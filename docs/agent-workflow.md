# Installed CLI and agent review

Install the standalone CLI for macOS or Linux using the [installer](installation.md). Source development uses Bun 1.4.4.

## Open a review and read feedback

```sh
marginroom open ./article.html --json
marginroom comments 'http://127.0.0.1:PORT/viewer.html?doc=ID' --status open --json
```

`open` returns the review URL. Local URLs work only on the service host. To use an existing remote instance, pair with it as described below.

`marginroom comments 'REVIEW_URL'` prints threads with statuses, quotes, bodies, replies and full IDs. Add `--status all` to include handled feedback or `--json` for automation. Redirected text stays text. The text view decodes stored HTML entities once; JSON preserves stored values. Revisions label `quote` as "Original quote" and `body` as "Suggested". A legacy whole-block quote may contain only a display substring, so the CLI cannot supply missing original context.

Without `--json`, `open` prints the URL and a quoted comments command. `open --browser` opens a 60-second, one-use management handoff and cannot be combined with `--json`. `/claim.html` removes the handoff from browser history before its API call and grants that document to the existing browser principal. It does not replace cookies or grant administrator access. Ordinary JSON and share links contain no management secret. Root and subcommand help do not start a service.

JSON envelopes use `schemaVersion:1`. With `--json`, results and errors go to stdout as JSON; text-mode errors go to stderr. Exit codes are 2 for input errors, 3 for connection/start failures, 4 for authentication/permission failures, 5 for import/resource failures and 6 for version/protocol conflicts. Status accepts `open`, `all`, `accepted`, `rejected`, `stale` and `withdrawn`. Feedback includes records and replies; `complete:true` denotes the unpaginated suggestions response.

## Import resources and create versions

The entry directory is the default resource boundary. `--assets-dir` selects a wider published root. Repeat `--include-resource relative/path` to add dynamically referenced files inside that boundary; it does not scan a folder.

The CLI collects static HTML src/srcset/link/style references, CSS URL/@import references and literal JS module dependencies. Limits are 256 files, 2 MB per file and 16 MB total. Traversal, outside-root symlinks, base elements, unsupported schemes and missing dependencies fail before publication. The browser import dialog submits selected images and an optional published folder through the same `/api/imports` manifest endpoint.

Imports preserve originals. A viewer-only base routes relative resources inside the opaque sandbox. Static analysis cannot resolve dynamically constructed URLs, fetch APIs, bundlers, servers or arbitrary websites. External resources still need network access. Source and exported HTML are untrusted outside the sandbox; standalone exports do not bundle every dependency for offline use.

Unchanged content reopens the same review. Changed source requires `--new-version-of URL`. Each version has a separate URL in a stable series. Prior sources, assets, overlays, comments and replies remain on the old version.

Management-only version navigation uses the existing element locator or exact paragraph/range context. Failed, duplicate or unverifiable targets return `not_found`, `ambiguous` or `unavailable`. Navigation creates no records, and public links do not expose series history.

## Pair with an existing host

Machine Bearer credentials are separate from cookies and `OWNER_KEY`. The server stores their SHA256 hashes. Invalid or revoked Bearer credentials never fall back to guest access. Machine routes are limited to owned or granted documents.

For a CLI-managed local service, `marginroom pair --data-dir DIR --out private-pair.json` can start or reuse that instance. For an already running Bun or Docker server, the host owner must authorize an operator with filesystem access to its actual SQLite database:

```sh
marginroom pair --host-db /ABS/EXISTING/app.db --server https://your-existing-instance --out /PRIVATE/private-pair.json --json
```

In Docker, run inside the container or make the actual mounted database available to the installed executable. This command does not start a service. It checks the running origin's product, protocol and instance against the database's durable `machine_instance` row, then issues a separate machine principal. A missing or wrong database is rejected rather than initialized. The output file must not exist; the CLI creates it with mode 0600. Stdout contains only `{schemaVersion:1,paired:true}`, without credentials.

Transfer the private file securely, then supply both `--server https://your-existing-instance` and `--token-file /private/path.json`. Pairing creates no deployment, tunnel or account. Host-local writable database access provides bootstrap authority. A public URL, anonymous request, human cookie or global owner key does not. HTTP pairing requires an already authorized, unscoped machine credential.

