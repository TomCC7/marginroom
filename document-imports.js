import {parse} from 'parse5';
import path from 'node:path';
import {mkdirSync,writeFileSync,renameSync,readFileSync,existsSync,rmSync,readdirSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {digest} from './machine-auth.js';
import {parse as lex} from 'es-module-lexer/js';
import {BUNDLE_LIMITS,importLimits} from './import-limits.js';
export {BUNDLE_LIMITS};
export function moduleImports(text){try{return lex(text)[0].filter(i=>typeof i.n==='string');}catch{throw new ImportError('invalid_javascript');}}
export class ImportError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
// URL-token phase of the HTML srcset algorithm: commas inside data URLs are not separators.
export function srcsetReferences(text){const out=[];let p=0;while(p<text.length){while(/[\s,]/.test(text[p]||'')&&p<text.length)p++;const s=p;while(p<text.length&&!/\s/.test(text[p]))p++;let e=p;while(e>s&&text[e-1]===',')e--;if(e>s)out.push({s,e,url:text.slice(s,e)});if(e<p)continue;let parens=0;while(p<text.length){const c=text[p++];if(c==='(')parens++;if(c===')')parens=Math.max(0,parens-1);if(c===','&&!parens)break;}}return out;}
export function safePath(value){return typeof value==='string' && value.length<=512 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every(p=>p && p!=='.' && p!=='..') && !/%(?:2e|2f|5c)/i.test(value);}
// Static declared dependencies only; no script execution, network requests or workspace scans.
export function dependencies(text,name,{rootRelative=true}={}){
 const refs=[];
 if(/\.html?$/i.test(name)){
  const walk=n=>{for(const a of n.attrs||[]) if(['src','poster'].includes(a.name)|| (a.name==='href' && ['link','image','use'].includes(n.tagName)))refs.push(a.value);else if(a.name==='style')css(a.value);else if(a.name==='srcset')for(const s of srcsetReferences(a.value))refs.push(s.url);
   if(n.tagName==='base')throw new ImportError('base_element_not_supported');
   for(const a of n.attrs||[])if(a.name==='srcdoc')walk(parse(a.value));
   if(n.tagName==='script'&&!(n.attrs||[]).some(a=>a.name==='type'&&!/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(a.value)))modules((n.childNodes||[]).map(n=>n.value||'').join(''));
   if(n.tagName==='style')css((n.childNodes||[]).map(n=>n.value||'').join(''));
   for(const c of n.childNodes||[])walk(c);if(n.content)walk(n.content);};walk(parse(text));
 } else if(/\.css$/i.test(name))css(text);
 else if(/\.(?:m?js)$/i.test(name))modules(text);
 function modules(text){for(const m of moduleImports(text))refs.push(m.n);}
 function css(t){for(const m of t.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/gi))refs.push(m[1]||m[2]);}
 const local=[],external=[];
 for(const raw of refs){if(!raw||raw.startsWith('#')||/^(data:|blob:)/i.test(raw))continue;if(/^(https?:)?\/\//i.test(raw)){external.push(raw);continue;}if(/^[a-z][\w+.-]*:/i.test(raw))throw new ImportError('unsupported_resource_scheme');
 local.push(resourcePath(raw,name,rootRelative));}
 return {local:[...new Set(local)],external:[...new Set(external)]};
}
export function resourcePath(raw,name,rootRelative=true){
 const encoded=raw.split(/[?#]/)[0];let decoded;try{decoded=decodeURIComponent(encoded);}catch{throw new ImportError('invalid_resource_url');}
 if(/%(?:00|2e|2f|5c)/i.test(encoded)||decoded.includes('\\')||decoded.includes('\0')||decoded.startsWith('//'))throw new ImportError('resource_outside_boundary');
 if(decoded.startsWith('/')&&!rootRelative)throw new ImportError('root_resource_requires_assets_dir');
 const target=path.posix.normalize(decoded.startsWith('/')?decoded.slice(1):path.posix.join(path.posix.dirname(name),decoded));
 if(!safePath(target))throw new ImportError('resource_outside_boundary');return target;
}
export function validateBundle(input,limits=importLimits()){
 if(!input||!safePath(input.entry)||!Array.isArray(input.files)||!input.files.length)throw new ImportError('invalid_manifest');
 if(input.files.length>limits.count)throw new ImportError(`too_many_resources:max=${limits.count}`,413);
 const files=new Map();let total=0;
 for(const f of input.files){
  if(!f||typeof f!=='object'||typeof f.data!=='string')throw new ImportError('invalid_resource');
  // Bound encoded input before walking its alphabet or allocating decoded bytes.
  if(f.data.length>4*Math.ceil(limits.file/3)||total+Math.floor(f.data.length/4)*3-2>limits.total)throw new ImportError(`bundle_too_large:file=${limits.file}:total=${limits.total}`,413);
  if(!safePath(f.path)||files.has(f.path)||!/^[-A-Za-z0-9_/+.]+\.(?:html?|css|m?js|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|map)$/i.test(f.path)||typeof f.data!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))throw new ImportError('invalid_resource');
  const size=f.data.length/4*3-(f.data.endsWith('==')?2:f.data.endsWith('=')?1:0);total+=size;
  if(size>limits.file||total>limits.total)throw new ImportError(`bundle_too_large:file=${limits.file}:total=${limits.total}`,413);
  const bytes=Buffer.from(f.data,'base64');if(f.sha256!==digest(bytes))throw new ImportError('digest_mismatch');files.set(f.path,bytes);}
 const entry=files.get(input.entry);if(!entry||!/<[a-z!][\s\S]*>/i.test(entry.toString('utf8')))throw new ImportError('not_html');
 const external=[];for(const [name,bytes]of files){const deps=dependencies(bytes.toString('utf8'),name);for(const ref of deps.local)if(!files.has(ref))throw new ImportError(`missing_resource:${ref}`);external.push(...deps.external);}
 const hash=digest(JSON.stringify({entry:input.entry,files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([p,b])=>[p,digest(b)])}));
 return {files,hash,external:[...new Set(external)]};
}
function durable(file,bytes){const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
function syncDir(dir){const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function documentImports(db,dir,{stripActiveContent,onPhase=()=>{},checkCapacity=()=>{},limits=importLimits()}){
 const root=path.join(dir,'bundles');mkdirSync(root,{recursive:true,mode:0o700});
 db.exec(`CREATE TABLE IF NOT EXISTS imported_documents(doc TEXT PRIMARY KEY, principal TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, entry TEXT NOT NULL, series TEXT NOT NULL, previous TEXT, created TEXT NOT NULL, UNIQUE(principal,source,hash));`);
 // The database is the publication pointer. Uncommitted directories are never served.
 for(const name of readdirSync(root)){
  if(name.startsWith('.stage-'))rmSync(path.join(root,name),{recursive:true,force:true});
  else if(safePath(name)&&!db.prepare('SELECT 1 FROM imported_documents WHERE doc=?').get(name)){
   rmSync(path.join(root,name),{recursive:true,force:true});for(const suffix of ['.html','.raw.html'])rmSync(path.join(dir,name+suffix),{force:true});
  }
 }
 const run=db.transaction((req,input,options={})=>{
  const bundle=validateBundle(input,limits);if(typeof input.source!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(input.source))throw new ImportError('invalid_source_identity');
  const principal=req.caller.token;
  const old=db.prepare('SELECT * FROM imported_documents WHERE principal=? AND source=? AND hash=?').get(principal,input.source,bundle.hash);if(old)return {...old,reused:true,external:bundle.external};
  const latest=db.prepare('SELECT * FROM imported_documents WHERE principal=? AND source=? ORDER BY rowid DESC LIMIT 1').get(principal,input.source);
  const parent=input.previous && db.prepare('SELECT * FROM imported_documents WHERE doc=?').get(input.previous);
  if(latest&&!parent)throw new ImportError('source_changed_use_new_version',409);
  if(input.previous&&(!parent||!req.canManage(parent.doc)))throw new ImportError('invalid_version_parent',403);
  if(parent&&latest&&parent.series!==latest.series)throw new ImportError('version_series_conflict',409);
  checkCapacity(req);
  const doc=options.id||`review-${randomUUID()}`,stage=path.join(root,`.stage-${doc}`),dest=path.join(root,doc);
  mkdirSync(stage,{mode:0o700});
  try{for(const [name,bytes]of bundle.files){const file=path.join(stage,name);mkdirSync(path.dirname(file),{recursive:true,mode:0o700});durable(file,bytes);syncDir(path.dirname(file));}syncDir(stage);renameSync(stage,dest);syncDir(root);onPhase('files-published');
   // Compatibility source views are written before DB publication and hidden by the listing guard.
   if(options.raw!==false)durable(path.join(dir,`${doc}.raw.html`),bundle.files.get(input.entry));durable(path.join(dir,`${doc}.html`),stripActiveContent(bundle.files.get(input.entry).toString('utf8')));syncDir(dir);onPhase('before-db-commit');
   const row={doc,principal,source:input.source,hash:bundle.hash,entry:input.entry,series:parent?.series||doc,previous:parent?.doc||null,created:new Date().toISOString()};
   db.prepare('INSERT INTO imported_documents VALUES(@doc,@principal,@source,@hash,@entry,@series,@previous,@created)').run(row);
   db.prepare('INSERT INTO doc_owners(doc_id,owner_token,created_at) VALUES(?,?,?)').run(doc,principal,row.created);
   return {...row,reused:false,external:bundle.external};
  }catch(e){rmSync(stage,{recursive:true,force:true});throw e;}
 });
 return {import:(req,input,options)=>{const result=run.immediate(req,input,options);onPhase('committed');return result;},forget:doc=>{db.prepare('DELETE FROM imported_documents WHERE doc=?').run(doc);db.prepare('DELETE FROM document_grants WHERE doc=?').run(doc);db.prepare('DELETE FROM management_handoffs WHERE doc=?').run(doc);rmSync(path.join(root,doc),{recursive:true,force:true});},get:doc=>db.prepare('SELECT * FROM imported_documents WHERE doc=?').get(doc),root};
}
