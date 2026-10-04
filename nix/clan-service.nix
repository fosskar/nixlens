{ nosModule }:
{ lib, ... }:
let
  certs = import ./certs.nix { inherit lib; };
  certGenerator = pkgs: args: {
    dependencies = [ "nos-ca" ];
    files."cert.pem".secret = false;
    files."key.pem" = { };
    runtimeInputs = [ pkgs.openssl ];
    script = certs.cert args;
  };
in
{
  _class = "clan.service";
  manifest.name = "@fosskar/nos";
  manifest.description = "Read-only web frontend for the machines of a clan";
  manifest.readme = ''
    `agent` machines report their state; the `hub` serves the web UI on
    loopback (put an authenticating reverse proxy in front) and reaches each
    agent at `<machine>.<meta.domain>` over mutual TLS. A private ca in the
    vars store signs one certificate per machine. A hub machine needs no
    agent role.
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
        nixosModule =
          { config, pkgs, ... }:
          let
            inherit (config.networking) hostName;
            cert = config.clan.core.vars.generators.nos-agent.files;
          in
          {
            clan.core.vars.generators.nos-agent = certGenerator pkgs {
              name = hostName;
              usage = "serverAuth";
              sans = [
                "${hostName}.${config.clan.core.settings.domain}"
                hostName
              ];
            };
            services.nos = {
              enable = true;
              listenAddress = "::";
              inherit (settings) port openFirewall;
              tls.certFile = cert."cert.pem".path;
              tls.keyFile = cert."key.pem".path;
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
          { config, pkgs, ... }:
          let
            cert = config.clan.core.vars.generators.nos-hub.files;
          in
          {
            clan.core.vars.generators.nos-hub = certGenerator pkgs {
              name = config.networking.hostName;
              usage = "clientAuth";
            };
            services.nos = {
              enable = true;
              # explicit, so a machine that is also an agent (::) fails
              # evaluation instead of exposing the unauthenticated ui
              listenAddress = "127.0.0.1";
              inherit (settings) port;
              tls.certFile = cert."cert.pem".path;
              tls.keyFile = cert."key.pem".path;
              hub.enable = true;
              hub.peers = lib.mapAttrs (
                name: machine:
                "https://${name}.${config.clan.core.settings.domain}:${toString machine.settings.port}"
              ) (roles.agent.machines or { });
            };
          };
      };
  };

  perMachine.nixosModule =
    { config, pkgs, ... }:
    {
      imports = [ nosModule ];
      # the key never leaves the vars store
      clan.core.vars.generators.nos-ca = {
        share = true;
        files."ca.crt".secret = false;
        files."ca.key".deploy = false;
        runtimeInputs = [ pkgs.openssl ];
        script = certs.ca;
      };
      services.nos.tls.caFile = config.clan.core.vars.generators.nos-ca.files."ca.crt".path;
    };
}
