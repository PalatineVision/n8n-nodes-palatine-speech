#!/usr/bin/env bash
# Never print credentials, force-push, mirror all refs, or change the release commit.
set -euo pipefail
: "${GITHUB_MIRROR_TOKEN:?Set the protected, masked GITHUB_MIRROR_TOKEN variable}"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY}"
: "${CI_COMMIT_SHA:?This script must run in GitLab CI}"
[ "${CI_COMMIT_REF_PROTECTED:-false}" = true ] || { echo 'Only protected refs may be mirrored'; exit 1; }
[ "$(git rev-parse HEAD)" = "$CI_COMMIT_SHA" ] || { echo 'Checkout does not match pipeline commit'; exit 1; }
node scripts/check-release.mjs

askpass="$(mktemp)"
trap 'rm -f "$askpass"' EXIT
cat > "$askpass" <<'ASKPASS'
#!/usr/bin/env sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$GITHUB_MIRROR_TOKEN" ;;
  *) exit 1 ;;
esac
ASKPASS
chmod 700 "$askpass"
export GIT_ASKPASS="$askpass"
export GIT_TERMINAL_PROMPT=0
github_url="https://github.com/$GITHUB_REPOSITORY.git"

case "${1:-}" in
  main)
    [ "${CI_COMMIT_BRANCH:-}" = main ] || { echo 'Expected main branch'; exit 1; }
    git -c credential.helper= push "$github_url" HEAD:refs/heads/main
    ;;
  tag)
    : "${CI_COMMIT_TAG:?Expected a release tag}"
    git fetch origin refs/heads/main:refs/remotes/origin/main
    git merge-base --is-ancestor HEAD refs/remotes/origin/main || { echo 'Release commit must belong to GitLab main'; exit 1; }
    git -c credential.helper= fetch "$github_url" refs/heads/main:refs/remotes/github/main
    git merge-base --is-ancestor HEAD refs/remotes/github/main || { echo 'Wait for the main pipeline to mirror this commit to GitHub'; exit 1; }
    [ "$(git rev-parse "refs/tags/$CI_COMMIT_TAG^{commit}")" = "$CI_COMMIT_SHA" ] || { echo 'Tag does not point to this commit'; exit 1; }
    git -c credential.helper= push "$github_url" "refs/tags/$CI_COMMIT_TAG:refs/tags/$CI_COMMIT_TAG"
    ;;
  *) echo 'Usage: mirror-github.sh main|tag'; exit 2 ;;
esac