Normal server startup persists instance identity in the database, so same-database restarts retain paired credentials. A managed runner adopts its previously recorded instance ID on first upgrade; conflicting explicit identities fail closed. Include `machine_instance` in database backups. Do not delete it to repair pairing.

Authorized management APIs can issue a single-document, read-only suggestions credential with `POST /api/machine/delegate {doc}` and revoke an issuer-owned token with `POST /api/machine/revoke {token}`. Reading comments does not call these APIs. Keep tokens out of URLs, logs, exports and version control. File permissions do not isolate processes running as the same OS user.

## Local service state

Use `--data-dir DIR` or `MARGINROOM_DATA_DIR` to isolate persistent state. The default is `~/.local/share/marginroom`. Directories use mode 0700; identity, credentials, database and state use 0600. Private logs rotate before launch above 1 MB. The runner emits at most another 1 MB per lifetime, bounding current and previous logs to 4 MB, and emits no per-request access logs.

The detached service survives terminal exit. Startup serializes launchers, and the runner holds a kernel lifetime lease. Linux uses an abstract Unix socket; macOS uses exclusive loopback TCP. Reuse checks product, protocol and instance identity. The CLI never kills a PID. On restart it reuses the last loopback port when available, otherwise it chooses an ephemeral port without disturbing the occupying process. Old review URLs then need the new origin.

## Verification commands

Run these against disposable state, not production. First prepare the installed
binary and browser prerequisites in the [test guide](../test/README.md#run-the-suites).

- `bun run test:existing-host` checks existing-host identity persistence and host-local bootstrap with a freshly installed standalone binary, including unauthorized and wrong-database denial. `HOST_ARTIFACTS` retains a secret-free receipt.
- `bun run test:agent` independently installs the binary, then exercises child-process CLI, HTTP, SQLite and native Chromium. It also tests SIGKILL launcher adoption, competing-runner lease rejection, occupied ports, guest quotas and deleted-source reimport. Cleanup stops only its argv- and instance-verified disposable runner.
- `bun test/agent-migration.mjs ORIGINAL_NODE_FIXTURE_DIR` checks a copied original-driver fixture, every row, column and schema object, transaction rollback, backup, HTTP content/feedback and coordinated fixture restore. Capture the synthetic fixture before replacing the original driver.
- `bun test/import-recovery.mjs` tests abrupt import exits before and after publication, backup and readback. `bun run test:api` and `bun test/i18n.test.mjs` cover API and locale contracts.

Set `FONT_FIXTURE` to an installed licensed TTF if `/usr/share/fonts/TTF/OpenSans-Regular.ttf` is unavailable. Screenshots use synthetic Chromium content at 1440/390 widths. Physical Safari and OS IME need device testing. The earlier c2/c3 unit debt remains open.

## Coordinated production cutover

The host owner authorizes deployment and restart. Pause writes, then identify the current PID, working directory, runner, environment, database, documents and externally maintained metal-arm assets. Back up code, a native SQLite snapshot, complete documents/assets/bundles and identity/session configuration together. Check backup integrity and representative old rows and replies.

Stage the reviewed allowlisted package in a separate candidate with the supported runtime and exact production dependencies. Preserve CURRENT metal-arm files; archived copies must not overwrite them. Rehearse with copied synthetic state. After authorization, restart through the original production runner/environment and read old documents, raw resources, overlays, replies and permissions over HTTP. Retain the old source and backup until acceptance.

Rollback requires stopping writes and restoring code, database, documents/assets and identity as one set. Additive tables do not make an old writer compatible with new imported bundles. Never copy a stale database over a live writer. Backend startup adds tables without claiming old owner rows.

Legacy `/api/upload` single-file creates use the common validator/publication service and retain their historical chosen IDs. Legacy-only documents still permit explicit overwrite for compatibility; versioned bundle reviews refuse it. New browser and CLI workflows never use overwrite. Source packages and standalone builds exclude externally maintained metal-arm plan assets, so an existing-host cutover must preserve its CURRENT copies.
