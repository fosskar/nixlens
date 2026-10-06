{
  description = "nixlens: a visual overview of your NixOS machines";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixbot = {
      url = "github:Mic92/nixbot";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.treefmt-nix.follows = "treefmt-nix";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      treefmt-nix,
      nixbot,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      treefmtFor = forAllSystems (pkgs: treefmt-nix.lib.evalModule pkgs ./nix/treefmt.nix);
    in
    {
      # nixbot scheduled effects: flake input updates and renovate
      herculesCI = import ./nix/effects.nix {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        inherit nixbot;
      };

      packages = forAllSystems (pkgs: {
        default = pkgs.callPackage ./nix/package.nix { };
      });

      nixosModules.default =
        { lib, pkgs, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.nixlens.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      clan.modules."@fosskar/nixlens" = import ./nix/clan-service.nix {
        nixlensModule = self.nixosModules.default;
      };

      checks = forAllSystems (pkgs: {
        formatting = treefmtFor.${pkgs.stdenv.hostPlatform.system}.config.build.check self;
        nixos-test = pkgs.callPackage ./nix/test.nix { nixlensModule = self.nixosModules.default; };
        go-race = pkgs.callPackage ./nix/race.nix {
          nixlens = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.go
            pkgs.gopls
            pkgs.nodejs
            pkgs.oxlint
            treefmtFor.${pkgs.stdenv.hostPlatform.system}.config.build.wrapper
          ];
          env.CGO_ENABLED = 0;
        };
      });

      formatter = forAllSystems (
        pkgs: treefmtFor.${pkgs.stdenv.hostPlatform.system}.config.build.wrapper
      );
    };
}
