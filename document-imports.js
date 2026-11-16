import {parse} from 'parse5';
import path from 'node:path';
import {mkdirSync,writeFileSync,renameSync,readFileSync,existsSync,rmSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {digest} from './machine-auth.js';
export const BUNDLE_LIMITS={file:2_000_000,total:16_000_000,count:256};
export class ImportError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export function safePath(value){return typeof value==='string' && value.length<=512 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every(p=>p && p!=='.' && p!=='..') && !/%(?:2e|2f|5c)/i.test(value);}
// Static declared dependencies only; no script execution, network requests or workspace scans.
export function dependencies(text,name){
 const refs=[];
 if(/\.html?$/i.test(name)){
  const walk=n=>{for(const a of n.attrs||[]) if(['src','poster'].includes(a.name)|| (a.name==='href' && ['link','image','use'].includes(n.tagName)))refs.push(a.value);else if(a.name==='style')css(a.value);else if(a.name==='srcset')for(const s of a.value.split(','))refs.push(s.trim().split(/\s+/)[0]);
   if(n.tagName==='base')throw new ImportError('base_element_not_supported');
   if(n.tagName==='style')css((n.childNodes||[]).map(n=>n.value||'').join(''));
   for(const c of n.childNodes||[])walk(c);};walk(parse(text));
 } else if(/\.css$/i.test(name))css(text);
 else if(/\.(?:m?js)$/i.test(name)){for(const m of text.matchAll(/(?:\bimport\s*(?:[^'";]*?\sfrom\s*)?|\bexport\s+[^'";]*?\sfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g))refs.push(m[1]);}
 function css(t){for(const m of t.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/gi))refs.push(m[1]||m[2]);}
 const local=[],external=[];
 for(const raw of refs){if(!raw||raw.startsWith('#')||/^(data:|blob:)/i.test(raw))continue;if(/^(https?:)?\/\//i.test(raw)){external.push(raw);continue;}if(/^[a-z][\w+.-]*:/i.test(raw))throw new ImportError('unsupported_resource_scheme');
 let decoded;try{decoded=decodeURIComponent(raw.split(/[?#]/)[0]);}catch{throw new ImportError('invalid_resource_url');}
 if(decoded.startsWith('/')||decoded.includes('\\'))throw new ImportError('resource_outside_boundary');
 const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),decoded));if(!safePath(target))throw new ImportError('resource_outside_boundary');local.push(target);}
 return {local:[...new Set(local)],external:[...new Set(external)]};
}
export function validateBundle(input){
 if(!input||!safePath(input.entry)||!Array.isArray(input.files)||!input.files.length||input.files.length>BUNDLE_LIMITS.count)throw new ImportError('invalid_manifest');
 const files=new Map();let total=0;
 for(const f of input.files){if(!safePath(f.path)||files.has(f.path)||!/^[-A-Za-z0-9_/+.]+\.(?:html?|css|m?js|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|map)$/i.test(f.path)||typeof f.data!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))throw new ImportError('invalid_resource');
  const bytes=Buffer.from(f.data,'base64');total+=bytes.length;if(bytes.length>BUNDLE_LIMITS.file||total>BUNDLE_LIMITS.total)throw new ImportError('bundle_too_large',413);if(f.sha256!==digest(bytes))throw new ImportError('digest_mismatch');files.set(f.path,bytes);}
 const entry=files.get(input.entry);if(!entry||!/<[a-z!][\s\S]*>/i.test(entry.toString('utf8')))throw new ImportError('not_html');
 const external=[];for(const [name,bytes]of files){const deps=dependencies(bytes.toString('utf8'),name);for(const ref of deps.local)if(!files.has(ref))throw new ImportError(`missing_resource:${ref}`);external.push(...deps.external);}
 const hash=digest(JSON.stringify({entry:input.entry,files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([p,b])=>[p,digest(b)])}));
 return {files,hash,external:[...new Set(external)]};
}
function durable(file,bytes){const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
function syncDir(dir){const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function documentImports(db,dir,{stripActiveContent}){
 const root=path.join(dir,'bundles');mkdirSync(root,{recursive:true,mode:0o700});
 db.exec(`CREATE TABLE IF NOT EXISTS imported_documents(doc TEXT PRIMARY KEY, principal TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, entry TEXT NOT NULL, series TEXT NOT NULL, previous TEXT, created TEXT NOT NULL, UNIQUE(principal,source,hash));`);
 // The database is the publication pointer. Uncommitted directories are never served.
 const run=db.transaction((req,input)=>{
  const bundle=validateBundle(input);if(typeof input.source!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(input.source))throw new ImportError('invalid_source_identity');
  const principal=req.caller.token;
  const old=db.prepare('SELECT * FROM imported_documents WHERE principal=? AND source=? AND hash=?').get(principal,input.source,bundle.hash);if(old)return {...old,reused:true,external:bundle.external};
  const latest=db.prepare('SELECT * FROM imported_documents WHERE principal=? AND source=? ORDER BY rowid DESC LIMIT 1').get(principal,input.source);
  const parent=input.previous && db.prepare('SELECT * FROM imported_documents WHERE doc=?').get(input.previous);
  if(latest&&!parent)throw new ImportError('source_changed_use_new_version',409);
  if(input.previous&&(!parent||!req.canManage(parent.doc)))throw new ImportError('invalid_version_parent',403);
  if(parent&&latest&&parent.series!==latest.series)throw new ImportError('version_series_conflict',409);
  const doc=`review-${randomUUID()}`,stage=path.join(root,`.stage-${doc}`),dest=path.join(root,doc);
  mkdirSync(stage,{mode:0o700});
  try{for(const [name,bytes]of bundle.files){const file=path.join(stage,name);mkdirSync(path.dirname(file),{recursive:true,mode:0o700});durable(file,bytes);syncDir(path.dirname(file));}syncDir(stage);renameSync(stage,dest);syncDir(root);
   // Compatibility source views are written before DB publication and hidden by the listing guard.
   durable(path.join(dir,`${doc}.raw.html`),bundle.files.get(input.entry));durable(path.join(dir,`${doc}.html`),stripActiveContent(bundle.files.get(input.entry).toString('utf8')));syncDir(dir);
   const row={doc,principal,source:input.source,hash:bundle.hash,entry:input.entry,series:parent?.series||doc,previous:parent?.doc||null,created:new Date().toISOString()};
   db.prepare('INSERT INTO imported_documents VALUES(@doc,@principal,@source,@hash,@entry,@series,@previous,@created)').run(row);
   db.prepare('INSERT INTO doc_owners(doc_id,owner_token,created_at) VALUES(?,?,?)').run(doc,principal,row.created);
   return {...row,reused:false,external:bundle.external};
  }catch(e){rmSync(stage,{recursive:true,force:true});throw e;}
 });
 return {import:(req,input)=>run.immediate(req,input),get:doc=>db.prepare('SELECT * FROM imported_documents WHERE doc=?').get(doc),root};
}
