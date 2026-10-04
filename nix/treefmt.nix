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
          if [ ! -w "''${HOME:-/nonexistent}" ]; then
            HOME=$(mktemp -d)
            export HOME
          fi
          exec golangci-lint "$@"
        '';
      };
    };
    prettier.enable = true;
  };

  # the same linter the frontend uses during development
  settings.formatter.oxlint = {
    command = pkgs.oxlint;
    includes = [
      "web/src/*.ts"
      "web/src/*.tsx"
    ];
  };
}
