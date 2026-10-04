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

  # a vhost without tls options may still sit behind a tls-terminating proxy,
  # so hostnames get https. vhosts named by a label rather than a hostname are
  # reached through their non-loopback listen addresses instead
  nginxApps = lib.concatLists (
    lib.mapAttrsToList (
      attrName: vhost:
      let
        hostNames = lib.filter (n: usable n && lib.hasInfix "." n) (
          [ (if vhost.serverName == null then attrName else vhost.serverName) ] ++ vhost.serverAliases
        );
        wildcard = [
          "0.0.0.0"
          "::"
          "[::]"
        ];
        loopback = addr: lib.hasPrefix "127." addr || addr == "::1" || addr == "[::1]";
        listenApp = l: {
          name = attrName;
          url = "${if l.ssl then "https" else "http"}://${
            if lib.elem l.addr wildcard then config.networking.fqdnOrHostName else l.addr
          }${lib.optionalString (l.port != null) ":${toString l.port}"}";
        };
      in
      if hostNames != [ ] then
        map (mkApp "https") hostNames
      else
        map listenApp (lib.filter (l: !(loopback l.addr)) vhost.listen)
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
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.nos = {
      description = "nOS dashboard";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      path = [ pkgs.util-linux ];
      serviceConfig = {
        ExecStart = lib.escapeShellArgs (
          [
            (lib.getExe cfg.package)
            "-listen"
            "${cfg.listenAddress}:${toString cfg.port}"
            "-apps"
            appsFile
          ]
          ++ lib.optionals (cfg.tokenFile != null) [
            "-token-file"
            "%d/token"
          ]
          ++ lib.optionals cfg.hub.enable [
            "-hub"
            "-peers"
            (pkgs.writeText "nos-peers.json" (builtins.toJSON cfg.hub.peers))
          ]
        );
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
