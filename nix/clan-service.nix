{ nosModule }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "@fosskar/nos";
  manifest.description = "Read-only web frontend for the machines of a clan";
  manifest.readme = ''
    `agent` machines report their state; the `hub` serves the web UI on
    loopback (put an authenticating reverse proxy in front) and reaches each
    agent at `<machine>.<meta.domain>`. A hub machine needs no agent role.

    The hub sends the shared token to agents over plain http, so that
    domain must resolve over an encrypted, authenticated network such as
    yggdrasil or wireguard.
  '';

  roles.agent = {
    description = "Reports this machine's system, drives and apps to the hub";
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
      { settings, ... }:
      {
        nixosModule = {
          services.nos = {
            enable = true;
            # dual-stack; mesh networks such as yggdrasil are ipv6-only
            listenAddress = "::";
            inherit (settings) port openFirewall;
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
              # explicit, so a machine that is also an agent (0.0.0.0) fails
              # evaluation instead of exposing the unauthenticated ui
              listenAddress = "127.0.0.1";
              inherit (settings) port;
              hub.enable = true;
              hub.peers = lib.mapAttrs (
                name: machine:
                "http://${name}.${config.clan.core.settings.domain}:${toString machine.settings.port}"
              ) (roles.agent.machines or { });
            };
          };
      };
  };

  perMachine.nixosModule =
    { config, pkgs, ... }:
    {
      imports = [ nosModule ];
      clan.core.vars.generators.nos = {
        share = true;
        files.token = { };
        runtimeInputs = [ pkgs.openssl ];
        script = ''
          openssl rand -hex 32 > "$out/token"
        '';
      };
      services.nos.tokenFile = config.clan.core.vars.generators.nos.files.token.path;
    };
}
