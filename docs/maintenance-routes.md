# HTTP maintenance coverage

**M** = `maintenance.middleware`, the first application middleware, before identity, request-body parsing, auth, rate limiting and routes. All listed requests receive `503`, `Retry-After: 30` and `error: maintenance` while the flag is set. Method-based coverage also rejects non-safe methods on unknown paths and covers future write routes registered after the middleware. GET, HEAD and OPTIONS are not blocked while the listener is running in maintenance mode. No existing GET/HEAD route writes to persistent application state.

| Method | Route | Gate | Note |
| --- | --- | --- | --- |
| POST | `/api/imports` | M |  |
| POST | `/api/machine/pair` | M |  |
| POST | `/api/machine/delegate` | M |  |
| POST | `/api/machine/revoke` | M |  |
| POST | `/api/management/handoff` | M |  |
| POST | `/api/management/claim` | M |  |
| POST | `/api/versions-locate` | M | Navigation lookup (POST) |
| POST | `/api/upload-asset` | M |  |
| POST | `/api/upload` | M |  |
| DELETE | `/api/doc/:id` | M |  |
| PUT | `/api/access/:id` | M |  |
| POST | `/api/snapshot/:id` | M | Snapshot export (POST) |
| POST | `/api/patch-download/:id` | M | Patched export (POST) |
| POST | `/api/revision/:id` | M |  |
| POST | `/api/edit/:id` | M |  |
| POST | `/api/restore/:id` | M |  |
| POST | `/api/suggest/:id` | M |  |
| POST | `/api/suggest/:id/:sid/replies` | M |  |
| POST | `/api/suggest/:id/:sid/accept` | M |  |
| POST | `/api/suggest/:id/:sid/resolve-stale` | M |  |
| POST | `/api/suggest/:id/:sid/reject` | M | Reject rewrite / Resolve comment (including inherited) |
| POST | `/api/suggest/:id/:sid/reopen` | M | Reopen comment (including inherited) |
| POST | `/api/feedback` | M |  |
