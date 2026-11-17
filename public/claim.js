import {bind,languageSelect} from './i18n.js';
const token=location.hash.slice(1);history.replaceState(null,'','/claim.html');
document.querySelector('main').prepend(languageSelect());const status=document.querySelector('#status');bind(status,'agent.claiming');
try{const response=await fetch('/api/management/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const result=await response.json();if(!response.ok)throw new Error();location.replace('/viewer.html?doc='+encodeURIComponent(result.document));}catch{bind(status,'agent.failed');}
