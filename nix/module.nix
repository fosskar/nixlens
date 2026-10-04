{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nos;

  apps = lib.mapAttrsToList (name: app: {
    inherit name;
    inherit (app)
      url
      icon
      category
      description
      ;
  }) cfg.apps;

  appsFile = pkgs.writeText "nos-apps.json" (builtins.toJSON apps);
in
{
  options.services.nos = {
    enable = lib.mkEnableOption "the nOS agent, which reports this machine's state";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The nos package to run.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address nOS listens on. A hub should stay on loopback behind an authenticating reverse proxy.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8090;
      description = "Port nOS listens on.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open {option}`services.nos.port` in the firewall.";
    };

    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "File with a bearer token that agents require and the hub sends to its peers.";
    };

    apps = lib.mkOption {
      type = lib.types.attrsOf (
        lib.types.submodule {
          options = {
            url = lib.mkOption {
              type = lib.types.str;
              description = "URL the app opens.";
            };
            icon = lib.mkOption {
              type = lib.types.str;
              default = "";
              example = "jellyfin.svg";
              description = "Icon: a dashboard-icons file or name, `sh-<name>` (selfh.st), `mdi-<name>`, or a URL.";
            };
            category = lib.mkOption {
              type = lib.types.str;
              default = "Apps";
              description = "Section the app is listed under.";
            };
            description = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = "Short description shown with the app.";
            };
          };
        }
      );
      default = { };
      example = {
        Jellyfin = {
          url = "https://jellyfin.example.com";
          icon = "jellyfin.svg";
          category = "Media";
        };
      };
      description = "Apps this machine provides, by display name.";
    };

    hub = {
      enable = lib.mkEnableOption "the nOS web UI, aggregating this machine with its peers";

      peers = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        example = {
          nixbox = "http://nixbox.example.lan:8090";
        };
        description = "Agents shown by this hub, by machine name and base URL.";
      };

      categories = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [
          "Media"
          "Tools"
        ];
        description = "App categories listed first, in this order; the rest follow alphabetically.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.nos = {
      description = "nOS dashboard";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      path = [ pkgs.util-linux ] ++ lib.optional config.boot.zfs.enabled config.boot.zfs.package;
      serviceConfig = {
        ExecStart = lib.escapeShellArgs (
          [
            (lib.getExe cfg.package)
            "-listen"
            "${cfg.listenAddress}:${toString cfg.port}"
            "-apps"
            appsFile
            "-installed-memory-file"
            "/run/nos/installed-memory"
          ]
          ++ lib.optionals (cfg.tokenFile != null) [
            "-token-file"
            "%d/token"
          ]
          ++ lib.optionals cfg.hub.enable [
            "-hub"
            "-peers"
            (pkgs.writeText "nos-peers.json" (builtins.toJSON cfg.hub.peers))
            "-categories"
            (lib.concatStringsSep "," cfg.hub.categories)
          ]
        );
        ExecStartPre = "+${lib.getExe cfg.package} -write-installed-memory /run/nos/installed-memory";
        RuntimeDirectory = "nos";
        LoadCredential = lib.mkIf (cfg.tokenFile != null) "token:${cfg.tokenFile}";
        DynamicUser = true;
        Restart = "on-failure";
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        NoNewPrivileges = true;
        ProtectControlGroups = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectClock = true;
        ProtectHostname = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        RestrictNamespaces = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
          "AF_NETLINK"
        ];
        SystemCallArchitectures = "native";
        CapabilityBoundingSet = "";
        UMask = "0077";
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
