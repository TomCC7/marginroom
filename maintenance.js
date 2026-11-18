import { lstatSync } from 'node:fs';
import path from 'node:path';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STATUS_PATH = '/api/maintenance/status';
const RETRY_AFTER = '30';

export function maintenanceControl() {
  const flag = path.resolve(process.env.MMW_MAINTENANCE_FILE || path.join(
    path.dirname(process.env.HS_DB_PATH || './data/app.db'), 'maintenance.flag',
  ));
  let inflight = 0, stopping = false, idle;
  let loggedStatError = false;
  function enabled() {
    try {
      lstatSync(flag);
      loggedStatError = false;
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        loggedStatError = false;
        return false;
      }
      // Don't silently allow writes if the operator's flag cannot be checked.
      if (!loggedStatError) console.error(`Cannot check maintenance flag (${error.code}); writes disabled`);
      loggedStatError = true;
      return true;
    }
  }
  function middleware(req, res, next) {
    // Count both transport and async handler lifetime. A disconnected client
    // does not necessarily cancel an already-started filesystem/SQLite write.
    inflight++;
    const work = req.maintenanceWork = { pending: 1 };
    work.done = () => {
      if (--work.pending !== 0) return;
      if (--inflight === 0) idle?.();
    };
    function ended() {
      res.off('finish', ended);
      res.off('close', ended);
      work.done();
    }
    res.once('finish', ended);
    res.once('close', ended);

    const probe = req.path === STATUS_PATH && (req.method === 'GET' || req.method === 'HEAD');
    if (probe && !stopping) {
      return res.set('Cache-Control', 'no-store').json({ maintenance: enabled(), inflight: inflight - 1 });
    }
    if (stopping || (!SAFE_METHODS.has(req.method) && enabled())) {
      return res.set({ 'Retry-After': RETRY_AFTER, 'Cache-Control': 'no-store', Connection: 'close' })
        .status(503).json({ error: 'maintenance', message: 'Service under maintenance. Please retry shortly.' });
    }
    next();
  }
  function track(handler) {
    return async (req, res, next) => {
      const work = req.maintenanceWork;
      work.pending++;
      try { return await handler(req, res, next); }
      finally { work.done(); }
    };
  }
  return {
    middleware,
    track,
    stop() { stopping = true; },
    drained() { return inflight === 0 ? Promise.resolve() : new Promise(resolve => { idle = resolve; }); },
  };
}

export function installShutdown(server, db, maintenance) {
  const timeout = Number(process.env.MMW_SHUTDOWN_TIMEOUT_MS ?? 30_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new Error('MMW_SHUTDOWN_TIMEOUT_MS must be a positive integer within the timer range');
  }
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    maintenance.stop();
    console.log(`${signal}: draining HTTP requests`);
    const deadline = setTimeout(() => {
      console.error(`Shutdown drain timed out after ${timeout} ms; forcing exit`);
      server.closeAllConnections?.();
      try { db.close(); } finally { process.exit(0); }
    }, timeout);
    const closed = new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    });
    Promise.all([closed, maintenance.drained()]).then(() => {
      db.close();
      clearTimeout(deadline);
      console.log('HTTP drain complete; database closed');
      process.exit(0);
    }).catch(error => {
      console.error('Graceful shutdown failed:', error);
      process.exit(1);
    });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  };
}
