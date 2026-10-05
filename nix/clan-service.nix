{ nosModule }:
{ lib, clanLib, ... }:
let
  # the public half of another machine's key, from the vars store
  fingerprintOf =
    config: machine:
    lib.trim (
      clanLib.getPublicValue {
        flake = config.clan.core.settings.directory;
        inherit machine;
        generator = "nos";
        file = "fingerprint";
      }
    );
in
{
  _class = "clan.service";
  manifest.name = "@fosskar/nos";
  manifest.description = "Visual overview of the machines of a clan, with their apps one click away";
  manifest.readme = ''
    `agent` machines report their state; the `hub` serves the web UI on
    loopback (put an authenticating reverse proxy in front) and reaches each
    agent at `<machine>.<meta.domain>` over mutual TLS. Every machine gets
    its own key from the vars store; hub and agents pin each other's
    fingerprints, so there is no CA. A hub machine needs no agent role.
  '';

  roles.agent = {
    description = "Reports this machine's system, drives, network and apps to the hub";
    interface = {
      options = {
        port = lib.mkOption {
          type = lib.types.port;
          default = 7480;
          description = "Port the agent listens on.";
        };
        openFirewall = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Open the agent port in the firewall.";
        };
      };
    };
    perInstance =
      { settings, roles, ... }:
      {
        nixosModule =
          { config, ... }:
          {
            services.nos = {
              enable = true;
              listenAddress = "::";
              inherit (settings) port openFirewall;
              trustedHubs = map (fingerprintOf config) (lib.attrNames (roles.hub.machines or { }));
            };
          };
      };
  };

  roles.hub = {
    description = "Serves the web UI for all agents";
    interface = {
      options.port = lib.mkOption {
        type = lib.types.port;
        default = 7480;
        description = "Loopback port the hub listens on.";
      };
    };
    perInstance =
      { settings, roles, ... }:
      {
        nixosModule =
          { config, ... }:
          {
            services.nos = {
              enable = true;
              # explicit, so a machine that is also an agent (::) fails
              # evaluation instead of exposing the unauthenticated ui
              listenAddress = "127.0.0.1";
              inherit (settings) port;
              hub.enable = true;
              hub.peers = lib.mapAttrs (name: machine: {
                url = "https://${name}.${config.clan.core.settings.domain}:${toString machine.settings.port}";
                fingerprint = fingerprintOf config name;
              }) (roles.agent.machines or { });
            };
          };
      };
  };

  perMachine.nixosModule =
    { config, ... }:
    {
      imports = [ nosModule ];
      # nos creates the key and prints its fingerprint itself, so the format
      # always matches what it checks
      clan.core.vars.generators.nos = {
        files."key.pem" = { };
        files.fingerprint.secret = false;
        runtimeInputs = [ config.services.nos.package ];
        script = ''
          nos -key "$out/key.pem" -fingerprint > "$out/fingerprint"
        '';
      };
      services.nos.keyFile = config.clan.core.vars.generators.nos.files."key.pem".path;
    };
}
