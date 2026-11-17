---
name: marginroom
description: Use when submitting generated HTML for human review.
---
# Marginroom agent workflow

## Submit a document

Import only documents you are authorized to submit:

```sh
marginroom open ./article.html --json
```

Add `--assets-dir ./site` to set the resource boundary. Read the returned `reviewUrl`; loopback URLs work only on the service host. Remote instances require both `--server` and a securely transferred `--token-file`. The CLI creates no tunnel or deployment and requires no MCP, recurring consumer or registry publication.

## Read feedback

```sh
marginroom comments 'REVIEW_URL' --status open --json
```

Use structured feedback rather than screenshots. Preserve exact record IDs, kind/status, quote, anchor, original context and replies. This command is read-only. Obtain authorization before replying, resolving, accepting, editing source or scheduling polling.

## Submit a new version

Unchanged bundles reopen the same review. After authorized source changes, run:

```sh
marginroom open ./article.html --new-version-of 'REVIEW_URL' --json
```

Original records remain on their source version; new-version sidebar and `comments` reads project permitted ancestor threads, full bodies and replies without copying. Preserve `doc_id`/`sourceDocId`; route authorized replies/mutations to the actual source, not the viewed version. Pending inherited rewrites remain discussion only; do not replay or accept them on newer text. Outdated targets retain historical context and a source-version link. Version navigation returns `located` only after exact validation. Treat `not_found`, `ambiguous` and `unavailable` as failed navigation, not permission to guess a target.

## Hand management to a local browser

Run `marginroom open ./article.html --browser` explicitly. Its one-use handoff grants only that document to the browser's existing principal. Keep token files, identity state and handoff fragments private.
