import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const number='(?:0|[1-9][0-9]*)';
const identifier='(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const semver=new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`);
export function releaseVersion(env=process.env,pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)))) {
 const tag=env.RELEASE_TAG;
 if(tag!==undefined) assert(tag.startsWith('v')&&semver.test(tag.slice(1)),'Invalid release tag');
 const version=tag?.slice(1)??env.MARGINROOM_BUILD_VERSION??pkg.version;
 assert(typeof version==='string'&&version.length<=100&&semver.test(version),'Invalid release version (SemVer without build metadata)');
 if(env.MARGINROOM_BUILD_VERSION!==undefined) assert.equal(env.MARGINROOM_BUILD_VERSION,version,'Explicit version mismatch');
 if(env.GITHUB_EVENT_NAME==='push') {
  assert.equal(env.GITHUB_REF,`refs/tags/v${version}`,'Tag/ref mismatch');
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
  assert.equal(git('rev-parse',`refs/tags/v${version}^{commit}`),git('rev-parse','HEAD'),'Tag/head mismatch');
  assert.equal(git('rev-parse','HEAD'),env.GITHUB_SHA,'Event/head mismatch');
 }
 return version;
}
if(import.meta.main) console.log(releaseVersion());
