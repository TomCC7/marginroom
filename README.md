# Marginroom

Review generated HTML in place. Comment on text or elements, propose revisions, and let an agent read the feedback as JSON.

![English review with a comment, reply and inline revision](docs/screenshots/english-review.png)

## Try the CLI

Requires **Linux and Node >=22.23.4 <23** for local auto-start. The CLI is not published on npm or included in GitHub `main` yet. Use the supplied `marginroom-cli-d7e9f1c.tgz` test archive.

Install into a separate directory without sudo. Use a desktop session for `--browser`; headless agents use `--json` instead:

```sh
npm install --prefix ./marginroom-test ./marginroom-cli-d7e9f1c.tgz --omit=dev
CLI="$PWD/marginroom-test/node_modules/.bin/marginroom"
STATE="$PWD/marginroom-test/state"

"$CLI" open /absolute/path/to/article.html --data-dir "$STATE" --browser
```

The CLI starts or reuses its service, prints the review URL, and opens your browser with document-management permission. Add `--assets-dir /path/to/site` when dependencies need a wider root. Your original files stay unchanged.

## Test the review loop

1. In **Annotate**, select text and choose **Add comment**. Submit a comment and add a reply to its thread.
2. Read that thread through the CLI. Replace `REVIEW_URL` with the printed URL:

```sh
"$CLI" comments 'REVIEW_URL' --data-dir "$STATE" --status open --json
```

Check the record ID, quote, body and replies. This command only reads feedback.

3. Repeat the original `open` command. It should reuse the same review and retain the thread.
4. Change the HTML, then explicitly create a new version:

```sh
"$CLI" open /absolute/path/to/article.html --data-dir "$STATE" \
  --new-version-of 'REVIEW_URL' --browser
```

The old review remains intact. Version navigation locates an old target only when it can verify it; otherwise it reports why it cannot.

`--json` suppresses browser launch and prompts. It cannot be combined with `--browser`. State persists in `$STATE`; closing the terminal does not stop the service.

## Sharing and other setups

Loopback URLs work only on the service host. For another device, use a reachable, explicitly paired instance with `--server` and `--token-file`. See [CLI setup and pairing](docs/agent-workflow.md). Anyone who can reach a document URL can read it; repository privacy does not protect the running site.

For the web-only Docker setup, run these commands from a source checkout:

```sh
cp .env.example .env
docker compose up --build -d
```

Open http://localhost:3939. Data persists in a Docker volume; `docker compose down -v` deletes it.

## More

[User guide](docs/user-guide.md) · [Operations and backups](docs/operations.md) · [Agent skill](skills/marginroom/SKILL.md) · [Development and tests](test/README.md) · [Localization](docs/localization.md)

[MIT](LICENSE). Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith. Original notices are preserved.
