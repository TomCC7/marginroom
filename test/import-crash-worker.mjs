import {openDb} from '../db.js';
import {documentImports} from '../document-imports.js';
import {digest} from '../machine-auth.js';
const [dir,phase]=process.argv.slice(2),db=openDb(dir+'/db.sqlite');
const bytes=Buffer.from('<html><head></head><body><p>Synthetic crash fixture</p></body></html>');
const imports=documentImports(db,dir,{stripActiveContent:s=>s,onPhase:p=>{if(p===phase)process.exit(73)}});
console.log(JSON.stringify(imports.import({caller:{token:'synthetic-machine',machine:true},canManage:()=>true},{entry:'index.html',source:'crash-fixture',files:[{path:'index.html',data:bytes.toString('base64'),sha256:digest(bytes)}]})));
