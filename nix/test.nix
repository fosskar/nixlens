{
  lib,
  testers,
  runCommand,
  openssl,
  nosModule,
}:
let
  certs = import ./certs.nix { inherit lib; };
  # the same scripts the clan service runs as vars generators
  testCerts = runCommand "nos-test-certs" { nativeBuildInputs = [ openssl ]; } ''
    mkdir -p $out/nos-ca $out/agent $out/hub
    (out=$out/nos-ca; ${certs.ca})
    (in=$out; out=$out/agent; cd "$(mktemp -d)"; ${
      certs.cert {
        name = "agent";
        usage = "serverAuth";
        sans = [ "agent" ];
      }
    })
    (in=$out; out=$out/hub; cd "$(mktemp -d)"; ${
      certs.cert {
        name = "hub";
        usage = "clientAuth";
      }
    })
  '';
  # keys must not be nix store paths, so they are reached through /etc
  tlsFor = role: {
    environment.etc."nos/key.pem".source = "${testCerts}/${role}/key.pem";
    environment.etc."nos/cert.pem".source = "${testCerts}/${role}/cert.pem";
    environment.etc."nos/ca.crt".source = "${testCerts}/nos-ca/ca.crt";
    services.nos.tls = {
      certFile = "${testCerts}/${role}/cert.pem";
      keyFile = "/etc/nos/key.pem";
      caFile = "${testCerts}/nos-ca/ca.crt";
    };
  };
