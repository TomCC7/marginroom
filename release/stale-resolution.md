# Stale rewrite closeout (local-only)

## Contract

`POST /api/suggest/:doc/:suggestion/resolve-stale` is document-owner-only, using the same `ownsDoc` authorization as accept/reject. No author/display-name or suggesting capability grants it. Client `stale` flags are ignored. A server-valid open rewrite returns 409 `suggestion_not_stale`; wrong-document/missing IDs return 404 after owner authorization, nonowners 403. Already closed stale proposals return the authoritative record with `replayed:true` without another history write. Accepted/rejected/withdrawn rewrites cannot be repurposed by this route. Comment reject/reopen and caller-scoped continuous revisions retain their existing boundaries.

No schema migration or new lifecycle status. Closeout reuses `rejected` plus one append-only `rewrite_history` event (`operation=RESOLVE_STALE`, `new_json={reason}`); public records derive `resolved_stale` and `stale_reason` from that event. Original proposal, author, range, caller provenance, receipt and replies are untouched. Existing history/status triggers still run and advance the paragraph epoch, invalidating obsolete continuous drafts atomically. Old readers see a rejected rewrite (never an applicable open one). Only new readers distinguish its closeout reason. The entire source recheck/status/history transition runs inside an immediate SQLite transaction, reading the canonical source synchronously without an async gap; accept uses that same boundary. This does not coordinate arbitrary out-of-process filesystem writers: cutover still requires stopped writers and the existing matching backup protocol.

`GET /api/suggestions` projects an `invalid_reason` for open/stale rewrites without persisting changes on read or bulk-closing anything. DB `stale` rows remain pending in the new UI until explicit owner closeout. An unchanged, uniquely identifiable paragraph with exact accepted base/range remains acceptable after unrelated source hash changes; missing or changed targets fail closed, and source drift with occurrence-addressed/repeated paragraphs is ambiguous and cannot be reassigned. Existing NULL-hash legacy rows are still revalidated against authoritative source/overlay. Generated/grouped source remains unsupported, not guessed.

UI shows only **标记已处理** as the owner decision for stale rewrites, not accept/reject or fake location. Replying/history remain available. Closeout updates keyed cards, counts and filters without reload, quote navigation or source/iframe reconstruction. Failed acceptance after source drift also changes the card in place and retires obsolete rewrite decorations while retaining canonical text and unrelated active drafts. A stale rewrite can never use the comment reopen API.

## Verification

From the release root:

```sh
node test/stale-resolution.mjs
STALE_ONLY=1 node scripts/stage-continuous-candidate.mjs /home/cc/hermes/wechat-markmyword-prototype/upstream review-artifacts/stale/candidate-current
STALE_RUNTIME=review-artifacts/stale/candidate-current STALE_ARTIFACTS=review-artifacts/stale/candidate-evidence node test/stale-resolution.mjs
npm test
node test/resolve.browser.mjs
node test/inline-cutover.mjs /home/cc/hermes/wechat-markmyword-prototype/upstream review-artifacts/stale/candidate-current
```

The new test uses temporary on-disk SQLite, synthetic documents, an ephemeral loopback HTTP listener and Chromium. It verifies open-orphan/DB-stale closeout, no source/overlay changes, saved replies and reason after reopen, owner/404/cross-doc restrictions, forged stale rejection, concurrent invalid accept/duplicate closeout, valid acceptance, unrelated-source changes, duplicate ambiguity, and ordinary/static at 1440/390. Real pointer closeout removes pending cards; history/filter/count/reload persist. Source/input/iframe identity, inner reading/nested scroll, unsent reply and separate native inline editor text survive. A loaded-valid UI whose source changes has its actual accept rejected and then closes safely, without frame/input loss. Reply-draft concurrency uses a deliberate dispatched event behind the modal, not a claim that the modal permits pointer click-through. Native screenshots show unobstructed primary controls and history.

No deploy, push, CI, tunnel, persistent service or real document/SQLite mutation is authorized. CURRENT is read-only. The candidate is independently derived from latest CURRENT. During this task CURRENT advanced to the approved continuous revision parent: initial cumulative patching correctly refused. `STALE_ONLY=1` requires the nine relevant CURRENT assets to byte-match that approved parent candidate, applies only this card's six runtime deltas, and preserves the complete current inventory (including newer metal-arm content). The failed `review-artifacts/stale/candidate` directory has no manifest and must never be installed; use `candidate-current`. Its full inventory guard must pass again immediately before the parent-authorized cutover. Keep backend/frontend coordinated; use stopped-writer SQLite/docs/identity backups. Rehearsed rollback is to a matching pre-write snapshot, not code-only downgrade after new user writes. Physical Safari/iPhone native selection/keyboard is not certified by Chromium.
