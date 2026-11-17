# Modern Web Guidance bounded repair audit

## Baseline and boundaries
Implementation starts at exact deployed `ddc0c61e60804887f3cf1a554fc51b9a3339114e`; deployment receipt was read from the predecessor's parent-evidence. The retained read-only audits and nine cached guides remain unchanged outside this worktree. This is a repair pass, not a second broad audit. No live writes, service restart, publication, real comments, or user-document edits were performed.

CURRENT-derived test application and packaging retain all 54 public files. In particular the externally updated `metal-arm-plan.js` (`2672cccea09b4e299c53014e9f88c79a2d8bf589f301cde2a02b3f72522cd68a`) and content JSON (`17dc5180a3af9e63816af713bdac9581f8fc756df575d040055c93cf288a226f`) are copied from CURRENT, not from stale Git versions. Only seven explicitly enumerated frontend assets are candidates for replacement.

## Findings and dispositions

### SEC-01 — medium, reproduced CSS UI redress; repaired
`public/viewer.js:renderBaseHtml`, `public/scope-css.js:scopeCssRules/scopeCssText`.
The original pipeline scoped only head styles, imported body styles globally, and copied unscopable external sheets. The retained fixture made a shell button disappear. The revised pipeline scopes all inline style nodes before importing body content and removes their original nodes; linked sheets and CSS imports are not granted shell stylesheet privileges. Full opaque previews keep their original styling. Constructed stylesheets discard imports without loading them, with a feature-detected existing CSSOM fallback. CSS parse failures no longer return raw unscoped CSS.
Regression: full-product disposable fixture contains malicious body `#more-btn{display:none!important}`, head stylesheet and CSS import; shell button remains visible, no body styles or external sheet are imported into the shell. Review corrections also match stylesheet rel as a case-insensitive whitespace-separated token (`[rel~="stylesheet" i]`), including mixed-case/multi-token body links. Original body styles/sheets are retained in source order in the opaque preview head before replacing its body from Article; they never regain shell privileges. Four-viewport computed-style assertions check body text rgb(123,45,67)/33px and a multi-token data stylesheet's author-control color, while hostile shell-targeting rules leave More visible. The external mixed-case token link is also asserted retained only inside the iframe; external requests were not observed from the opaque fixture in this environment, so its loaded-style behavior is not claimed by that assertion. Native exact-range/rich-inline controls continue working. This repairs the reproduced boundary escape; it is not a proof that the existing CSS scoper is a comprehensive hostile-CSS sanitizer.
Guide: `security` §1.2 and Phase 2 constraint-first policy; `sanitize-untrusted-html` inspected, but no unconditional setHTML adoption because source styles and Safari fallback semantics must remain compatible.

### UX-01 — P1, modal keyboard escape; repaired
`public/viewer.html:#composer`, `public/review-v3.js:showComposer/closeComposer/main`, `public/review-v3.css` final native-modal rules.
The same composer node becomes a native dialog opened with showModal and closed with close. Removed redundant role/aria-modal; no manual focus trap or background inert toggling. Cancel routes through existing dirty-draft confirmation, including browsers without closedby. Pointer backdrop dismissal checks both press and release coordinates, preserving text-selection drags. Native backdrop preserves scrim and layout; mobile visual-viewport CSS remains authoritative.
Regression: real Tab navigation cannot focus background controls; dirty Esc opens existing confirmation, Keep retains Chinese draft and newline, empty Esc closes; native-modal assertion; ordinary Enter and synthetic composition-confirm Enter post nothing. Existing runtime-text native drag → composer → UI submit → exact-ID API/SQLite → reload locate passes at 1440 and 390. No new IME timers or Enter submission changes.
Guide: `dialog` Rule 1 and cancel/fallback rules; `accessibility` §5/§12.

### UX-02 — P2, tool panel focus order; repaired
`public/review-v3.js:pop/closePop` and existing tool handlers.
Opening More/Name/Share focuses the first appropriate native control, exposes aria-controls/expanded, and Escape closes and returns focus to the opener. All existing close paths clear expanded state. No false role=menu/aria-haspopup promises or custom arrow-key contract. Pointer selection behavior is unchanged.
Regression: keyboard Enter and native focusless-pointer clicks on all three triggers, focus within panel immediately, aria-controls/expanded and Esc focus/state restored. The opener is passed explicitly from each handler, never inferred from activeElement (Chromium equivalent policy, not a physical Safari claim).
Guide: `accessibility` logical order and focus management; `viewport-aware-dropdowns` accessibility distinction.

### UX-03 — P2, 390×260 bottom clipping; repaired
`public/review-v3.js:sizePop`.
Retains approved fixed manual placement and sets panel max-height from actual visual viewport bottom minus panel top and 8px safe gap. Recomputed on resize and visualViewport resize/scroll. Does not introduce unsupported Anchor/Popover dependencies. Overflow remains independently scrollable.
Regression: menu at 390×260 has y=80,height=172,bottom=252; Help is fully reachable after scrolling. Also passes 390×320, 390×844 and desktop. Native screenshots inspected, including the short viewport with the last action visible.
Guide: `viewport-aware-dropdowns` edge resilience and manual fallback.

