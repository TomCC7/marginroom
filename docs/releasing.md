# Releasing Marginroom

Release publication is GitHub Actions only. Maintainers do not build release assets locally.

## Publish a release

1. Ensure `feat/cli-readable` is green and merged.
2. Tag the exact commit to publish:
   ```sh
   git tag v0.1.0 <commit-sha>
   git push origin v0.1.0
   ```
3. Watch the `Release` workflow. It builds `linux-x64`, `darwin-arm64`, and `darwin-x64`, runs native installed CLI/service smoke on `ubuntu-24.04`, `macos-15`, and `macos-15-intel`, then publishes the release.
4. Verify the workflow run and release:
   ```sh
   gh run watch --exit-status
   gh release view v0.1.0
   ```
   The release must contain all three archives, `manifest-*.json`, `manifest.json`, `SHA256SUMS`, `install.sh`, `LICENSE`, and `RELEASE-NOTES.md`.

## Dry-run build/test without publishing

Use `workflow_dispatch` with a version string such as `0.1.1` or `0.1.1-alpha.1`:

```sh
gh workflow run Release --ref feat/cli-readable -f version=0.1.1
gh run watch --exit-status
```

Dry-run builds and smoke-tests artifacts but never publishes a release, tag, or asset. It is safe to run on any commit.

## Rules

- **No clobber**: an existing release tag, release, or asset is never overwritten. The workflow fails if the tag does not already point at the exact commit being built.
- **Latest vs prerelease**: tags without a hyphen (e.g. `v0.1.0`) create a stable release with explicit `--latest`. Prerelease tags (e.g. `v0.1.1-alpha.1`) use `--prerelease --latest=false` and do not displace `latest`. These are release-channel semantics, not compatibility or signing guarantees. Do not rely on an alpha tag becoming latest; tag the first stable `v0.1.0` explicitly.
- **Version source of truth**: the release version is derived from the Git tag (`v*`) on release, or from the `version` input on dry-run. It is never hardcoded in build scripts.
- **Immutability**: the installer embeds the exact version and per-target SHA256. The generic URL `https://github.com/TomCC7/marginroom/releases/latest/download/install.sh` always downloads the installer for the current latest stable release.

## Platform and signing caveats

- macOS binaries are cross-compiled from Linux and are **not** Developer-ID signed or notarized. Gatekeeper may block them; see `docs/installation.md`.
- Native runtime smoke for macOS runs on GitHub-hosted `macos-15` (arm64) and `macos-15-intel` (x86_64) runners. If GitHub changes or removes these labels, the workflow fails rather than silently skipping a target.
- The workflow uses pinned action SHAs and a pinned Bun version. Update them deliberately in a dedicated commit.
