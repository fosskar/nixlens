# the unit tests under the race detector, which needs cgo; a plain test run
# rather than a package build, so no binary keeps toolchain references
{
  stdenv,
  go,
  nixlens,
}:
stdenv.mkDerivation {
  name = "nixlens-go-race";
  inherit (nixlens) src;
  nativeBuildInputs = [ go ];
  buildPhase = ''
    export HOME=$TMPDIR GOCACHE=$TMPDIR/go-cache GOTOOLCHAIN=local CGO_ENABLED=1
    mkdir -p web
    cp -r ${nixlens.web} web/dist
    go test -race -count=1 ./...
  '';
  installPhase = "touch $out";
}
