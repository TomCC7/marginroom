# Installation and builds

## Platforms

Release archives support macOS arm64, macOS x86_64 and Linux x86_64 with glibc. Windows, Linux ARM and musl are unsupported. Bun's OS/CPU minimums apply; see [executable targets](https://bun.sh/docs/bundler/executables).

The v0.1.2 release passed native installed CLI/service smoke tests on Linux x86_64 and both macOS architectures in [CI run 44199926996](https://github.com/TomCC7/marginroom/actions/runs/44199926996). These checks cover CLI/service operation; physical GUI and Safari behavior require separate device tests.

macOS binaries have no Developer ID signature or Apple notarization. Gatekeeper may block a download. After attempting launch, follow [Apple's app-specific Open Anyway instructions](https://support.apple.com/en-us/102445) in System Settings, Privacy & Security, only if you trust the source and have verified the digest. Do not disable Gatekeeper globally or bypass malware/damaged-app alerts.

## Installer

### Latest stable release

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/latest/download/install.sh | sh
marginroom open ./article.html --browser
```

Stable releases update `latest`; prereleases leave it unchanged.

### Pinned version

Download a release's installer to select that version:

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/download/v0.1.0/install.sh | sh
```

The installer embeds a trusted archive SHA256 for each target and checks it before installation. It does not use a downloaded checksum file as its authority. HTTPS delivery of the installer is the trust root. The shell command executes downloaded code; download and inspect the installer first if needed.

Both platforms require curl, tar and standard shell file tools. macOS uses `shasum -a 256`; Linux uses `sha256sum` and checks glibc. A Rosetta shell reporting x86_64 selects the Intel build.

The installer atomically replaces only a user-owned `~/.local/bin/marginroom`. It needs no sudo, changes no shell profiles and does not restart services. After downloading the installer, use `sh install.sh --bin-dir '/absolute/path with spaces/bin'` to choose another directory. `--from HTTPS_DIRECTORY` selects a mirror while retaining the embedded version and digests. Plain HTTP is accepted only on localhost for tests. Use a generated release installer; the source template refuses installation.

### State and service

State defaults to `~/.local/share/marginroom` on both platforms. Use `--data-dir DIR` for a separate instance. Directories use mode 0700 and credentials use 0600. Browser launch uses macOS `open` or Linux `xdg-open`; headless callers can use `--json`.

The service reexecutes its own binary as a detached process, without an external runtime or checkout. Linux uses a kernel abstract Unix socket lease; macOS uses a deterministic exclusive loopback TCP lease. The kernel releases the lease on a crash. A port/hash collision fails closed; choose another state directory rather than kill an unrelated process.

Bun supplies the SQLite driver, and backup/restore use native SQLite and Node-compatible file APIs. The service uses built-in crypto for hashing and needs no Linux `/proc`, GNU readlink, shell hashing or external Bun.

## Source builds

Use Bun 1.4.4, Git, tar and a clean Git tree. Place build output outside the source tree:

```sh
bun install --frozen-lockfile
MARGINROOM_BUILD_VERSION=0.1.0 bun scripts/build.mjs ../deliverables
```

The build compiles `--target=bun-linux-x64`, `bun-darwin-arm64` and `bun-darwin-x64`. It produces versioned archives containing the executable and MIT license, plus generated `install.sh`, `SHA256SUMS`, per-target manifests and release notes. Manifests record the clean source head, Bun version and frontend asset digests.

Builds exclude uploaded documents, databases, identities, backups, screenshots and externally maintained metal-arm assets. No native addon compiler is required.

Run the source CLI with `bun bin/marginroom.mjs open ./article.html --json`, or the server with `bun run start`. See [operations](operations.md) for server configuration, backup/restore and existing-host identity.
