# Running Marginroom

Installation, configuration, ownership recovery, and backups for a self-hosted instance.

## Installed CLI and coordinated backend upgrade

See the [agent workflow](agent-workflow.md) for standalone installation, local service state and pairing. CLI identity is separate from human cookies and `OWNER_KEY`. Ordinary JSON/share links contain no management handoff. Machine imports require host authorization; browser imports retain guest capacity limits.

Before a backend upgrade, run `bun test/agent-migration.mjs ORIGINAL_NODE_FIXTURE_DIR` on copied synthetic original-driver data to check migration and rollback. Install the backend as a coordinated candidate with matching database, documents, bundles and identity backups. A static-asset swap is insufficient. Preserve CURRENT externally maintained metal-arm files.

## Docker installation

Requires Docker Engine with Compose v2 and a free local port. Run commands from the release repository. The Docker build installs locked dependencies using `bun install --frozen-lockfile --production`, using Bun 1.4.4 and its built-in SQLite driver; no host JavaScript runtime is needed.

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps
# Open http://localhost:3939/
```

Compose binds to 127.0.0.1 by default. Review HTTPS and authentication before changing to a public binding. To change the local port, set `MMW_PORT` in `.env`.

On first boot the image creates `/data/identity.json` with random, persistent `SESSION_SECRET` and `OWNER_KEY` values before loading the app. The `/data` named volume holds the database, imported documents/assets and identity secrets. A fresh volume contains an optional synthetic `example` seed only if this source copy includes it. Rebuilds and `docker compose down` keep the volume. `docker compose down -v` destroys it.

Retrieve your owner recovery key on your own terminal (it is a secret):

```sh
docker compose exec app bun -e 'console.log(JSON.parse(require("fs").readFileSync("/data/identity.json","utf8")).OWNER_KEY)'
```

Open `http://localhost:3939/?key=YOUR_KEY` once in your owner browser. Then use the plain URL; do not share key-bearing links or include them in screenshots/logs. The `x-owner-key` request header is also supported for operator API requests. Keep the key in a private password manager independently of the running volume.

### Identity, ownership, and cookie recovery

The key grants global owner privileges over every document. An anonymous browser has a signed guest cookie and may own its uploads, subject to limits. Display names do not establish identity or ownership. Guest documents may be absent from other guests' home listings; anyone with a reachable document URL can still read them.

If the owner's cookie is cleared or expires, present the saved `OWNER_KEY` to regain privileges. A guest that loses its cookie must ask the global owner to manage the document; typing the old name cannot recover its identity.

Restoring the same `SESSION_SECRET` preserves signed cookies that remain in the browser. It cannot recreate deleted cookies. Recovery requires the key or a saved copy of `identity.json`.

The image refuses to start if explicit environment secrets conflict with persisted identity. Changing `SESSION_SECRET` invalidates existing signatures. Changing only `OWNER_KEY` leaves signed owner cookies valid. To revoke them, rotate the session secret too. Back up first and make these changes only while stopped.

## Sharing an instance

The Compose quickstart publishes port 3939 on loopback. A link containing `localhost` refers to the recipient's own computer, so copying it does not make your instance available to another reviewer.

For collaboration, give reviewers a URL routed to this instance through a private network or an HTTPS reverse proxy. Keep the app's loopback binding when the proxy runs on the same host. A private-network forwarding setup must make the address reachable by each reviewer; a public HTTPS deployment should have an external login gate for confidential documents. Merely knowing a document URL grants read access once the instance is reachable.

For HTTPS, set `NODE_ENV=production` in the environment passed to the app so it uses Secure cookies. Use the deployed address consistently: a browser identity established on `localhost` is not automatically available on another hostname. If necessary, recover administrator access on the deployed address using your saved key, then return to a plain URL before sharing.

Open the document through that reachable address, choose **Share**, select **Read only**, **Read and suggest** or **Edit directly**, then choose **Copy link**. The permission applies to every holder of that document link. Test the URL in a separate guest browser before inviting reviewers. Share the plain document URL, never `?key=...` or the recovery key itself.

## Runtime and configuration

The runtime and dependency manager are **Bun 1.4.4**. The lockfile is `bun.lock`; Docker uses `oven/bun:1.4.4-slim`. The compiled CLI needs no separately installed runtime. See [installation](installation.md).

| Setting | App behavior / packaging value |
| --- | --- |
| `HS_DB_PATH` | Docker: `/data/app.db`; native default: `./data/app.db` |
| `HS_DOCS_DIR` | Docker: `/data/docs`; native default: repository `docs/` |
| `HOST`, `PORT` | Docker: `0.0.0.0:3939` internally; Compose publishes loopback only |
| `SESSION_SECRET`, `OWNER_KEY` | Docker initializes/persists in `/data/identity.json`; plain `bun server.js` does **not** do this |
| `NODE_ENV` | Compose defaults to `development` for local HTTP cookies. Use `production` with HTTPS to set Secure cookies; configure network access and authentication separately. |
| `MMW_GUEST_DOC_LIMIT`, `MMW_MAX_GUEST_OWNERS` | App defaults: 1 document per guest; 15 distinct guest owners |
| `MMW_MAX_DOC_BYTES` | App default: 2,000,000 bytes per uploaded file |
| `MMW_READ_PER_MIN`, `MMW_WRITE_PER_MIN`, `MMW_UPLOAD_PER_HOUR` | Defaults: 300 reads/min, 60 writes/min, 10 uploads/hour per IP; global owner exempt |

