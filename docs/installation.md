# Installation and builds

## Platforms and verification limits

Releases supply archives for macOS arm64, macOS x86_64, and Linux x86_64 glibc. Each release workflow run natively smoke-tests the installed CLI/service on Linux x86_64, macOS arm64, and macOS x86_64; see the run for exact evidence. Windows, Linux ARM and musl are unsupported. Bun's own OS/CPU minimums apply; see [official executable targets](https://bun.sh/docs/bundler/executables).

macOS builds have no Developer ID signature or Apple notarization. Gatekeeper may block downloaded software. Only if you trust the source and verified digest, follow [Apple's app-specific Open Anyway instructions](https://support.apple.com/en-us/102445) in System Settings → Privacy & Security after attempting launch. Do not disable Gatekeeper globally or bypass malware/damaged-app alerts.

## Installer

### Latest stable release

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/latest/download/install.sh | sh
marginroom open ./article.html --browser
```

This URL becomes usable after the first stable (non-prerelease) release is published. Prereleases do not update `latest`.

### Pinned version

For a specific release, download its own installer:

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/download/v0.1.0/install.sh | sh
```

The version-pinned installer embeds a distinct trusted archive SHA256 for each target; it does not trust a freshly downloaded checksum file. HTTPS delivery of the installer is the trust root. Downloading the installer executes code: inspect it first if desired. macOS uses `shasum -a 256`; Linux uses `sha256sum` and checks glibc. Both need curl, tar and standard shell file tools. Rosetta shells reporting x86_64 select Intel builds.

Installation atomically replaces only a user-owned `~/.local/bin/marginroom`, without sudo or shell-profile changes. It never restarts services. Use `sh install.sh --bin-dir '/absolute/path with spaces/bin'` after downloading the installer to choose a directory. `--from HTTPS_DIRECTORY` selects a mirror but never changes the embedded version/digests. Plain HTTP is accepted only on localhost for tests. The source template intentionally refuses installation: use generated release bytes.

State defaults to `~/.local/share/marginroom` on both platforms; `--data-dir DIR` isolates advanced use. Directories are private (0700), credentials 0600. Browser launch uses macOS `open` or Linux `xdg-open`; headless callers use `--json`. The service reexecutes its own binary, detached, with no external runtime or checkout. Linux uses a kernel abstract Unix socket lease. macOS uses a deterministic exclusive loopback TCP lease, released by the kernel on crash. A rare port/hash collision fails closed; select another state directory rather than kill an unrelated process. SQLite uses Bun's built-in driver; backup/restore use native SQLite and Node-compatible file APIs, not platform shell commands. Hashing is built-in crypto. No Linux `/proc`, GNU readlink, shell hashing or external Bun is needed by the service.

## Source builds

Use pinned **Bun 1.4.4**, a clean Git tree, Git and tar. Build output must be outside the source tree:

```sh
bun install --frozen-lockfile
MARGINROOM_BUILD_VERSION=0.1.0 bun scripts/build.mjs ../deliverables
```

All three targets are compiled using Bun's official `--target=bun-linux-x64`, `bun-darwin-arm64`, and `bun-darwin-x64`. Output is a versioned archive with executable + MIT license, generated install.sh, SHA256SUMS, per-target manifests and release notes. Manifests record exact clean source head, Bun version and frontend asset digests. Uploaded documents, databases, identities, backups, screenshots and externally maintained metal-arm assets are not embedded. No native addon compiler is required.

Source CLI: `bun bin/marginroom.mjs open ./article.html --json`. Server: `bun run start`. [Operations](operations.md) covers backup/restore and existing-host identity.
