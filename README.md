# Marginroom

Review generated HTML in place. Read feedback threads in your terminal, or use JSON with an agent.

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/download/v0.1.0-alpha.2/install.sh | sh
marginroom open ./article.html --browser
```

Pre-release for macOS Apple Silicon / Intel and Linux x64 glibc. No Bun, Node or sudo needed. Installs to `~/.local/bin`; add it to PATH if prompted. **macOS binaries are cross-built, not runtime-tested, Developer-ID signed or notarized.** See [platform limits and installation](docs/installation.md). The release route becomes available when the owner publishes this prerelease.

Select text or an element in Annotate, comment, and reply. Read feedback:

```sh
marginroom comments 'REVIEW_URL'
# Stable machine-readable schema:
marginroom comments 'REVIEW_URL' --json
```

Default output keeps each thread together, including replies and its full ID:

```text
1 open comment · 1 reply

[open] Comment · Synthetic Owl
“Review this paragraph”
  Please clarify the example.
  ↳ Synthetic Fox
    Added more detail.
ID  00000000-0000-4000-8000-000000000001
```

Use `marginroom --help` or `marginroom comments --help` for options. Quote review URLs (the `?` is a glob in zsh). Text stays text when redirected; `NO_COLOR` disables terminal colors. Revision threads label the original selection and suggested replacement. `--json` retains exact stored records and the existing schema, without terminal formatting.

Reopening the same file resumes review. After editing the HTML, preserve earlier feedback with a new version:

```sh
marginroom open ./article.html --new-version-of 'REVIEW_URL' --browser
```

Original files stay unchanged. Use `--json` instead of `--browser` for headless use. Local links are loopback-only; anyone who can reach a document URL can read it.

[Source builds](docs/installation.md#source-builds) · [User guide](docs/user-guide.md) · [CLI and pairing](docs/agent-workflow.md) · [Operations](docs/operations.md) · [Agent skill](skills/marginroom/SKILL.md)

[MIT](LICENSE). Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith. Original notices preserved.
