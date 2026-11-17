#!/bin/sh
set -eu
# Generated releases replace these constants with exact version and archive digests.
VERSION='@VERSION@'
LINUX_SHA='@LINUX_SHA@'
ARM_SHA='@ARM_SHA@'
X64_SHA='@X64_SHA@'
source_url="https://github.com/TomCC7/marginroom/releases/download/v$VERSION"
install_dir=${HOME:?HOME must be set}/.local/bin
fail() { printf '%s\n' "marginroom installer: $*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
 case "$1" in
 --from|--bin-dir) [ "$#" -ge 2 ] || fail "Missing value for $1"; option=$1; value=$2; shift 2; case "$option" in --from) source_url=$value;; --bin-dir) install_dir=$value;; esac;;
 *) fail "Unknown option: $1";;
 esac
done
case "$(uname -s)-$(uname -m)" in
 Linux-x86_64) target=linux-x64; sha=$LINUX_SHA; getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'Linux glibc is required';;
 Darwin-arm64) target=darwin-arm64; sha=$ARM_SHA;;
 Darwin-x86_64) target=darwin-x64; sha=$X64_SHA;;
 *) fail 'Unsupported OS/architecture (Darwin arm64/x86_64 or Linux x86_64 glibc required)';;
esac
[ "${#sha}" -eq 64 ] || fail 'Use the generated release installer, not the source template'
case "$sha" in *[!0-9a-f]*) fail 'Invalid trusted SHA256';; esac
case "$install_dir" in /*) ;; *) fail '--bin-dir must be absolute';; esac
case "$source_url" in https://*|http://127.0.0.1:*|http://localhost:*) ;; *) fail 'HTTPS download required (loopback HTTP allowed for testing)';; esac
command -v curl >/dev/null || fail 'curl is required'
case "$target" in darwin-*) command -v shasum >/dev/null || fail 'shasum is required';; *) command -v sha256sum >/dev/null || fail 'sha256sum is required';; esac
umask 077
task_tmp=$(mktemp -d "${TMPDIR:-/tmp}/marginroom.XXXXXX")
install_tmp=''
cleanup() { rm -rf "$task_tmp"; [ -z "$install_tmp" ] || rm -f "$install_tmp"; }
trap cleanup 0
trap 'exit 1' HUP INT TERM
name=marginroom-$VERSION-$target.tar.gz
curl --fail --location --silent --show-error "${source_url%/}/$name" -o "$task_tmp/archive"
case "$target" in darwin-*) actual=$(shasum -a 256 "$task_tmp/archive");; *) actual=$(sha256sum "$task_tmp/archive");; esac
actual=${actual%% *}
[ "$actual" = "$sha" ] || fail 'SHA256 mismatch; refusing installation'
# Only extract the known binary from the trusted archive, never arbitrary members.
tar -xzf "$task_tmp/archive" -C "$task_tmp" marginroom
[ -f "$task_tmp/marginroom" ] && [ ! -L "$task_tmp/marginroom" ] || fail 'Invalid archive executable'
mkdir -p "$install_dir"
[ -O "$install_dir" ] || fail 'Install directory must be owned by the current user'
[ ! -d "$install_dir/marginroom" ] || fail 'Destination is a directory'
install_tmp=$(mktemp "$install_dir/.marginroom.XXXXXX")
cp "$task_tmp/marginroom" "$install_tmp"
chmod 755 "$install_tmp"
mv -f "$install_tmp" "$install_dir/marginroom"
install_tmp=''
printf 'Installed Marginroom %s at %s/marginroom\n' "$VERSION" "$install_dir"
case ":${PATH:-}:" in *":$install_dir:"*) ;; *) printf 'Add %s to PATH, or use %s/marginroom directly.\n' "$install_dir" "$install_dir";; esac
