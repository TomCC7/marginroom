import {webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
let result;try{const b=await webkit.launch({headless:true});result={available:true,version:b.version()};await b.close()}catch(e){result={available:false,error:e.message}}await writeFile(new URL('../../evidence/webkit.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
