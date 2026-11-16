# Running Marginroom

Installation, configuration, ownership recovery, and backups for a self-hosted instance.

## Installed CLI and coordinated backend upgrade

See [agent workflow](agent-workflow.md) for isolated npm-tarball installation, Linux loopback service ownership, explicit pairing, private credential files and scope limitations. CLI identity is separate from human cookies and OWNER_KEY. Ordinary JSON/share links never contain management handoffs. Machine import is host-authorized; browser imports retain guest capacity limits.

`npm run test:agent-migration` rehearses baseline → additive migration → complete code/DB/docs/identity rollback on synthetic data, including independent locked rollback dependencies and old HTTP rows/replies. It does not touch a live deployment. A new backend must be installed as a coordinated candidate with matching DB/docs/bundles/identity backup, not a static-asset hot swap. Existing externally maintained metal-arm files must be retained from CURRENT.

## Docker installation

Requires Docker Engine with Compose v2 and a free local port. Run commands from the release repository. The Docker build installs locked dependencies using `npm ci --omit=dev`, including the native SQLite module; no host Node installation is needed.

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps
# Open http://localhost:3939/
```

The default binding is **127.0.0.1 only**. Do not change it to a public binding without an appropriate HTTPS/authentication deployment review. To change the local port, set `MMW_PORT` in `.env`.

On first boot the image creates `/data/identity.json` with random, persistent `SESSION_SECRET` and `OWNER_KEY` values before loading the app. `/data` is a named volume containing the database, imported documents/assets, and identity secrets. Fresh data has no real imported documents; an optional synthetic `example` seed is included only if present in this source copy. Rebuilds and `docker compose down` keep the volume. **`docker compose down -v` destroys it.**

Retrieve your owner recovery key on your own terminal (it is a secret):

```sh
docker compose exec app node -e 'console.log(JSON.parse(require("fs").readFileSync("/data/identity.json","utf8")).OWNER_KEY)'
```

Open `http://localhost:3939/?key=YOUR_KEY` once in your owner browser. Then use the plain URL; do not share key-bearing links or include them in screenshots/logs. The `x-owner-key` request header is also supported for operator API requests. Keep the key in a private password manager independently of the running volume.

### Identity, ownership, and cookie recovery

The key grants **global owner** privileges, including actions on any document. An anonymous browser also has its own signed guest cookie and may own documents it uploaded, subject to limits. Someone typing the same display name does not become that browser or owner. Guest documents may be absent from other guests' home listings, but listing visibility is not document authentication.

If the owner's browser cookie is cleared or expires, present the saved `OWNER_KEY` again to regain owner privileges. If a guest loses its cookie, its identity is not recoverable by typing its old name; ask the global owner to manage the document. Restoring a backup with the same `SESSION_SECRET` preserves the validity of existing signed cookies **if those cookies are still present in the browser**. It does not recreate deleted browser cookies. Losing both the key and all copies of `identity.json` is not a supported recovery path.

The image refuses to start if explicit environment secrets conflict with persisted identity; it does not silently rotate them. Changing `SESSION_SECRET` invalidates existing signatures. Changing just `OWNER_KEY` does **not** revoke existing signed owner cookies: rotate the session secret too when revocation is needed. Back up first and perform such manual changes only while stopped.

## Sharing an instance

The Compose quickstart publishes port 3939 on loopback. A link containing `localhost` refers to the recipient's own computer, so copying it does not make your instance available to another reviewer.

For collaboration, give reviewers a URL routed to this instance through a private network or an HTTPS reverse proxy. Keep the app's loopback binding when the proxy runs on the same host. A private-network forwarding setup must make the address reachable by each reviewer; a public HTTPS deployment should have an external login gate for confidential documents. Merely knowing a document URL grants read access once the instance is reachable.

For HTTPS, set `NODE_ENV=production` in the environment passed to the app so it uses Secure cookies. Use the deployed address consistently: a browser identity established on `localhost` is not automatically available on another hostname. If necessary, recover administrator access on the deployed address using your saved key, then return to a plain URL before sharing.

Open the document through that reachable address, choose **Share**, select **Read only**, **Read and suggest** or **Edit directly**, then choose **Copy link**. The permission applies to every holder of that document link. Test the URL in a separate guest browser before inviting reviewers. Share the plain document URL, never `?key=...` or the recovery key itself.

## Runtime and configuration

The supported/tested packaging baseline is **Node 22.23.4** on Debian Bookworm (Docker). Native dependencies make arbitrary Node upgrades or copying host `node_modules` into a container unsafe. Host `npm ci` was also exercised on Node 22.23.4; other runtimes/platforms are not certified by this release.

