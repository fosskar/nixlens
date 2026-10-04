{ testers, nosModule }:
testers.runNixOSTest {
  name = "nos";

  nodes.machine = {
    imports = [ nosModule ];
    services.nos.enable = true;
    services.caddy = {
      enable = true;
      virtualHosts."jellyfin.example.com, http://grafana.example.com:3000".extraConfig = "respond ok";
    };
  };

  testScript = ''
    import json

    machine.wait_for_unit("nos.service")
    machine.wait_for_open_port(8090)

    system = json.loads(machine.succeed("curl -sf http://127.0.0.1:8090/api/system"))
    assert system["hostname"] == "machine", system

    disks = json.loads(machine.succeed("curl -sf http://127.0.0.1:8090/api/disks"))
    assert any(d["name"] == "vda" for d in disks), disks

    apps = json.loads(machine.succeed("curl -sf http://127.0.0.1:8090/api/apps"))
    assert apps == [
      {"name": "grafana", "url": "http://grafana.example.com:3000"},
      {"name": "jellyfin", "url": "https://jellyfin.example.com"},
    ], apps

    machine.succeed("curl -sf http://127.0.0.1:8090/ | grep -q '<title>nOS</title>'")
  '';
}
