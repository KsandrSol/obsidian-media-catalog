#!/usr/bin/env node
'use strict';
// JSON on stdin/stdout. Never logs requests, credentials, subprocess stderr or note text.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),yaml=require('yaml');
const {loadCore,transport,readKey}=require('./catalog-runtime.cjs');
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const line=v=>typeof v==='string'?v.replace(/[\r\n]/g,' ').trim():'';
const titleKey=v=>line(v).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const ERRORS={invalid_input:"Проверьте название и параметры позиции.",busy:"Каталог занят; повторите позже.",card_changed:"Карточка изменилась; обновите выбор.",not_found:"Карточка или каталог не найдены.",network:"Источник временно недоступен; попробуйте позже.",write_failed:"Не удалось сохранить данные каталога."};
class CliError extends Error{constructor(code,message){super(message||ERRORS[code]);this.code=code;}}
function errorResult(e){const code=e instanceof CliError&&Object.hasOwn(ERRORS,e.code)?e.code:e?.code==='ENOENT'?'not_found':'write_failed';return {ok:false,code,error:ERRORS[code]};}
function lockPath(root,dir=path.join(os.tmpdir(),'media-catalog-locks-'+process.getuid())){fs.mkdirSync(dir,{recursive:true,mode:0o700});return path.join(dir,digest(root)+'.lock');}
async function acquireLock(root,{lockDir,lockWait=30000}={}){
 const file=lockPath(root,lockDir),token=crypto.randomUUID(),deadline=Date.now()+lockWait;
 while(true){
  const temporary=file+'.'+token+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});fs.linkSync(temporary,file);break;}
  catch(e){if(e.code!=='EEXIST')throw new CliError('write_failed');
   try{const stat=fs.statSync(file);let dead=false;try{const owner=JSON.parse(fs.readFileSync(file,'utf8'));if(Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(err){dead=err.code==='ESRCH';}}}catch{}
    if(dead||Date.now()-stat.mtimeMs>120000){if(fs.statSync(file).ino===stat.ino)fs.unlinkSync(file);continue;}
   }catch(e){if(e.code==='ENOENT')continue;}
   if(Date.now()>=deadline)throw new CliError('busy');await new Promise(r=>setTimeout(r,100));
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 }
 const owned=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8')).token===token;}catch{return false;}};
 const heartbeat=setInterval(()=>{if(owned())try{const now=new Date();fs.utimesSync(file,now,now);}catch{}},20000);heartbeat.unref();
 return {assert(){if(!owned())throw new CliError('busy');},release(){clearInterval(heartbeat);if(owned())fs.unlinkSync(file);}};
}
function diskVault(directory){
 const root=fs.realpathSync(directory),entries=new Map();
 function resolve(p){if(!p||path.isAbsolute(p)||p.split(/[\\/]/).some(x=>!x||x==='.'||x==='..'))throw new CliError('invalid_input', 'Invalid vault path');const target=path.join(root,p);let current=root;for(const part of p.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new CliError('invalid_input', 'Symlink in catalog path');}return target;}
 function entry(p){const target=resolve(p);if(!fs.existsSync(target))return null;const stat=fs.statSync(target);if(!entries.has(p))entries.set(p,{path:p,basename:path.basename(p,path.extname(p)),extension:path.extname(p).slice(1)});const e=entries.get(p);if(stat.isDirectory())e.children=fs.readdirSync(target).filter(n=>!n.startsWith('.')).map(n=>entry(p+'/'+n)).filter(Boolean);return e;}
 function atomic(p,data,expected){const target=resolve(p);fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.'+crypto.randomUUID()+'.tmp';try{const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(expected===undefined){fs.linkSync(tmp,target);}else{if(fs.readFileSync(target,'utf8')!==expected)throw new CliError('card_changed', 'Card changed; retry');fs.renameSync(tmp,target);}}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}return entry(p);}
 return {root,resolve,atomic,getAbstractFileByPath:entry,read:async f=>fs.readFileSync(resolve(f.path),'utf8'),async create(p,s){return this.atomic(p,s);},createFolder:async p=>fs.mkdirSync(resolve(p),{recursive:true}),async createBinary(p,b){return this.atomic(p,Buffer.from(b));},readBinary:async f=>{const b=fs.readFileSync(resolve(f.path));return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);}};
}
function patchText(raw,patch){const m=raw.match(/^(\ufeff?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);if(!m)throw new CliError('not_found', 'Missing frontmatter');const doc=yaml.parseDocument(m[2]);if(doc.errors.length||!yaml.isMap(doc.contents))throw new CliError('invalid_input', 'Invalid frontmatter');for(const [k,v] of Object.entries(patch))doc.set(k,v);return m[1]+doc.toString().trimEnd()+m[3]+raw.slice(m[0].length);}
function provenance(fm,input){const patch={};if((fm.found_via==null||typeof fm.found_via==='string'&&!fm.found_via.trim())&&line(input.found_via))patch.found_via=line(input.found_via);if(input.collections!=null){if(!Array.isArray(input.collections)||input.collections.some(v=>typeof v!=='string'||!/^\[\[[^\[\]\r\n]+\]\]$/.test(v)))throw new CliError('invalid_input', 'Invalid collections');if(fm.collections!=null&&!Array.isArray(fm.collections))throw new CliError('invalid_input', 'Invalid stored collections');const next=[...new Set([...(fm.collections||[]),...input.collections])];if(JSON.stringify(next)!==JSON.stringify(fm.collections||[]))patch.collections=next;}return patch;}
function personalPatch(T,kind,input){const patch={};for(const [k,v] of Object.entries(input||{})){if(k==='status'){if(T.statusCode(v)==='other')throw new CliError('invalid_input', 'Invalid status');patch.status=T.statusLabel(kind,T.statusCode(v),'ru').toLowerCase();}else if(k==='rating'){if(!Number.isInteger(v)||v<1||v>10)throw new CliError('invalid_input', 'Invalid rating');patch.rating=v;}else if(k==='review'){if(typeof v!=='string'||/[\r\n]/.test(v))throw new CliError('invalid_input', 'Invalid review');patch.review=v;}else if(['started','finished'].includes(k)){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new CliError('invalid_input', 'Invalid date');patch[k]=v;}else throw new CliError('invalid_input', 'Unsupported personal field');}return patch;}
async function execute(command,input,options={}){
 const {T,notices}=loadCore(options.transport||transport),api=new T.Api(k=>k==='kinopoisk'?(options.key??readKey()):'',options.transport||transport,options.delay|| (ms=>new Promise(r=>setTimeout(r,ms))));
 if(!input||typeof input!=='object'||!['film','book'].includes(input.kind))throw new CliError('invalid_input', 'kind must be film or book');
 if(command==='search'){if(input.year!=null&&input.year!==''&&(!/^\d{4}$/.test(String(input.year))))throw new CliError('invalid_input');if(!line(input.title))throw new CliError('invalid_input');let result;try{result=await api.search(input.kind,line(input.title),line(String(input.year||'')),input.provider||'auto',line(input.author));}catch{throw new CliError('network');}if(!result.items.length&&result.warnings.length)throw new CliError('network');return {items:JSON.parse(JSON.stringify(result.items)),warnings:result.warnings.length?['Источник временно недоступен.']:[]};}
 if(!['add','replace'].includes(command)||!input.vault)throw new CliError('invalid_input', 'Expected search, add or replace and a vault for writing');
 // All writes below are explicit CLI invocations, never a side effect of search.
 const vault=diskVault(input.vault),lease=await acquireLock(vault.root,options);
 const atomic=vault.atomic;vault.atomic=(...args)=>{lease.assert();return atomic(...args);};
 try{
  const personal=personalPatch(T,input.kind,input.personal),folders={...T.FOLDERS},app={vault};let rec;
  let selected=null;
  const candidates=command==='replace'?(input.candidate?[input.candidate]:[]):(input.candidates??(input.candidate?[input.candidate]:[]));
  if(!Array.isArray(candidates)||candidates.some(c=>!c||c.kind!==input.kind||!['chitai','openlibrary','google','wikidata','kinopoisk','tmdb'].includes(c.source)||!/^[-\w:/]+$/.test(String(c.id))))throw new CliError('invalid_input', 'Invalid candidates');
  for(const c of candidates){try{rec=await api.details(c);selected=c;break;}catch{}}
  if(candidates.length&&!rec){if(command==='replace')throw new CliError('network', 'Candidate unavailable; original kept');notices.push('Метаданные недоступны; сохранена незаполненная карточка.');}
  if(!rec){const title=line(input.title);if(!title)throw new CliError('invalid_input', 'Title required');rec={kind:input.kind,source:'manual',source_id:digest(JSON.stringify([input.kind,titleKey(title),input.year||'',input.author||''])).slice(0,20),description:'',fields:{title,year:T.sortNumber(input.year,'year'),...(input.kind==='book'?{author:line(input.author)?[line(input.author)]:[]}:{}),source_url:''}};}
  const found=await T.duplicateFiles(app,rec,folders);let existing=found.matches[0];
  if(!existing)existing=found.similar.find(f=>{const fm=T.frontmatter(fs.readFileSync(vault.resolve(f.path),'utf8'));return (!rec.fields.year||!fm.year||String(fm.year)===String(rec.fields.year))&&(input.kind!=='book'||!line(input.author)||!fm.author||titleKey(String(fm.author).replace(/\[\[|\]\]/g,'')).includes(titleKey(input.author)));});
  const old=command==='replace'?vault.getAbstractFileByPath(input.path):null;
  if(command==='replace'&&(!old||!old.path.startsWith(folders[input.kind]+'/')))throw new CliError('not_found', 'Original card missing');
  if(command==='replace'&&digest(await vault.read(old))!==input.expected)throw new CliError('card_changed', 'Card changed; original kept');
  let file,wasExisting=false;
  if(existing&&existing!==old){file=existing;wasExisting=true;const raw=await vault.read(file),fm=T.frontmatter(raw),patch={...provenance(fm,input),...personal};if(Object.keys(patch).length)vault.atomic(file.path,patchText(raw,patch),raw);}
  else if(command==='replace'){
    const raw=await vault.read(old),fm=T.frontmatter(raw);if(fm.type!==input.kind)throw new CliError('invalid_input', 'Wrong card type');
    try{rec=await T.localCover(app,rec,api,folders);}catch{delete rec.fields.cover;notices.push('Обложка не сохранена.');}
    const empty='---\ntype: '+input.kind+'\n---\n',fields=T.metadataPatch(empty,rec),previous=T.metadataPatch(empty,{...rec,fields:fm,description:fm.summary||''});const patch={...Object.fromEntries(Object.keys(previous).filter(k=>!['type','source','source_id'].includes(k)).map(k=>[k,null])),...fields,source:rec.source,source_id:rec.source_id,...provenance(fm,input)};
    vault.atomic(old.path,patchText(raw,patch),raw);file=old;
  }else{
    await T.ensureFolder(vault,folders[input.kind]);try{rec=await T.localCover(app,rec,api,folders);}catch{rec.fields.cover=null;notices.push('Обложка не сохранена.');}
    const base=T.safeName(rec.fields.title)+(input.kind==='film'&&rec.fields.year?' ('+rec.fields.year+')':'');let name=folders[input.kind]+'/'+base+'.md';if(vault.getAbstractFileByPath(name))name=folders[input.kind]+'/'+base+' — '+rec.source_id.replace(/[^\w-]/g,'').slice(-12)+'.md';
    const raw=T.cardText(rec),patch={...provenance({},input),...personal};file=await vault.create(name,patchText(raw,patch));
  }
  const raw=await vault.read(file),fm=T.frontmatter(raw);return {candidate:selected,path:file.path,title:line(fm.title)||file.basename,year:fm.year,status:line(fm.status)||'без статуса',existing:wasExisting,hash:digest(raw),warnings:notices,previous_kept:command==='replace'&&file!==old?old.path:null};
 }finally{lease.release();}
}
module.exports={execute,diskVault,patchText,acquireLock,lockPath,errorResult,CliError};
if(require.main===module)(async()=>{try{let raw='';for await(const b of process.stdin){raw+=b;if(raw.length>1024*1024)throw new CliError('invalid_input', 'Input too large');}let input;try{input=JSON.parse(raw);}catch{throw new CliError('invalid_input');}const result=await execute(process.argv[2],input);process.stdout.write(JSON.stringify({ok:true,...result})+'\n');}catch(e){process.stdout.write(JSON.stringify(errorResult(e))+'\n');process.exitCode=1;}})();
