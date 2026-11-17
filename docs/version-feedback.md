# Feedback across document versions

`--new-version-of` preserves the original source, assets, overlay and discussion rows. New-version reads include the current version's native threads plus its **authorized ancestors**, not siblings, descendants or an arbitrary series-wide list. This also works for chains created before this release and for comments/replies added to predecessors after creating a descendant. There is no database migration, comment copy or automatic acceptance.

## Reading and locating

The right-side Discussion and `marginroom comments NEW_URL --status all --json` show full bodies and nested replies. Pending/handled filters retain the source status. An inherited record keeps its original `id`, `doc_id`, `anchor`, `source_hash`, `quote`, `base_text`, UTF-16 ranges, author and timestamps. Additive fields are:

- `inherited:true`, `sourceDocId`, `sourceVersion:{document,created}` and `viewDocId`;
- `placement:{status,reason,anchor?,start?,end?,baseText?}` describing evidence for this view only;
- `canReply` and `canManageSource` describing source permissions, not new authority.

Never replace original locator fields with placement fields when storing or forwarding a record. Route an authorized reply to `/api/suggest/SOURCE_DOC/RECORD/replies`, not the document being viewed. The browser does this for inherited replies. Source management remains on the original version; inherited accept/reject/resolve controls are not offered in the new view. A pending inherited rewrite is discussion, not a change to replay on newer text.

Placement reuses the existing element and logical paragraph resolvers. It requires exact original context, a unique current target, and verified UTF-16 quote/range evidence. Old raw KaTeX ranges can map only when raw context is identical and the visible quote is exact. Changed/deleted, duplicated, nonlinear or unverifiable targets fail closed as `not_found`, `ambiguous` or `unavailable`. They remain in Discussion with original passage context and a source-version link, not a guessed highlight. No old source hash is installed on a new DOM.

## Access policy

Human reviewers use their existing human session, never the uploading machine's token. Per-document link discussion policy (`suggest`/`edit`, or actual owner/management grant) determines whether discussion can be read. A `view`-only document hides its discussion from non-managers under the existing policy. Every ancestor is checked separately. Traversal stops at the first inaccessible predecessor; neither its identity nor references beyond that boundary are disclosed. Version navigation lists this permitted ancestry, oldest first, and removes inaccessible `previous`/series references.

Unscoped machine readers still require ownership/grants for **each** document. A delegated read-only credential for the newest document reads only that document's native feedback, even if predecessors have public discussion links. Revoked/invalid Bearer credentials remain 401, never guest fallback. Reading versions grants no edit, management, delete, accept or reject authority.

## Ordering, pagination and limits

Threads are ordered oldest ancestor first, then source creation time and stable record ID. Replies retain source creation/row order. Ancestry is one cycle-guarded recursive SQL query, bounded to 128 versions; exceeding the depth limit fails explicitly. Thread/reply/history hydration is batched, not a recursive per-thread query. Parsed source/anchor resolution is cached only for the current request.

`GET /api/suggestions/DOC?status=all&limit=200&offset=0` returns `suggestions`, `total`, `complete`, `nextOffset` and an opaque `snapshot`. Limit is 1–200. Send the snapshot with subsequent pages; database writes invalidate it with 409 (`history_changed_retry`). Clients must restart collection, not label mixed pages complete. At most 10,000 replies are hydrated per page; larger pages fail with `history_reply_limit` (413), so lower the page limit. Excess ancestry fails with `history_depth_limit` (422). Missing or unverifiable source targets do not delete discussion.

The native sidebar and CLI collect up to 50 pages / 10,000 threads. They refuse incomplete or changing history instead of silently displaying truncated output as complete. CLI `schemaVersion:1` is unchanged; `complete:true` means all permitted pages for the chosen status were returned. The CLI is read-only. Native history/navigation errors remain visible and navigation provides a retry control.

## Disposable verification

`bun run test:versions` exercises the actual app and opaque iframe with a three-version chain, fork, unrelated document, full bodies/replies, exact and outdated locations, legacy math/UTF-16, source routing, permissions, filters and immutable originals. Set `TEST_BINARY=/ABS/INSTALLED/marginroom` to run the same checks through an installed standalone service, actual CLI comments and a verified service restart. `VERSION_ARTIFACTS=/ABS/OUTPUT` retains secret-free receipts and desktop/phone screenshots outside the source tree. No production service or database is used.
