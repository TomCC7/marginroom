# Marginroom

Review imported HTML in place: discuss page elements, propose text revisions, and export the accepted result without moving the page into a document editor.

![English review of a synthetic document with a comment, reply and inline revision](docs/screenshots/english-review.png)

## Agent / CLI entry

The same package now includes `marginroom open FILE --json` and read-only `marginroom comments REVIEW_URL --status open --json`. See [installed CLI, pairing, resource limits and cutover](docs/agent-workflow.md) and [agent skill](skills/marginroom/SKILL.md). Local auto-service is Linux-verified on the existing Node 22 runtime; no registry publication or production deployment is performed.

## Run locally

Requires Git and Docker with Compose v2:

```sh
git clone https://github.com/TomCC7/marginroom.git
cd marginroom
cp .env.example .env
docker compose up --build -d
```

Open **http://localhost:3939**. The default instance is reachable only on your machine. Documents, review history and identity keys persist in a Docker volume; `docker compose down -v` deletes them.

**Access:** anyone who can reach a document URL can read it. A private GitHub repository does not protect the running instance. See [sharing and access](docs/operations.md#sharing-an-instance) before inviting reviewers.

## Start a review

1. Choose **Import HTML** and select a file with its local images, or paste HTML source.
2. Use **Browse** to interact with the page, or **Annotate** to select elements and **Add comment**. Select a supported text block and choose **Revise inline** to propose changes.
3. Continue your saved proposal by revising the same block again. Owners can resolve comments and accept or reject revisions in **Discussion**.
4. Open **More actions (⋯)** → **Export accepted HTML** to download the result. Pending proposals and discussion controls are not exported.

English is the default interface language; the compact language control also offers Simplified Chinese. Document text, comments and author names are never translated.

## Learn more

- [User guide](docs/user-guide.md): importing, drafts, reading position, viewport sizes, review decisions, exports and current limits.
- [Operations](docs/operations.md): configuration, identity and recovery, remote sharing, persistent storage and backups.
- [Development and tests](test/README.md): Node setup and focused test suites.
- [Localization](docs/localization.md): resources, self-hosted runtime and frame compatibility.

## License and credit

[MIT](LICENSE). Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith; original copyright and license notices are preserved.