### SEC-02 — low schema/lifecycle hardening; repaired, not an auth-bypass claim
`public/frame-messages.js:parseFrameReady`, `public/viewer.js:onFrameMessage`.
Producer inspection (`frame-controller.js:scan`, lines 593–630) proves repeated ready is legitimate after DOM mutation. DO NOT make it once-only. New parser bounds 20,000 unique nonempty ≤200-char anchors, own origText keys belonging to the set, ≤1,000,000 chars/value and ≤16,000,000 chars total. Edit text is bounded at 1,000,000. Malformed snapshots are rejected atomically; legitimate repeated complete snapshots still update mode/overlay. Existing exact event.source binding remains. No new authorization/token system.
Regression: six malformed schema cases rejected, first and updated snapshots accepted; real opaque interactive controller emits ready, then new DOM paragraph causes a valid larger ready snapshot without runtime error.
Guide: `security` §1.5; `validate-origins` opaque source-bound fallback. An author script sharing the controller frame can still report its own DOM; this is not independent user-intent authentication.

### SEC-H01 — safe sentinel hypothesis now reproduced and narrowly mitigated
Dual-origin loopback HTTP fixture, a fake `?key=DISPOSABLE_SENTINEL_ONLY`, original real renderBaseHtml and author `img referrerpolicy=unsafe-url` produced a request containing the complete fake query in Referer. No actual credential or production request was used. Fixed shell import forces resource/link referrerpolicy=no-referrer; rerun loads the image with empty Referer. Static full-preview sanitization also overrides author policies and prepends a no-referrer meta policy; remote resource loading is not globally disabled.
This confirms the concrete shell resource override, not historical production key leakage. Arbitrary author JavaScript in the intentionally executable opaque interactive renderer still has its pre-existing network capability; changing that renderer's network contract or broader query-capability design is outside this bounded client patch. No claim of comprehensive data-exfiltration prevention.
Guide: `security` companion referrer policy and data hygiene rules.

### UX-P01 — concrete hidden polling work, minimal repair
Extracted actual poll functions from exact predecessor and candidate run under deterministic counters: three hidden poll invocations perform 3 document fetches before, 0 after; a visible invocation performs 1 both times. Add hidden guard, in-flight guard/finally reset, recheck visibility after await, and visible-return refresh. Existing selection/draft/busy guards remain. No claim of measured INP regression or user-visible speedup.
Guide: `performance` recurring work and event lifecycle discipline.

### UX-P02 — redundant SVG rebuild repaired; broader layout claim deferred
Only build the fixed selection-action SVG once; repeated updates still translate the label and preserve actual selection/position logic. Full-product probe calls selectionUI(null) 20 times and asserts SVG node identity survives. The predecessor has an unconditional innerHTML assignment on each call. No batching/rAF rewrite: layout thrashing or long-document timing regression was not established, so geometry and native selection event ordering are intentionally unchanged. This is a bounded concrete DOM-churn fix, not an INP optimization claim.
Guide: `performance` avoid unnecessary UI work. No newly introduced scheduler API.

## Verification and limitations
Commands run from this worktree:
- `bun test/modern-web.browser.mjs`: PASS at 1440×900,390×260,390×320,390×844, plus interactive DOM rescan. GET-only fixtures; no API writes.
- `bun test/modern-web-probes.mjs`: PASS schema, baseline/candidate hidden-poll counters and two-origin sentinel before/after.
- `APP_DIR=../current-app RUNTIME_ARTIFACTS=../evidence/current-runtime bun run test:runtime-text`: PASS 1440/390 synthetic real HTTP/SQLite, native drag, UI submit, exact-ID readback, reload/locate, canonical inline, cross-block/hidden/ambiguous rejection. Base HTML/overlay unchanged.
- Same command with predecessor private-doc JSON and `RUNTIME_ARTIFACTS=../private-evidence`: PASS 1440/390 exact requested legend using CURRENT external enhancer. Initial private test assumed first legend and failed after external enhancer update; test now selects the exact authorized phrase and reload checks that same paragraph, without weakening any assertions. Private screenshots/data are not committed or attached.
- Initial synthetic run hit a transient existing mobile discussion overlay at canonical click; retry and both final repo/CURRENT-derived runs pass. Failure evidence retained, not silently counted as pass.
- `bun run test:api`: PASS. `bun run test:unit`: stops at known baseline frame-suggest c2/c3 assertions, 17 passed/2 failed in that file, same debt as predecessor. No all-green unit claim.
- WebKit executable is absent (`webkit-2336/pw_run.sh`); no WebKit or physical Safari result claimed. Chromium viewport emulation and synthetic composition events do not prove real OS IME, screen reader or physical keyboard behavior.
- Desktop/mobile synthetic and private exact-legend composer screenshots inspected natively. No product visual redesign or permanent explanatory chrome.

## Modern Web Guidance
Provenance: installed skill version `2026_11_09-5bcc021b`; parent cached list/search/retrieve workflow retained under `../guidance/`; this repair additionally executed focused `search "contain modal focus" --skill-version 2026_11_09-5bcc021b` and read the complete relevant cached guides.
- **`dialog`**: I use native modal focus containment instead of layering a custom trap, with cancel interception for existing unsaved confirmation and no closedby dependency ("The browser provides: inert page, focus containment").
- **`accessibility`**: I move focus into newly opened tool panels and restore their trigger on Escape, without promising unimplemented menu semantics ("Manage focus correctly to and from updated content").
- **`viewport-aware-dropdowns`**: I retain the manual positioning fallback and bound panel height to the visual viewport, avoiding unconditional Anchor APIs ("To prevent the panel from being cut off at the edge of the screen").
- **`security`**: I validate bounded message snapshots without breaking legitimate rescan, and constrain resource-policy overrides rather than imposing global CSP ("Validate and sanitize the properties of incoming message payloads"; "Do not blindly apply strict policies to an existing application").
- **`performance`**: I remove demonstrable recurring hidden fetches and redundant SVG replacement; I do not claim unmeasured INP gains ("DON'T block the thread with recurring timers").
