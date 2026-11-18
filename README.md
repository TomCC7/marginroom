# Marginroom

English · [简体中文](README.zh-CN.md)

Review HTML in the browser and send feedback to your agent.

Open a generated page, comment or suggest revisions beside the content, then read the discussion in your terminal or as JSON. Your original HTML stays unchanged.

![An HTML document with comments, replies and an inline revision in Marginroom](docs/screenshots/english-review.png)

## Install

macOS Apple Silicon / Intel, or Linux x64 with glibc. No Node, Bun or sudo required.

```sh
curl -fsSL https://github.com/TomCC7/marginroom/releases/latest/download/install.sh | sh
```

This installs the latest release to `~/.local/bin`. Follow the PATH instruction if prompted. See [installation and macOS security notes](docs/installation.md) for platform limitations.

## Review a page

```sh
marginroom open ./article.html --browser
```

Marginroom starts its local service and opens your page. Switch to **Annotate** to comment on text or elements, propose revisions, and reply to feedback. The interface offers English and Simplified Chinese.

## Read the feedback

Copy the review URL from your browser. Read the threads in your terminal:

```sh
marginroom comments 'REVIEW_URL'
```

Or give your agent structured records, including IDs, quotes and replies:

```sh
marginroom comments 'REVIEW_URL' --json
```

Keep URLs quoted. Use `--status all` to include handled feedback, or `marginroom comments --help` for more options.

## Keep reviewing

Opening an unchanged file resumes its review. After changing the HTML, create a new version:

```sh
marginroom open ./article.html --new-version-of 'REVIEW_URL' --browser
```

The new version shows permitted ancestor discussions, including full comments and replies. Exact unchanged targets attach to the current text; changed or ambiguous targets remain in history with an original-version link. Earlier records stay unchanged. [Details](docs/version-feedback.md).

Local review links work only on the service host. To review from another device, [connect to a reachable instance](docs/agent-workflow.md). Anyone who can reach a document URL can read it.

## Documentation

[User guide](docs/user-guide.md) · [Agent workflow](skills/marginroom/SKILL.md) · [Build from source](docs/installation.md#source-builds) · [Hosting and backups](docs/operations.md)

### Maintenance and deploys

In v0.1.4+, the service account can `touch` the file configured by `MMW_MAINTENANCE_FILE` without a restart. Reads stay available; new writes return `503` with `Retry-After`, and the browser keeps unsent input. Poll the running instance's `/api/maintenance/status` for `maintenance: true` and `inflight: 0` before sending `SIGTERM`. Wait for exit before replacing the service, then verify the new instance and remove the flag to reopen writes. `SIGTERM` and `SIGINT` stop the listener and allow up to 30 seconds for admitted requests to finish (configurable via `MMW_SHUTDOWN_TIMEOUT_MS`).

See [the deploy runbook](docs/operations.md#maintenance-and-graceful-deploys) for paths, Compose commands and the one-time upgrade caveat for pre-v0.1.4 instances.

[MIT](LICENSE). Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith.
