#!/usr/bin/env node
// Validate offline snapshot before restoring into a NEW or EMPTY data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

const [backupArg, targetArg, confirmation] = process.argv.slice(2);
if (!backupArg || !targetArg || confirmation !== '--writes-stopped') {
  console.error('Usage: node scripts/restore.mjs BACKUP_DIR EMPTY_DATA_DIR --writes-stopped');
  console.error('Stop the application and every other writer first. Never restore over existing data.');
  process.exit(1);
}
const backup = await fs.realpath(backupArg);
const target = path.resolve(targetArg);
// Refuse symlink destination and overlap, even through symlinked parents.
const parent = await fs.realpath(path.dirname(target));
const canonicalTarget = path.join(parent, path.basename(target));
if (canonicalTarget === backup || canonicalTarget.startsWith(backup + path.sep) || backup.startsWith(canonicalTarget + path.sep)) throw Error('Backup and restore target must not overlap');
const manifestPath = path.join(backup, 'backup-manifest.json');
if (!(await fs.lstat(manifestPath)).isFile()) throw Error('Manifest must be a regular file');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.format !== 1 || manifest.writesStopped !== true || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw Error('Unsupported backup manifest');
const actual = {};
async function digest(dir, prefix = '') {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (e.isDirectory()) await digest(path.join(dir, e.name), rel + '/');
    else if (!e.isFile()) throw Error(`Unsupported file type: ${rel}`);
    else if (rel !== 'backup-manifest.json') actual[rel] = createHash('sha256').update(await fs.readFile(path.join(dir, e.name))).digest('hex');
  }
}
await digest(backup);
for (const key of ['app.db', 'identity.json']) if (!(key in actual)) throw Error(`Missing ${key}`);
if (!(await fs.lstat(path.join(backup, 'docs'))).isDirectory()) throw Error('Missing docs directory');
if (Object.keys(actual).length !== Object.keys(manifest.files).length || Object.entries(actual).some(([k, v]) => manifest.files[k] !== v)) throw Error('Backup checksum/file inventory mismatch');
const identity = JSON.parse(await fs.readFile(path.join(backup, 'identity.json'), 'utf8'));
for (const key of ['SESSION_SECRET', 'OWNER_KEY']) if (typeof identity[key] !== 'string' || identity[key].length < 32) throw Error(`Invalid ${key}`);
const db = new Database(path.join(backup, 'app.db'), { readonly: true, fileMustExist: true });
try { if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw Error('Backup SQLite integrity check failed'); }
finally { db.close(); }
try {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(target)).length) throw Error('Restore target must be an empty, non-symlink directory');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await fs.mkdir(target, { mode: 0o700 });
}
await fs.chmod(target, 0o700);
try {
  await fs.copyFile(path.join(backup, 'app.db'), path.join(target, 'app.db'), 1);
  await fs.copyFile(path.join(backup, 'identity.json'), path.join(target, 'identity.json'), 1);
  await fs.chmod(path.join(target, 'app.db'), 0o600);
  await fs.chmod(path.join(target, 'identity.json'), 0o600);
  await fs.cp(path.join(backup, 'docs'), path.join(target, 'docs'), { recursive: true, force: false, errorOnExist: true });
  console.log(`Restore complete: ${Object.keys(actual).length} verified files; SQLite integrity_check=ok. Start the same app version and verify before switching traffic.`);
} catch (error) {
  console.error('Restore failed; target may be incomplete. Keep the application stopped.');
  throw error;
}
