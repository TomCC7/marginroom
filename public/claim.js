import {bind,languageSelect} from './i18n.js';
const token=location.hash.slice(1);history.replaceState(null,'','/claim.html');
document.querySelector('main').prepend(languageSelect());const status=document.querySelector('#status');bind(status,'agent.claiming');
const retry=document.createElement('button');retry.type='button';retry.hidden=true;bind(retry,'common.retry');status.after(retry);
async function claim(){
 retry.hidden=true;bind(status,'agent.claiming');
 try{
  const response=await fetch('/api/management/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  const result=await response.json();
  if(response.status===503&&result.error==='maintenance'){bind(status,'errors.maintenance');retry.hidden=false;return;}
  if(!response.ok)throw new Error();
  location.replace('/viewer.html?doc='+encodeURIComponent(result.document));
 }catch{bind(status,'agent.failed');}
}
retry.onclick=claim;await claim();
