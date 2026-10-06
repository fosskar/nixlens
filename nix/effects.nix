# nixbot scheduled effects. The GitToken comes from nixbot at runtime (a
# github app installation token on github repos).
{ pkgs, nixbot }:
let
  inherit (nixbot.lib.effects { inherit pkgs; }) mkEffect;

  repo = "fosskar/nixlens";
  gitName = "fosskar[bot]";
  gitEmail = "300917551+fosskar[bot]@users.noreply.github.com";

  # nixbot mounts a pushable clone of the effect's commit at
  # $NIXBOT_EFFECT_CHECKOUT, which is also the working directory. The updater
  # comes from nixfiles, which needs no flake input to run.
  updateFlakeInputs = mkEffect {
    name = "effect-update-flake-inputs";
    checkout = true;
    inputs = [
      pkgs.git
      pkgs.nix
    ];
    secretsMap.git.type = "GitToken";
    effectScript = ''
      set -euo pipefail
      token=$(jq -re '.git.data.token' "$HERCULES_CI_SECRETS_JSON")
      export FORGE_TOKEN="$token"
      export GITHUB_TOKEN="$token"
      export NIX_CONFIG="experimental-features = nix-command flakes
      access-tokens = github.com=$token"

      git config --global user.name '${gitName}'
      git config --global user.email '${gitEmail}'

      git config remote.origin.promisor true
      git config remote.origin.partialclonefilter blob:none

      nix run "github:fosskar/nixfiles#updater-flake-inputs"
    '';
  };

  # npm and go module updates. renovate clones the repository itself; the
  # package build reads the npm lockfile directly, so no hash needs updating
  renovate = mkEffect {
    name = "effect-renovate";
    inputs = [
      pkgs.renovate
      pkgs.nodejs
      pkgs.go
      pkgs.git
    ];
    secretsMap.git.type = "GitToken";
    effectScript = ''
      set -euo pipefail
      token=$(jq -re '.git.data.token' "$HERCULES_CI_SECRETS_JSON")
      export RENOVATE_TOKEN="$token"
      export RENOVATE_GITHUB_COM_TOKEN="$token"

      export RENOVATE_PLATFORM=github
      export RENOVATE_REPOSITORIES=${repo}
      export RENOVATE_GIT_AUTHOR='${gitName} <${gitEmail}>'
      export RENOVATE_BINARY_SOURCE=global
      export LOG_LEVEL=info

      renovate
    '';
  };
in
_args: {
  onSchedule.update-flake-inputs = {
    when = {
      hour = 1;
      minute = 0;
    };
    outputs.effects.update-flake-inputs = updateFlakeInputs;
  };

  onSchedule.renovate = {
    when = {
      hour = 20;
      minute = 0;
    };
    outputs.effects.renovate = renovate;
  };
}
