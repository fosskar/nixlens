{
  lib,
  buildGoModule,
  buildNpmPackage,
  importNpmLock,
}:
let
  version = "0.1.0";

  webSrc = lib.fileset.toSource {
    root = ../web;
    fileset = lib.fileset.difference ../web (
      lib.fileset.unions [
        (lib.fileset.maybeMissing ../web/node_modules)
        (lib.fileset.maybeMissing ../web/dist)
      ]
    );
  };

  web = buildNpmPackage {
    pname = "nos-web";
    inherit version;
    src = webSrc;
    # dependencies come straight from package-lock.json, so dependency
    # updates need no hash bump
    npmDeps = importNpmLock { npmRoot = webSrc; };
    inherit (importNpmLock) npmConfigHook;
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
      ../internal/smart/testdata
      (lib.fileset.fileFilter (file: file.hasExt "go") ../.)
    ];
  };
  vendorHash = null;
  subPackages = [ "cmd/nos" ];
  env.CGO_ENABLED = 0;

  preBuild = ''
    mkdir -p web
    cp -r ${web} web/dist
  '';

  passthru = { inherit web; };

  meta = {
    description = "Read-only web frontend for a NixOS host";
    mainProgram = "nos";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
}
