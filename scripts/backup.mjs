#!/usr/bin/env bun
// Offline application snapshot: SQLite backup API + document tree + identity.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from '../lib/sqlite.mjs';

const [sourceArg, targetArg, confirmation] = process.argv.slice(2);
if (!sourceArg || !targetArg || confirmation !== '--writes-stopped') {
  console.error('Usage: bun scripts/backup.mjs DATA_DIR NEW_BACKUP_DIR --writes-stopped');
  console.error('Stop the application and every other writer first. This flag is an operator assertion, not a lock.');
  process.exit(1);
}
const source = await fs.realpath(sourceArg);
const target = path.resolve(targetArg);
const targetParent = await fs.realpath(path.dirname(target));
const canonicalTarget = path.join(targetParent, path.basename(target));
if (canonicalTarget === source || canonicalTarget.startsWith(source + path.sep)) throw Error('Backup must be outside the data directory');
const identity = JSON.parse(await fs.readFile(path.join(source, 'identity.json'), 'utf8'));
for (const key of ['SESSION_SECRET', 'OWNER_KEY']) {
  if (typeof identity[key] !== 'string' || identity[key].length < 32) throw Error(`Missing/invalid ${key} in identity.json`);
}
// Reject links/special files, including nested document assets.
async function regularTree(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await regularTree(p);
    else if (!e.isFile()) throw Error(`Unsupported file type: ${p}`);
  }
}
for (const file of ['app.db', 'identity.json']) {
  if (!(await fs.lstat(path.join(source, file))).isFile()) throw Error(`Expected regular file: ${file}`);
}
if (!(await fs.lstat(path.join(source, 'docs'))).isDirectory()) throw Error('Expected docs directory');
await regularTree(path.join(source, 'docs'));
await fs.mkdir(target, { mode: 0o700 }); // Never overwrite an existing backup.
let db;
try {
  db = new Database(path.join(source, 'app.db'), { readonly: true, create: false });
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw Error('Source SQLite integrity check failed');
  await db.backup(path.join(target, 'app.db'));
  db.close(); db = null;
  // Make the standalone snapshot readable on a read-only backup mount. A WAL
  // header otherwise makes SQLite try to create -wal/-shm beside the snapshot.
  db = new Database(path.join(target, 'app.db'), { create: false });
  db.pragma('journal_mode = DELETE');
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw Error('Snapshot SQLite integrity check failed');
  db.close(); db = null;
  await fs.cp(path.join(source, 'docs'), path.join(target, 'docs'), { recursive: true, errorOnExist: true, force: false });
  await fs.writeFile(path.join(target, 'identity.json'), JSON.stringify(identity) + '\n', { mode: 0o600, flag: 'wx' });
  const files = {};
  async function digest(dir, prefix = '') {
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + e.name;
      if (e.isDirectory()) await digest(path.join(dir, e.name), rel + '/');
      else {
        files[rel] = createHash('sha256').update(await fs.readFile(path.join(dir, e.name))).digest('hex');
        await fs.chmod(path.join(dir, e.name), 0o600);
      }
    }
    await fs.chmod(dir, 0o700);
  }
  await digest(target);
  await fs.writeFile(path.join(target, 'backup-manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), writesStopped: true, files }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Backup complete: ${Object.keys(files).length} files; SQLite integrity_check=ok. Contains secrets: store privately.`);
} catch (error) {
  db?.close();
  console.error('Backup failed; incomplete target must not be used.');
  throw error;
}
