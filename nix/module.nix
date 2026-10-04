{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nos;

  groups = matches: lib.concatMap (m: if builtins.isList m then m else [ ]) matches;

  mkApp =
    scheme: address:
    let
      parsed = builtins.match "([^:/]+)(:[0-9]+)?.*" address;
      host = builtins.elemAt parsed 0;
      port = builtins.elemAt parsed 1;
    in
    {
      name = builtins.head (lib.splitString "." host);
      url = "${scheme}://${host}${lib.optionalString (port != null) port}";
    };

  usable =
    address:
    address != ""
    && !(lib.hasPrefix ":" address)
    && !(lib.hasInfix "*" address)
    && address != "_"
    && builtins.match "localhost(:[0-9]+)?" address == null;

  caddyApps =
    let
      vhosts = config.services.caddy.virtualHosts;
      addresses = lib.concatLists (
        lib.mapAttrsToList (
          attrName: vhost: lib.concatMap (lib.splitString ",") ([ attrName ] ++ (vhost.serverAliases or [ ]))
        ) vhosts
      );
      toApp =
        raw:
        let
          trimmed = lib.trim raw;
          http = lib.hasPrefix "http://" trimmed;
          address = lib.removePrefix "https://" (lib.removePrefix "http://" trimmed);
        in
        lib.optional (usable address) (mkApp (if http then "http" else "https") address);
    in
    lib.concatMap toApp addresses;

  nginxApps = lib.concatLists (
    lib.mapAttrsToList (
      attrName: vhost:
      let
        tls =
          vhost.forceSSL || vhost.onlySSL || vhost.addSSL || vhost.enableACME || vhost.useACMEHost != null;
        names = [
          (if vhost.serverName == null then attrName else vhost.serverName)
        ]
        ++ vhost.serverAliases;
      in
      map (mkApp (if tls then "https" else "http")) (lib.filter usable names)
    ) config.services.nginx.virtualHosts
  );

  traefikApps =
    let
      routers = config.services.traefik.dynamicConfigOptions.http.routers or { };
      hostClauses = rule: groups (builtins.split "Host\\(([^)]*)\\)" rule);
      hostsOf = clause: groups (builtins.split "`([^`]+)`" clause);
      rules = lib.mapAttrsToList (_: router: router.rule or "") routers;
    in
    map (mkApp "https") (lib.concatMap (rule: lib.concatMap hostsOf (hostClauses rule)) rules);

  apps = lib.sort (a: b: a.name < b.name) (
    lib.unique (
      lib.optionals config.services.caddy.enable caddyApps
      ++ lib.optionals config.services.nginx.enable nginxApps
      ++ lib.optionals config.services.traefik.enable traefikApps
    )
  );

  appsFile = pkgs.writeText "nos-apps.json" (builtins.toJSON apps);
in
{
  options.services.nos = {
    enable = lib.mkEnableOption "nOS, a read-only NixOS web dashboard";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The nos package to run.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address the dashboard listens on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8090;
      description = "Port the dashboard listens on.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.nos = {
      description = "nOS dashboard";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      path = [ pkgs.util-linux ];
      serviceConfig = {
        ExecStart = "${lib.getExe cfg.package} -listen ${cfg.listenAddress}:${toString cfg.port} -apps ${appsFile}";
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
  };
}
