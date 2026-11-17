# Single-block selection repair

## Proven reproductions (isolated fixtures, before mutation)

- A native Selection left in the review shell, followed by input in one wrapped
  list item in the static iframe, produced `原位修改限单个段落；跨段请选择分别处理`
  and reverted input. The frame's own range was valid. Parent `staticMessage`
  incorrectly revalidated the hidden authority block against **parent** Selection.
- Native double-click selected `local`; native triple-click selected the whole
  wrapped li/p, with its end at next sibling offset 0. The old controller returned
  without publishing or invalidating that selection, leaving the double-click
  quote in the composer. HTML indentation between siblings is covered too.

These reproduce the reported symptoms; the original user's exact prior shell
selection history is not known. Pending-record locking is a separate behavior.

## Changes and boundaries

- Keep native authority-DOM range validation; only the already frame-validated
  input bridge avoids reading a different document's Selection. No global
  preventDefault bypass, sandbox relaxation, anchor/schema/auth change.
- Share a single-block range normalizer between parent and trusted frame script.
  Normalize an adjacent next-block offset-0 boundary, including HTML whitespace
  indentation, but never another element (even empty) or sibling text. Clamp
  native edit selections before mutation so siblings cannot be merged.
- Publish current selection at selectionchange/pointerup/keyup; invalid ranges
  explicitly clear old quotes. Capture a requestId-correlated fresh frame snapshot
  on action pointerdown; retain its logical quote/UTF-16 coordinates across focus
  collapse. Request timeout is a failure bound, not a selection debounce.
- Move the single 44px native dimensions hide button into its existing bottom row.
  Hidden desktop uses a compact bottom-edge handle; hidden phone reuses the
  existing action footer without adding a row or covering the imported footer.
  Preserve ARIA, keyboard focus, persisted visibility, Auto measurement and frame.
- Transfer existing grouped-content help titles into the static preview. Grouped
  suggestions stay unsupported. Pending suggestions remain locked separately.

## Verification

`bun run test:selection` runs GET-only native-input/selection fixtures and a real
throwaway server/SQLite import→comment→rewrite→accept→viewer-export test.
Fixtures cover 1440/390, Auto/phone, Fit/100%, li/p visual wrapping, inline shells,
Ctrl+A, cursor edge deletion, plain/multiline paste, CDP composition, repeated
words/UTF-16, true sibling/nested crossblock refusal, rapid reselection and keyboard
selection. Ordinary DOM is tested via an isolated adapter, not a hidden production
Article mode. SQLite persists whole-paragraph 0..166 and replacement 19..24; only
the intended li overlay changes, original source and sibling markup remain intact.

Relevant existing unit, suggest/API, static-preview, frontend, viewport/resize,
mobile-selection/storage and security tests are also exercised. The existing
mobile-storage marker assertion now waits for its actual iframe→parent visibility
transition instead of racing the asynchronous message; its assertion is retained.

Accepted leaf overlays retain existing text-only semantics. This is not a new
rich-text accept/export feature. Physical Safari/iPhone native menus and IME are
not validated by Chromium/CDP simulation.

## Release discipline

Local commit only. No push, CI, install, deployment or service restart is performed.
The private handoff supplies a CURRENT-live-derived public-only candidate,
before/after inventory hashes, unchanged-file list, screenshots and a rehearsed
hash-guarded install/rollback utility. The operator owns installation and exact
private publication. Same-card independent reviewer must repeat both positive and
negative native Range cases and compare final mobile/desktop screenshots.
