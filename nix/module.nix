{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nixlens;
  shared = import ./options.nix { inherit lib; };
  loopback = lib.elem cfg.listenAddress [
    "127.0.0.1"
    "::1"
    "localhost"
  ];
  # an agent serves https to the hubs it trusts; the hub's own listener
  # stays plain http behind its proxy
  tls = !cfg.hub.enable && cfg.trustedHubs != [ ];

  apps = lib.mapAttrsToList (name: app: {
    inherit name;
    inherit (app)
      url
      icon
      category
      description
      ;
  }) cfg.apps;

  appsFile = pkgs.writeText "nixlens-apps.json" (builtins.toJSON apps);
in
{
  options.services.nixlens = {
    enable = lib.mkEnableOption "the nixlens agent, which reports this machine's state";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The nixlens package to run.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address nixlens listens on. A hub should stay on loopback behind an authenticating reverse proxy.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 7480;
      description = "Port nixlens listens on.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open {option}`services.nixlens.port` in the firewall.";
    };

    keyFile = lib.mkOption {
      # externalPath rejects the world-readable nix store, where a path
      # literal would copy the key
      type = lib.types.nullOr lib.types.externalPath;
      default = null;
      description = ''
        This machine's ed25519 key for mutual TLS between hub and agents, in
        PKCS #8 PEM. Without one, nixlens creates its own in its state directory
        on first start. Either way its fingerprint is logged on every start
        (`journalctl -u nixlens | grep fingerprint`), for
        {option}`services.nixlens.trustedHubs` and
        {option}`services.nixlens.hub.peers.<name>.fingerprint` on the other side.
      '';
    };

    trustedHubs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "SHA256:mE3VtPq1Zz8l1d7m4cX0nV2QHqzQd5a8V0b8m1f7n6Y" ];
      description = ''
        Fingerprints of the hubs that may read this agent. When set, the agent
        serves https and accepts only these hubs. Required when the agent
        listens beyond loopback.
      '';
    };

    inherit (shared) apps smart;

    hub = {
      enable = lib.mkEnableOption "the nixlens web UI, aggregating this machine with its peers";

      peers = lib.mkOption {
        type = lib.types.attrsOf (
          lib.types.submodule {
            options = {
              url = lib.mkOption {
                type = lib.types.str;
                example = "https://nixbox.example.lan:7480";
                description = "Base URL of the agent.";
              };
              fingerprint = lib.mkOption {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "Fingerprint of the agent's key, required for an https URL.";
              };
            };
          }
        );
        default = { };
        description = "Agents shown by this hub, by machine name.";
      };

      inherit (shared.hub)
        categories
        accountUrl
        adminGroups
        categoryGroups
        ;
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
        message = "services.nixlens.hub trusts the Remote-* headers of a reverse proxy, so services.nixlens.listenAddress must be a loopback address";
      }
      {
        assertion = cfg.hub.enable || loopback || tls;
        message = "services.nixlens listens on ${cfg.listenAddress}; set services.nixlens.trustedHubs, or anyone who reaches the port can read this machine's system and storage data";
      }
      {
        assertion = !(cfg.hub.enable && cfg.trustedHubs != [ ]);
        message = "services.nixlens.trustedHubs is for agents; a hub is reached through its reverse proxy";
      }
    ]
    ++ lib.mapAttrsToList (name: peer: {
      assertion = lib.hasPrefix "https://" peer.url == (peer.fingerprint != null);
      message = "services.nixlens.hub.peers.${name}: an https url needs a fingerprint, and a fingerprint an https url";
    }) cfg.hub.peers;

    systemd.services.nixlens = {
      description = "nixlens dashboard";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      path = [
        pkgs.ethtool
        pkgs.util-linux
      ]
      ++ lib.optional config.boot.zfs.enabled config.boot.zfs.package;
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
            "/run/nixlens/installed-memory"
          ]
          ++ lib.optionals cfg.smart.enable [
            "-smart-file"
            "/run/nixlens-smart/smart.json"
          ]
          ++ [
            "-key"
            (if cfg.keyFile == null then "/var/lib/nixlens/key.pem" else "%d/key")
          ]
          ++ lib.optionals tls [
            "-trust"
            (lib.concatStringsSep "," cfg.trustedHubs)
          ]
          ++ lib.optionals cfg.hub.enable [
            "-hub"
            "-peers"
            (pkgs.writeText "nixlens-peers.json" (
              builtins.toJSON (
                lib.mapAttrs (_: peer: {
                  inherit (peer) url;
                  fingerprint = if peer.fingerprint == null then "" else peer.fingerprint;
                }) cfg.hub.peers
              )
            ))
            "-categories"
            (lib.concatStringsSep "," cfg.hub.categories)
            "-admin-groups"
            (lib.concatStringsSep "," cfg.hub.adminGroups)
            "-category-groups"
            (pkgs.writeText "nixlens-category-groups.json" (builtins.toJSON cfg.hub.categoryGroups))
            "-icon-cache"
            "/var/lib/nixlens/icons"
          ]
          ++ lib.optionals (cfg.hub.enable && cfg.hub.accountUrl != null) [
            "-account-url"
            cfg.hub.accountUrl
          ]
        );
        ExecStartPre = "+${lib.getExe cfg.package} -write-installed-memory /run/nixlens/installed-memory";
        RuntimeDirectory = "nixlens";
        # holds the key nixlens creates when services.nixlens.keyFile is unset,
        # and the app icons a hub fetched
        StateDirectory = "nixlens";
        LoadCredential = lib.mkIf (cfg.keyFile != null) [ "key:${cfg.keyFile}" ];
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
        # netlink lists interface addresses
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_NETLINK"
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

    systemd.services.nixlens-smart = lib.mkIf cfg.smart.enable {
      description = "nixlens SMART collection";
      path = [
        pkgs.smartmontools
        pkgs.util-linux
      ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe cfg.package} -collect-smart /run/nixlens-smart/smart.json";
        RuntimeDirectory = "nixlens-smart";
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

    systemd.timers.nixlens-smart = lib.mkIf cfg.smart.enable {
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "2min";
        OnUnitActiveSec = "30min";
      };
    };
  };
}
