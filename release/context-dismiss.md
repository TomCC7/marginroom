# Bounded element-context dismissal

Frontend-only delta from `fd183176ddbd8538c12e7ad59cfb4a53edfb6ddb`.

- Compact actual × (`aria-label="关闭"`), 36px desktop / 44px phone hitbox, reserved space beside hierarchy navigation. No new toolbar/header.
- X and idle-context Escape clear shell selection and the owning picker; focus returns to the document/frame with `preventScroll`. They do not exit Annotate or toggle the discussion rail.
- Completed primary blank taps on the document root/body/html clear the controller through the existing validated `targetCleared` bridge. The shell handles only its own article/root background. Eligible elements retarget normally; review controls/marks retain their actions. No raw frame-coordinate outside-click heuristic or message-guard change.
- Clear cancels pending picks and stale geometry publication. Unchanged residual native ranges are suppressed until changed, not destroyed. Interactive async text publication is generation-gated.
- Comment/reply composers retain the existing explicit unsaved-content dialog. Inline drafts remain active on blank clicks. No changes to cancellation/submission APIs, saved marks, records, source, reading restore, iframe/app lifecycle or mode.

## Verification

`test/context-dismiss.browser.mjs` first failed on the missing actual X against the baseline. Final real Chromium run passes ordinary DOM, opaque static and interactive frames at 1440/390: mouse/touch X, shell/frame Escape, genuine root/stage blanks, first-click retarget, parent/remembered-child navigation, comment/reply unsaved protections, supported inline draft/caret/range preservation, unchanged frame/input/reading snapshot, saved records/marks, and geometry + full poll interval without resurrection. No page errors. Ordinary renderer is reached only by a test-only legacy Article option; no production navigation is added.

Native before/after PNGs and structured evidence: `review-artifacts/dismiss/evidence/`. A bounded `DISMISS_SCROLL=1 DISMISS_WIDTHS=390` follow-up covers nonzero ordinary window/frame reading coordinates and real static/interactive Browse input (plus the interactive source button); it does not broaden the feature. Legacy ordinary Browse form editing is not certified by this probe; ordinary mode is test-only, while actual user documents use frames. Desktop/phone captures inspected against the provided context-popover reference: compact two-row hierarchy/actions retained; X does not overlap hierarchy or snippet; after close the ephemeral corner/outline is gone while saved comment paint remains. Physical Safari/iPhone selection/keyboard unverified.

Narrow existing regressions: `node test/element-context.browser.mjs`, `node test/draft-diff.browser.mjs`, `node test/triple-selection.browser.mjs`, `node --test test/element-review.test.mjs test/frame-messages.test.mjs`, `node test/viewer-ui.test.mjs`. No broad repeated application matrix.

## Candidate / operator boundary

After committing a clean release, run `node scripts/stage-dismiss-candidate.mjs CURRENT review-artifacts/dismiss/candidate`. It independently copies CURRENT runtime code, applies only the six frontend semantic deltas, refuses any other public delta since the baseline, and records every runtime file's before/after digest. Existing CURRENT branding, homepage/server changes and unrelated content remain byte-identical. This is not a wholesale release replacement and introduces no backend/package/schema changes.

Use `scripts/install-inline-candidate.mjs check|install|rollback CANDIDATE STOPPED_TARGET NEW_BACKUP [--writers-stopped]`. The guard rejects full-inventory or hash drift (including unrelated content), checks candidate bytes, verifies backup hashes before rollback and reads back every written asset. Rehearse only against a disposable CURRENT code copy; never install into served CURRENT during worker/reviewer execution. Parent must recheck the read-only guard immediately before any authorized deployment, back up DB/docs/identity and coordinate writers/services per existing operator policy. No push, CI, service/tunnel operation, publication or live mutation is part of this task.

Independent same-card review is required before downstream continuous-revision work is released. That work and margin tags are intentionally untouched.
