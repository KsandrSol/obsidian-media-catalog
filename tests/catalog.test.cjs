'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),yaml=require('yaml');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
class El {
  constructor(tag='div',options={}){this.tag=tag;this.children=[];this.events={};this.attrs={};this.value='';this.classes=[];this.textContent=options.text||'';if(options.cls)this.classes.push(options.cls);Object.assign(this.attrs,options.attr);}
  createEl(tag,options={}){const el=new El(tag,options);this.children.push(el);return el;}
  createDiv(options={}){return this.createEl('div',options);}
  addClass(value){this.classes.push(value);}
  setText(value){this.textContent=value;}
  setAttribute(k,v){this.attrs[k]=v;}
  focus(){this.focused=true;}
  empty(){this.children=[];this.textContent='';}
  addEventListener(k,fn){(this.events[k]||=[]).push(fn);}
  removeEventListener(k,fn){this.events[k]=(this.events[k]||[]).filter(f=>f!==fn);}
  async fire(k){for(const fn of this.events[k]||[])await fn({target:this});}
  find(tag){return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.find(tag)]);}
}
class Component {
  constructor(){this.components=[];this.disposals=[];this.loaded=false;}
  load(){if(this.loaded)return;this.loaded=true;this.onload?.();for(const c of this.components)c.load();}
  unload(){if(!this.loaded)return;this.loaded=false;for(const c of this.components)c.unload();for(const fn of this.disposals.splice(0))fn();this.onunload?.();}
  addChild(c){this.components.push(c);if(this.loaded)c.load();return c;}
  removeChild(c){c.unload();this.components=this.components.filter(x=>x!==c);return c;}
  registerDomEvent(el,event,fn){el.addEventListener(event,fn);this.disposals.push(()=>el.removeEventListener(event,fn));}
}
function environment(options={}) {
  const notices=[],renders=[],storage=new Map();
  class Modal extends Component {constructor(app){super();this.app=app;this.contentEl=new El();}open(){this.onOpen();}close(){this.onClose();}}
  class ItemView extends Component {constructor(leaf){super();this.app=leaf.app;this.leaf=leaf;this.contentEl=new El();}async setState() {}}
  class MarkdownRenderChild extends Component {constructor(containerEl){super();this.containerEl=containerEl;}}
  class Plugin extends Component {constructor(app){super();this.app=app;this.commands=[];this.data=null;this.icons=[];}async loadData(){return this.data;}async saveData(data){this.data=data;}registerView(type,fn){this.viewType=type;this.viewFactory=fn;}addCommand(c){this.commands.push(c);}addRibbonIcon(icon,title,cb){this.icons.push({icon,title,cb});}registerMarkdownCodeBlockProcessor(type,cb){this.processor={type,cb};}addSettingTab(tab){this.settings=tab;}}
  class PluginSettingTab {constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=new El();}}
  class Setting {constructor(el){this.element=el;}setName(){return this;}setDesc(){return this;}setHeading(){return this;}addText(fn){const t={inputEl:new El('input'),setValue(v){this.inputEl.value=v;return this;},onChange(cb){this.change=cb;return this;}};fn(t);return this;}addButton(fn){const b={setButtonText(){return this;},onClick(){return this;}};fn(b);return this;}}
  const api={Plugin,Modal,ItemView,Component,MarkdownRenderChild,PluginSettingTab,Setting,Notice:class {constructor(msg){notices.push(msg);}},MarkdownRenderer:{async render(...args){renders.push(args);if(options.renderError)throw new Error('missing Bases');}},parseYaml:yaml.parse,stringifyYaml:yaml.stringify,normalizePath:p=>p.replace(/\/+/g,'/'),requestUrl:options.transport||async function(){throw new Error('offline');}};
  const sandbox={module:{exports:{}},require:name=>{assert.equal(name,'obsidian');return api;},URL,URLSearchParams,window:{localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}};
  const callbacks=new Map();let timerId=0;
  sandbox.setTimeout=function(fn,ms){'use strict';if(this!==undefined&&this!==sandbox)throw new TypeError('Illegal invocation');if(options.controlled){const id=++timerId;callbacks.set(id,fn);return id;}return setTimeout(fn,ms);};
  sandbox.clearTimeout=function(id){'use strict';if(this!==undefined&&this!==sandbox)throw new TypeError('Illegal invocation');if(options.controlled)callbacks.delete(id);else clearTimeout(id);};
  vm.runInNewContext(source,sandbox,{filename:'plugin.js'});
  return {Plugin:sandbox.module.exports,T:sandbox.module.exports._test,notices,renders,storage,callbacks,api};
}
function appFixture(initial={}) {
  const entries=new Map([['',{path:'',children:[]}]]),content=new Map(),writes=[],opened=[];
  const attach=(entry)=>{const parent=entry.path.split('/').slice(0,-1).join('/');entries.get(parent).children.push(entry);entries.set(entry.path,entry);};
  const folder=p=>{if(!p||entries.has(p))return;folder(p.split('/').slice(0,-1).join('/'));attach({path:p,children:[]});};
  const file=(p,value)=>{folder(p.split('/').slice(0,-1).join('/'));const name=p.split('/').at(-1),extension=name.split('.').at(-1);const f={path:p,name,basename:name.slice(0,-extension.length-1),extension};attach(f);content.set(p,value);return f;};
  for(const [p,raw] of Object.entries(initial))file(p,raw);
  const app={vault:{getName:()=> 'Fixture',getAbstractFileByPath:p=>entries.get(p)||null,getMarkdownFiles:()=>{throw new Error('Full-vault scanning is prohibited in this test');},async read(f){if(!content.has(f.path))throw new Error('not found');return content.get(f.path);},async createFolder(p){if(entries.has(p))throw new Error('exists');writes.push({kind:'folder',path:p});folder(p);},async create(p,raw){if(entries.has(p))throw new Error('exists');writes.push({kind:'create',path:p});return file(p,raw);}},workspace:{getLeaf(){return {openFile:async f=>opened.push(f.path)};},getLeavesOfType:()=>[],requestSaveLayout(){},async revealLeaf() {}}};
  return {app,entries,content,writes,opened,file,folder};
}
const fm=fields=>'---\n'+yaml.stringify(fields)+'---\n\nManual body stays here.\n';
const record=(kind='film')=>({kind,source:kind==='film'?'tmdb':'openlibrary',source_id:'123',description:'Description',fields:{title:'Example',year:2025,source_url:'https://example.org/item/123',...(kind==='film'?{tmdb_id:123}:{isbn:['9780306406157']})}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));

