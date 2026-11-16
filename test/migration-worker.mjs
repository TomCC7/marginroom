// Disposable process adapter used only by migration/rollback acceptance.
import path from 'node:path';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const [repo,data]=process.argv.slice(2);const identity=JSON.parse(await readFile(path.join(data,'identity.json'),'utf8'));
Object.assign(process.env,{HS_DOCS_DIR:path.join(data,'docs'),HS_DB_PATH:path.join(data,'app.db'),SESSION_SECRET:identity.session,OWNER_KEY:identity.owner,MMW_GUEST_DOC_LIMIT:'10',MMW_UPLOAD_PER_HOUR:'1000'});
const {openDb}=await import(pathToFileURL(path.join(repo,'db.js'))),{createApp}=await import(pathToFileURL(path.join(repo,'server.js')));const db=openDb();const server=createApp(db).listen(0,'127.0.0.1',()=>process.send({origin:'http://127.0.0.1:'+server.address().port}));
process.on('message',async message=>{if(message.backup){await db.backup(message.backup);process.send({backedUp:true});}});
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));
