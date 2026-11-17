# Marginroom v@VERSION@

Standalone HTML review CLI and embedded local service for Linux x64 glibc, macOS arm64 and macOS Intel.

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/download/v@VERSION@/install.sh | sh
marginroom open ./article.html --browser
```

No Node/Bun runtime, checkout or sudo needed. The installer pins this version and checks a target-specific archive SHA256 before atomic installation. `SHA256SUMS` and manifests identify all artifacts and the exact source commit @SOURCE_COMMIT@.

**macOS: not signed or notarized.** Read platform/Gatekeeper limitations in [installation.md](https://github.com/TomCC7/marginroom/blob/@SOURCE_COMMIT@/docs/installation.md) before testing. Do not disable system security. Native CLI/service runtime evidence for this tag is in the matching `Release` workflow run; the build job itself cross-compiles from Linux.

Use `marginroom comments 'REVIEW_URL' --json` for feedback and `marginroom open ./article.html --new-version-of 'REVIEW_URL' --browser` for a revision. Loopback links are local to the service host. Installation does not restart an existing service.

MIT; based on markmyword by Alexa Griffith. This is experimental software; stable/prerelease describes the release channel, not a compatibility guarantee.
