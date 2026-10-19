'use strict';
// Executes the plugin's real search/detail/download code, without writing to the vault.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),yaml=require('yaml');
const root=path.resolve(__dirname,'..'),calls=[];
fs.mkdirSync(path.join(root,'checks'),{recursive:true});
async function transport({url,headers={}}){
 const args=['--location','--silent','--show-error','--max-time','25','--write-out','\n%{http_code} %{content_type}'];
 for(const [name,value] of Object.entries(headers))args.push('-H',name+': '+value);
 args.push(url);const {stdout}=await promisify(execFile)('curl',args,{encoding:'buffer',maxBuffer:8*1024*1024}),cut=stdout.lastIndexOf(10),data=stdout.subarray(0,cut),trailer=stdout.subarray(cut+1).toString(),status=Number(trailer.split(' ')[0]),contentType=trailer.slice(trailer.indexOf(' ')+1);
 calls.push({url,status,contentType,bytes:data.length,signature:data.subarray(0,32).toString('hex'),at:new Date().toISOString()});
 if(new URL(url).hostname.endsWith('.img-gorod.ru'))fs.writeFileSync(path.join(root,'checks','cover-response-'+(calls.length)+'.bin'),data);
 return {status,headers:{'content-type':contentType},text:data.toString(),get json(){return JSON.parse(data.toString());},arrayBuffer:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};
}
class Stub {}
const obsidian={Plugin:Stub,Modal:Stub,ItemView:Stub,Component:Stub,MarkdownRenderChild:Stub,PluginSettingTab:Stub,parseYaml:yaml.parse,stringifyYaml:yaml.stringify,normalizePath:v=>v,requestUrl:transport};
const context={module:{exports:{}},require:n=>n==='obsidian'?obsidian:JSON.parse(fs.readFileSync(path.join(root,'src/en.json'))),URL,URLSearchParams,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(path.join(root,'src/main.js'),'utf8'),context);
const T=context.module.exports._test,api=new T.Api(name=>name==='kinopoisk'?process.env.KINOPOISK_API_KEY||'':'',transport);
function diskVault(directory){
 const entries=new Map();
 return {getAbstractFileByPath(p){if(entries.has(p))return entries.get(p);const target=path.join(directory,p);if(!fs.existsSync(target))return null;const entry=fs.statSync(target).isDirectory()?{path:p,children:[]}:{path:p,extension:path.extname(p).slice(1)};entries.set(p,entry);return entry;},
 async createFolder(p){fs.mkdirSync(path.join(directory,p),{recursive:true});},
 async createBinary(p,data){fs.writeFileSync(path.join(directory,p),Buffer.from(data),{flag:'wx'});return this.getAbstractFileByPath(p);},
 async readBinary(f){const b=fs.readFileSync(path.join(directory,f.path));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}};
}
async function main(){
 const directory=fs.mkdtempSync(path.join(root,'checks/live-covers-')),coverApp={vault:diskVault(directory)},folders={book:'Acceptance/Books',film:'Acceptance/Films'};
 const books=[['Илиада','2995811'],['Новая версия — Измени себя, не изменяя себе','3172593'],['Программист-прагматик','2797753'],['Психология влияния','2898239'],['Цель','3106654']],results=[];
 for(const [name,id] of books){
  const raw=fs.readFileSync('/home/ksandrsol/obsidian/Areas/Личное/Книги/'+name+'.md','utf8'),file={path:'Books/'+name+'.md',basename:name,extension:'md'},folder={path:'Books',children:[file]},app={vault:{getAbstractFileByPath:p=>p==='Books'?folder:file,read:async()=>raw}};
  const {rows}=await T.scanNotes({app,t:v=>v},'Books','book'),row=rows[0],found=await api.search('book',row.bookQuery),item=found.items.find(i=>i.source==='chitai'&&i.id===id);
  if(!item)throw new Error(name+': expected edition missing: '+JSON.stringify(found));
  const rec=await api.details(item),patch=T.metadataPatch(raw,rec),rowResult={title:name,query:row.bookQuery,source:rec.source,source_id:rec.source_id,fields:rec.fields,patch};
  try{const local=await T.localCover(coverApp,rec,api,folders),link=local.fields.cover;
   if(!link?.startsWith('[[Acceptance/Books/Обложки/'))throw new Error('Cover link does not use the configured folder');
   const savedPath=path.join(directory,link.slice(2,-2)),saved=fs.readFileSync(savedPath);
   if(!saved.length||saved.length>150*1024)throw new Error('Invalid saved cover size');
   const roundtrip=yaml.parse(T.cardText(local).split('---')[1]);if(roundtrip.cover!==link)throw new Error('Cover link did not survive YAML');
   Object.assign(rowResult,{coverBytes:saved.length,coverLink:link,savedPath,signature:saved.subarray(0,32).toString('hex')});
  }catch(e){rowResult.coverWarning=e.message;}
  results.push(rowResult);
  console.log(name,rec.fields.author.join(', '),rec.fields.year,rowResult.coverBytes?rowResult.coverBytes+' bytes':'cover warning: '+rowResult.coverWarning);
 }
 if(results.some(r=>r.coverWarning))process.exitCode=1;
 fs.writeFileSync(path.join(root,'checks/plugin-live-books.json'),JSON.stringify({at:new Date().toISOString(),results,calls},null,2)+'\n');
}
module.exports={T,api,transport,calls,root};
if(require.main===module)main().catch(e=>{fs.writeFileSync(path.join(root,'checks/plugin-live-error.json'),JSON.stringify({error:e.message,calls},null,2));console.error(e.message);process.exitCode=1;});
