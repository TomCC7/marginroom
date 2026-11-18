# Using Marginroom

For terminal or agent use, follow [the CLI workflow](agent-workflow.md). This guide covers browser review.

[Install and run locally](operations.md#docker-installation), then open the instance in your browser. The interface starts in English; the language control also offers Simplified Chinese. Your choice applies to the homepage and viewer in this browser. It changes product controls while preserving document text, authors and comments.

## Import and resume a document

1. On the homepage, choose **Import HTML**. Select an HTML file and its local images, or paste HTML source, then import and open it.
2. Select a published resource folder when needed. The dialog shows the title and selected-resource count. Missing declared dependencies fail before publication.
3. Identical selected content resumes the same review for this identity, regardless of filename. Check **Start an independent review** for a separate copy. To create a revision, enter the previous review URL. Old URLs retain their feedback; pending old rewrites are not applied to the new version.

Use **Recent** to find documents opened in this browser, including shared links. Search by title or remove local entries without deleting the server document. **My documents** lists documents created by or explicitly granted to the current signed browser identity. Management access does not establish authorship. Deleting a server document is a separate, permission-checked action.

Click **Marginroom** in the viewer to return home. Before leaving with unsaved work, choose to keep editing, submit/save, or discard it. Reading coordinates and viewport preferences are browser-local. Static previews restore reading position; interactive documents retain numeric scroll coordinates, not their forms or application state.

## Comment on a page

1. Leave the viewer in **Browse** to use the original page's links, buttons and forms. Switch to **Annotate** to select review targets.
2. Click the element you want to discuss, then choose **Add comment**. Use **Parent** to move up the hierarchy. To select a smaller element, click it directly on the page.
3. To comment on a phrase, drag-select its text and choose **Add comment**. Text selection offers comments; select an element to propose a rewrite.
4. Enter your comment and submit it. Open its bubble marker or find it in **Discussion**. **Locate source** returns to its target; **Reply** continues the discussion.

Close the idle element menu with **×**, **Esc**, or a click on blank page space. Comment and revision drafts keep their own cancel/submit controls. The document owner or administrator can resolve comments and reopen them from **Handled**.

## Suggest and continue editing

1. In **Annotate**, select a supported single text block and click **Revise inline**. The whole block is editable, regardless of any earlier text selection.
2. Edit in place. Red deletions and green insertions appear at their positions in the text. Separate edits stay separate, with unchanged text between them.
3. Click **Submit revision** to save. The accepted original stays unchanged until the owner accepts your proposal.
4. Select the same block and choose **Revise inline** again to continue your saved proposal. Change an existing edit, add another, or restore the original wording. Saving withdraws reverted edits and retains their discussion history. Cancel discards only unsaved changes.

Pending revisions have a pencil marker, separate from comment bubbles. Click a marker to open its discussion; when several revisions share a target, choose the one you want. Locating a revision from the discussion or filtered list highlights its source and marker. Pages without safe margin space use the inline and discussion controls.

Other reviewers' changes do not lock the entire block. Actual overlapping edits produce a conflict and keep your draft for correction. Older suggestions without a verifiable author identity cannot be claimed by entering the same display name.

## Process feedback and export

The document owner or administrator handles decisions in **Discussion** or **List**:

- Resolve a completed comment. Reopen it from **Handled** if the discussion needs more work.
- Accept a valid revision with **Accept revision**, or choose **Reject**. Acceptance changes the document; rejection keeps the original.
- For an expired or unlocatable revision, choose **Mark handled**. It cannot be accepted. Its proposed text, replies and reason remain in the handled history.

These actions update the review in place. Use the pending/handled and comment/revision filters to find the remaining work.

**Inherited comments:** Resolve/Reopen requires human management access to the **original source document**, not ownership of the version you are reading. This remains available when the inherited target is outdated or missing: closing a conversation does not accept a source edit. The one original thread is updated for the source and every descendant view; Pending/Handled and counts refresh on other open versions and after reload. Its original ID, passage, body and replies are retained. A failed request leaves it pending. Inherited rewrite proposals cannot be applied from the descendant. Ordinary reviewers (including the comment's author), read-only visitors and machine/delegated tokens gain no decision permission. For paired-machine uploads, use the existing per-source browser management handoff (`marginroom open … --browser`); granting management of only the newest version does not grant management of its predecessors. A card without source management explains the requirement.

Open **More actions (⋯)** and choose **Export accepted HTML** to download the accepted document without pending proposals or review controls. Uploaded `<img src>` images are embedded, including animated GIFs. See [current limits](#current-limits) for resources the export does not bundle.

The same menu offers **Version history** and, with edit permission, **Edit source directly**. Direct editing changes the review document instead of submitting a proposal. Only the owner or administrator can restore a historical version.

## Share with another reviewer

Make the instance reachable through a private network or HTTPS deployment before sharing. A quickstart `localhost` URL works only on your machine. See [sharing an instance](operations.md#sharing-an-instance).

1. As the owner or administrator, open **Share** and set what link holders can do: **Read only**, **Read and suggest**, or **Edit directly**.
2. Choose **Copy link** and send the direct document URL. The recipient can open that document without going through the homepage.
3. The recipient uses their own browser identity to comment or suggest. You return to the document in your owner browser to process the feedback. Link holders receive the selected access level, not ownership.

Never share an administrator recovery key or a key-bearing URL.

## Preview at another size

Use **Size** in the topbar to show or hide viewport controls. Choose **Auto** to fill the available area, or **Desktop**, **Laptop**, **Tablet**, **Phone** or **Custom size** for fixed dimensions. Rotate the viewport, fit it to the available space, or use 100% with stage panning. Preferences are per document. These are isolated iframe viewports, not full device or Safari emulation.

## Identity and access

Anyone who can reach the instance and knows a document URL can read it, including unlisted documents. Sharing sets a link-wide access level rather than creating individual invitations or accounts.

- **Read:** page only; visitors cannot see discussion records or counts.
- **Suggest:** page, comments and proposed changes.
- **Edit:** also permits direct text editing.

Only the document owner or instance administrator can manage sharing, process comments and revision decisions, restore history or delete documents. The administrator's recovery cookie/key is separate from the uploader's browser identity. Display names do not prove ownership. Changing browsers/devices does not sync ownership, recent history or reading coordinates. See [ownership recovery](operations.md#identity-ownership-and-cookie-recovery).

For confidential material, use an external login gate or private network. A private source repository does not protect a running instance.

## Current limits

- Inline rewriting supports single-block source text and preserves supported inline formatting. Arbitrary rich/grouped, cross-block and runtime-generated content remains comment-only. A stale save retains your draft rather than replacing newer work.
- Element locators distinguish repeated targets. Changes within an anonymous target's source scope can invalidate its locator; the viewer reports a missing target instead of attaching the discussion to a similar element.
- Static exports embed uploaded `<img src>` images. Remote images, CSS backgrounds, `<picture>` sources and interactive dependencies are not bundled. Image filenames share an instance-wide namespace; a selected conflicting image must be renamed together with its HTML reference.
- Interactive scripts run inside an opaque-origin sandbox. Exported HTML does not inherit that sandbox, and coarse cleanup is not a complete HTML sanitizer. Only open downloads from authors you trust.
- The interface supports English and Simplified Chinese. Chromium is tested; physical iPhone/Safari and physical IME behavior remain device checks.

