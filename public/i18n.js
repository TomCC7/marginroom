import './vendor/i18next-27.1.1.min.js';
import en from './locales/en.js';
import zhCN from './locales/zh-CN.js';
export const LOCALE_KEY='marginroom.locale.v1';
export const supportedLocale=value=>value==='zh-CN'?'zh-CN':'en';
export function storedLocale(storage){try{return supportedLocale(storage?.getItem(LOCALE_KEY))}catch{return 'en'}}
export function createLocale(storage){
  const engine=globalThis.i18next.createInstance();
  engine.init({resources:{en:{translation:en},'zh-CN':{translation:zhCN}},lng:storedLocale(storage),fallbackLng:'en',supportedLngs:['en','zh-CN'],load:'currentOnly',initImmediate:false,initAsync:false,interpolation:{escapeValue:false},returnNull:false});
  const missing=new Set();
  const t=(key,params={})=>{if(!engine.exists(key,params)){missing.add(key);throw new Error('Missing shell locale key: '+key)}return engine.t(key,params)};
  return {engine,t,missing,get language(){return supportedLocale(engine.language)},async change(value){const locale=supportedLocale(value);await engine.changeLanguage(locale);try{storage?.setItem(LOCALE_KEY,locale)}catch{}return locale}};
}
let storage;try{storage=globalThis.localStorage}catch{}
export const locale=createLocale(storage),t=locale.t;
globalThis.__marginroomLocale=locale;
export const onLocaleChange=fn=>{locale.engine.on('languageChanged',fn);return ()=>locale.engine.off('languageChanged',fn)};
export const date=(value,options={month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})=>new Intl.DateTimeFormat(locale.language,options).format(new Date(value));
export const number=value=>new Intl.NumberFormat(locale.language).format(value);
const bindings=new Map();
export function pruneBindings(){for(const node of bindings.keys())if(!node.isConnected)bindings.delete(node)}
export function unbind(node,attribute='textContent'){bindings.get(node)?.delete(attribute)}
// Explicit product-owned targets only. No traversal of imported source DOM.
export function bind(node,key,params={},attribute='textContent'){
  if(!node)return node;
  if(!bindings.has(node))bindings.set(node,new Map());
  bindings.get(node).set(attribute,{key,params});
  const value=t(key,params);
  if(attribute==='textContent')node.textContent=value;else node.setAttribute(attribute,value);
  return node;
}
export function bindShell(scope){
  pruneBindings();
  for(const node of [scope,...scope.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]')]){
    for(const attribute of ['textContent','title','aria-label','placeholder']){const field=attribute==='textContent'?'data-i18n':'data-i18n-'+attribute,key=node.getAttribute?.(field);if(key)bind(node,key,{},attribute)}
  }
}
function paintBindings(){
  if(globalThis.document)document.documentElement.lang=locale.language;
  for(const [node,attrs] of bindings){if(!node.isConnected){bindings.delete(node);continue}for(const [attribute,{key,params}]of attrs)bind(node,key,params,attribute)}
  for(const select of globalThis.document?.querySelectorAll('[data-locale-select]')||[])select.value=locale.language;
}
onLocaleChange(paintBindings);
export function languageSelect(){
  const select=document.createElement('select');select.dataset.localeSelect='';
  select.className='locale-select';bind(select,'language.label',{},'aria-label');
  for(const [value,key]of [['en','language.english'],['zh-CN','language.chinese']]){const option=document.createElement('option');option.value=value;bind(option,key);select.append(option)}
  select.value=locale.language;select.onchange=()=>locale.change(select.value);
  return select;
}
if(globalThis.document)document.documentElement.lang=locale.language;
