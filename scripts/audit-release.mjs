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
const changed=[];for(const f of snapshot.files){const b=await readFile(f.path);if(createHash('sha256').update(b).digest('hex')!==f.sha256)changed.push(f.path);}
// Inspect every unique historical text blob reachable from the intended branch.
const objects=git('rev-list','--objects','HEAD').split('\n');let textBlobs=0,binaryBlobs=0;
for(const line of objects){const [id]=line.split(' ');if(git('cat-file','-t',id)!=='blob')continue;const b=execFileSync('git',['cat-file','blob',id],{maxBuffer:20*1024*1024});if(b.includes(0)){binaryBlobs++;continue;}textBlobs++;for(const re of forbiddenText)assert.ok(!re.test(b.toString()),'Privacy/secret pattern in historical blob '+id);}
console.log(JSON.stringify({trackedPaths:paths.length,snapshotFiles:snapshot.files.length,releaseChangedSnapshotPaths:changed,historicalTextBlobs:textBlobs,historicalBinaryBlobs:binaryBlobs,result:'PASS'},null,2));