in
testers.runNixOSTest {
  name = "nos";

  nodes.hub = {
    imports = [
      nosModule
      (tlsFor "hub")
    ];
    services.nos = {
      enable = true;
      hub.enable = true;
      hub.peers.agent = "https://agent:7480";
      hub.categories = [ "Monitoring" ];
      hub.adminGroups = [ "admin" ];
      hub.accountUrl = "https://auth.example.com/settings";
      hub.categoryGroups.Monitoring = [ "admin" ];
    };
    services.nos.apps.Grafana = {
      url = "http://grafana.example.com:3000";
      icon = "grafana.svg";
      category = "Monitoring";
    };
  };

  nodes.agent = {
    imports = [
      nosModule
      (tlsFor "agent")
    ];
    virtualisation.emptyDiskImages = [
      512
      512
    ];
    boot.supportedFilesystems = [ "zfs" ];
    networking.hostId = "8425e349";
    services.nos = {
      enable = true;
      smart.enable = true;
      listenAddress = "::";
      openFirewall = true;
    };
    services.nos.apps.Immich = {
      url = "https://immich.example.com";
      category = "Media";
      description = "photos";
    };
  };

  testScript = ''
    import json

    def get(node, path, groups="admin"):
        return json.loads(node.succeed(f"curl -sf -H 'Remote-Groups: {groups}' -H 'Remote-Name: Simon' http://127.0.0.1:7480{path}"))

    start_all()
    agent.wait_for_open_port(7480, timeout=60)
    hub.wait_for_open_port(7480, timeout=60)

    tls = "--cacert /etc/nos/ca.crt"
    mine = "--cert /etc/nos/cert.pem --key /etc/nos/key.pem"
    hub.fail("curl -sf http://agent:7480/api/local/system")
    hub.fail(f"curl -sf {tls} https://agent:7480/api/local/system")
    hub.succeed(f"curl -sf {tls} {mine} https://agent:7480/api/local/system")
    # an agent's own certificate must not work as a client certificate
    agent.fail(f"curl -sf {tls} {mine} https://agent:7480/api/local/system")
    # agents serve no ui
    hub.fail(f"curl -sf {tls} {mine} https://agent:7480/")

    machines = get(hub, "/api/machines")
    assert [(m["name"], m["self"], m["online"]) for m in machines] == [
      ("hub", True, True),
      ("agent", False, True),
    ], machines

    system = get(hub, "/api/machines/agent/system")
    assert system["hostname"] == "agent", system
    assert system["memTotal"] > 0 and system["swaps"] == [], system
    assert 0 < system["cores"] <= system["cpus"], system

    assert system["memInstalled"] == 1024 * 2**20, system

    agent.succeed("ip link add nosbr0 type bridge && ip tuntap add nostap0 mode tap && ip link set nostap0 master nosbr0")
    network = {i["name"]: i for i in get(hub, "/api/machines/agent/network")}
    assert "lo" not in network, network
    eth1 = network["eth1"]
    assert eth1["kind"] == "ethernet" and eth1["up"] and eth1["driver"] == "virtio_net", eth1
    assert any(a.startswith("192.168.1.") for a in eth1["addresses"]), eth1
    assert network["nosbr0"]["kind"] == "bridge", network
    assert network["nostap0"]["kind"] == "tap" and network["nostap0"]["master"] == "nosbr0", network

    agent.succeed("zpool create -f testpool mirror /dev/vdb /dev/vdc")
    storage = get(hub, "/api/machines/agent/storage")
    [pool] = [p for p in storage["pools"] if p["kind"] == "zfs"]
    assert pool["name"] == "testpool" and pool["state"] == "ONLINE" and pool["usable"] > 0, pool
    [group] = pool["groups"]
    assert group["layout"] == "mirror", group
    assert sorted(m["device"] for m in group["members"]) == ["vdb", "vdc"], group
    root = [p for p in storage["pools"] if p["state"] == "mounted" and any(m["device"] == "vda" for g in p["groups"] for m in g["members"])]
    assert root and root[0]["usable"] > 0, storage["pools"]
    vda = next(d for d in storage["disks"] if d["name"] == "vda")
    assert any(p["pool"] == root[0]["name"] for p in vda["partitions"]), vda
    vdb = next(d for d in storage["disks"] if d["name"] == "vdb")
    assert any(p["pool"] == "testpool" and p["role"] == "mirror" for p in vdb["partitions"]), vdb
    assert any(p["pool"] == "" and p["role"] == "zfs reserved" for p in vdb["partitions"]), vdb

    agent.succeed("zfs create -o quota=100M testpool/data && zfs snapshot testpool/data@one")
    detail = get(hub, "/api/machines/agent/pool/testpool")
    data = next(d for d in detail["datasets"] if d["name"] == "testpool/data")
    assert data["quota"] == 100 * 2**20 and data["snapshots"] == 1 and data["lastSnapshot"] > 0, data
    assert detail["properties"]["ashift"], detail
    hub.fail("curl -sf -H 'Remote-Groups: admin' http://127.0.0.1:7480/api/machines/agent/pool/-o")

    agent.succeed("systemctl start nos-smart.service")
    agent.succeed("test -s /run/nos-smart/smart.json")
    storage = get(hub, "/api/machines/agent/storage")
    assert all("smart" not in d for d in storage["disks"]), storage["disks"]

    apps = get(hub, "/api/apps")
    assert [(a["name"], a["machine"], a["category"], a["icon"]) for a in apps] == [
      ("Grafana", "hub", "Monitoring", "grafana.svg"),
      ("Immich", "agent", "Media", ""),
    ], apps

    hub.succeed("curl -sf http://127.0.0.1:7480/ | grep -q '<title>nOS</title>'")

    me = get(hub, "/api/me", groups="user, admin")
    assert me["name"] == "Simon" and me["groups"] == ["user", "admin"] and me["admin"], me
    assert me["accountUrl"] == "https://auth.example.com/settings", me
    assert not get(hub, "/api/me", groups="user")["admin"]
    hub.fail("curl -sf -H 'Remote-Groups: user' http://127.0.0.1:7480/api/machines")
    hub.fail("curl -sf -H 'Remote-Groups: user' http://127.0.0.1:7480/api/overview")
    overview = get(hub, "/api/overview")
    assert [(m["name"], m["online"], "system" in m, "storage" in m) for m in overview] == [
      ("hub", True, True, True),
      ("agent", True, True, True),
    ], overview
    assert [a["name"] for a in get(hub, "/api/apps", groups="user")] == ["Immich"]

    agent.stop_job("nos.service")
    machines = get(hub, "/api/machines")
    assert not machines[1]["online"], machines
    hub.fail("curl -sf -H 'Remote-Groups: admin' http://127.0.0.1:7480/api/machines/agent/system")
  '';
}
