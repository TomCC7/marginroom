// Trusted process configuration only. Never read policy from an import payload.
export const IMPORT_ENV = ['MMW_IMPORT_FILE_BYTES','MMW_IMPORT_TOTAL_BYTES','MMW_IMPORT_FILES'];
export function importLimits(env=process.env) {
 const defaults=[16_000_000,64_000_000,1024],maximum=[64_000_000,256_000_000,4096];
 const values=IMPORT_ENV.map((key,i)=>{
  const raw=env[key];if(raw===undefined)return defaults[i];
  if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>maximum[i])throw Object.assign(new Error(`invalid_import_config:${key}:expected_integer_1_to_${maximum[i]}`),{code:'invalid_import_config'});
  return Number(raw);
 });
 const [file,total,count]=values;if(file>total)throw Object.assign(new Error('invalid_import_config:file_exceeds_total'),{code:'invalid_import_config'});
 // Base64 plus bounded path/digest/JSON overhead. This is an admission cap, not decoded permission.
 return Object.freeze({file,total,count,body:4*Math.ceil(total/3)+count*2048+65536});
}
export const BUNDLE_LIMITS=importLimits({});
export function importLimitEnv(env=process.env){importLimits(env);return Object.fromEntries(IMPORT_ENV.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));}
