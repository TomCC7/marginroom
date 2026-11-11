# Marginroom

Review HTML pages without moving them into a document editor. Import a page, comment on its elements, suggest text changes in place, and export the accepted result.

![Marginroom with an example document open for review](docs/screenshots/alpha-synthetic.png)

## Run locally

You need Git and Docker with Compose v2. Clone this repository, then run these commands from its directory:

```sh
git clone https://github.com/TomCC7/marginroom.git
cd marginroom
cp .env.example .env
docker compose up --build -d
```

Open **http://localhost:3939**. The default setup listens only on your machine. Documents, review history and identity keys live in a persistent Docker volume. `docker compose down -v` deletes that data.

For configuration, administrator recovery, native Node setup and backups, see [Running Marginroom](docs/operations.md).

## Import and resume a document

1. On the homepage, choose **导入 HTML**. Select an HTML file and its local images, or paste HTML source, then import and open it.
2. If the document name already exists, choose keep both, replace or cancel. Replacement updates the source and keeps its review history, so existing anchors may become invalid. Keep both to review the new copy independently.
3. Use **最近打开** to find documents opened in this browser, including shared links. Search by title or remove local entries without deleting the server document. **我的文稿** lists documents created by the current signed browser identity. Deleting a document is a separate, permission-checked action.

Click **Marginroom** in the viewer to return home. Before leaving with unsaved work, choose to keep editing, submit/save, or discard it. Reading coordinates and viewport preferences are browser-local. Static previews restore reading position; interactive documents retain numeric scroll coordinates, not their forms or application state.

## Comment on a page

1. Leave the viewer in **浏览 (Browse)** to use the original page's links, buttons and forms. Switch to **批注 (Annotate)** to select review targets.
2. Click the element you want to discuss, then choose **写批注**. Use **父元素** to move up the hierarchy. To select a smaller element, click it directly on the page.
3. To comment on a phrase, drag-select its text and choose **写批注**. Text selection offers comments; select an element to propose a rewrite.
4. Enter your comment and submit it. Open its bubble marker or find it in **批注栏**. **定位原文** returns to its target; **回复** continues the discussion.

Close the idle element menu with **×**, **Esc**, or a click on blank page space. Comment and revision drafts keep their own cancel/submit controls. The document owner or administrator can resolve comments and reopen them from **已处理**.

## Suggest and continue editing

1. In **批注**, select a supported single text block and click **原位修改**. The whole block is editable, regardless of any earlier text selection.
2. Edit in place. Red deletions and green insertions appear at their positions in the text. Separate edits stay separate, with unchanged text between them.
3. Click **提交建议** to save. The accepted original stays unchanged until the owner accepts your proposal.
4. Select the same block and choose **原位修改** again to continue your saved proposal. Change an existing edit, add another, or restore the original wording. Saving withdraws reverted edits and retains their discussion history. Cancel discards only unsaved changes.

Pending revisions have a pencil marker, separate from comment bubbles. Click a marker to open its discussion; when several revisions share a target, choose the one you want. Locating a revision from the discussion or filtered list highlights its source and marker. Pages without safe margin space use the inline and discussion controls.

Other reviewers' changes do not lock the entire block. Actual overlapping edits produce a conflict and keep your draft for correction. Older suggestions without a verifiable author identity cannot be claimed by entering the same display name.

## Process feedback and export

The document owner or administrator handles decisions in **批注栏** or **批注列表**:

- Resolve a completed comment. Reopen it from **已处理** if the discussion needs more work.
- Accept a valid revision with **接受修改**, or choose **拒绝**. Acceptance changes the document; rejection keeps the original.
- For an expired or unlocatable revision, choose **标记已处理**. It cannot be accepted. Its proposed text, replies and reason remain in the handled history.

These actions update the review in place. Use the pending/handled and comment/revision filters to find the remaining work.

When ready, open **更多操作 (⋯)** and choose **导出已接受的 HTML**. The download contains the accepted document, not pending proposals or review controls. Uploaded `<img src>` images are embedded, including animated GIFs. Remote images and interactive dependencies are not bundled. The same menu provides **版本历史**, and **直接编辑原文** for identities with edit permission. Direct editing changes the original rather than submitting a proposal; only the owner or administrator can restore a historical version.

## Share with another reviewer

**First make the instance reachable by the other person.** The local quickstart's `localhost` URL only works on your own machine. Use an appropriately configured private-network or HTTPS deployment before sharing. See [Sharing an instance](docs/operations.md#sharing-an-instance).

1. As the owner or administrator, open **分享** and set what link holders can do: **仅阅读**, **阅读与建议**, or **直接编辑**.
2. Choose **复制链接** and send the direct document URL. The recipient can open that document without going through the homepage.
3. The recipient uses their own browser identity to comment or suggest. You return to the document in your owner browser to process the feedback. Link holders receive the selected access level, not ownership.

Never share an administrator recovery key or a key-bearing URL.

## Preview at another size

Use the viewport controls to choose Desktop, Laptop, Tablet, Phone or custom dimensions. Rotate the viewport, fit it to the available space, or use 100% with stage panning. Preferences are per document. These are isolated iframe viewports, not full device or Safari emulation.

## Identity and access

**Anyone who can reach the instance and knows a document URL can read it.** An unlisted document is not private. Sharing does not create individual invitations or accounts.

- **Read:** page only; visitors cannot see discussion records or counts.
- **Suggest:** page, comments and proposed changes.
- **Edit:** also permits direct text editing.

Only the document owner or instance administrator can manage sharing, process comments and revision decisions, restore history or delete documents. The administrator's recovery cookie/key is separate from the uploader's browser identity. Display names do not prove ownership. Changing browsers/devices does not sync ownership, recent history or reading coordinates. See [ownership recovery](docs/operations.md#identity-ownership-and-cookie-recovery).

For confidential material, use an external login gate or private network. A private source repository does not protect a running instance.

## Current limits

- Inline rewriting supports single-block source text and preserves supported inline formatting. Arbitrary rich/grouped, cross-block and runtime-generated content remains comment-only. A stale save retains your draft rather than replacing newer work.
- Element locators distinguish repeated targets. Changes within an anonymous target's source scope can invalidate its locator; the viewer reports a missing target instead of attaching the discussion to a similar element.
- Static exports embed uploaded `<img src>` images. Remote images, CSS backgrounds, `<picture>` sources and interactive dependencies are not bundled. Image filenames share an instance-wide namespace; a selected conflicting image must be renamed together with its HTML reference.
- Interactive scripts run inside an opaque-origin sandbox. Exported HTML does not inherit that sandbox, and coarse cleanup is not a complete HTML sanitizer. Only open downloads from authors you trust.
- The tool UI is Chinese. Chromium is tested; physical iPhone/Safari behavior remains a device check.

## Development

Tested with Node **22.23.4**. Install dependencies and run the unit/API suites:

```sh
npm ci
npm test
```

Install Chromium before running a browser workflow test:

```sh
npm run browser:install
node test/home-entry.browser.mjs
```

See the [test guide](test/README.md) for additional suites. [Operations evidence](release/operations-evidence.md) documents alpha Docker/recovery checks.

## Credits and license

Based on [markmyword](https://github.com/alexagriffith/markmyword) by Alexa Griffith, with a revised review interface, inline suggestions and self-hosting tools. [MIT license](LICENSE); original copyright and license notices are preserved.
