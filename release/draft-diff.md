# Bounded live draft diff repair

## Evidence and scope

The operator supplied two user images: `img_d3b69d778851.webp` (unsubmitted full-paragraph red/green draft) and `img_0ad5729ab283.png` (submitted localized change). Both were inspected natively. They do not establish which letter the user edited. Synthetic fixtures only were used for reproduction.

Before the repair, replacing one synthetic paragraph letter rendered all 323 UTF-16 units deleted and the entire edited paragraph green. `inline-draft.js` merely unhides a full-scope `del` on input and colors the full editor as an insertion. Submission already uses the canonical `review-ranges.difference` prefix/suffix reduction. The latest operator instruction explicitly narrows this task to the draft renderer; submission, backend, schema, range/patch storage and final rendering are unchanged.

## Repair

Only `public/inline-draft.js` and `public/static-preview.js` are deployed changes:

- Reuse **the existing** UTF-16-safe `difference` for draft paint; inject that same function into the opaque preview controller.
- Preserve canonical rich children when opening the full-element editor instead of pre-flattening its markup.
- Keep unchanged text ordinary. Paint the inserted range with CSS Custom Highlights. Paint only removed text in a noninteractive, fixed-position red strikethrough label above the changed range (gutter fallback at the viewport's first line).
- Keep the active editable tree untouched on input/composition/undo. Remove highlight/label on stop. A no-op has neither marker.
- Keep native source/selection semantics, toolbar rows, browse/annotate policy, comments, and submit behavior unchanged.

The deletion label is out of source flow specifically to avoid inserting fake text into the editable, native undo stack or payload. The independent reviewer should judge its visual anchoring, not just the assertions. CSS Custom Highlights require a modern browser; physical Safari IME/selection was not exercised.

This deliberately retains the existing single minimal-enclosing-range semantics for separate edits. No new character-edit algorithm or multi-hunk API was introduced under this narrowed authorization.

## Real verification

- `DRAFT_BASELINE=1 bun test/draft-diff.browser.mjs` before edits: `REPRODUCED: one-letter input renders entire 323 UTF-16-unit paragraph as deleted`.
- `bun test/draft-diff.browser.mjs`: PASS native p/li start/middle/end, 1440/390, preserved emphasis/citation, cancellation, real native undo/redo, insertion/deletion, emoji-surrogate replacement and Chromium CDP IME composition/commit.
- `bun test/element-context.browser.mjs`: PASS real disposable server/SQLite browser flow, varying residual full/partial selections, exact removed letter and highlighted inserted `Z`, rich p/li, comments/citations, exact UI POST `quote:'p', body:'Z', rangeStart:3, rangeEnd:4`, persisted row matching that request, submitted DOM `del p`/`ins Z`, accepted `SimZle text leaf.`, immutable original source, disjoint pending rebase and permission gates.
- Narrow tests: `bun test/review-ranges.test.mjs && bun test/frame-messages.test.mjs && bun test/element-review.test.mjs && bun test/anchoring-inline.test.mjs`: four modules PASS; UTF-16, repeated quotes, drift, DOM exclusions and message guards covered.
- `bun test/security-release.test.mjs`: 23 checks PASS on synthetic runtime.
- CURRENT-derived candidate served from its own disposable server/SQLite also passes `test/element-context.browser.mjs`; its log is `review-artifacts/draft-candidate-test.log` and evidence is `review-artifacts/draft-candidate-evidence/`.

Native-inspected screenshots: `review-artifacts/draft-diff/before-1440.png`; `review-artifacts/element-context/evidence/one-letter-draft-1440.png`, `one-letter-draft-390.png`, `one-letter-submitted-1440.png`. Candidate evidence includes same-edit `one-letter-leaf-draft-1440.png` / `one-letter-submitted-1440.png` and recorded exact payloads in `evidence.json`.

## CURRENT candidate and parent-only handoff

Baseline release: `b6145c0b9ce02bc92e1859942d86fef67705f978`. Observed CURRENT git HEAD: `c089565bc398b78dfd83d2c2ccf70fb8a834b363`; the full working-tree asset inventory, not HEAD alone, is guarded.

Build command (CURRENT is the actual served code root; it is read only here):

```
DRAFT_ONLY=1 INLINE_BASELINE=b6145c0b9ce02bc92e1859942d86fef67705f978 bun scripts/stage-inline-candidate.mjs CURRENT review-artifacts/draft-current-candidate
```

The candidate is independently copied from CURRENT, then patched with only the two reviewed frontend hunks. Its `manifest.json` contains every before/after hash. All other public assets, branding, backend and package files stay byte-identical. The draft-only stage guard rejects any other deployed delta.

```
bun scripts/install-inline-candidate.mjs check review-artifacts/draft-current-candidate CURRENT NEW_BACKUP
```

Check was actually run against CURRENT and passed. Check → install → rollback → check was rehearsed against a disposable **code-only copy**, with all post-write hashes verified. No live install happened.

Only the parent may perform live cutover after independent review, identity/docs/DB backup and appropriate writer freeze:

```
bun scripts/install-inline-candidate.mjs install CANDIDATE CURRENT NEW_BACKUP --writers-stopped
bun scripts/install-inline-candidate.mjs rollback CANDIDATE CURRENT NEW_BACKUP --writers-stopped
```

Both commands guard the full inventory and candidate/target/backup digests. Any drift requires restaging/review, not overriding the guard. This task performed no live mutations, service operations, pushes or CI. Parent owns public hash verification and private exact-SHA publication.
