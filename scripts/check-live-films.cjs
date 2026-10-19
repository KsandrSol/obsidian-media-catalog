'use strict';
const fs=require('node:fs'),path=require('node:path'),{T,api,calls,root,diskVault}=require('./check-live.cjs');
(async()=>{
 const directory=fs.mkdtempSync(path.join(root,'checks/live-film-covers-')),app={vault:diskVault(directory)},folders={film:'Acceptance/Films'};
 const results=[],provider=process.env.KINOPOISK_API_KEY?'kinopoisk':'wikidata';
 for(const [title,year] of [['Дюна','2021'],['Матрица','1999'],['Мстители','2012'],['Удачи, веселья, не сдохни','2025'],['Брат','1997']]){
  const found=await api.search('film',title,year,provider),row={title,year,provider,found};results.push(row);console.log(title,year,found.items.length,found.warnings.join('; '));
  if(found.items.length){try{const rec=await api.details(found.items[0]);row.fields=rec.fields;if(rec.fields.cover){const local=await T.localCover(app,rec,api,folders);row.coverLink=local.fields.cover;row.savedPath=path.join(directory,row.coverLink.slice(2,-2));row.coverBytes=fs.statSync(row.savedPath).size;}console.log('  cover:',row.coverBytes||'missing');}catch(e){row.detailsError=e.message;}}
 }
 if(results.some(r=>!r.found.items.length||!r.coverBytes||r.detailsError))process.exitCode=1;
 fs.writeFileSync(path.join(root,'checks/plugin-live-films.json'),JSON.stringify({at:new Date().toISOString(),results,calls},null,2)+'\n');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
