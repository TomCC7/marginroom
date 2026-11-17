# Interface localization

Marginroom uses i18next 27.1.1, vendored on the same origin. See
[the vendor provenance and acquisition recipe](../public/vendor/README.md).
The browser loads the engine locally without a runtime CDN or translation
service. Localization adds no bundler or production dependency. English is the
initial and fallback language; Simplified Chinese is the other supported locale.
Unknown or unavailable browser storage falls back to English. The language
preference belongs to the browser rather than an account.

## Adding copy

Add semantic keys to both `public/locales/en.js` and `zh-CN.js`. Use interpolation
for values and i18next/Intl plural and number formatting for counts. Never use
rendered copy as a lookup key. Missing keys throw and are collected by the central
locale instance. Bind only product-owned nodes and text attributes using
`bind`/`bindShell`; never scan imported content for words to replace. User text,
filenames, document titles, author names and comments are not translation targets.

The viewer retains translation producers for its current notices and menus.
Locale-only keyed card updates reconcile text and presentation attributes in
explicit shell-owned card containers, retaining cards, buttons, input values and
focus. They do not invoke source decoration, mode application, polling, iframe
reconnection or editable-DOM rendering. Marker and inline-draft controllers expose
separate label-only locale methods. Dates use the active locale; saved record
values are unchanged. Unknown server failures retain their actual reason inside
a localized explanation.

## Sandboxed frame compatibility

`frame-locale.js` fetches the pinned same-origin engine and inlines it with the
same resources into each newly generated opaque document. Static previews retain
their existing channel/token/source/origin validation. Their additional `locale`
message accepts only `en` or `zh-CN`. Interactive controllers accept this message
only from their existing parent window and validate the same exact two values.
The parent supplies the current locale on readiness as well as on later changes,
so a switch during delayed boot is not lost. This protocol does not change source
HTML, source `lang`, script state, selection or canonical anchors.

Install the engine, resources and frame module with the complete reviewed frontend
inventory before serving the new shell. Reload pre-upgrade tabs to obtain that
asset set. Older controllers ignore the additive locale message and older parents
do not send it, so mixed cached versions may leave frame controls untranslated.
Within the upgraded app, language switches preserve the frame without reloading
or reconstructing it.

Include vendor and resource files in runtime and rollback inventories.
Localization requires no database, backend schema or dependency cutover.

## Verification

- `bun test/i18n.test.mjs`: resource/key/placeholder parity, fallback, plural,
  storage, missing-key and scoped hardcoded-copy checks.
- `bun test/i18n-viewer.browser.mjs`: disposable SQLite/HTTP/browser
  import, comment/reply, inline draft, save/reload and locale invariants at
  desktop/mobile widths, with ordinary/static/interactive render paths.
- `bun test/i18n-open-states.browser.mjs`: bounded open name/share/filter,
  failed-submit leave confirmation, grouped help and loading/empty/populated
  history locale roundtrips. Only denial and held-history probes intercept HTTP;
  synthetic version rows live solely in the disposable database.
- The browser checks use synthetic native composition events. Physical IME,
  iPhone, Safari and native-keyboard behavior require device testing.

Detailed operator installation/rollback instructions accompany the independently
CURRENT-derived candidate; only the protected operator performs deployment.
