// Audits only explicitly intended tracked publication paths, never runtime files.
import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const paths=git('ls-files').split('\n').filter(Boolean).sort();
const allowed=JSON.parse(await readFile('release/publication-allowlist.json','utf8'));
assert.deepEqual(paths,allowed.paths,'Tracked paths must match explicit publication allowlist');
const forbiddenPath=/(^|\/)(?:review-artifacts|data|backups|node_modules|\.local)(?:\/|$)|\.(?:db|sqlite|log)(?:$|[-.])|(?:^|\/)\.env(?:$|\.(?!example$))/i;
const forbiddenText=[/\/home\/[a-z0-9_-]+\//i,/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,/\bsk-[A-Za-z0-9]{30,}/,/\b(?:192\.168|10\.0)\.\d+\.\d+\b/];
for(const p of paths){assert.ok(!forbiddenPath.test(p),'Forbidden publication path: '+p);assert.ok((await lstat(p)).isFile(),'Not a regular file: '+p);const b=await readFile(p);if(b.includes(0))continue;for(const re of forbiddenText)assert.ok(!re.test(b.toString()),'Privacy/secret pattern in '+p);}
const snapshot=JSON.parse(await readFile('release/source-snapshot.json','utf8'));
assert.equal(git('merge-base','HEAD',snapshot.upstreamCommit),snapshot.upstreamCommit);
const changed=[],removed=[];for(const f of snapshot.files){if(!paths.includes(f.path)){assert.equal(f.path,'package-lock.json','Unexpected removed upstream path');removed.push(f.path);continue;}const b=await readFile(f.path);if(createHash('sha256').update(b).digest('hex')!==f.sha256)changed.push(f.path);}
// Inspect every unique historical text blob reachable from the intended branch.
const objects=git('rev-list','--objects','--all').split('\n');let textBlobs=0,binaryBlobs=0;
// Individually reviewed old developer-report blobs: directory examples only,
// no actual documents/identities/tokens. No exemption for any credential pattern.
const developerReports=new Set(['a48fa16d6acf0de7c8bdedeac0058dee66a6b432','643f62f5a0dc70d6f075a722e5138ac185d9255d','9fad049e0d7e9096100fa6c01e70e0198eda5fba','eadc85a9a8a3fd70b68220f6a53fa54e15a84780']);
for(const line of objects){const [id]=line.split(' ');if(git('cat-file','-t',id)!=='blob')continue;const b=execFileSync('git',['cat-file','blob',id],{maxBuffer:20*1024*1024});if(b.includes(0)){binaryBlobs++;continue;}textBlobs++;for(const [i,re] of forbiddenText.entries())assert.ok((i===0&&developerReports.has(id))||!re.test(b.toString()),'Privacy/secret pattern in historical blob '+id);}
console.log(JSON.stringify({trackedPaths:paths.length,snapshotFiles:snapshot.files.length,releaseChangedSnapshotPaths:changed,releaseRemovedSnapshotPaths:removed,historicalTextBlobs:textBlobs,historicalBinaryBlobs:binaryBlobs,result:'PASS'},null,2));
