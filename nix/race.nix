# the unit tests under the race detector, which needs cgo; a plain test run
# rather than a package build, so no binary keeps toolchain references
{
  stdenv,
  go,
  nos,
}:
stdenv.mkDerivation {
  name = "nos-go-race";
  inherit (nos) src;
  nativeBuildInputs = [ go ];
  buildPhase = ''
    export HOME=$TMPDIR GOCACHE=$TMPDIR/go-cache GOTOOLCHAIN=local CGO_ENABLED=1
    mkdir -p web
    cp -r ${nos.web} web/dist
    go test -race -count=1 ./...
  '';
  installPhase = "touch $out";
}
