#!/usr/bin/env bash
set -euo pipefail

scanner_root=/tmp/n8n-scanner
export SCANNER_DIR="$scanner_root/node_modules/@n8n/scan-community-package"
npm install --prefix "$scanner_root" --no-audit --no-fund "@n8n/scan-community-package@${SCANNER_VERSION:-0.38.0}"

mkdir -p .ci-artifacts
package_name="$(node -p "require('./package.json').name")"
package_version="$(node -p "require('./package.json').version")"
npm pack --ignore-scripts --pack-destination .ci-artifacts
archive=".ci-artifacts/${package_name//\//-}-$package_version.tgz"
archive="${archive/@/}"
unpack_dir="$(mktemp -d)"
tar -xzf "$archive" -C "$unpack_dir"
node scripts/scan-local.mjs "$unpack_dir/package"
