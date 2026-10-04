{ pkgs, ... }:
{
  projectRootFile = "flake.nix";

  settings.global.excludes = [
    "LICENSE"
    "flake.lock"
    "web/package-lock.json"
    "web/dist/*"
    "testdata/*"
    "docs/screenshots/*"
    "*.png"
    "*.svg"
  ];

  programs = {
    nixfmt.enable = true;
    deadnix.enable = true;
    statix.enable = true;
    gofmt.enable = true;
    golangci-lint = {
      enable = true;
      # golangci-lint needs the go toolchain and writable caches; the nix
      # check sandbox has neither by default
      package = pkgs.writeShellApplication {
        name = "golangci-lint";
        runtimeInputs = [
          pkgs.go
          pkgs.golangci-lint
        ];
        text = ''
          export CGO_ENABLED=0 GOTOOLCHAIN=local
          # web/embed.go embeds the frontend build, which is not in git
          if [ ! -e web/dist ]; then
            mkdir -p web/dist
            : >web/dist/.placeholder
          fi
          if [ ! -w "''${HOME:-/nonexistent}" ]; then
            HOME=$(mktemp -d)
            export HOME
          fi
          # treefmt passes files, but files from several packages cannot be
          # type-checked together; lint the packages instead
          args=()
          for arg in "$@"; do
            case $arg in
            *.go) ;;
            *) args+=("$arg") ;;
            esac
          done
          exec golangci-lint "''${args[@]}" ./...
        '';
      };
    };
    prettier.enable = true;
  };

  # the same linter the frontend uses during development
  settings.formatter.oxlint = {
    command = pkgs.oxlint;
    includes = [
      "web/src/**/*.ts"
      "web/src/**/*.tsx"
    ];
  };
}
