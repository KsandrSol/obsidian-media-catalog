'use strict';
// Loads the plugin itself: search, metadata and card formatting have one implementation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os'),{spawn}=require('node:child_process'),yaml=require('yaml');
const root=path.resolve(__dirname,'..');
async function transport({url,headers={}}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'media-http-'));
 const quote=v=>'"'+String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\r\n]/g,'')+'"';
 try{
  const args=['--silent','--show-error','--location','--max-redirs','4','--max-time','25','--max-filesize','8388608','--output',path.join(dir,'body'),'--dump-header',path.join(dir,'headers'),'--write-out','%{http_code}','--config','-'];
  const status=await new Promise((resolve,reject)=>{const p=spawn('curl',args,{stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.resume();p.on('error',()=>reject(new Error('HTTP transport unavailable')));p.on('close',code=>code?reject(new Error('HTTP request failed')):resolve(Number(out)));p.stdin.on('error',()=>{});p.stdin.end('url = '+quote(url)+'\n'+Object.entries(headers).map(([k,v])=>'header = '+quote(k+': '+v)+'\n').join(''));});
  const bytes=fs.readFileSync(path.join(dir,'body')),blocks=fs.readFileSync(path.join(dir,'headers'),'utf8').trim().split(/\r?\n\r?\n/),responseHeaders={};
  for(const line of blocks.at(-1).split(/\r?\n/).slice(1)){const i=line.indexOf(':');if(i>0)responseHeaders[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}
  return {status,headers:responseHeaders,text:bytes.toString(),get json(){return JSON.parse(bytes.toString());},arrayBuffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function loadCore(request=transport){
 class Stub{}
 const notices=[],obsidian={Plugin:Stub,Modal:Stub,ItemView:Stub,Component:Stub,MarkdownRenderChild:Stub,PluginSettingTab:Stub,Notice:class{constructor(message){notices.push(message);}},parseYaml:yaml.parse,stringifyYaml:yaml.stringify,normalizePath:p=>p,requestUrl:request};
 const ctx={module:{exports:{}},require:n=>{if(n==='obsidian')return obsidian;if(n==='./en.json')return JSON.parse(fs.readFileSync(path.join(root,'src/en.json')));throw new Error('Unknown runtime import');},URL,URLSearchParams,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(root,'src/main.js'),'utf8'),ctx);
 return {T:ctx.module.exports._test,notices};
}
function readKey(file=path.join(os.homedir(),'.config/obsidian-media/env')){
 try{const line=fs.readFileSync(file,'utf8').split(/\r?\n/).find(l=>/^\s*(?:export\s+)?KINOPOISK_API_KEY\s*=/.test(l));if(!line)return '';let v=line.slice(line.indexOf('=')+1).trim();if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);else v=v.replace(/\s+#.*$/,'');return v;}catch(e){if(e.code==='ENOENT')return '';throw new Error('Cannot read media credentials');}
}
module.exports={loadCore,transport,readKey};