Compose passes only settings listed in `compose.yaml`. Add limit overrides to its `environment` section; `.env` alone does not pass arbitrary variables to the container. Leave `GITHUB_TOKEN` unset; feedback-to-GitHub is not configured. Documents stay on the instance, but imported remote URLs can cause browser network requests.

For native development, run `bun install --frozen-lockfile` with Bun 1.4.4. Explicitly export stable `SESSION_SECRET`, `OWNER_KEY`, an absolute `HS_DB_PATH`, and an absolute `HS_DOCS_DIR` pointing to a **fresh disposable directory** before `bun run start`. The server does not load `.env` automatically. With no session secret native runs use a per-boot random secret; with no owner key owner-key recovery is disabled. Native operators must securely create `identity.json` matching the two exported secrets in their data directory to use the backup tools. The image's automatic initialization is the recommended quickstart.

## Maintenance and graceful deploys

On v0.1.4 and newer, configure `MMW_MAINTENANCE_FILE` to an absolute path in a persistent, service-account-writable directory outside the served document tree. By default it is `maintenance.flag` alongside `HS_DB_PATH` (or `./data/maintenance.flag`). `touch` enables it, `rm` disables it, and neither needs a restart. All HTTP methods except GET, HEAD and OPTIONS return `503` with `Retry-After: 30` during maintenance, including POST routes that only render or locate data. Already-admitted requests keep running. The [route inventory](maintenance-routes.md) lists the gated routes.

1. Set the flag on the **running** instance. In Compose: `docker compose exec -T app touch /data/maintenance.flag`.
2. From the host, poll the **actual listener** (not a cached proxy): `curl -fsS http://127.0.0.1:3939/api/maintenance/status`. Adjust host/port to the configured bind. Proceed once JSON shows `maintenance: true` and `inflight: 0`; bound the polling loop and fail if the endpoint is unavailable, the flag is off, or it does not drain. The endpoint is read-only, not cached, and exposes only these aggregate fields without authentication; optionally restrict its path at the reverse proxy. The probe excludes itself. Live reads may still arrive after a zero count.
3. Send the old process `SIGTERM` (or `docker compose stop app`) and wait for exit before backing up or replacing it. `SIGINT` works too. The listener closes, and admitted requests have up to `MMW_SHUTDOWN_TIMEOUT_MS` milliseconds (default `30000`) to finish before SQLite closes. A timeout logs `forcing exit` and disconnects unfinished requests; both normal drain and timeout exit with code `0`, so check the log if a clean drain is required. Keep your supervisor's stop timeout higher than the application timeout (Compose defaults to `MMW_STOP_GRACE_PERIOD=35s`).
4. Start the replacement with the same data and flag path, verify reads and the enabled status, then remove the flag (`docker compose exec -T app rm /data/maintenance.flag`). Verify `maintenance: false` before declaring writes open. Leave the flag set if replacement verification fails.

An older running binary does not honor the flag or provide a drain probe. For the first upgrade from a pre-v0.1.4 instance, arrange a separate operator-approved maintenance window covering **all** ingress paths and writers. Do not assume this runbook can safely stop that old binary just because the replacement supports it.

## Backup and restore

A backup must include SQLite review state/history/ownership, the entire document tree including raw interactive HTML/config/assets, and persistent identity secrets. Copying only `app.db` omits files and identity and can miss SQLite WAL data.

Stop the application and every other writer for the entire backup or restore. The tools use SQLite's `VACUUM INTO` snapshot and check integrity, but cannot coordinate file uploads/deletions with database changes while writers run. `--writes-stopped` records your assertion; it does not lock the volume. Do not run another app against that volume during the operation.

Backups are unencrypted directories containing content and owner credentials. Store them privately, encrypt at rest/off-host as appropriate, and never commit or publicly upload them. SHA-256 inventory checks detect accidental corruption, not maliciously replaced manifests.

### Back up the Compose instance

```sh
mkdir -p backups
chmod 700 backups
docker compose stop app
# Choose a NEW backup name; existing directories are refused.
docker compose run --rm --no-deps -v "$PWD/backups:/backups" app \
  bun scripts/backup.mjs /data /backups/alpha-001 --writes-stopped
docker compose start app
```

The image runs as UID/GID 1000 (`bun`). On Linux the backup directory must be writable by that user. If your host UID differs, grant access to that directory only. Keep backups inaccessible to other users. Check the command's exit status; a failed run can leave an incomplete directory that must not be restored. Keep a separate private copy outside the application disk.

### Restore rehearsal or recovery into a new volume

Keep the original volume intact until the recovered service has been checked. Use the **same application image/version** first. The following creates a separate recovery Compose project and volume, leaving the original stopped and untouched. A recovery project uses port 3940 so there is no collision.

```sh
docker compose stop app
mkdir -p backups
# Replace alpha-001 with an existing successful backup.
MMW_PORT=3940 docker compose -p mmw-recovery run --rm --no-deps \
  -v "$PWD/backups:/backups:ro" app \
  bun scripts/restore.mjs /backups/alpha-001 /data --writes-stopped
MMW_PORT=3940 docker compose -p mmw-recovery up -d
# Open http://localhost:3940/ and recover owner access with the SAME saved key.
# Check a real imported document, comments/suggestions/history, and its download.
```

Restore refuses nonempty destinations, checksum/inventory mismatches, links/special files, and invalid SQLite snapshots. It validates before copying but is not an atomic switch: a disk/copy failure can leave a partial destination, which must stay stopped. Never delete or replace the original data to make a restore command pass. Stop and remove the disposable recovery project only after checking it; use `down -v` **only with the explicitly named disposable recovery project**, never the live project. Restart the original with `docker compose start app` if returning to it.
