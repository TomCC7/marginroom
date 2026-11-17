# Installation and builds

The standalone distribution supports Linux x86_64 with glibc. Other targets are refused by the installer. The local service uses Linux abstract Unix sockets. macOS, Windows, ARM64 and musl artifacts are not supplied or verified. A desktop opener (`xdg-open`) is required only for `--browser`; headless callers use `--json`.

The repository is private. No public release URL is configured. Ask the repository owner for a complete exact-version distribution: `marginroom-VERSION-linux-x64`, `install.sh`, `manifest.json`, `SHA256SUMS`, and `LICENSE`. The generated installer embeds the exact version and SHA256 of its binary. Verify the installer/manifest through your trusted delivery channel; downloading both a binary and a checksum from an untrusted source does not authenticate either.

From that directory:

```sh
sh ./install.sh
marginroom open ./article.html --browser
```

Installation copies only the verified executable to `~/.local/bin/marginroom`, without sudo or shell-profile changes. `--bin-dir '/path/with spaces/bin'` selects another directory. The installer reports if the chosen directory is absent from PATH. It refuses unsupported targets and digest mismatches before replacing an installed binary. A running managed service retains its original executable until it is stopped and restarted by its operator; installation does not stop any service.

For a task-owned or owner-provided HTTP endpoint containing the same exact version, use the generated installer:

```sh
sh ./install.sh --from 'https://YOUR_AUTHORIZED_HOST/EXACT_VERSION_DIRECTORY'
```

This is a placeholder, not a public Marginroom service. Download requires curl; local copy does not. The installer needs a POSIX shell, standard Linux file tools, `getconf`, and `sha256sum`. To use the source installer rather than a generated distribution, supply its trust anchor explicitly:

```sh
sh scripts/install.sh --from '/trusted/release directory' --version 'EXACT_VERSION' --sha256 'TRUSTED_64_CHARACTER_SHA256'
```

## Development

Use **Bun 1.4.4** for the backend, CLI, dependency installation and tests. `.bun-version`, `packageManager`, and the Docker image pin it. No Node runtime, npm, native addon compiler, or alternate database driver is required.

```sh
bun install --frozen-lockfile
bun run test:api
bun run build
```

Builds write to `../deliverables` by default; `bun scripts/build.mjs '/other/output directory'` selects another destination. The binary name includes the package version and exact Git commit prefix. `manifest.json` records the full source commit, dirty status, Bun version, dependencies, target, binary digest and every embedded public asset digest. Build from a clean committed tree for delivery. The build copies only explicit runtime paths and allowlisted frontend assets into an isolated staging directory. It excludes uploaded documents, databases, identities, private docs, screenshots/backups and externally maintained `public/metal-arm-plan*` assets. MIT license notices remain in the distribution.

The executable embeds its dependencies and real frontend files. Its child reexecutes that executable through the private `--service` dispatch, without source files or a Bun/Node executable on PATH. Source use is also supported: `bun bin/marginroom.mjs open ./article.html --json`. Ordinary self-hosted servers run `bun run start`; [operations](operations.md) covers persistent identity and containers.
