# Releasing Marginroom

Publish releases through GitHub Actions. Maintainers use its build and native smoke jobs to produce release assets.

## Publish a release

1. Merge reviewed changes into `main` and check the required tests on the commit to publish.
2. Choose an unpublished release tag and a reviewed commit. Set `RELEASE_TAG` and `RELEASE_COMMIT` to those values before running:
   ```sh
   git tag "$RELEASE_TAG" "$RELEASE_COMMIT"
   git push origin "$RELEASE_TAG"
   ```
3. Watch the `Release` workflow. It builds `linux-x64`, `darwin-arm64` and `darwin-x64`, then runs installed CLI/service smoke on `ubuntu-24.04`, `macos-15` and `macos-15-intel` before publishing.
4. Select that workflow run and check the release:
   ```sh
   gh run watch <run-id> --exit-status
   gh release view "$RELEASE_TAG"
   ```
   Check for all three archives, `manifest-*.json`, `manifest.json`, `SHA256SUMS`, `install.sh`, `LICENSE` and `RELEASE-NOTES.md`.

## Build and test without publishing

Dispatch `Release` on `main` with a version such as `0.1.1` or `0.1.1-alpha.1`:

```sh
gh workflow run Release --ref main -f version=0.1.1
gh run watch <run-id> --exit-status
```

The dry run builds and smoke-tests artifacts without publishing a release, tag or asset.

## Versions and immutable assets

An existing release tag, release or asset must not be overwritten. On a release trigger, the workflow checks that the remote tag points to the exact commit being built.

Stable tags such as `v0.1.1` publish with `--latest`. Prerelease tags such as `v0.1.1-alpha.1` publish with `--prerelease --latest=false`, leaving the stable `latest` unchanged. The Git tag supplies the release version; the `version` input supplies it for a dry run.

Each generated installer embeds its exact version and per-target SHA256. `https://github.com/TomCC7/marginroom/releases/latest/download/install.sh` downloads the current latest stable release's installer.

## Platform checks

The workflow cross-compiles macOS binaries on Linux, then smoke-tests them on native GitHub-hosted `macos-15` arm64 and `macos-15-intel` x86_64 runners. A missing runner label fails the workflow rather than skipping a target. See [installation](installation.md#platforms) for supported platforms, signing and Gatekeeper instructions.

Action SHAs and Bun are pinned. Update them in a dedicated commit.
