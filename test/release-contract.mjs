// Bounded regression checks. Temporary git refs only; no remote calls/publication.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {releaseVersion} from '../scripts/release-version.mjs';
import {publishRelease} from '../scripts/publish-release.mjs';
const root=mkdtempSync(path.join(os.tmpdir(),'marginroom-contract-'));const cwd=process.cwd();
try {
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','fixture');
 const sha=git('rev-parse','HEAD');for(const v of ['0.1.0','0.2.0'])git('update-ref',`refs/tags/v${v}`,sha);
 process.chdir(root);
 for(const v of ['0.1.0','0.2.0'])assert.equal(releaseVersion({GITHUB_EVENT_NAME:'push',GITHUB_REF:`refs/tags/v${v}`,GITHUB_SHA:sha,MARGINROOM_BUILD_VERSION:''}),v);
 const push={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/tags/v0.1.0',GITHUB_SHA:sha,MARGINROOM_BUILD_VERSION:''};
 for(const delta of [{GITHUB_REF:'refs/heads/main'},{GITHUB_REF:'refs/tags/v$(touch injected)'},{MARGINROOM_BUILD_VERSION:'0.2.0'},{RELEASE_TAG:'v0.2.0'},{GITHUB_SHA:'0'.repeat(40)}]) assert.throws(()=>releaseVersion({...push,...delta}));
 for(const v of ['1.0','01.2.3','0.1.0+build','$(touch injected)','0.1.0\nattack'])assert.throws(()=>releaseVersion({MARGINROOM_BUILD_VERSION:v}));
 process.chdir(cwd);
 for(const version of ['0.1.0','0.2.0-alpha.1']) {
  const dist=path.join(root,version);mkdirSync(dist);
  const files={'manifest.json':JSON.stringify({version,sourceCommit:sha,sourceDirty:false}),'RELEASE-NOTES.md':'notes','install.sh':'installer'};
  for(const [f,c] of Object.entries(files))writeFileSync(path.join(dist,f),c);
  writeFileSync(path.join(dist,'SHA256SUMS'),Object.entries(files).map(([f,c])=>`${createHash('sha256').update(c).digest('hex')}  ${f}`).join('\n')+'\n');
  const env={RELEASE_VERSION:version,GITHUB_REF:`refs/tags/v${version}`,GITHUB_REPOSITORY:'TomCC7/marginroom',GITHUB_SHA:sha};
  const mock=(status=404,remote=sha)=>args=>{
   if(args[0]==='release')return args;
   if(args.includes('--include')) {const e=new Error('HTTP error');e.stdout=`HTTP/2.0 ${status} Test\n\n{}`;throw e;}
   return JSON.stringify({object:{type:'commit',sha:remote}});
  };
  const args=publishRelease(env,dist,mock());assert(args.includes('--verify-tag'));assert(!args.includes('--target'));
  assert(args.includes(version.includes('-')?'--latest=false':'--latest'));
  assert.equal(args.includes('--prerelease'),version.includes('-'));
  for(const f of [...Object.keys(files),'SHA256SUMS'])assert(args.includes(path.join(dist,f)));
  for(const status of [200,401,403,500])assert.throws(()=>publishRelease(env,dist,mock(status)));
  assert.throws(()=>publishRelease(env,dist,mock(404,'0'.repeat(40))));
  writeFileSync(path.join(dist,'install.sh'),'tampered');assert.throws(()=>publishRelease(env,dist,mock()));
 }
 console.log('PASS: actual push env two versions; invalid/injected/mismatched inputs; stable/prerelease args; full hashed inventory; tag movement; fail-closed HTTP guards; tamper refusal');
} finally {process.chdir(cwd);rmSync(root,{recursive:true,force:true});}
