# Marginroom

Review generated HTML in place; let an agent read saved feedback as JSON.

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/download/v0.1.0-alpha.1/install.sh | sh
marginroom open ./article.html --browser
```

Pre-release for macOS Apple Silicon / Intel and Linux x64 glibc. No Bun, Node or sudo needed. Installs to `~/.local/bin`; add it to PATH if prompted. **macOS binaries are cross-built, not runtime-tested, Developer-ID signed or notarized.** See [platform limits and installation](docs/installation.md). The release route becomes available when the owner publishes this prerelease.

Select text or an element in Annotate, comment, and reply. Read feedback:

```sh
marginroom comments 'REVIEW_URL' --json
```

Reopening the same file resumes review. After editing the HTML, preserve earlier feedback with a new version:

```sh
marginroom open ./article.html --new-version-of 'REVIEW_URL' --browser
```

Original files stay unchanged. Use `--json` instead of `--browser` for headless use. Local links are loopback-only; anyone who can reach a document URL can read it.

[Source builds](docs/installation.md#source-builds) · [User guide](docs/user-guide.md) · [CLI and pairing](docs/agent-workflow.md) · [Operations](docs/operations.md) · [Agent skill](skills/marginroom/SKILL.md)

[MIT](LICENSE). Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith. Original notices preserved.
