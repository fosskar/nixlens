{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nos;
  tlsFilesSet = lib.count (f: f != null) [
    cfg.tls.certFile
    cfg.tls.keyFile
    cfg.tls.caFile
  ];
  tls = tlsFilesSet == 3;

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
      default = 7480;
      description = "Port nOS listens on.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open {option}`services.nos.port` in the firewall.";
    };

    tls = {
      certFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = ''
          Certificate for mutual TLS: an agent's server certificate
          (extended key usage serverAuth, naming the host the hub dials), or
          the hub's client certificate (clientAuth).
        '';
      };
      keyFile = lib.mkOption {
        # externalPath rejects the world-readable nix store, where a path
        # literal would copy the key
        type = lib.types.nullOr lib.types.externalPath;
        default = null;
        description = "Private key of {option}`services.nos.tls.certFile`.";
      };
      caFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "CA that an agent checks the hub against, and the hub checks its agents against.";
      };
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

    smart.enable = lib.mkEnableOption ''
      SMART health of all drives, collected every 30 minutes by a separate
      oneshot with raw disk access. Sleeping drives are not woken; they keep
      their last values
    '';

    hub = {
      enable = lib.mkEnableOption "the nOS web UI, aggregating this machine with its peers";

      peers = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        example = {
          nixbox = "http://nixbox.example.lan:7480";
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

      adminGroups = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [ "admin" ];
        description = ''
          Groups, from the reverse proxy's `Remote-Groups` header, that see
          machines, system and storage. Empty allows every request.
        '';
      };

      categoryGroups = lib.mkOption {
        type = lib.types.attrsOf (lib.types.listOf lib.types.str);
        default = { };
        example = {
          admin = [ "admin" ];
        };
        description = "Categories listed only for the given groups; unlisted categories are visible to everyone.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion =
          !cfg.hub.enable
          || lib.elem cfg.listenAddress [
            "127.0.0.1"
            "::1"
            "localhost"
          ];
        message = "services.nos.hub trusts the Remote-* headers of a reverse proxy, so services.nos.listenAddress must be a loopback address";
      }
      {
        assertion = lib.elem tlsFilesSet [
          0
          3
        ];
        message = "services.nos.tls.certFile, keyFile and caFile must be set together";
      }
      {
        assertion =
          !(cfg.hub.enable && tls) || lib.all (lib.hasPrefix "https://") (lib.attrValues cfg.hub.peers);
        message = "with services.nos.tls set, every services.nos.hub.peers url must use https";
      }
    ];

    warnings =
      lib.optional
        (
          !tls
          && !(lib.elem cfg.listenAddress [
            "127.0.0.1"
            "::1"
            "localhost"
          ])
        )
        "services.nos listens on ${cfg.listenAddress} without services.nos.tls, so anyone who reaches the port can read this machine's system and storage data";

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
            "${
              if lib.hasInfix ":" cfg.listenAddress then "[${cfg.listenAddress}]" else cfg.listenAddress
            }:${toString cfg.port}"
            "-apps"
            appsFile
            "-installed-memory-file"
            "/run/nos/installed-memory"
          ]
          ++ lib.optionals cfg.smart.enable [
            "-smart-file"
            "/run/nos-smart/smart.json"
          ]
          ++ lib.optionals tls [
            "-tls-cert"
            "%d/cert"
            "-tls-key"
            "%d/key"
            "-tls-ca"
            "%d/ca"
          ]
          ++ lib.optionals cfg.hub.enable [
            "-hub"
            "-peers"
            (pkgs.writeText "nos-peers.json" (builtins.toJSON cfg.hub.peers))
            "-categories"
            (lib.concatStringsSep "," cfg.hub.categories)
            "-admin-groups"
            (lib.concatStringsSep "," cfg.hub.adminGroups)
            "-category-groups"
            (pkgs.writeText "nos-category-groups.json" (builtins.toJSON cfg.hub.categoryGroups))
          ]
        );
        ExecStartPre = "+${lib.getExe cfg.package} -write-installed-memory /run/nos/installed-memory";
        RuntimeDirectory = "nos";
        LoadCredential = lib.mkIf tls [
          "cert:${cfg.tls.certFile}"
          "key:${cfg.tls.keyFile}"
          "ca:${cfg.tls.caFile}"
        ];
        DynamicUser = true;
        Restart = "on-failure";
        ProtectSystem = "strict";
        # statfs on filesystems mounted below /home; home directories stay 0700
        ProtectHome = "read-only";
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
        ];
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged @resources"
        ];
        SystemCallErrorNumber = "EPERM";
        CapabilityBoundingSet = "";
        ProtectKernelTunables = true;
        ProtectProc = "invisible";
        # lsblk reads sysfs and the udev database; zpool and zfs need /dev/zfs
        DevicePolicy = "closed";
        DeviceAllow = lib.optional config.boot.zfs.enabled "/dev/zfs rw";
        MemoryMax = "256M";
        TasksMax = 64;
        UMask = "0077";
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];

    systemd.services.nos-smart = lib.mkIf cfg.smart.enable {
      description = "nOS SMART collection";
      path = [
        pkgs.smartmontools
        pkgs.util-linux
      ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe cfg.package} -collect-smart /run/nos-smart/smart.json";
        RuntimeDirectory = "nos-smart";
        RuntimeDirectoryMode = "0755";
        RuntimeDirectoryPreserve = true;
        # smartctl needs CAP_SYS_RAWIO for ata passthrough and CAP_SYS_ADMIN
        # for nvme admin commands; everything else stays closed
        CapabilityBoundingSet = "CAP_SYS_RAWIO CAP_SYS_ADMIN";
        PrivateNetwork = true;
        IPAddressDeny = "any";
        RestrictAddressFamilies = [ "AF_UNIX" ];
        # read access to disks is enough for smart queries
        DevicePolicy = "closed";
        DeviceAllow = [
          "block-sd r"
          "block-blkext r"
          "char-nvme r"
        ];
        SystemCallFilter = [
          "@system-service"
          "~@privileged @resources"
        ];
        SystemCallErrorNumber = "EPERM";
        ProtectKernelTunables = true;
        ProtectProc = "invisible";
        UMask = "0022";
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
        SystemCallArchitectures = "native";
      };
    };

    systemd.timers.nos-smart = lib.mkIf cfg.smart.enable {
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "2min";
        OnUnitActiveSec = "30min";
      };
    };
  };
}
