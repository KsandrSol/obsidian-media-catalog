'use strict';
const fs=require('node:fs'),path=require('node:path'),{api,calls,root}=require('./check-live.cjs');
(async()=>{
 const results=[],provider=process.env.KINOPOISK_API_KEY?'kinopoisk':'wikidata';
 for(const [title,year] of [['Дюна','2021'],['Матрица','1999'],['Мстители','2012'],['Удачи, веселья, не сдохни','2025'],['Брат','1997']]){
  const found=await api.search('film',title,year,provider),row={title,year,provider,found};results.push(row);console.log(title,year,found.items.length,found.warnings.join('; '));
  if(found.items.length){try{const rec=await api.details(found.items[0]);row.fields=rec.fields;if(rec.fields.cover)row.coverBytes=(await api.cover(rec.fields.cover)).data.byteLength;}catch(e){row.detailsError=e.message;}}
 }
 fs.writeFileSync(path.join(root,'checks/plugin-live-films.json'),JSON.stringify({at:new Date().toISOString(),results,calls},null,2)+'\n');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
