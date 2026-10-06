# declared once for services.nixlens and the clan service settings
{ lib }:
{
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
    categories = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [
        "Media"
        "Tools"
      ];
      description = "App categories listed first, in this order; the rest follow alphabetically.";
    };

    accountUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://auth.example.com/settings";
      description = "Page where users manage their account, linked from the user menu.";
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
}
