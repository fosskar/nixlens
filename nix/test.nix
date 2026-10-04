{ testers, nosModule }:
let
  tokenFile = "/etc/nos-token";
  token.environment.etc."nos-token".text = "test-token";
in
testers.runNixOSTest {
  name = "nos";

  nodes.hub = {
    imports = [
      nosModule
      token
    ];
    services.nos = {
      enable = true;
      inherit tokenFile;
      hub.enable = true;
      hub.peers.agent = "http://agent:7480";
      hub.categories = [ "Monitoring" ];
      hub.adminGroups = [ "admin" ];
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
      token
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
      inherit tokenFile;
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

    hub.fail("curl -sf http://agent:7480/api/local/system")
    hub.succeed("curl -sf -H 'Authorization: Bearer test-token' http://agent:7480/api/local/system")
    agent.fail("curl -sf http://127.0.0.1:7480/")

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
    assert not get(hub, "/api/me", groups="user")["admin"]
    hub.fail("curl -sf -H 'Remote-Groups: user' http://127.0.0.1:7480/api/machines")
    assert [a["name"] for a in get(hub, "/api/apps", groups="user")] == ["Immich"]

    agent.stop_job("nos.service")
    machines = get(hub, "/api/machines")
    assert not machines[1]["online"], machines
    hub.fail("curl -sf -H 'Remote-Groups: admin' http://127.0.0.1:7480/api/machines/agent/system")
  '';
}
