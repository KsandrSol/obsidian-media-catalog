'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),yaml=require('yaml');
const {execute}=require('../scripts/catalog-cli.cjs'),{loadCore,readKey}=require('../scripts/catalog-runtime.cjs');
const options={key:'',transport:async()=>{throw new Error('offline');},delay:async()=>{}};
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'media-cli-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const fm=(dir,p)=>yaml.parse(fs.readFileSync(path.join(dir,p),'utf8').split('---')[1]);
test('CLI fallback cards, duplicate provenance and explicit impressions use the shared card format',async t=>{
 const vault=temporary(t),input={vault,kind:'book',title:'Психология влияния',author:'Роберт Чалдини',found_via:'Канал A',collections:['[[Areas/Личное/Подборки/Книги]]']};
 const a=await execute('add',input,options);assert.equal(a.existing,false);const raw=fs.readFileSync(path.join(vault,a.path),'utf8');assert.equal(fm(vault,a.path).status,'хочу прочитать');assert.equal(fm(vault,a.path).review,'');
 const b=await execute('add',{...input,found_via:'Канал B',collections:[...input.collections,'[[Другая подборка]]']},options);assert.equal(b.path,a.path);assert.equal(b.existing,true);assert.equal(fm(vault,a.path).found_via,'Канал A');assert.equal(fm(vault,a.path).collections.length,2);assert.equal(fs.readFileSync(path.join(vault,a.path),'utf8').split('---').slice(2).join('---'),raw.split('---').slice(2).join('---'));
 await execute('add',{...input,personal:{status:'прочитано',rating:8,review:'Затянуто',finished:'2026-10-18'}},options);assert.equal(fm(vault,a.path).rating,8);assert.equal(fm(vault,a.path).status,'прочитано');
 const before=fs.readFileSync(path.join(vault,a.path),'utf8');await execute('add',input,options);assert.equal(fs.readFileSync(path.join(vault,a.path),'utf8'),before);assert.equal(fs.existsSync(path.join(vault,'.media-catalog.lock')),false);
});
test('CLI calls actual Api with mocked Wikimedia transport and saves the cover locally',async t=>{
 const vault=temporary(t),requests=[],opts={key:'',delay:async()=>{},transport:async r=>{requests.push(r.url);const u=new URL(r.url);if(u.hostname==='upload.wikimedia.org')return {status:200,arrayBuffer:Uint8Array.from([255,216,255,224]).buffer};if(u.hostname.endsWith('.wikipedia.org'))return {status:200,json:{query:{pages:{1:{title:'Матрица',pageprops:{wikibase_item:'Q83495'},thumbnail:{source:'https://upload.wikimedia.org/poster.jpg'}}}}}};if(u.searchParams.get('action')==='wbsearchentities')return {status:200,json:{search:[{id:'Q83495'}]}};return {status:200,json:{entities:{Q83495:{id:'Q83495',labels:{ru:{value:'Матрица'}},claims:{P31:[{mainsnak:{snaktype:'value',datavalue:{value:{id:'Q11424'}}}}],P577:[{mainsnak:{snaktype:'value',datavalue:{value:{time:'+1999-01-01T00:00:00Z'}}}}]},sitelinks:{ruwiki:{title:'Матрица'}}}}}};}};
 const found=await execute('search',{kind:'film',title:'Матрица',year:1999},opts);assert.equal(found.items[0].id,'Q83495');
 const a=await execute('add',{vault,kind:'film',title:'Матрица',year:1999,candidate:found.items[0]},opts),fields=fm(vault,a.path);assert.match(fields.cover,/^\[\[Areas\/Личное\/Кино\/Обложки\//);assert.equal(fs.readFileSync(path.join(vault,fields.cover.slice(2,-2))).length,4);
 const b=await execute('add',{vault,kind:'film',title:'Матрица',candidate:found.items[0]},opts);assert.equal(a.path,b.path);assert.equal(b.existing,true);assert.ok(requests.some(u=>u.includes('wbsearchentities')));
 await assert.rejects(execute('replace',{vault,kind:'film',title:'Матрица',candidate:found.items[0],path:a.path,expected:'wrong'},opts),/changed/);
});
test('CLI refuses escaped/symlink paths and malformed personal values without changes',async t=>{
 const vault=temporary(t),outside=temporary(t);fs.symlinkSync(outside,path.join(vault,'Areas'));
 await assert.rejects(execute('add',{vault,kind:'book',title:'Книга'},options),/Symlink/);assert.deepEqual(fs.readdirSync(outside),[]);
 await assert.rejects(execute('add',{vault:outside,kind:'book',title:'Книга',personal:{rating:11}},options),/rating/);
});
test('provenance is personal in plugin metadata filling and present in Base templates',()=>{
 const {T}=loadCore();for(const kind of ['book','film']){const rec={kind,source:'manual',source_id:'1',fields:{title:'Книга',found_via:'source',collections:['[[source]]']}};for(const value of ['', 'Свой источник']){const patch=T.metadataPatch('---\ntype: '+kind+'\nfound_via: '+JSON.stringify(value)+'\ncollections: []\n---\n',rec);assert.equal(Object.hasOwn(patch,'found_via'),false);assert.equal(Object.hasOwn(patch,'collections'),false);}const base=yaml.parse(T.baseText(kind,T.FOLDERS[kind]));assert.equal(base.properties.found_via.displayName,'Откуда узнал');assert.equal(base.properties.collections.displayName,'Подборки');}
});
test('credential file parsing is optional and does not require shell execution',t=>{const dir=temporary(t),file=path.join(dir,'env');assert.equal(readKey(file),'');fs.writeFileSync(file,'export KINOPOISK_API_KEY="test-key"\n');assert.equal(readKey(file),'test-key');});

test('locks live outside vault, expire after two minutes or a dead pid, and never remove another owner',async t=>{
 const {acquireLock,lockPath}=require('../scripts/catalog-cli.cjs'),vault=temporary(t),lockDir=temporary(t),file=lockPath(vault,lockDir);
 const first=await acquireLock(vault,{lockDir,lockWait:0});assert.deepEqual(fs.readdirSync(vault),[]);await assert.rejects(acquireLock(vault,{lockDir,lockWait:0}),e=>e.code==='busy');first.release();
 fs.writeFileSync(file,JSON.stringify({pid:2147483647,token:'dead'}));const recovered=await acquireLock(vault,{lockDir,lockWait:0});recovered.release();
 fs.writeFileSync(file,JSON.stringify({pid:process.pid,token:'old'}));const old=new Date(Date.now()-121000);fs.utimesSync(file,old,old);const expired=await acquireLock(vault,{lockDir,lockWait:0});
 fs.writeFileSync(file,JSON.stringify({pid:process.pid,token:'other'}));assert.throws(()=>expired.assert(),e=>e.code==='busy');expired.release();assert.equal(JSON.parse(fs.readFileSync(file)).token,'other');
});
test('safe error codes never expose plugin, subprocess or credential text',async t=>{
 const {errorResult,CliError}=require('../scripts/catalog-cli.cjs');for(const code of ['invalid_input','busy','card_changed','not_found','network','write_failed']){const out=errorResult(new CliError(code,'secret-key'));assert.equal(out.code,code);assert.equal(JSON.stringify(out).includes('secret-key'),false);}
 assert.equal(errorResult(new Error('curl secret-key')).code,'write_failed');assert.equal(JSON.stringify(errorResult(new Error('curl secret-key'))).includes('secret-key'),false);
 await assert.rejects(execute('search',{kind:'book',title:''},options),e=>e.code==='invalid_input');await assert.rejects(execute('search',{kind:'film',title:'Матрица'},options),e=>e.code==='network');
 const vault=temporary(t);await assert.rejects(execute('add',{vault,kind:'film',title:''},options),e=>e.code==='invalid_input');
});

test('explicit replacement keeps personal properties, body and path, clears stale source IDs',async t=>{
 const vault=temporary(t),initial=await execute('add',{vault,kind:'film',title:'Ошибочный фильм',personal:{rating:8,review:'Мой текст',status:'просмотрено'},found_via:'Канал',collections:['[[Подборка]]']},options);
 let raw=fs.readFileSync(path.join(vault,initial.path),'utf8').replace('type: film','type: film\ntmdb_id: 999\ncustom: keep');fs.writeFileSync(path.join(vault,initial.path),raw);const hash=require('node:crypto').createHash('sha256').update(raw).digest('hex');
 const transport=async()=>({status:200,json:{entities:{Q1:{id:'Q1',labels:{ru:{value:'Правильный фильм'}},claims:{P31:[{mainsnak:{snaktype:'value',datavalue:{value:{id:'Q11424'}}}}]}}}}});
 const changed=await execute('replace',{vault,kind:'film',title:'Правильный фильм',candidate:{kind:'film',source:'wikidata',id:'Q1'},path:initial.path,expected:hash},{...options,transport});
 const fields=fm(vault,changed.path);assert.equal(changed.path,initial.path);assert.equal(fields.title,'Правильный фильм');assert.equal(fields.rating,8);assert.equal(fields.review,'Мой текст');assert.equal(fields.status,'просмотрено');assert.equal(fields.custom,'keep');assert.equal(fields.tmdb_id,null);assert.equal(fields.found_via,'Канал');assert.deepEqual(fields.collections,['[[Подборка]]']);assert.equal(fs.readFileSync(path.join(vault,changed.path),'utf8').split('---').slice(2).join('---'),raw.split('---').slice(2).join('---'));
});

test('CLI executable emits safe JSON and concurrent add processes create one card',async t=>{
 const {spawn}=require('node:child_process'),vault=temporary(t),cli=path.resolve(__dirname,'../scripts/catalog-cli.cjs');
 const run=(command,input)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,command],{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',()=>{try{assert.equal(err,'');resolve(JSON.parse(out));}catch(e){reject(e);}});p.stdin.end(JSON.stringify(input));});
 const invalid=await run('search',{kind:'book',title:''});assert.equal(invalid.code,'invalid_input');assert.equal(invalid.ok,false);
 const input={vault,kind:'book',title:'Илиада',author:'Гомер',found_via:'Источник'};
 const results=await Promise.all([run('add',input),run('add',input)]);assert.ok(results.every(r=>r.ok));assert.equal(results[0].path,results[1].path);assert.equal(results.filter(r=>r.existing).length,1);assert.equal(fs.existsSync(path.join(vault,'.media-catalog.lock')),false);
});

test('duplicate legacy card with no status is returned without changing it',async t=>{
 const vault=temporary(t),input={vault,kind:'book',title:'Илиада'},a=await execute('add',input,options),file=path.join(vault,a.path);const raw=fs.readFileSync(file,'utf8').replace(/^status:.*\n/m,'');fs.writeFileSync(file,raw);const b=await execute('add',input,options);assert.equal(b.existing,true);assert.equal(b.status,'без статуса');assert.equal(fs.readFileSync(file,'utf8'),raw);
});
