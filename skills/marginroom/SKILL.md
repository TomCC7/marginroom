---
name: marginroom
description: Use when submitting generated HTML for human review.
---
# Marginroom agent workflow
Only import documents you are authorized to submit. Run `marginroom open ./article.html --json`; add `--assets-dir ./site` to make the resource boundary explicit. Read the returned reviewUrl; loopback URLs are local-only. Never substitute screenshots for structured feedback.
Run `marginroom comments <review-url> --status open --json`. Preserve exact record IDs, kind/status, quote, anchor, original context and replies. This command is read-only: it does not authorize replying, resolving, accepting, editing source, or scheduled polling. Ask for authorization for those actions.
Unchanged bundles reopen the same review. After authorized source changes use `marginroom open ./article.html --new-version-of <old-review-url> --json`. Old records remain on the old version; do not replay pending rewrites or copy comments into the new version. Existing version navigation returns located only after exact validation; not_found/ambiguous/unavailable are not permission to guess.
For local human management, explicitly run `marginroom open ./article.html --browser`; the one-use handoff grants only that document to the browser's existing principal. Never disclose token files, identity state, or handoff fragments. Remote instances require explicit --server plus a securely transferred --token-file; no MCP, automatic tunnels, recurring consumer, or registry publication.
