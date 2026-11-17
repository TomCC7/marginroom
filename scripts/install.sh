#!/bin/sh
set -eu
DEFAULT_VERSION=''
DEFAULT_SHA256=''
version=$DEFAULT_VERSION
sha=$DEFAULT_SHA256
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_dir=${HOME:?HOME must be set}/.local/bin
fail() { printf '%s\n' "marginroom installer: $*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
 case "$1" in
  --from|--version|--sha256|--bin-dir) [ "$#" -ge 2 ] || fail "Missing value for $1"; option=$1; value=$2; shift 2; case "$option" in --from) source_dir=$value;; --version) version=$value;; --sha256) sha=$value;; --bin-dir) install_dir=$value;; esac;;
  *) fail "Unknown option: $1";;
 esac
done
case "$(uname -s)-$(uname -m)" in Linux-x86_64) ;; *) fail 'Unsupported target; only Linux x64 glibc is verified';; esac
# A musl host is not a supported glibc target.
if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then fail 'Unsupported libc; glibc is required'; fi
case "$version" in ''|*[!A-Za-z0-9._-]*) fail 'An exact --version is required';; esac
[ "${#sha}" -eq 64 ] || fail 'Expected trusted --sha256 digest (64 hex characters)'
case "$sha" in *[!0-9a-f]*) fail 'Expected lowercase SHA256';; esac
name=marginroom-$version-linux-x64
umask 077
task_tmp=$(mktemp -d)
install_tmp=''
cleanup() { rm -rf -- "$task_tmp"; [ -z "$install_tmp" ] || rm -f -- "$install_tmp"; }
trap cleanup EXIT HUP INT TERM
case "$source_dir" in
 https://*|http://*) command -v curl >/dev/null || fail 'curl is required for downloading'; curl --fail --location --silent --show-error "${source_dir%/}/$name" -o "$task_tmp/marginroom";;
 *://*) fail 'Unsupported download scheme';;
 *) cp -- "$source_dir/$name" "$task_tmp/marginroom";;
esac
command -v sha256sum >/dev/null || fail 'sha256sum is required'
printf '%s  %s\n' "$sha" "$task_tmp/marginroom" | sha256sum --check --status || fail 'SHA256 mismatch; refusing installation'
mkdir -p -- "$install_dir"
[ ! -d "$install_dir/marginroom" ] || fail 'Destination is a directory'
# Keep the final rename on one filesystem; never replace the global CLI.
install_tmp=$(mktemp "$install_dir/.marginroom.XXXXXX")
cp -- "$task_tmp/marginroom" "$install_tmp"
chmod 755 "$install_tmp"
mv -f -- "$install_tmp" "$install_dir/marginroom"
printf 'Installed Marginroom %s at %s/marginroom\n' "$version" "$install_dir"
case ":$PATH:" in *":$install_dir:"*) ;; *) printf 'This directory is not on PATH. Run "%s/marginroom" or add it to PATH yourself.\n' "$install_dir";; esac
