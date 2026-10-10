#!/usr/bin/env bash
# Source this script on the protected Linux shell runner; no sudo or global install.
set -euo pipefail
node_version=24.11.1
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64|arm64) node_arch=arm64 ;;
  *) echo "Unsupported runner architecture"; return 1 ;;
esac
node_folder="node-v$node_version-linux-$node_arch"
tools_root="$CI_PROJECT_DIR/.ci-tools"
if [ ! -x "$tools_root/$node_folder/bin/node" ]; then
  mkdir -p "$tools_root"
  download_dir="$(mktemp -d)"
  curl --fail --silent --show-error --location --retry 3 --max-time 180 "https://nodejs.org/dist/v$node_version/$node_folder.tar.xz" -o "$download_dir/$node_folder.tar.xz"
  curl --fail --silent --show-error --location --retry 3 --max-time 60 "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$download_dir/SHASUMS256.txt"
  (cd "$download_dir"; grep "  $node_folder.tar.xz$" SHASUMS256.txt | sha256sum --check --strict -)
  tar -xJf "$download_dir/$node_folder.tar.xz" -C "$tools_root"
fi
export PATH="$tools_root/$node_folder/bin:$PATH"
test "$(node --version)" = "v$node_version"
node --version
npm --version
