self: super: {
  go = super.go_1_22;
  nodejs = super.nodejs_20;
  bazel-wrapper = super.callPackage ./bazel-wrapper {};
  impure-cc = super.callPackage ./impure-cc {};
  golangci-lint = super.golangci-lint.override {
    buildGoModule = self.buildGo122Module;
  };
  mkShell = super.mkShell.override {
    stdenv = super.stdenvNoCC;
  };
  please = super.callPackage ./please {
    buildGoModule = self.buildGo122Module;
  };
  robo = super.callPackage ./robo {
    buildGoModule = self.buildGo122Module;
  };
  mkLazyWrapper = super.callPackage ./mk-lazy-wrapper {};
  pnpm = self.writeShellScriptBin "pnpm" ''
    set -euo pipefail
    CACHE_DIR="''${COREPACK_HOME:-$HOME/.cache/corepack}"
    mkdir -p "$CACHE_DIR"
    TMP_DIR="''${TMPDIR:-$HOME/.cache/tmp}"
    mkdir -p "$TMP_DIR"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    export COREPACK_HOME="$CACHE_DIR"
    export TMPDIR="$TMP_DIR"
    exec ${self.nodejs}/bin/corepack pnpm "$@"
  '';
}