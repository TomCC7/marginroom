import en from './locales/en.js';
import zhCN from './locales/zh-CN.js';
import {locale} from './i18n.js';
// Called only inside the generated opaque document. Never changes its lang,
// source nodes, selection or editable HTML. The engine/resources are same-origin
// fetched and inlined, not imported from an opaque origin or fetched from a CDN.
export function frameLocaleRuntime(resources,language){
 const engine=globalThis.i18next.createInstance();
 engine.init({resources,lng:language==='zh-CN'?'zh-CN':'en',fallbackLng:'en',supportedLngs:['en','zh-CN'],load:'currentOnly',initAsync:false,initImmediate:false,interpolation:{escapeValue:false},returnNull:false});
 const listeners=new Set();
 const api={t(key,params){if(!engine.exists(key,params))throw Error('Missing frame locale key: '+key);return engine.t(key,params)},change(value){if(value!=='en'&&value!=='zh-CN')return false;engine.changeLanguage(value);for(const fn of listeners)fn();return true},subscribe(fn){listeners.add(fn)}};
 globalThis.__marginroomLocale=api;
 return api;
}
let runtime;
export async function frameLocaleSource(){
 runtime??=fetch(new URL('./vendor/i18next-27.1.1.min.js',import.meta.url)).then(r=>{if(!r.ok)throw Error('Locale runtime unavailable');return r.text()});
 const safe=v=>JSON.stringify(v).replace(/</g,'\\u003c');
 return await runtime+'\n;('+frameLocaleRuntime.toString()+')('+safe({en:{translation:en},'zh-CN':{translation:zhCN}})+','+safe(locale.language)+');\n';
}