| Setting | App behavior / packaging value |
| --- | --- |
| `HS_DB_PATH` | Docker: `/data/app.db`; native default: `./data/app.db` |
| `HS_DOCS_DIR` | Docker: `/data/docs`; native default: repository `docs/` |
| `HOST`, `PORT` | Docker: `0.0.0.0:3939` internally; Compose publishes loopback only |
| `SESSION_SECRET`, `OWNER_KEY` | Docker initializes/persists in `/data/identity.json`; plain `node server.js` does **not** do this |
| `NODE_ENV` | Compose defaults to `development` for local HTTP cookie support. Use `production` with HTTPS to set Secure cookies. This flag is cookie behavior, not a security guarantee. |
| `MMW_GUEST_DOC_LIMIT`, `MMW_MAX_GUEST_OWNERS` | App defaults: 1 document per guest; 15 distinct guest owners |
| `MMW_MAX_DOC_BYTES` | App default: 2,000,000 bytes per uploaded file |
| `MMW_READ_PER_MIN`, `MMW_WRITE_PER_MIN`, `MMW_UPLOAD_PER_HOUR` | Defaults: 300 reads/min, 60 writes/min, 10 uploads/hour per IP; global owner exempt |

Compose deliberately passes only the settings shown in `compose.yaml`. Add limit overrides explicitly to its `environment` section; placing arbitrary variables in `.env` alone does not pass them to the container. Feedback-to-GitHub is not configured or required: leave `GITHUB_TOKEN` unset. This packaging does not upload your documents to a hosted service, though imported remote URLs can cause browser network requests.

For native development, run `npm ci` on Node 22.23.4. Explicitly export stable `SESSION_SECRET`, `OWNER_KEY`, an absolute `HS_DB_PATH`, and an absolute `HS_DOCS_DIR` pointing to a **fresh disposable directory** before `npm start`. The server does not load `.env` automatically. With no session secret native runs use a per-boot random secret; with no owner key owner-key recovery is disabled. Native operators must securely create `identity.json` matching the two exported secrets in their data directory to use the backup tools. The image's automatic initialization is the recommended quickstart.

## Backup and restore

A backup must include **all three**: SQLite review state/history/ownership, the entire document tree (including raw interactive HTML/config/assets), and persistent identity secrets. Copying only `app.db` is insufficient, particularly in SQLite WAL mode.

The tools use SQLite's backup API and check integrity. **Stop the application and every other writer for the entire operation**: SQLite consistency alone cannot coordinate file uploads/deletions with database changes. `--writes-stopped` is your assertion, not an automatic lock. Do not run another app against the same volume. Backups are unencrypted directories containing content and owner credentials; store privately, encrypt at rest/off-host as appropriate, and never commit or publicly upload them. SHA-256 inventory checks detect accidental corruption, not maliciously replaced manifests.

### Back up the Compose instance

```sh
mkdir -p backups
chmod 700 backups
docker compose stop app
# Choose a NEW backup name; existing directories are refused.
docker compose run --rm --no-deps -v "$PWD/backups:/backups" app \
  node scripts/backup.mjs /data /backups/alpha-001 --writes-stopped
docker compose start app
```

The image runs as UID/GID 1000 (`node`). On Linux the backup directory must be writable by that user; if your host UID differs, grant that user access to **only that directory** before running the command. Do not make backups world-readable. Check the command's exit status before considering a backup successful. A failed run can leave an incomplete directory; never restore it. Keep a separate private copy outside the application disk.

### Restore rehearsal or recovery into a new volume

Keep the original volume intact until the recovered service has been checked. Use the **same application image/version** first. The following creates a separate recovery Compose project and volume, leaving the original stopped and untouched. A recovery project uses port 3940 so there is no collision.

```sh
docker compose stop app
mkdir -p backups
# Replace alpha-001 with an existing successful backup.
MMW_PORT=3940 docker compose -p mmw-recovery run --rm --no-deps \
  -v "$PWD/backups:/backups:ro" app \
  node scripts/restore.mjs /backups/alpha-001 /data --writes-stopped
MMW_PORT=3940 docker compose -p mmw-recovery up -d
# Open http://localhost:3940/ and recover owner access with the SAME saved key.
# Check a real imported document, comments/suggestions/history, and its download.
```

Restore refuses nonempty destinations, checksum/inventory mismatches, links/special files, and invalid SQLite snapshots. It validates before copying but is not an atomic switch: a disk/copy failure can leave a partial destination, which must stay stopped. Never delete or replace the original data to make a restore command pass. Stop and remove the disposable recovery project only after checking it; use `down -v` **only with the explicitly named disposable recovery project**, never the live project. Restart the original with `docker compose start app` if returning to it.
