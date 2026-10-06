{
  lib,
  testers,
  nixlensModule,
}:
let
  # fixed keys for the test only; their fingerprints are written out below,
  # so the configuration needs no key at evaluation time
  keys = {
    hub = {
      file = ./test-keys/hub.pem;
      fingerprint = "SHA256:6PYaZQqsy1qpSBCVqlN2BpfrAZGF0QB6k9Chgqo7mM4";
    };
    agent = {
      file = ./test-keys/agent.pem;
      fingerprint = "SHA256:kCMYrBc50GUIBasXh+I46P+YP5e5kWUBIUN/iegW9fM";
    };
  };
  # keys must not be nix store paths, so they are reached through /etc
  keyFor = role: {
    environment.etc."nixlens/key.pem".source = keys.${role}.file;
    services.nixlens.keyFile = "/etc/nixlens/key.pem";
  };
in
testers.runNixOSTest {
  name = "nixlens";

  nodes.hub =
    { pkgs, ... }:
    {
      imports = [
        nixlensModule
        (keyFor "hub")
      ];
      environment.systemPackages = [ pkgs.openssl ];
      services.nixlens = {
        enable = true;
        hub.enable = true;
        hub.peers.agent = {
          url = "https://agent:7480";
          inherit (keys.agent) fingerprint;
        };
        hub.categories = [ "Monitoring" ];
        hub.adminGroups = [ "admin" ];
        hub.accountUrl = "https://auth.example.com/settings";
        hub.categoryGroups.Monitoring = [ "admin" ];
      };
      services.nixlens.apps.Grafana = {
        url = "http://grafana.example.com:3000";
        icon = "grafana.svg";
        category = "Monitoring";
      };
    };

  nodes.agent = {
    imports = [
      nixlensModule
      (keyFor "agent")
    ];
    virtualisation.emptyDiskImages = [
      512
      512
    ];
    boot.supportedFilesystems = [ "zfs" ];
    networking.hostId = "8425e349";
    services.nixlens = {
      enable = true;
      smart.enable = true;
      listenAddress = "::";
      openFirewall = true;
      trustedHubs = [ keys.hub.fingerprint ];
    };
    services.nixlens.apps.Immich = {
      url = "https://immich.example.com";
      category = "Media";
      description = "photos";
    };
  };

  testScript =
    { nodes, ... }:
    ''
      import json

      def get(node, path, groups="admin"):
          return json.loads(node.succeed(f"curl -sf -H 'Remote-Groups: {groups}' -H 'Remote-Name: Simon' http://127.0.0.1:7480{path}"))

      start_all()
      agent.wait_for_open_port(7480, timeout=60)
      hub.wait_for_open_port(7480, timeout=60)

      # curl pins the agent's key like the hub does; the hub's key needs a
      # certificate around it for curl
      pin = "--insecure --pinnedpubkey sha256//" + "${lib.removePrefix "SHA256:" keys.agent.fingerprint}="
      hub.succeed("openssl req -x509 -new -key /etc/nixlens/key.pem -subj /CN=hub -days 1 -out /tmp/hub.crt")
      hub.succeed("openssl genpkey -algorithm ed25519 -out /tmp/other.pem && openssl req -x509 -new -key /tmp/other.pem -subj /CN=other -days 1 -out /tmp/other.crt")
      mine = "--cert /tmp/hub.crt --key /etc/nixlens/key.pem"
      hub.fail("curl -sf http://agent:7480/api/local/system")
      hub.fail(f"curl -sf {pin} https://agent:7480/api/local/system")
      hub.succeed(f"curl -sf {pin} {mine} https://agent:7480/api/local/system")
      # a key the agent does not trust is rejected, and the hub would reject
      # an agent with another key
      hub.fail(f"curl -sf {pin} --cert /tmp/other.crt --key /tmp/other.pem https://agent:7480/api/local/system")
      hub.fail(f"curl -sf --insecure --pinnedpubkey sha256//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= {mine} https://agent:7480/api/local/system")
      # agents serve no ui
      hub.fail(f"curl -sf {pin} {mine} https://agent:7480/")
      agent.succeed("journalctl -u nixlens | grep -q 'key fingerprint ${keys.agent.fingerprint}'")

      # without services.nixlens.keyFile nixlens creates its key in its state
      # directory, as the dynamic user it runs as, and keeps it
      autokey = "systemd-run --wait --pipe -p DynamicUser=yes -p StateDirectory=nixlens-autokey ${lib.getExe nodes.agent.services.nixlens.package} -key /var/lib/nixlens-autokey/key.pem -fingerprint"
      first, second = agent.succeed(autokey).strip(), agent.succeed(autokey).strip()
      assert first == second and first.startswith("SHA256:"), (first, second)
      agent.succeed("test -s /var/lib/private/nixlens-autokey/key.pem")

      machines = get(hub, "/api/overview")
      assert [(m["name"], m["self"], m["online"]) for m in machines] == [
        ("hub", True, True),
        ("agent", False, True),
      ], machines

      system = get(hub, "/api/machines/agent/system")
      assert system["hostname"] == "agent", system
      assert system["memTotal"] > 0 and system["swaps"] == [], system
      assert 0 < system["cores"] <= system["cpus"], system

      assert system["memInstalled"] == 1024 * 2**20, system

      agent.succeed("ip link add nixlensbr0 type bridge && ip tuntap add nixlenstap0 mode tap && ip link set nixlenstap0 master nixlensbr0")
      network = {i["name"]: i for i in get(hub, "/api/machines/agent/network")}
      assert "lo" not in network, network
      eth1 = network["eth1"]
      assert eth1["kind"] == "ethernet" and eth1["up"] and eth1["driver"] == "virtio_net", eth1
      assert any(a.startswith("192.168.1.") for a in eth1["addresses"]), eth1
      assert network["nixlensbr0"]["kind"] == "bridge", network
      assert network["nixlenstap0"]["kind"] == "tap" and network["nixlenstap0"]["master"] == "nixlensbr0", network

      agent.succeed("zpool create -f testpool mirror /dev/vdb /dev/vdc")
      # the agent caches storage for a few seconds, and the overview above read it
      def has_zfs_pool(_):
          global storage
          storage = get(hub, "/api/machines/agent/storage")
          return any(p["kind"] == "zfs" for p in storage["pools"])
      retry(has_zfs_pool)
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

      agent.succeed("systemctl start nixlens-smart.service")
      agent.succeed("test -s /run/nixlens-smart/smart.json")
      storage = get(hub, "/api/machines/agent/storage")
      assert all("smart" not in d for d in storage["disks"]), storage["disks"]

      apps = get(hub, "/api/apps")
      assert [(a["name"], a["machine"], a["category"], a["icon"]) for a in apps] == [
        ("Grafana", "hub", "Monitoring", "grafana.svg"),
        ("Immich", "agent", "Media", ""),
      ], apps

      hub.succeed("curl -sf http://127.0.0.1:7480/ | grep -q '<title>nixlens</title>'")

      me = get(hub, "/api/me", groups="user, admin")
      assert me["name"] == "Simon" and me["groups"] == ["user", "admin"] and me["admin"], me
      assert me["accountUrl"] == "https://auth.example.com/settings", me
      assert not get(hub, "/api/me", groups="user")["admin"]
      hub.fail("curl -sf -H 'Remote-Groups: user' http://127.0.0.1:7480/api/overview")
      overview = get(hub, "/api/overview")
      assert [(m["name"], m["online"], "system" in m, "storage" in m) for m in overview] == [
        ("hub", True, True, True),
        ("agent", True, True, True),
      ], overview
      assert [a["name"] for a in get(hub, "/api/apps", groups="user")] == ["Immich"]

      agent.stop_job("nixlens.service")
      machines = get(hub, "/api/overview")
      assert not machines[1]["online"], machines
      hub.fail("curl -sf -H 'Remote-Groups: admin' http://127.0.0.1:7480/api/machines/agent/system")
    '';
}
