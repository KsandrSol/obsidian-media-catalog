'use strict';
// Read-only search acceptance: no vault path or write command is used.
const fs=require('node:fs'),path=require('node:path'),{execute,errorResult}=require('./catalog-cli.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),results=[];
 for(const kind of ['book','film']){
  const saved=JSON.parse(fs.readFileSync(path.join(root,'checks/plugin-live-'+(kind==='book'?'books':'films')+'.json')));
  for(const row of saved.results){const input={kind,title:row.query?.title||row.title,...(kind==='film'?{year:row.year}:{author:row.query?.author||''})};
   try{const found=await execute('search',input);const expected=kind==='book'?String(row.source_id):row.found.items[0].id;const hit=found.items.find(i=>String(i.id)===expected);results.push({input,expected,accepted:!!hit,items:found.items,warnings:found.warnings});console.log(input.title,hit?'OK '+hit.id:'EXPECTED NOT FOUND');}
   catch(e){results.push({input,accepted:false,...errorResult(e)});console.log(input.title,'FAILED');}
  }
 }
 fs.writeFileSync(path.join(root,'checks/cli-search-0.9.0.json'),JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');if(results.some(r=>!r.accepted))process.exitCode=1;
})().catch(()=>{console.error('Search acceptance failed');process.exitCode=1;});
