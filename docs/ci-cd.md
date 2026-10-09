# CI/CD: GitLab main to a verified npm release

GitLab is the source of truth:
https://git.palatine.ru/palatine/speech-n8n-node (branch `main`).

The public source used for npm provenance is:
https://github.com/PalatineVision/n8n-nodes-palatine-speech.

GitLab and GitHub accounts are independent. GitLab does not need an npm token.

## Pipeline

1. Branch and merge request pipelines run metadata validation, `npm ci`, lint, build, tests, and the n8n source/package scanner.
2. A successful protected `main` pipeline pushes that commit to GitHub `main`. It does not publish.
3. A protected stable tag `vX.Y.Z` runs all checks again. The tag must match both package manifests.
4. A maintainer starts the blocking manual job `release-to-github`. It checks that the tagged commit belongs to GitLab main and is already present in GitHub main, then pushes that exact tag.
5. GitHub Actions repeats validation and the local scanner, then publishes through npm trusted publishing with provenance.
6. Both systems verify the published version, its `gitHead`, provenance, and the official n8n scanner result. GitLab waits up to roughly 20 minutes for registry responses and scanning.

There are no force pushes, ref deletions, wildcard tag pushes, automatic version bumps or automatic production releases on main. If histories diverge, the mirror fails; reconcile them explicitly. Do not enable an additional GitLab push mirror: it could send release tags before checks finish.

Only stable releases are configured. Pre-release tags fail release validation.

## Initial history reconciliation

The initial CI integration commit retains both the GitLab and existing GitHub main histories while keeping the GitLab source tree. This allows the first mirror push to be a fast-forward without replacing either history. Keep this merge ancestry when integrating the CI branch; do not squash it.

## One-time GitLab setup

- A Maintainer must apply the configuration to this project's main branch.
- Enable a Linux Docker/Kubernetes runner that can use `node:24-bookworm`, run untagged jobs and reach npmjs.org and github.com. If the runner requires tags, add its actual tags under `default`.
- Protect `main` and tags matching `v*`. Allow release-tag creation only for release maintainers.
- In Settings > CI/CD > Variables add `GITHUB_MIRROR_TOKEN`: **Masked**, **Protected**, environment scope `github-mirror`. Disable variable expansion for this value.
- The token must belong to an account with write access to the public GitHub repository. Prefer a fine-grained token restricted to this repository with **Contents: Read and write** and **Workflows: Read and write**. Organization approval may be required.
- `GITHUB_REPOSITORY` is declared in the YAML and must match package.json's public repository URL. Updating the mirror destination requires changing both.
- Disable any separate repository push mirror for this project. The pipeline owns synchronization.
- Validate the YAML with this GitLab instance's CI Lint before merging. Local YAML parsing does not replace server validation.

The mirror credential is scoped to the mirror jobs; dependency installation and scanning jobs do not need it. No credentials belong in Git URLs or committed files.

## One-time GitHub and npm setup

- Keep the GitHub repository public. Enable Actions and ensure repository rules allow the mirror account to push main and the selected release tags.
- Create the GitHub environment `npm`. Optional reviewers add another release approval; if approval waits, GitLab's registry verification may time out and can be retried after publication.
- In npm package settings configure a **GitHub Actions trusted publisher**:
  - Organization: `PalatineVision`
  - Repository: `n8n-nodes-palatine-speech`
  - Workflow filename: `publish.yml`
  - Environment: `npm`
  - Allow direct `npm publish` if that option is shown.
- The publisher must have permission for the existing package `n8n-nodes-palatine-speech`.
- The GitHub workflow uses a GitHub-hosted runner and `id-token: write`. No `NPM_TOKEN` is required.
- Do not change npm security settings or revoke existing tokens until the first trusted-publisher release is verified.

The GitHub publish job deliberately fails if the version already exists on npm. If publication succeeded but verification failed, rerun GitLab's `verify-published` job after correcting the verification issue; do not delete/recreate release tags or republish the version.

## Releasing

Fix known release-blocking issues first. From an up-to-date, clean checkout of GitLab main:

1. Update package.json and package-lock.json together, for example `npm version patch --no-git-tag-version`, and submit the changes to main.
2. Wait for all main jobs, including `mirror-main`, to pass.
3. Create a tag matching the actual version, for example `git tag -a v1.2.0 -m "Release 1.2.0"`, then push only that tag to the GitLab remote: `git push gitlab v1.2.0`.
4. Wait for the tag's check and scan jobs, then start `release-to-github`.
5. Confirm GitHub publication and GitLab `verify-published` both succeed.

Use a new, unused version; the example is not an instruction to publish 1.2.0 now. Do not use the existing `npm run release` command for this flow: its local release-it configuration can publish directly and create a GitHub release.

## Validation performed locally

The configuration can be parsed as YAML, shell scripts can be checked with Bash, release guards are covered by `tests/release.test.cjs`, and lint, build and the local scanner can be run without publishing. This CI branch keeps the GitLab package version and application behavior; the separate local polling changes are not included. Server-specific runner availability, protected refs, environment variables, GitHub permissions and npm trusted-publisher settings require authenticated access to those services.

## References

- [n8n verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [GitLab protected tags](https://docs.gitlab.com/user/project/protected_tags/)
