{
  lib,
  buildGoModule,
  buildNpmPackage,
}:
let
  version = "0.1.0";

  web = buildNpmPackage {
    pname = "nos-web";
    inherit version;
    src = lib.fileset.toSource {
      root = ../web;
      fileset = lib.fileset.difference ../web (
        lib.fileset.unions [
          (lib.fileset.maybeMissing ../web/node_modules)
          (lib.fileset.maybeMissing ../web/dist)
        ]
      );
    };
    npmDepsHash = "sha256-ctX0NmlbZyGMbMljfI+jPqz8f92doBQzmSnY68EPa4w=";
    installPhase = ''
      cp -r dist $out
    '';
  };
in
buildGoModule {
  pname = "nos";
  inherit version;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../go.mod
      (lib.fileset.fileFilter (file: file.hasExt "go") ../.)
    ];
  };
  vendorHash = null;
  env.CGO_ENABLED = 0;

  preBuild = ''
    mkdir -p web
    cp -r ${web} web/dist
  '';

  passthru = { inherit web; };

  meta = {
    description = "Read-only web frontend for a NixOS host";
    mainProgram = "nos";
  };
}
