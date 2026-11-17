// Feedback is untrusted terminal input. Remove complete ANSI/OSC sequences,
// then remaining C0/C1 controls (except newline/tab), including stray ESC.
export function safe(value){return String(value??'').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g,'').replace(/\x1b[P^_][\s\S]*?(?:\x1b\\|$)/g,'').replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
// The API stores these five HTML entities (server escapeText), exactly once.
const content=value=>safe(String(value??'').replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[entity]));
export function threads(records,{color=Boolean(process.stdout.isTTY)&&!('NO_COLOR'in process.env),width=process.stdout.columns||80}={}){
 const lines=[],counts=new Map();let replies=0;
 for(const r of records){const key=`${safe(r.status)} ${r.kind==='comment'?'comment':r.kind==='rewrite'?'revision':safe(r.kind)}`;counts.set(key,(counts.get(key)||0)+1);replies+=Array.isArray(r.replies)?r.replies.length:0;}
 if(!records.length)return 'No feedback threads match this filter.';
 lines.push([...counts].map(([key,n])=>plural(n,key)).join(' · ')+(replies?' · '+plural(replies,'reply').replace('replys','replies') :''));
 const append=(value,indent='')=>{for(const line of safe(value).split('\n')){let chunk='';for(const char of line){if([...chunk].length>=Math.max(16,width-indent.length)){lines.push(indent+chunk);chunk='';}chunk+=char;}lines.push(indent+chunk);}};
 for(const r of records){lines.push('');const status=`[${safe(r.status)}]`;const title=`${status} ${r.kind==='rewrite'?'Revision':r.kind==='comment'?'Comment':safe(r.kind)} · ${content(r.author)}`;const titleStart=lines.length;append(title);if(color){const i=titleStart;lines[i]=lines[i].replace(status,`\x1b[36m${status}\x1b[0m`);}
 // A legacy whole-block rewrite can carry only a display substring quote.
 // Label the actual field, not an inferred full original or anchoring base_text.
 if(r.kind==='rewrite'){lines.push('Original quote:');append(content(r.quote),'  ');lines.push('Suggested:');append(content(r.body),'  ');}else{if(r.quote)append('“'+content(r.quote)+'”');append(content(r.body),'  ');}
 for(const reply of r.replies||[]){append('↳ '+content(reply.author),'  ');append(content(reply.body),'    ');}lines.push('ID  '+safe(r.id));}
 // IDs intentionally never wrap, so copying retains their complete value.
 return lines.join('\n');
}
export const shellQuote=value=>"'"+safe(value).replaceAll("'","'\\''")+"'";
