// Publication boundary: fail closed; never update a release or create/move a tag.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function publishRelease(env,dist,exec=(args)=>execFileSync('gh',args,{encoding:'utf8'})) {
 const version=env.RELEASE_VERSION;
 assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version));
 const tag=`v${version}`,repo=env.GITHUB_REPOSITORY;
 assert.equal(env.GITHUB_REF,`refs/tags/${tag}`);
 assert(/^[\w.-]+\/[\w.-]+$/.test(repo));
 assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA));
 const api=(p)=>JSON.parse(exec(['api',`repos/${repo}/${p}`]));
 let ref=api(`git/ref/tags/${tag}`).object;
 for(let depth=0;ref.type==='tag';depth++) {assert(depth<5);ref=api(`git/tags/${ref.sha}`).object;}
 assert.equal(ref.type,'commit'); assert.equal(ref.sha,env.GITHUB_SHA,'Remote tag moved');
 // --include exposes the actual HTTP status. Only an explicit 404 permits creation.
 let response;
 try {response=exec(['api','--include',`repos/${repo}/releases/tags/${tag}`]);}
 catch(e) {response=String(e.stdout??''); if(!/^HTTP\/\S+ 404\b/m.test(response)) throw e;}
 assert(/^HTTP\/\S+ 404\b/m.test(response),'Existing release or non-404 API response; refusing publication');
 const manifest=JSON.parse(readFileSync(path.join(dist,'manifest.json')));
 assert.equal(manifest.version,version);assert.equal(manifest.sourceCommit,env.GITHUB_SHA);assert.equal(manifest.sourceDirty,false);
 const files=readFileSync(path.join(dist,'SHA256SUMS'),'utf8').trim().split('\n').map(line=>{
  const match=/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);assert(match,'Invalid checksum entry');
  assert.equal(createHash('sha256').update(readFileSync(path.join(dist,match[2]))).digest('hex'),match[1]);return match[2];
 });
 assert(files.includes('RELEASE-NOTES.md'));assert.equal(new Set(files).size,files.length);
 const args=['release','create',tag,'--repo',repo,'--verify-tag','--title',tag,'--notes-file',path.join(dist,'RELEASE-NOTES.md')];
 if(version.includes('-')) args.push('--prerelease','--latest=false');else args.push('--latest');
 // Inventory is exactly the verified checksum inventory plus SHA256SUMS itself.
 args.push(...[...files,'SHA256SUMS'].map(f=>path.join(dist,f)));
 return exec(args);
}
if(import.meta.main) console.log(publishRelease(process.env,path.resolve(process.argv[2])));
