# Marginroom

Review generated HTML in place. Comment on text or elements, propose revisions, and let an agent read the feedback as JSON.

From the supplied, verified Linux x64 release directory, install without sudo:

```sh
sh ./install.sh
```

Then open your HTML in a desktop session:

```sh
marginroom open ./article.html --browser
```

The CLI starts or reuses its local service, prints the review URL, and opens your browser with document management permission. Original files stay unchanged. If the installer reports that its directory is absent from PATH, use the printed executable path or add that directory yourself. No Bun or Node installation is needed for the standalone binary.

In **Annotate**, select text or an element, add a comment, then reply in its thread. An agent reads the exact saved records with:

```sh
marginroom comments 'REVIEW_URL' --status open --json
```

Opening the same file again resumes its review. After changing the source, explicitly create a new version:

```sh
marginroom open ./article.html --new-version-of 'REVIEW_URL' --browser
```

Prior URLs and feedback remain intact. For headless use, replace `--browser` with `--json`. State defaults to `~/.local/share/marginroom`; advanced isolation uses `--data-dir DIR`. Loopback links work only on the service host. For another device, use an explicitly paired, reachable instance. Anyone who can reach a document URL can read it.

The repository and artifacts are private; there is no public download URL or published package. Obtain the exact versioned release and its trusted SHA256 manifest from the repository owner. [Installation, verified downloads and builds](docs/installation.md) describes local and HTTP installation, platform limits, and Bun 1.4.4 development.

[User guide](docs/user-guide.md) · [CLI and pairing](docs/agent-workflow.md) · [Operations and backups](docs/operations.md) · [Agent skill](skills/marginroom/SKILL.md) · [Tests](test/README.md) · [Localization](docs/localization.md)

[MIT](LICENSE). Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith. Original notices are preserved.