test('browser timer receiver: repeated input clears correctly, publishes and closes',async()=>{
  const e=environment({controlled:true}),states=[];
  const c=new e.T.SearchController(async()=>({items:[{title:'result'}]}),s=>states.push(s.state));
  c.input('one');c.input('two');assert.equal(e.callbacks.size,1);
  await [...e.callbacks.values()][0]();assert.deepEqual(states,['waiting','waiting','loading','done']);
  c.input('three');c.close();assert.equal(e.callbacks.size,1); // previously fired mock timer retained
  assert.equal(c.closed,true);
});
test('stale search result cannot replace a newer query',async()=>{
  const e=environment({controlled:true}),pending=[],states=[];
  const c=new e.T.SearchController(()=>new Promise(resolve=>pending.push(resolve)),s=>states.push(s));
  c.input('old');const old=[...e.callbacks.values()].at(-1)();
  c.input('new');const fresh=[...e.callbacks.values()].at(-1)();
  pending[1]({items:['new']});await fresh;pending[0]({items:['old']});await old;
  assert.equal(states.at(-1).items[0],'new');assert.equal(states.filter(s=>s.state==='done').length,1);
});
test('closing a pending search suppresses results',async()=>{
  const e=environment({controlled:true}),states=[];let resolve;
  const c=new e.T.SearchController(()=>new Promise(r=>resolve=r),s=>states.push(s.state));
  c.input('query');const run=[...e.callbacks.values()][0]();c.close();resolve({items:['late']});await run;assert.equal(states.includes('done'),false);
});
test('real input handler initializes full modal and returns local suggestion without key',async()=>{
  const e=environment(),f=appFixture({'Areas/Личное/Кино/Example.md':fm({type:'film',title:'Example'})});
  const p=new e.Plugin(f.app);await p.onload();p.openPicker('film');const m=[...p.modals][0];
  assert.equal(m.status.textContent,'Введите хотя бы два символа.');m.controller.delay=0;m.query.value='Example';await m.query.fire('input');await tick();
  assert.equal(m.status.textContent,'Выберите вариант.');assert.equal(m.results.find('button').length,1);assert.equal(f.writes.length,0);m.close();
});
test('missing TMDB token is visible in the actual modal',async()=>{
  const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();p.openPicker('film');const m=[...p.modals][0];
  m.controller.delay=0;m.query.value='Unknown';await m.query.fire('input');await tick();assert.match(m.status.textContent,/TMDB Read Access Token/);m.close();
});
test('authenticated movie title search sends token to TMDB and keeps year optional',async()=>{
  const requests=[],e=environment();const api=new e.T.Api(()=> 'secret',async r=>{requests.push(r);return {status:200,json:{results:[]}};});
  await api.search('film','Example','2025');const u=new URL(requests[0].url);assert.equal(u.hostname,'api.themoviedb.org');assert.equal(u.searchParams.get('query'),'Example');assert.equal(u.searchParams.get('primary_release_year'),'2025');assert.equal(requests[0].headers.Authorization,'Bearer secret');
});
test('network and auth errors do not reveal credentials',async()=>{
  const e=environment();const a=new e.T.Api(()=> 'secret',async()=>{throw new Error('URL contains secret');});await assert.rejects(a.search('film','test'),err=>!err.message.includes('secret')&&err.message.includes('сети'));
  const b=new e.T.Api(()=> 'secret',async()=>({status:401}));await assert.rejects(b.search('film','test'),/Проверьте ключ/);
});
test('book lookup does not call Google without a key',async()=>{
  const hosts=[],e=environment();const api=new e.T.Api(()=> '',async r=>{hosts.push(new URL(r.url).hostname);return {status:200,json:{docs:[]}};});await api.search('book','Example');assert.deepEqual(hosts,['openlibrary.org']);
});
test('valid ISBN-10 and ISBN-13 represent the same edition',()=>{const {T}=environment();assert.equal(T.canonicalISBN('0-306-40615-2'),'9780306406157');assert.equal(T.canonicalISBN('9780306406158'),null);});
test('custom folder ISBN duplicate opens old note without writes',async()=>{
  const e=environment(),old=fm({type:'book',title:'Old title',isbn:['0-306-40615-2'],rating:5}),f=appFixture({'Library/Books/Old.md':old});
  const result=await e.T.addCard(f.app,record('book'),false,{book:'Library/Books',film:'Library/Films'});assert.equal(result.existing.path,'Library/Books/Old.md');assert.equal(f.writes.length,0);assert.equal(f.content.get(result.existing.path),old);
});
test('same title requires explicit different edition confirmation',async()=>{
  const e=environment(),f=appFixture({'Areas/Личное/Книги/Example.md':fm({type:'book',title:'Example',isbn:['9785006320727']})});
  const result=await e.T.addCard(f.app,record('book'));assert.equal(result.similar.length,1);assert.equal(f.writes.length,0);
});
test('creating a different edition uses a distinct path and retains old note',async()=>{
  const e=environment(),old=fm({type:'book',title:'Example',isbn:['9785006320727']}),f=appFixture({'Areas/Личное/Книги/Example.md':old});
  const result=await e.T.addCard(f.app,record('book'),true);assert.notEqual(result.created.path,'Areas/Личное/Книги/Example.md');assert.equal(f.content.get('Areas/Личное/Книги/Example.md'),old);
});
test('serialized duplicate additions create exactly one card',async()=>{
  const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();const add=()=>e.T.addCard(f.app,record(),false,p.folders);
  const results=await Promise.all([p.enqueueAdd(add),p.enqueueAdd(add)]);assert.ok(results[0].created);assert.ok(results[1].existing);assert.equal(f.writes.filter(w=>w.kind==='create').length,1);
});
test('unsafe user paths are rejected',()=>{const {T}=environment();for(const p of ['../outside','/absolute','Hidden/.secrets','A//B','A\\B','A#view','A|title','A\nB','C:/foo'])assert.throws(()=>T.catalogPath(p));assert.equal(T.catalogPath('Books/Library.base','.base'),'Books/Library.base');assert.throws(()=>T.catalogPath('Books/note.md','.base'));});
test('generated Base filters only the selected folder and kind',()=>{const {T}=environment(),base=yaml.parse(T.baseText('book','Library/Books'));assert.deepEqual(base.filters.and,['file.inFolder("Library/Books")','type == "book"']);assert.deepEqual(base.views.map(v=>v.type),['cards','table']);assert.equal(base.views[0].image,'note.cover');});
test('plugin startup performs no writes and registers one library icon',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();assert.equal(f.writes.length,0);assert.equal(p.icons.length,1);assert.equal(p.icons[0].icon,'library');assert.ok(p.commands.some(c=>c.id==='open-catalog'));assert.equal(p.processor.type,'media-catalog');});
test('custom paths load through standard data; credentials remain device-local',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);p.data={folders:{book:'Library/Books'},bases:{book:'Library/Books.base'},tmdb:'must-not-be-used'};await p.onload();assert.equal(p.folders.book,'Library/Books');assert.equal(p.key('tmdb'),'');p.setKey('tmdb','secret');assert.equal(p.key('tmdb'),'secret');assert.equal(p.data.tmdb,'must-not-be-used');});
test('invalid stored path falls back to default without touching any file',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);p.data={folders:{film:'../outside'}};await p.onload();assert.equal(p.folders.film,e.T.FOLDERS.film);assert.equal(f.writes.length,0);assert.equal(e.notices.length,1);});
test('create missing catalog is explicit and never overwrites an existing Base',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();await p.createCatalog('film');const old=f.content.get(p.bases.film);await assert.rejects(p.createCatalog('film'),/Существующие файлы не изменены/);assert.equal(f.content.get(p.bases.film),old);});
test('existing Base is embedded through MarkdownRenderer and Add opens movie picker',async()=>{
  const e=environment(),f=appFixture({'Areas/Личное/Кино.base':'original base'}),p=new e.Plugin(f.app);await p.onload();
  const target=new El(),widget=new e.T.CatalogWidget(p,target,'film');widget.load();await tick();assert.equal(e.renders[0][1],'![[Areas/Личное/Кино.base]]');assert.ok(e.renders[0][4] instanceof Component);
  await target.find('button').find(b=>b.textContent.includes('Добавить')).fire('click');assert.equal(p.modals.size,1);assert.equal(f.writes.length,0);p.onunload();widget.unload();
});
test('missing Base shows a setup button without writing on render',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();const target=new El(),w=new e.T.CatalogWidget(p,target,'book');w.load();await tick();assert.equal(f.writes.length,0);assert.ok(target.find('button').some(b=>b.textContent==='Создать недостающий каталог'));w.unload();});
test('native embed failure keeps direct Base access and visible explanation',async()=>{const e=environment({renderError:true}),f=appFixture({'Areas/Личное/Кино.base':'original'}),p=new e.Plugin(f.app);await p.onload();const target=new El(),w=new e.T.CatalogWidget(p,target,'film');w.load();await tick();assert.ok(target.find('button').some(b=>b.textContent==='Открыть файл базы'));assert.ok(target.find('div').some(d=>d.textContent.includes('Включите штатный плагин Bases')));w.unload();});
test('catalog view switches to books and cleans renderer on close',async()=>{const e=environment(),f=appFixture({'Areas/Личное/Кино.base':'film','Areas/Личное/Книги.base':'book'}),p=new e.Plugin(f.app);await p.onload();const v=new e.T.CatalogView({app:f.app},p);v.load();await v.onOpen();await tick();await v.contentEl.find('button').find(b=>b.textContent==='Книги').fire('click');await tick();assert.equal(v.getState().kind,'book');assert.equal(e.renders.at(-1)[1],'![[Areas/Личное/Книги.base]]');const widget=v.widget;await v.onClose();assert.equal(widget.closed,true);assert.equal(v.contentEl.children.length,0);});
test('inline shortcode rejects unsupported content without rendering or writing',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();const el=new El();p.processor.cb('bad',el,{addChild(){throw new Error('should not create child');}});assert.match(el.textContent,/film или book/);assert.equal(f.writes.length,0);});
test('inline shortcode registers a MarkdownRenderChild with source-path context',async()=>{const e=environment(),f=appFixture({'Areas/Личное/Книги.base':'books'}),p=new e.Plugin(f.app);await p.onload();const el=new El();let child;p.processor.cb('book',el,{sourcePath:'Dashboards/Library.md',addChild(c){child=c;assert.ok(c instanceof e.api.MarkdownRenderChild);assert.equal(c.containerEl,el);c.load();}});await tick();assert.equal(e.renders[0][3],'Dashboards/Library.md');child.unload();assert.equal(child.closed,true);});
test('unloading plugin closes dialogs and clears their controllers',async()=>{const e=environment(),f=appFixture(),p=new e.Plugin(f.app);await p.onload();p.openPicker('film');p.openPicker('book');const dialogs=[...p.modals];p.onunload();assert.equal(p.modals.size,0);assert.ok(dialogs.every(m=>m.closed&&m.controller.closed));});
test('plugin unload clears inline catalog and removes its Add handler',async()=>{const e=environment(),f=appFixture({'Areas/Личное/Кино.base':'movies'}),p=new e.Plugin(f.app);await p.onload();const el=new El(),w=new e.T.CatalogWidget(p,el,'film');w.load();await tick();const add=el.find('button').find(b=>b.textContent.includes('Добавить'));p.onunload();await add.fire('click');assert.equal(p.modals.size,0);assert.equal(p.widgets.size,0);assert.equal(w.closed,true);assert.equal(el.children.length,0);});
test('mobile manifest and runtime dependency boundary are correct',()=>{const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));assert.equal(manifest.isDesktopOnly,false);assert.equal(manifest.version,'0.2.0');assert.deepEqual([...source.matchAll(/require\("([^"]+)"\)/g)].map(m=>m[1]),['obsidian']);});
