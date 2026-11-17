# Packaging and recovery evidence

Historical pre-Bun execution record. These runtime and package-manager versions describe that earlier run; current setup and commands are in [installation](../docs/installation.md).

## Scope

This records real local Docker execution against **disposable synthetic data only**. No live source checkout, production volume, other service, hosted deployment, or external document upload was used. Package/server/database source files were inspected but not edited by this packaging task. Application behavior and browser regression testing are separate release checks.

Runtime observed: Node **v22.23.4**, Docker Engine **29.9.2**, Compose **v2.24.5**. The image uses `node:22.23.4-bookworm-slim`, installs locked production dependencies, and runs the app as UID 1000. Build image tooling includes Python/make/g++; the final stage does not install that toolchain.

## Commands and observed results

Commands below are relative to the release repository. The `mmw-ops-*` / `mmw-packaging-check*` names are disposable rehearsal resources, not production resources.

### Build, configuration, and fresh image startup

```sh
docker build -t markmyword-packaging-rehearsal:local .
docker compose -p mmw-packaging-check config --quiet
docker run -d --name mmw-packaging-check \
  --mount type=volume,src=mmw-packaging-check-data,dst=/data \
  -p 127.0.0.1::3939 markmyword-packaging-rehearsal:local
docker inspect mmw-packaging-check --format '{{json .NetworkSettings.Ports}}'
```

All exited successfully. The actual published address was `127.0.0.1:32768` to container port 3939. The unmodified image CMD initialized random 64-character owner/session secrets in `/data/identity.json` with mode **0600**. A `docker exec ... node --input-type=module -e ...` assertion probe read only that disposable identity file, fetched `/`, and verified **HTTP 200** and issuance of a signed `mmw_owner` cookie when the persisted owner key was supplied. Secrets were not printed.

```text
unmodified image CMD: fresh persistent secrets, 0600 mode, HTTP 200, owner cookie issued
```

### Synthetic application fixture

A finite `docker run --name mmw-ops-seed ... node --input-type=module -e ...` harness initialized a separate disposable data volume, loaded the real `server.js`, then used HTTP API requests to:

- upload `rehearsal` (ordinary HTML) and `interactive-fixture` (synthetic inline-script HTML);
- write a synthetic text overlay and produce a version-history entry;
- create a comment as a non-owner reviewer;
- save the resulting owner cookie and identity privately in a separate checks volume;
- add a synthetic SVG asset and grouping config to the document tree.

Every request asserted status 200; read-back asserted overlay text, comment count, and version count before the harness exited. The process exit stopped the only server writing that fixture volume before the offline snapshot. This also left a realistic SQLite WAL-backed state for the backup API to capture.

```json
{"phase":"seed","node":"v22.23.4","uid":1000,"uploaded":2,"comments":1,"versions":1,"ownerPromotion":true}
```

This is an API/storage fixture, not a claim that the synthetic placeholder overlay anchor was validated by a browser or exported into a document.

### Backup and restore (successful final rehearsal)

```sh
docker run --name mmw-ops-backup-fixed \
  --mount type=volume,src=mmw-ops-rehearsal-data,dst=/source \
  --mount type=volume,src=mmw-ops-rehearsal-backups,dst=/data \
  markmyword-packaging-rehearsal:local \
  node scripts/backup.mjs /source /data/alpha-002 --writes-stopped

docker run --name mmw-ops-restore-fixed \
  --mount type=volume,src=mmw-ops-rehearsal-restored,dst=/data \
  --mount type=volume,src=mmw-ops-rehearsal-backups,dst=/backups,readonly \
  markmyword-packaging-rehearsal:local \
  node scripts/restore.mjs /backups/alpha-002 /data --writes-stopped
```

Both exited **0**:

```text
Backup complete: 8 files; SQLite integrity_check=ok. Contains secrets: store privately.
Restore complete: 8 verified files; SQLite integrity_check=ok. Start the same app version and verify before switching traffic.
```

The backup includes the SQLite snapshot, identity, the full document tree, original interactive HTML, config, and assets. SHA-256 inventory validation ran before restore copying. The destination was a separate empty volume; the original stayed intact.

Finite application containers then opened **both** the original data and restored data separately. Each verified byte-for-byte unchanged identity, 0600 identity mode, validity of the original signed owner cookie, owner-key promotion without that cookie (cookie-loss recovery), persisted overlay, exact comment body, one history entry, raw interactive source, SVG asset, and grouping config. Both exited **0**. The restored result was:

```json
{"phase":"restored","node":"v22.23.4","uid":1000,"oldOwnerCookieValid":true,"cookieLossKeyRecovery":true,"identityUnchanged":true,"identityMode":"0600","comments":1,"versions":1,"overlay":true,"rawHtml":true,"assets":true,"config":true}
```

A deleted browser cookie is not restored from the backup; presenting the saved key mints a new owner cookie. Names never participate in authentication.

### Negative checks

Actual container commands asserted nonzero exit for:

| Probe | Observed result |
| --- | --- |
| Restore into already populated recovered volume | `Restore target must be an empty, non-symlink directory` |
| Backup without `--writes-stopped` | Usage text and refusal; no snapshot attempted |
| Restore isolated backup after modifying document bytes | `Backup checksum/file inventory mismatch` |
| Read destination after rejected corrupted restore | Empty directory; assertion passed |
| Start unmodified image CMD with conflicting `OWNER_KEY` on initialized volume | `Environment conflicts with persisted OWNER_KEY`, before server import |

The corruption probe copied a successful backup into another disposable volume and modified only that copy.

### Compose-specific execution

```sh
docker compose -p mmw-ops-compose build
docker compose -p mmw-ops-compose run --no-deps app node -e \
  'const fs=require("fs"),assert=require("assert/strict");assert.equal(process.getuid(),1000);fs.writeFileSync("/data/compose-volume-probe","ok");assert.equal(fs.readFileSync("/data/compose-volume-probe","utf8"),"ok");console.log("Compose isolated project: UID 1000, persistent volume writable, Node "+process.version)'
docker compose -p mmw-ops-compose config --format json
```

Build and finite Compose run exited **0**. The isolated Compose named volume was writable by UID 1000, Node was v22.23.4, and resolved configuration bound the app port to **127.0.0.1**, not all host interfaces. Compose `up`/healthcheck lifecycle was not exercised end to end; fresh HTTP server startup was exercised directly with the real image CMD above.

## Issue found and fixed during rehearsal

The first restore (`alpha-001`) failed with `SQLITE_CANTOPEN` when the snapshot was mounted read-only. SQLite's backup preserved a WAL-mode database header, so opening it attempted to create adjacent WAL/shared-memory files. `backup.mjs` now normalizes the completed standalone snapshot to **DELETE journal mode**, performs a second integrity check, closes it, and only then calculates the manifest. Rebuilding and repeating with `alpha-002` succeeded on the read-only backup mount. Use the successful final snapshot, not the earlier experimental directory.

## Dependency audit: resolved before candidate handoff

The initial packaging rehearsal found body-parser (high), proxy-addr (critical), and qs (moderate) advisories. A focused `npm audit fix` refreshed six transitive packages without a framework/runtime migration. Subsequent `npm ci`, `npm audit`, and Docker `npm ci --omit=dev` all exited 0 and reported **zero known vulnerabilities**. This is a registry-advisory check, not proof of security.

## Final Marginroom image follow-up

The earlier commands above retain their actual pre-rename image label for truthful provenance. The final release image is `marginroom-private-alpha:local`.

```sh
docker build -t marginroom-private-alpha:local .
mkdir -p .local
docker image inspect --format '{{json .Config.Cmd}}' marginroom-private-alpha:local > .local/image-command.json
# Use a NEW volume/container name each time. The harness exits without publishing a port.
docker run --name marginroom-final-smoke-v2 \
  --mount type=volume,src=marginroom-final-smoke-data-v2,dst=/data \
  --mount type=bind,src="$PWD/.local/image-command.json",dst=/image-command.json,readonly \
  marginroom-private-alpha:local node test/container-smoke.mjs
```

Actual final run exited 0 as the image's non-root user. It executes the exact inspected image CMD as a child process, starts HTTP, uploads synthetic HTML, verifies owner-cookie issuance, restarts the child, verifies identity/cookie/overlay persistence, stops all writers, backs up, restores to a separate empty image-local directory, and opens the restored DB/docs with the existing identity. Both SQLite checks returned `ok`; four files were verified. The `/data` source volume is retained; the backup/restored directories are disposable container-local evidence. No host port or other service is touched.

The first final-image harness attempt failed because `/app/checks` was not writable by the non-root user. Moving only disposable test output beneath the image's user-owned test directory fixed the harness; no permission broadening or production change was made. The successful harness reports:

```text
Backup complete: 4 files; SQLite integrity_check=ok. Contains secrets: store privately.
Restore complete: 4 verified files; SQLite integrity_check=ok. Start the same app version and verify before switching traffic.
PASS final image exact CMD: fresh volume, HTTP startup, synthetic upload, owner cookie + restart, consistent backup, isolated restore + original identity/overlay.
```


## Limitations and resource handoff

- No real Safari/device tests, HTTPS reverse-proxy test, hostile-document audit, browser export validation, load test, multiwriter consistency guarantee, or full application suite is claimed here.
- SQLite backup consistency does not coordinate uploads/assets with database updates. Stop **all** writers for the complete operation. The assertion flag does not enforce this.
- Backups contain unencrypted documents and identity credentials. No off-host transfer, cloud upload, or external backup storage was exercised.
- The execution environment denied approval for container stop/restart/removal commands. The rehearsal switched to finite, naturally exiting containers instead of changing approval configuration. Cleanup was **not** claimed.
- One fresh-image smoke container, `mmw-packaging-check`, remained running on loopback port 32768 at handoff. Its synthetic volume is `mmw-packaging-check-data`. The finite test containers use the explicitly scoped names `mmw-ops-*`; associated volumes use `mmw-ops-rehearsal-*`, plus `mmw-ops-compose_app-data` and network `mmw-ops-compose_default`. They contain only this rehearsal's synthetic fixtures/secrets and can be removed by the supervising operator with appropriate approval. No preexisting service was stopped or changed.
