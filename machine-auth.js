import {createHash, randomBytes, randomUUID} from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
// Database-bound identity shared by normal hosts, managed runners and host-local pairing.
export function machineInstance(db, requested) {
  db.exec('CREATE TABLE IF NOT EXISTS machine_instance(singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO machine_instance(singleton,id) VALUES(1,?)').run(requested || randomUUID());
  const {id} = db.prepare('SELECT id FROM machine_instance WHERE singleton=1').get();
  if (requested && requested !== id) throw new Error('machine_instance_mismatch');
  return id;
}
export function machineAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS machine_credentials(hash TEXT PRIMARY KEY, principal TEXT NOT NULL, doc TEXT, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS document_grants(doc TEXT, principal TEXT, PRIMARY KEY(doc,principal));
    CREATE TABLE IF NOT EXISTS management_handoffs(hash TEXT PRIMARY KEY, doc TEXT NOT NULL, expires INTEGER NOT NULL);`);
  const issue = (principal = `m_${randomUUID()}`, doc = null) => {
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO machine_credentials(hash,principal,doc) VALUES(?,?,?)').run(digest(token),principal,doc);
    return {token,principal,doc};
  };
  const manages = (req, doc) => !!req.caller?.isOwner || !!db.prepare('SELECT 1 FROM doc_owners WHERE doc_id=? AND owner_token=? UNION SELECT 1 FROM document_grants WHERE doc=? AND principal=?').get(doc,req.caller.token,doc,req.caller.token);
  const middleware = (req,res,next) => {
    if (!req.headers.authorization) return next();
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization);
    const row = match && db.prepare('SELECT * FROM machine_credentials WHERE hash=? AND revoked=0').get(digest(match[1]));
    if (!row) return res.status(401).json({error:'invalid_machine_credential'});
    req.caller = {token:row.principal,isOwner:false,machine:true,doc:row.doc};
    // Machine API access is explicit, not inherited from public link permissions.
    const id = /^\/api\/(?:suggestions|doc|raw|doc-meta|access|versions|document-series)\/([^/]+)$/.exec(req.path)?.[1];
    if (row.doc && !(req.method==='GET' && req.path===`/api/suggestions/${row.doc}`)) return res.status(403).json({error:'read_only_document_scope'});
    if (id && !row.doc && !manages(req,id)) return res.status(403).json({error:'not_your_doc'});
    if (!row.doc && req.path.startsWith('/api/') && !id && !['/api/instance','/api/imports','/api/machine/pair','/api/machine/delegate','/api/machine/revoke','/api/management/handoff','/api/versions-locate'].includes(req.path)) return res.status(403).json({error:'machine_route_denied'});
    next();
  };
  return {issue,manages,middleware};
}
