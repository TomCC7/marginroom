# Marginroom

Review HTML pages without moving them into a document editor.

Upload a newsletter, report, or other HTML page. Reviewers can comment on the page and suggest text changes. Accept the changes you want, then download the edited HTML.

![Marginroom with an example document open for review](docs/screenshots/alpha-synthetic.png)

## What you can do

- Keep the page's layout while reviewing its text.
- Leave comments on text, images, and other elements, then reply or resolve them.
- Suggest changes directly in a paragraph. The document owner accepts or rejects them.
- Find discussions in a separate list and jump back to the relevant passage.
- Download the accepted text without the review controls. Uploaded images, including animated GIFs, are included in static exports.

Marginroom is an early, self-hosted app. The review interface is currently mostly Chinese; a language switcher is not available yet.

## Run locally

You need Docker with Compose v2. Clone this repository, open its directory, and run:

```sh
cp .env.example .env
docker compose up --build -d
```

Open **http://localhost:3939**. Upload an HTML file or paste its source to start reviewing.

The default setup listens only on your own machine. Documents, review history, and identity keys are stored in a Docker volume and survive restarts. Do not use `docker compose down -v` unless you intend to delete that data.

For configuration, administrator access, native Node setup, and backup instructions, see [Running Marginroom](docs/operations.md).

## Review a page

1. Upload your HTML and any local images it uses.
2. Choose the link's access level and share the viewer URL with your reviewers.
3. Reviewers select text to comment or switch to Suggesting to propose a change.
4. As the owner, reply to comments and accept or reject suggestions.
5. Download the result when you're ready.

To review from another device, you need to make your instance reachable. Read the access notes below before exposing it outside your machine.

### Preview a frontend viewport

The persistent header's preview selector defaults to **Article** (the existing page view). Choose **Desktop 1440 × 900**, **Laptop 1366 × 768**, **Tablet 768 × 1024**, **Phone 390 × 844**, or **Custom** (integer width and height, 240–4096 CSS pixels). Rotate swaps the selected dimensions without changing the saved custom dimensions. **Fit** scales only the reviewed page into the available workspace; **100%** keeps CSS pixels unscaled and lets you scroll/pan the preview stage. The adjacent percentage reports the actual scale.

Device previews use a real isolated iframe viewport: media queries, `vw`/`vh`, fixed elements, dialogs, and page scrolling use the selected dimensions, not the browser window. Resizing, rotating, changing sidebars, and returning through Article do not refresh the document or discard local input and review drafts. Preferences are stored per document in this browser only; blocked or invalid browser storage falls back safely.

Static HTML keeps its existing storage anchors and review workflow; its scripts remain stripped, so a static preview does not make inactive controls interactive. Already-interactive imports keep their existing sandbox and application state. This is viewport sizing, not full device emulation (no simulated touch, browser engine, OS, pixel density, or fake device frame). External resources and the existing comment-only restrictions below are unchanged.

## Who can access a document?

**Anyone who can reach your instance and knows a document's URL can read it.** There are no user accounts, invitation-only documents, or per-person access lists.

The link's setting controls what visitors can do:

- **Read:** view the page. Visitors cannot see its discussion records.
- **Suggest:** view the page, comment, and propose changes.
- **Edit:** also change the document text directly.

These settings apply to all visitors, not to individual people. Only the document owner or instance administrator can accept or reject suggestions, restore history, or change sharing permissions.

A signed browser cookie identifies the person who uploaded a document. A display name is only a label, not a verified identity. The instance administrator has a separate recovery key. See [ownership and cookie recovery](docs/operations.md#identity-ownership-and-cookie-recovery) if you lose access.

For confidential documents, put the instance behind a login gate or private network. A private GitHub repository does not make a running instance private.

## Current limits

- Text suggestions work within one ordinary paragraph. Resolve a pending suggestion before proposing another in the same paragraph. Grouped content, cross-paragraph selections, and interactive pages support comments only in the current review interface.
- Paragraph edits use plain text and can remove inline formatting such as links or bold text in that paragraph.
- Static exports bundle uploaded `<img src>` images. Remote images, CSS backgrounds, `<picture>` sources, and dependencies of interactive pages are not bundled. Uploaded image filenames must be unique across the instance.
- Downloaded interactive HTML can run its own scripts. Exports do not have the viewer's sandbox protection. Review untrusted HTML with care.
- Browser tests use Chromium. Real iPhone and Safari behavior still needs testing.

## Development

The tested Node version is **22.23.4**. To install dependencies and run the unit and API tests:

```sh
npm ci
npm test
```

For browser, security, and end-to-end tests:

```sh
npm run browser:install
npm run test:all
```

See the [test guide](test/README.md) for individual suites. The [operations verification notes](release/operations-evidence.md) record the Docker and recovery checks performed for this alpha.

## Credits and license

Marginroom is based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith, with a revised review interface, inline suggestions, and self-hosting tools.

[MIT license](LICENSE). Original copyright and license notices are preserved.
