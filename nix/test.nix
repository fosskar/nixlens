{ testers, nosModule }:
let
  tokenFile = builtins.toFile "nos-token" "test-token";
in
testers.runNixOSTest {
  name = "nos";

  nodes.hub = {
    imports = [ nosModule ];
    services.nos = {
      enable = true;
      inherit tokenFile;
      hub.enable = true;
      hub.peers.agent = "http://agent:8090";
    };
    services.caddy = {
      enable = true;
      virtualHosts."jellyfin.example.com, http://grafana.example.com:3000".extraConfig = "respond ok";
    };
  };

  nodes.agent = {
    imports = [ nosModule ];
    services.nos = {
      enable = true;
      listenAddress = "0.0.0.0";
      openFirewall = true;
      inherit tokenFile;
    };
    services.nginx = {
      enable = true;
      virtualHosts."immich.example.com" = { };
      virtualHosts.explorer.listen = [
        {
          addr = "0.0.0.0";
          port = 8098;
        }
      ];
      virtualHosts.internal.listen = [
        {
          addr = "127.0.0.1";
          port = 8099;
        }
      ];
    };
  };

  testScript = ''
    import json

    def get(node, path):
        return json.loads(node.succeed(f"curl -sf http://127.0.0.1:8090{path}"))

    start_all()
    agent.wait_for_open_port(8090)
    hub.wait_for_open_port(8090)

    hub.fail("curl -sf http://agent:8090/api/local/system")
    hub.succeed("curl -sf -H 'Authorization: Bearer test-token' http://agent:8090/api/local/system")
    agent.fail("curl -sf http://127.0.0.1:8090/")

    machines = get(hub, "/api/machines")
    assert [(m["name"], m["self"], m["online"]) for m in machines] == [
      ("hub", True, True),
      ("agent", False, True),
    ], machines

    system = get(hub, "/api/machines/agent/system")
    assert system["hostname"] == "agent", system
    assert system["memTotal"] > 0 and "swapTotal" in system, system

    disks = get(hub, "/api/machines/agent/disks")
    assert any(d["name"] == "vda" for d in disks), disks

    apps = get(hub, "/api/apps")
    assert [(a["name"], a["machine"], a["url"]) for a in apps] == [
      ("explorer", "agent", "http://agent:8098"),
      ("grafana", "hub", "http://grafana.example.com:3000"),
      ("immich", "agent", "https://immich.example.com"),
      ("jellyfin", "hub", "https://jellyfin.example.com"),
    ], apps

    hub.succeed("curl -sf http://127.0.0.1:8090/ | grep -q '<title>nOS</title>'")

    agent.stop_job("nos.service")
    machines = get(hub, "/api/machines")
    assert not machines[1]["online"], machines
    hub.fail("curl -sf http://127.0.0.1:8090/api/machines/agent/system")
  '';
}
