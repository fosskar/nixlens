{
  description = "nOS: read-only web frontend for a NixOS host";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.callPackage ./nix/package.nix { };
      });

      nixosModules.default =
        { lib, pkgs, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.nos.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      checks = forAllSystems (pkgs: {
        nixos-test = pkgs.callPackage ./nix/test.nix { nosModule = self.nixosModules.default; };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.go
            pkgs.gopls
            pkgs.nodejs
          ];
          env.CGO_ENABLED = 0;
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
