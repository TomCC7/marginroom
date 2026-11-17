#!/usr/bin/env python3
"""Bounded release installer test. Darwin tests are shell mocks, NOT Mac execution."""
import contextlib,functools,hashlib,http.server,json,os,pathlib,shutil,signal,subprocess,sys,tempfile,threading
repo=pathlib.Path(__file__).resolve().parents[1]
dist=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else repo.parent/'deliverables'
root=pathlib.Path(tempfile.mkdtemp(prefix='release-test-',dir=os.environ.get('TMPDIR',repo.parent)))
results=[];states=[]
def record(s): results.append(s);print('PASS',s,flush=True)
def run(args,env,good=True,**kw):
 p=subprocess.run(args,env=env,text=True,capture_output=True,timeout=70,**kw)
 if good and p.returncode:raise AssertionError((args,p.returncode,p.stderr,p.stdout))
 if not good:assert p.returncode,(args,'unexpected success')
 return p
class Handler(http.server.SimpleHTTPRequestHandler):
 hits=[]
 def log_message(self,format,*args):pass
 def do_GET(self):
  self.hits.append(self.path)
  if self.path.startswith('/corrupt/'):
   self.send_response(200);self.end_headers();self.wfile.write(b'corrupt archive');return
  return super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(dist)))
threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
# Runtime PATH deliberately contains neither Node nor Bun.
utils=root/'tools';utils.mkdir()
for name in ['sh','curl','tar','gzip','sha256sum','shasum','uname','getconf','mktemp','rm','mkdir','cp','chmod','mv','xdg-open']:
 src=shutil.which(name)
 if src: (utils/name).symlink_to(src)
# Do not launch a real desktop browser in this test.
(utils/'xdg-open').unlink(missing_ok=True);(utils/'xdg-open').write_text('#!/bin/sh\nprintf "%s\\n" "$1" > "$HOME/browser-url"\n');(utils/'xdg-open').chmod(0o755)
env={**os.environ,'HOME':str(root/'home with spaces'),'PATH':str(utils),'TMPDIR':str(root)}
pathlib.Path(env['HOME']).mkdir();installer=(dist/'install.sh').read_text()
def install(e,good=True,origin=url):return run(['/bin/sh','-s','--','--from',origin],e,good,input=installer)
try:
 install(env);binary=pathlib.Path(env['HOME'])/'.local/bin/marginroom';assert binary.is_file();assert binary.stat().st_mode&0o777==0o755
 assert not (utils/'bun').exists() and not (utils/'node').exists();record('literal piped installer; spaced HOME; private atomic user install; no Node/Bun on PATH')
 run([str(binary),'--help'],env);state=root/'state with spaces';states.append(state)
 article=root/'article.html';article.write_text('<!doctype html><title>Synthetic release fixture</title><p id="test">Synthetic release content.</p>')
 def cli(*args):return run([str(binary),*args,'--data-dir',str(state)],env)
 a=json.loads(cli('open',str(article),'--json').stdout);assert a['reviewUrl'];origin=a['reviewUrl'].split('/viewer')[0]
 import urllib.request
 for asset in ['viewer.html','viewer.js','review-v3.css']:
  with urllib.request.urlopen(origin+'/'+asset) as response:assert response.status==200 and len(response.read())>100
 comments=json.loads(cli('comments',a['reviewUrl'],'--json').stdout);assert comments['records']==[] and comments['complete']
 cli('open',str(article),'--browser');assert (pathlib.Path(env['HOME'])/'browser-url').read_text().startswith(origin+'/claim.html#')
 article.write_text('<!doctype html><title>Synthetic release revision</title><p id="test">Synthetic revised release content.</p>')
 b=json.loads(cli('open',str(article),'--new-version-of',a['reviewUrl'],'--json').stdout);assert a['document']!=b['document']
 record('Linux installed help/open/browser dispatch/embedded HTTP assets/comments JSON/explicit revision')
 st=json.loads((state/'service.json').read_text());os.kill(st['pid'],signal.SIGKILL)
 import time;time.sleep(.3)
 c=json.loads(cli('open',str(article),'--json').stdout);assert c['instanceId']==a['instanceId']
 record('Linux installed service restart preserves instance identity')
 before=hashlib.sha256(binary.read_bytes()).hexdigest();bad=install(env,False,url+'/corrupt');assert 'SHA256 mismatch' in bad.stderr;assert hashlib.sha256(binary.read_bytes()).hexdigest()==before;record('corrupt digest refusal preserves installed executable')
 mock=root/'mock';mock.mkdir();(mock/'uname').write_text('#!/bin/sh\ncase "$1" in -s) printf "%s\\n" "$TEST_OS";; -m) printf "%s\\n" "$TEST_ARCH";; esac\n');(mock/'uname').chmod(0o755)
 for system,arch in [('Darwin','arm64'),('Darwin','x86_64'),('Linux','x86_64')]:
  home=root/(system+arch);home.mkdir();e={**env,'HOME':str(home),'PATH':str(mock)+':'+str(utils),'TEST_OS':system,'TEST_ARCH':arch}
  p=install(e);installed=home/'.local/bin/marginroom';target={'arm64':'darwin-arm64','x86_64':'darwin-x64'}[arch] if system=='Darwin' else 'linux-x64'
  expected=json.loads((dist/f'manifest-{target}.json').read_text())['binarySha256'];assert hashlib.sha256(installed.read_bytes()).hexdigest()==expected
 record('mock uname Darwin arm64/x86_64 and Linux exact target selection; real shasum -a 256 branch; no Mach-O execution')
 for system,arch in [('Linux','aarch64'),('FreeBSD','x86_64'),('Darwin','unknown')]:
  count=len(Handler.hits);p=install({**env,'PATH':str(mock)+':'+str(utils),'TEST_OS':system,'TEST_ARCH':arch},False);assert 'Unsupported' in p.stderr and len(Handler.hits)==count
 record('unknown OS/architecture refuses before download')
 (mock/'getconf').write_text('#!/bin/sh\nexit 1\n');(mock/'getconf').chmod(0o755)
 p=install({**env,'PATH':str(mock)+':'+str(utils),'TEST_OS':'Linux','TEST_ARCH':'x86_64'},False);assert 'glibc' in p.stderr;record('non-glibc refusal')
 print(json.dumps({'root':str(root),'checks':results,'macOSRuntime':'NOT EXECUTED'},indent=2))
finally:
 for state in states:
  with contextlib.suppress(Exception):os.kill(json.loads((state/'service.json').read_text())['pid'],signal.SIGTERM)
 server.shutdown()
