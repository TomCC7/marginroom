# Marginroom v0.1.0-alpha.1

Standalone HTML review CLI and embedded local service for Linux x64 glibc, macOS arm64 and macOS Intel.

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/download/v0.1.0-alpha.1/install.sh | sh
marginroom open ./article.html --browser
```

No Node/Bun runtime, checkout or sudo needed. The installer pins this version and checks a target-specific archive SHA256 before atomic installation. `SHA256SUMS` and manifests identify all artifacts and exact source head.

**macOS: cross-built only; not runtime-tested, Developer-ID signed or notarized.** Read platform/Gatekeeper limitations at https://github.com/TomCC7/marginroom/blob/feat/macos-release/docs/installation.md before testing. Do not disable system security. Linux installed CLI/service verification is separate from Mac shell-mapping mocks.

Use `marginroom comments 'REVIEW_URL' --json` for feedback and `marginroom open ./article.html --new-version-of 'REVIEW_URL' --browser` for a revision. Loopback links are local to the service host. Installation does not restart an existing service.

MIT; based on markmyword by Alexa Griffith. This is an unsigned test prerelease, not a production compatibility guarantee.
