import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {dependencies,validateBundle,ImportError,safePath} from '../../document-imports.js';
import {digest} from '../../machine-auth.js';
import {CliError} from './client.mjs';
export async function collect(file,assets,include=[]){try{
 const entryAbsolute=await realpath(path.resolve(file)),root=await realpath(path.resolve(assets||path.dirname(file)));
 const within=p=>p.startsWith(root+path.sep);if(!within(entryAbsolute))throw new ImportError('entry_outside_boundary');
 const entry=path.relative(root,entryAbsolute).split(path.sep).join('/'),queue=[entry,...include],files=[],seen=new Set();
 while(queue.length){const name=queue.shift();if(!safePath(name))throw new ImportError('resource_outside_boundary');if(seen.has(name))continue;seen.add(name);if(seen.size>256)throw new ImportError('too_many_resources');
  const abs=await realpath(path.join(root,name)).catch(()=>{throw new ImportError(`missing_resource:${name}`);});if(!within(abs))throw new ImportError('symlink_escape');const info=await stat(abs);if(!info.isFile()||info.size>2_000_000)throw new ImportError('invalid_or_large_resource');const bytes=await readFile(abs);files.push({path:name,data:bytes.toString('base64'),sha256:digest(bytes)});queue.push(...dependencies(bytes.toString('utf8'),name).local);
 }
 const bundle={entry,files};validateBundle(bundle);return {bundle,absolute:entryAbsolute};
 }catch(e){throw new CliError(e.code||'resource_error',e.message,5);}}
