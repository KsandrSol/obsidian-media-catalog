"use strict";
const { Plugin, Modal, ItemView, Component, MarkdownRenderChild, MarkdownRenderer, PluginSettingTab, Setting, Notice, requestUrl, parseYaml, stringifyYaml, normalizePath } = require("obsidian");
const ID = "ksandr-media-picker";
const FOLDERS = { film: "Areas/Личное/Кино", book: "Areas/Личное/Книги" };
const BASES = { film: "Areas/Личное/Кино.base", book: "Areas/Личное/Книги.base" };
const VIEW = "ksandr-media-catalog";
function catalogPath(value, extension="") {
  const raw=text(value);
  if(!raw||raw.startsWith("/")||raw.includes("\\")||/[\[\]#|\r\n]/.test(raw)||raw.split("/").some(p=>!p||p.startsWith(".")||p.includes(":")))throw new Error("Укажите путь внутри хранилища без скрытых папок и специальных символов.");
  const path=normalizePath(raw);
  if(extension&&!path.endsWith(extension))throw new Error("Путь базы должен оканчиваться на "+extension);
  return path;
}
function catalogFiles(app,folder) {
  const root=app.vault.getAbstractFileByPath(folder), files=[];
  const visit=file=>{if(Array.isArray(file.children))for(const child of file.children)visit(child);else if(file.extension==="md")files.push(file);};
  if(root)visit(root);return files;
}
function baseText(kind,folder) {
  const creator=kind==="film"?"director":"author";
  return stringifyYaml({filters:{and:["file.inFolder("+JSON.stringify(folder)+")","type == "+JSON.stringify(kind)]},properties:{title:{displayName:"Название"},status:{displayName:"Статус"},rating:{displayName:"Моя оценка"},[creator]:{displayName:kind==="film"?"Режиссёр":"Автор"},year:{displayName:"Год"}},views:[{type:"cards",name:"Обложки",order:["file.name",creator,"year","status","rating"],image:"note.cover",imageFit:"contain",imageAspectRatio:1.5},{type:"table",name:"Все",order:["file.name",creator,"year","status","rating"],sort:[{property:"title",direction:"ASC"}]}]});
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = v => typeof v === "string" ? v.trim() : "";
const number = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const year = v => { const m = String(v || "").match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? Number(m[1]) : null; };
const arr = v => Array.isArray(v) ? v : [];
const isoDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
function cleanTitle(v) { return text(v).normalize("NFC").replace(/[\u0000-\u001f]/g, " ").slice(0, 500); }
function safeName(v) {
  const s = cleanTitle(v).replace(/:/g," — ").replace(/[\\/<>"|?*#^\[\]]/g," ").replace(/\s+/g," ").replace(/^\.+|\.+$/g,"").trim();
  if (!s) throw new Error("У результата нет допустимого названия.");
  return s.slice(0, 100).trim();
}
function canonicalISBN(v) {
  const s = String(v || "").replace(/[\s\-‐‑–—]/g,"").toUpperCase();
  if (/^\d{13}$/.test(s) && [...s].reduce((a,c,i)=>a+Number(c)*(i%2?3:1),0)%10===0) return s;
  if (/^\d{9}[\dX]$/.test(s) && [...s].reduce((a,c,i)=>a+(c==="X"?10:Number(c))*(10-i),0)%11===0) {
    const p = "978"+s.slice(0,9); const sum = [...p].reduce((a,c,i)=>a+Number(c)*(i%2?3:1),0);
    return p+((10-sum%10)%10);
  }
  return null;
}
const isbnSet = v => new Set((Array.isArray(v)?v:[v]).map(canonicalISBN).filter(Boolean));
function titleKey(v) { return cleanTitle(v).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim(); }
function validURL(v) { try { const u=new URL(v); return u.protocol==="https:" ? u.href : null; } catch { return null; } }
function frontmatter(raw) {
  const m=String(raw).replace(/^\ufeff/,"").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return {};
  try { const fm=parseYaml(m[1]); return fm && typeof fm==="object" && !Array.isArray(fm)?fm:{}; } catch { return {}; }
}
function errorText(status) {
  if (status===429) return "Источник ограничил запросы. Повторите позже.";
  if (status===401 || status===403) return "Источник отказал в доступе. Проверьте ключ в настройках плагина.";
  if (status===404) return "Данные выбранного издания не найдены.";
  return "Источник временно недоступен.";
}
class Api {
  constructor(keys, transport=requestUrl, delay=sleep, now=()=>Date.now()) {
    this.keys=keys; this.transport=transport; this.delay=delay; this.now=now; this.olTail=Promise.resolve(); this.lastOL=-Infinity;
  }
  async json(url, headers={}) {
    let r, timer;
    try {
      r=await Promise.race([this.transport({url,headers,throw:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("timeout")),20000);})]);
    } catch { throw new Error("Ошибка сети, TLS или превышено время ожидания. Проверьте подключение на этом устройстве."); }
    finally {clearTimeout(timer);}
    if (r.status<200 || r.status>=300) throw new Error(errorText(r.status));
    const data=r.json;
    if (!data || typeof data!=="object") throw new Error("Источник вернул некорректные данные.");
    return data;
  }
  ol(path, params={}) {
    const job=this.olTail.then(async()=>{
      const wait=this.lastOL+1050-this.now(); if(wait>0) await this.delay(wait);
      try { return await this.json("https://openlibrary.org/"+path+(Object.keys(params).length?"?"+new URLSearchParams(params):"")); }
      finally { this.lastOL=this.now(); }
    });
    this.olTail=job.catch(()=>{}); return job;
  }
  tmdb(path, params={}) {
    const token=text(this.keys("tmdb")); if(!token) throw new Error("Для фильмов укажите TMDB Read Access Token в настройках плагина.");
    return this.json("https://api.themoviedb.org/3/"+path+"?"+new URLSearchParams(params),{Authorization:"Bearer "+token});
  }
  google(path, params={}) {
    const key=text(this.keys("google")); if(!key) throw new Error("Для Google Books требуется ключ API.");
    return this.json("https://www.googleapis.com/books/v1/"+path+"?"+new URLSearchParams({...params,key}));
  }
  async search(kind, query, filmYear="") {
    if(kind==="film") {
      const params={query,language:"ru-RU",include_adult:"false"};
      if(filmYear) { if(!/^\d{4}$/.test(filmYear)) throw new Error("Год фильма: четыре цифры или пустое поле."); params.primary_release_year=filmYear; }
      const data=await this.tmdb("search/movie",params);
      return {items:arr(data.results).filter(m=>Number.isInteger(m.id)&&text(m.title||m.original_title)).slice(0,12).map(m=>({kind,source:"tmdb",id:String(m.id),title:cleanTitle(m.title||m.original_title),author:cleanTitle(m.original_title),year:year(m.release_date)})),warnings:[]};
    }
    const items=[], warnings=[]; const isbn=canonicalISBN(query);
    const searches=[(async()=>{
      try {
        const data=await this.ol("search.json",{q:isbn?"isbn:"+isbn:query,limit:"8",fields:"key,title,author_name,first_publish_year,editions,editions.key,editions.title,editions.publish_date,editions.publisher,editions.language,editions.isbn", "editions.limit":"3"});
        for(const work of arr(data.docs)) {
          const editions=arr(work.editions?.docs);
          for(const e of editions) {
            const id=text(e.key).split("/").pop(); if(!/^OL\d+M$/.test(id)) continue;
            items.push({kind,source:"openlibrary",id,title:cleanTitle(e.title||work.title),author:arr(work.author_name).filter(x=>typeof x==="string").join(", "),year:year(arr(e.publish_date)[0]||e.publish_date),publisher:arr(e.publisher).join(", "),language:arr(e.language).join(", "),isbn:arr(e.isbn),first_published:number(work.first_publish_year)});
          }
        }
      } catch(e) { warnings.push("Open Library: "+e.message); }
    })()];
    if(this.keys("google")) searches.push((async()=>{
      try {
        const d=await this.google("volumes",{q:isbn?"isbn:"+isbn:query,maxResults:"8",printType:"books"});
        for(const v of arr(d.items)) { const i=v.volumeInfo||{}; if(!/^[\w-]+$/.test(text(v.id))||!text(i.title)) continue;
          items.push({kind,source:"google",id:v.id,title:cleanTitle(i.title),author:arr(i.authors).join(", "),year:year(i.publishedDate),publisher:text(i.publisher),language:text(i.language),isbn:arr(i.industryIdentifiers).filter(x=>/^ISBN/.test(x.type||"")).map(x=>String(x.identifier))}); }
      } catch(e) { warnings.push("Google Books: "+e.message); }
    })());
    await Promise.all(searches);
    const seen=new Set(); return {items:items.filter(i=>i.title&&!seen.has(i.source+":"+i.id)&&seen.add(i.source+":"+i.id)).slice(0,24),warnings};
  }
  async details(item) {
    const ratings=[], at=isoDate();
    if(item.source==="tmdb") {
      if(!/^\d+$/.test(item.id)) throw new Error("Некорректный идентификатор фильма.");
      const m=await this.tmdb("movie/"+item.id,{language:"ru-RU",append_to_response:"credits,external_ids"});
      if(String(m.id)!==item.id || !text(m.title||m.original_title)) throw new Error("Источник вернул другой фильм.");
      const src="https://www.themoviedb.org/movie/"+item.id;
      if(number(m.vote_average)!==null && number(m.vote_count)>0) ratings.push(`TMDB: ${m.vote_average} /10, оценок ${m.vote_count}, на ${at} — ${src}`);
      return {kind:"film",source:"tmdb",source_id:item.id,description:text(m.overview),fields:{title:cleanTitle(m.title||m.original_title),original_title:cleanTitle(m.original_title)||null,director:arr(m.credits?.crew).filter(c=>c.job==="Director").map(c=>text(c.name)).filter(Boolean),year:year(m.release_date),runtime:number(m.runtime)||null,genre:arr(m.genres).map(g=>text(g.name)).filter(Boolean),country:arr(m.production_countries).map(c=>text(c.name)).filter(Boolean),tmdb_id:item.id,imdb_id:text(m.external_ids?.imdb_id||m.imdb_id)||null,cover:typeof m.poster_path==="string"&&/^\/[\w./-]+$/.test(m.poster_path)?"https://image.tmdb.org/t/p/w500"+m.poster_path:null,cover_source:src,source_url:src,external_ratings:ratings}};
    }
    if(item.source==="google") {
      if(!/^[\w-]+$/.test(item.id)) throw new Error("Некорректный идентификатор издания.");
      const v=await this.google("volumes/"+item.id); if(v.id!==item.id || !text(v.volumeInfo?.title)) throw new Error("Источник вернул другое издание.");
      const i=v.volumeInfo, src=validURL(i.canonicalVolumeLink)||"https://books.google.com/books?id="+item.id;
      if(number(i.averageRating)!==null && number(i.ratingsCount)>0) ratings.push(`Google Books: ${i.averageRating} /5, оценок ${i.ratingsCount}, на ${at} — ${src}`);
      return {kind:"book",source:"google",source_id:item.id,description:text(i.description).replace(/<[^>]+>/g,""),fields:{title:cleanTitle(i.title+(i.subtitle?": "+i.subtitle:"")),author:arr(i.authors).filter(x=>typeof x==="string"),year:year(i.publishedDate),first_published:null,publisher:text(i.publisher)||null,pages:number(i.pageCount)||null,language:text(i.language)||null,isbn:arr(i.industryIdentifiers).filter(x=>/^ISBN/.test(x.type||"")).map(x=>String(x.identifier)),genre:arr(i.categories).filter(x=>typeof x==="string"),cover:validURL(text(i.imageLinks?.thumbnail).replace(/^http:/,"https:")),cover_source:src,source_url:src,external_ratings:ratings}};
    }
    if(item.source!=="openlibrary" || !/^OL\d+M$/.test(item.id)) throw new Error("Некорректный идентификатор издания.");
    const e=await this.ol("books/"+item.id+".json"); if(text(e.key)!=="/books/"+item.id || !text(e.title)) throw new Error("Источник вернул другое издание.");
    const authors=[];
    for(const a of arr(e.authors).slice(0,4)) { const key=text(a.key); if(!/^\/authors\/OL\d+A$/.test(key)) continue;
      try { const d=await this.ol(key.slice(1)+".json"); if(text(d.name)) authors.push(d.name); } catch {} }
    const src="https://openlibrary.org/books/"+item.id;
    const cover=arr(e.covers).find(c=>Number.isInteger(c)&&c>0);
    return {kind:"book",source:"openlibrary",source_id:item.id,description:typeof e.description==="object"?text(e.description.value):text(e.description),fields:{title:cleanTitle(e.title),author:authors,year:year(e.publish_date),first_published:item.first_published||null,publisher:arr(e.publishers).join(", ")||null,pages:number(e.number_of_pages)||null,language:arr(e.languages).map(l=>text(l.key).split("/").pop()).filter(Boolean).join(", ")||null,isbn:[...arr(e.isbn_13),...arr(e.isbn_10)].map(String),genre:[],cover:cover?`https://covers.openlibrary.org/b/id/${cover}-L.jpg`:null,cover_source:src,source_url:src,external_ratings:ratings}};
  }
}
class SearchController {
  constructor(search, publish, delay=500, timers={set:(callback,ms)=>setTimeout(callback,ms),clear:id=>clearTimeout(id)}) { this.search=search;this.publish=publish;this.delay=delay;this.timers=timers;this.serial=0;this.closed=false;this.timer=null; }
  input(query, yearValue="") {
    const seq=++this.serial; if(this.timer!==null) this.timers.clear(this.timer);
    this.timer=null; if(this.closed) return;
    query=text(query); if(query.length<2) { this.publish({state:"idle",items:[]}); return; }
    this.publish({state:"waiting",items:[]});
    this.timer=this.timers.set(async()=>{ this.timer=null; if(this.closed||seq!==this.serial)return;
      this.publish({state:"loading",items:[]});
      try { const r=await this.search(query,yearValue,partial=>{if(!this.closed&&seq===this.serial)this.publish({state:"done",...partial});}); if(!this.closed&&seq===this.serial)this.publish({state:"done",...r}); }
      catch(e) { if(!this.closed&&seq===this.serial)this.publish({state:"error",items:[],error:e.message}); }
    },this.delay);
  }
  close() { this.closed=true;++this.serial;if(this.timer!==null)this.timers.clear(this.timer);this.timer=null; }
}
async function duplicateFiles(app, rec, folders=FOLDERS) {
  const matches=[], similar=[], ids=isbnSet(rec.fields.isbn), folder=folders[rec.kind];
  for(const file of catalogFiles(app,folder)) {
    // Read actual frontmatter: the metadata cache can lag behind a just-created file.
    const fm=frontmatter(await app.vault.read(file)); if(fm.type!==rec.kind)continue;
    const sameSource=fm.source===rec.source&&String(fm.source_id)===rec.source_id;
    const movie=rec.kind==="film"&&["tmdb_id","imdb_id"].some(k=>rec.fields[k]&&String(fm[k])===String(rec.fields[k]));
    const book=rec.kind==="book"&&[...isbnSet(fm.isbn)].some(i=>ids.has(i));
    if(sameSource||movie||book) matches.push(file);
    else if(titleKey(fm.title||file.basename)===titleKey(rec.fields.title)) similar.push(file);
  }
  return {matches,similar};
}
function cardText(rec) {
  const f=rec.fields;
  const fm={...f,type:rec.kind,status:rec.kind==="film"?"хочу посмотреть":"хочу прочитать",rating:null,started:null,finished:null,added:isoDate(),source:rec.source,source_id:rec.source_id,tags:[rec.kind==="film"?"кино":"книга"]};
  if(rec.kind==="book") { fm.original_title=null;fm.highlights=null;fm.isbn=arr(f.isbn).map(String); }
  const heading=rec.kind==="film"?"О чём":"О книге";
  return "---\n"+stringifyYaml(fm).trimEnd()+"\n---\n\n# "+f.title+"\n\n## "+heading+"\n\n"+(rec.description||"")+"\n\n## "+(rec.kind==="film"?"Мой отзыв":"Мои мысли")+"\n\n## Источник метаданных\n\n"+f.source_url+"\n\n";
}
async function ensureFolder(vault,folder) {
  let path="";for(const part of folder.split("/")) {path=path?path+"/"+part:part;
    const old=vault.getAbstractFileByPath(path);
    if(old) { if(!Array.isArray(old.children))throw new Error("Путь каталога занят файлом."); }
    else { try { await vault.createFolder(path); } catch(e) { if(!Array.isArray(vault.getAbstractFileByPath(path)?.children))throw e; } }
  }
}
async function addCard(app,rec,allowSeparate=false,folders=FOLDERS) {
  if(!folders[rec.kind] || !text(rec.fields?.title) || !text(rec.source_id) || !validURL(rec.fields.source_url))throw new Error("Некорректная карточка.");
  const folder=catalogPath(folders[rec.kind]);
  const found=await duplicateFiles(app,rec,folders);
  if(found.matches.length) return {existing:found.matches[0],multiple:found.matches.length>1};
  if(found.similar.length&&!allowSeparate)return {similar:found.similar};
  await ensureFolder(app.vault,folder);
  const base=safeName(rec.fields.title)+(rec.kind==="film"&&rec.fields.year?" ("+rec.fields.year+")":"");
  let path=folder+"/"+base+".md";
  if(app.vault.getAbstractFileByPath(path)) {
    const discriminator=[rec.fields.year, [...isbnSet(rec.fields.isbn)][0]||rec.source_id].filter(Boolean).join(" — ");
    path=folder+"/"+safeName(base+" — "+discriminator)+".md";
  }
  if(app.vault.getAbstractFileByPath(path))throw new Error("Файл уже существует. Откройте его и проверьте издание.");
  const file=await app.vault.create(path,cardText(rec)); return {created:file};
}
class PickerModal extends Modal {
  constructor(plugin,kind) { super(plugin.app);this.plugin=plugin;this.kind=kind;this.seq=0;this.closed=true;this.busy=false;this.allowSeparate=false; }
  onOpen() {
    this.closed=false;const c=this.contentEl;c.addClass("ksandr-media-picker");
    c.createEl("h2",{text:this.kind==="film"?"Добавить фильм":"Добавить книгу"});
    this.query=c.createEl("input",{type:"search",placeholder:this.kind==="film"?"Название фильма":"Название книги; можно добавить автора"});
    this.query.setAttribute("aria-label","Название");
    if(this.kind==="film") {this.yearInput=c.createEl("input",{type:"text",placeholder:"Год — необязательно"});this.yearInput.setAttribute("inputmode","numeric");this.yearInput.setAttribute("aria-label","Год выпуска");}
    this.status=c.createEl("p",{text:"Введите хотя бы два символа."});this.status.setAttribute("role","status");this.status.setAttribute("aria-live","polite");
    this.results=c.createDiv({cls:"kmp-results"});this.preview=c.createDiv({cls:"kmp-preview"});
    this.controller=new SearchController((q,y,partial)=>this.plugin.search?this.plugin.search(this.kind,q,y,partial):this.plugin.api.search(this.kind,q,y),state=>this.render(state));
    const change=()=>{++this.seq;this.record=null;this.allowSeparate=false;this.preview.empty();this.controller.input(this.query.value,this.yearInput?.value.trim()||"");};
    this.query.addEventListener("input",change);this.yearInput?.addEventListener("input",change);
    this.query.focus();
  }
  render(state) {
    this.results.empty();
    const msg={idle:"Введите хотя бы два символа.",waiting:"",loading:"Ищу…",error:state.error,done:state.items?.length?"Выберите вариант.":"Ничего не найдено. Попробуйте название с автором или другой язык."};
    this.status.setText(msg[state.state]||"");
    for(const w of state.warnings||[])this.results.createEl("p",{text:w});
    for(const item of state.items||[]) {
      const button=this.results.createEl("button",{text:[item.title,item.author,item.year,item.publisher,item.language,item.source].filter(Boolean).join(" · "),cls:"kmp-result"});
      button.addEventListener("click",()=>this.select(item));
    }
  }
  async select(item) {
    if(item.source==="vault") {
      ++this.seq;this.preview.empty();this.preview.createEl("h3",{text:item.title});this.preview.createEl("p",{text:"Эта карточка уже есть в каталоге."});
      const b=this.preview.createEl("button",{text:"Открыть карточку",cls:"mod-cta"});
      b.addEventListener("click",async()=>{const file=this.app.vault.getAbstractFileByPath(item.id);if(file&&item.id.startsWith(this.plugin.folders[this.kind]+"/")&&item.id.endsWith(".md")){await this.app.workspace.getLeaf(false).openFile(file);this.close();}});return;
    }
    const seq=++this.seq;this.preview.empty();this.preview.createEl("p",{text:"Загружаю выбранное издание…"});
    try {
      const rec=await this.plugin.api.details(item);if(this.closed||seq!==this.seq)return;
      this.record=rec;this.allowSeparate=false;this.showPreview(rec);
    } catch(e) { if(!this.closed&&seq===this.seq){this.preview.empty();this.preview.createEl("p",{text:e.message});} }
  }
  showPreview(rec) {
    const p=this.preview;p.empty();p.createEl("h3",{text:rec.fields.title});
    if(validURL(rec.fields.cover)){const img=p.createEl("img",{attr:{src:rec.fields.cover,alt:"Обложка",loading:"lazy"}});img.addClass("kmp-cover");}
    for(const [label,key] of [["Автор / режиссёр",rec.kind==="film"?"director":"author"],["Год издания / выпуска","year"],["Первое издание","first_published"],["Издательство","publisher"],["Язык","language"],["Страниц","pages"],["ISBN","isbn"],["Длительность, мин","runtime"]]) {
      const value=rec.fields[key]; if(value!=null&&value!==""&&(!Array.isArray(value)||value.length))p.createEl("p",{text:label+": "+(Array.isArray(value)?value.join(", "):value)});
    }
    p.createEl("a",{text:"Открыть источник",attr:{href:rec.fields.source_url,target:"_blank",rel:"noopener noreferrer"}});
    this.addButton=p.createEl("button",{text:"Добавить в каталог",cls:"mod-cta"});this.addButton.disabled=this.busy;
    this.addButton.addEventListener("click",()=>this.add(rec));
  }
  async add(rec) {
    if(this.busy||this.closed)return;this.busy=true;this.addButton.disabled=true;
    try {
      const result=await this.plugin.enqueueAdd(()=>addCard(this.app,rec,this.allowSeparate,this.plugin.folders));
      if(this.closed)return;
      if(result.similar) {
        this.preview.createEl("p",{text:"Карточка с таким названием уже есть. Проверьте автора и издание."});
        for(const file of result.similar){const b=this.preview.createEl("button",{text:"Открыть: "+file.basename});b.addEventListener("click",()=>this.app.workspace.getLeaf(false).openFile(file));}
        const b=this.preview.createEl("button",{text:"Подтверждаю: это другое издание / произведение"});
        b.addEventListener("click",()=>{this.allowSeparate=true;this.add(rec);});return;
      }
      if(result.multiple)new Notice("Найдено несколько карточек с одним ID. Открыта первая; файлы не изменены.");
      else new Notice(result.existing?"Карточка уже есть — открываю.":"Карточка добавлена.");
      await this.app.workspace.getLeaf(false).openFile(result.existing||result.created);this.close();
    } catch(e) { if(!this.closed)this.preview.createEl("p",{text:e.message}); }
    finally {this.busy=false;if(this.addButton)this.addButton.disabled=false;}
  }
  onClose() {this.closed=true;++this.seq;this.controller?.close();this.contentEl.empty();}
}
class CatalogWidget extends MarkdownRenderChild {
  constructor(plugin,element,kind,sourcePath="") {super(element);this.plugin=plugin;this.element=element;this.kind=kind;this.sourcePath=sourcePath;this.serial=0;this.closed=false;}
  onload() {this.closed=false;this.plugin.widgets.add(this);this.refresh().catch(()=>{if(!this.closed)new Notice("Не удалось открыть каталог.");});}
  async refresh() {
    const seq=++this.serial,c=this.element;c.empty();c.addClass("kmp-catalog");
    if(this.renderer){this.removeChild(this.renderer);this.renderer=null;}
    this.renderer=this.addChild(new Component());
    const bar=c.createDiv({cls:"kmp-catalog-bar"});
    bar.createEl("h3",{text:this.kind==="film"?"Кино":"Книги"});
    const add=bar.createEl("button",{text:this.kind==="film"?"＋ Добавить фильм":"＋ Добавить книгу",cls:"mod-cta"});
    this.renderer.registerDomEvent(add,"click",()=>this.plugin.openPicker(this.kind));
    const basePath=this.plugin.bases[this.kind],base=this.plugin.app.vault.getAbstractFileByPath(basePath);
    if(!base||base.extension!=="base") {
      c.createEl("p",{text:"Файл базы пока не найден: "+basePath+". Проверьте путь в настройках или создайте каталог."});
      const setup=c.createEl("button",{text:"Создать недостающий каталог"});
      this.renderer.registerDomEvent(setup,"click",async()=>{setup.disabled=true;try{await this.plugin.enqueueAdd(()=>this.plugin.createCatalog(this.kind));if(!this.closed&&seq===this.serial)await this.refresh();}catch(e){if(!this.closed)new Notice(e.message);}finally{setup.disabled=false;}});return;
    }
    const open=bar.createEl("button",{text:"Открыть файл базы"});
    this.renderer.registerDomEvent(open,"click",()=>this.plugin.app.workspace.getLeaf(false).openFile(base));
    const target=c.createDiv({cls:"kmp-base markdown-rendered"});
    try {await MarkdownRenderer.render(this.plugin.app,"![["+basePath+"]]",target,this.sourcePath,this.renderer);}
    catch {if(!this.closed&&seq===this.serial)target.setText("Не удалось встроить Bases. Включите штатный плагин Bases и откройте файл базы кнопкой выше.");}
  }
  onunload() {this.closed=true;++this.serial;this.plugin.widgets.delete(this);this.element.empty();}
}
class CatalogView extends ItemView {
  constructor(leaf,plugin) {super(leaf);this.plugin=plugin;this.kind="film";}
  getViewType() {return VIEW;}
  getDisplayText() {return "Кино и книги";}
  getIcon() {return "library";}
  getState() {return {kind:this.kind};}
  async setState(state,result) {this.kind=state?.kind==="book"?"book":"film";await this.render();await super.setState(state,result);}
  async onOpen() {await this.render();}
  async render() {
    if(this.widget){this.removeChild(this.widget);this.widget=null;}
    const c=this.contentEl;c.empty();c.addClass("kmp-library");
    const tabs=c.createDiv({cls:"kmp-tabs"});
    for(const [kind,label] of [["film","Кино"],["book","Книги"]]) {
      const b=tabs.createEl("button",{text:label});b.setAttribute("aria-pressed",String(this.kind===kind));
      b.addEventListener("click",async()=>{this.kind=kind;await this.render();this.app.workspace.requestSaveLayout();});
    }
    this.widget=this.addChild(new CatalogWidget(this.plugin,c.createDiv(),this.kind));
  }
  async onClose() {if(this.widget){this.removeChild(this.widget);this.widget=null;}this.contentEl.empty();}
}
class PickerSettings extends PluginSettingTab {
  display() {
    const c=this.containerEl;c.empty();new Setting(c).setName("Источники").setHeading();
    c.createEl("p",{text:"Ключи сохраняются в локальном хранилище этого устройства, вне файлов Vault. На Mac и телефоне настройте их отдельно. Книги можно искать в Open Library без ключа."});
    for(const [key,label,description] of [["tmdb","TMDB Read Access Token","Для поиска фильмов. API Read Access Token из настроек TMDB."],["google","Google Books API key","Дополнительный источник книг. Можно оставить пустым."]]) {
      new Setting(c).setName(label).setDesc(description).addText(t=>{t.inputEl.type="password";t.setValue(this.plugin.key(key));t.onChange(v=>{try{this.plugin.setKey(key,v);}catch{new Notice("Локальное хранилище ключей недоступно.");}});});
    }
    c.createEl("p",{text:"Другие плагины Obsidian имеют доступ к среде приложения и локальному хранилищу. Ключи не записываются в data.json и не синхронизируются этим плагином."});
    new Setting(c).setName("Каталоги").setHeading();
    for(const [kind,label] of [["film","Кино"],["book","Книги"]]) {
      for(const [group,name,suffix] of [["folders","Папка карточек",""],["bases","Файл базы",".base"]]) {
        new Setting(c).setName(label+": "+name).setDesc("Путь внутри хранилища сохраняется после выхода из поля. Существующие файлы автоматически не перемещаются.").addText(t=>{t.setValue(this.plugin[group][kind]);t.inputEl.addEventListener("change",async()=>{try{const path=catalogPath(t.inputEl.value,suffix);await this.plugin.enqueueAdd(async()=>{const next={...this.plugin.options,[group]:{...this.plugin[group],[kind]:path}};await this.plugin.saveData(next);this.plugin.options=next;});}catch(e){new Notice(e.message);}});});
      }
    }
    new Setting(c).setName("Открыть библиотеку").addButton(b=>b.setButtonText("Кино и книги").onClick(()=>this.plugin.openCatalog()));
    c.createEl("p",{text:"Сначала укажите папки и файлы базы. Новые Bases создаются только по кнопке в каталоге. При изменении путей закройте и снова откройте библиотеку."});
    new Setting(c).setName("Использование данных").setHeading();
    c.createEl("p",{text:"Поиск отправляет введённое название и выбранный ID в TMDB, Open Library и, если указан ключ, Google Books. Текст заметок, отзывы и хайлайты не отправляются. Телеметрии нет."});
    c.createEl("p",{text:"This product uses the TMDB API but is not endorsed or certified by TMDB. Данные фильмов и изображения предоставлены TMDB; каждая карточка содержит ссылку на источник."});
    c.createEl("a",{text:"The Movie Database (TMDB)",attr:{href:"https://www.themoviedb.org/",target:"_blank",rel:"noopener noreferrer"}});
  }
}
class MediaPicker extends Plugin {
  get folders() {return this.options?.folders||FOLDERS;}
  get bases() {return this.options?.bases||BASES;}
  async createCatalog(kind) {
    const path=catalogPath(this.bases[kind],".base"),folder=catalogPath(this.folders[kind]);
    if(this.app.vault.getAbstractFileByPath(path))throw new Error("По этому пути уже есть файл или папка. Существующие файлы не изменены.");
    await ensureFolder(this.app.vault,folder);
    const parent=path.split("/").slice(0,-1).join("/");if(parent)await ensureFolder(this.app.vault,parent);
    await this.app.vault.create(path,baseText(kind,folder));new Notice("Каталог создан.");
  }
  openPicker(kind) {
    const m=new PickerModal(this,kind);this.modals.add(m);const original=m.onClose.bind(m);
    m.onClose=()=>{original();this.modals.delete(m);};m.open();
  }
  async openCatalog(kind="film") {
    let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];
    if(!leaf)leaf=this.app.workspace.getLeaf("tab");
    await leaf.setViewState({type:VIEW,active:true,state:{kind}});await this.app.workspace.revealLeaf(leaf);
  }
  key(name) {try{return window.localStorage.getItem(this.storageKey(name))||"";}catch{return "";}}
  setKey(name,value) {const k=this.storageKey(name);if(text(value))window.localStorage.setItem(k,text(value));else window.localStorage.removeItem(k);}
  storageKey(name) {return ID+":"+this.app.vault.getName()+":"+name;}
  enqueueAdd(fn) {const job=this.addTail.then(fn);this.addTail=job.catch(()=>{});return job;}
  async search(kind,query,filmYear,partial=()=>{}) {
    const local=[], tokens=titleKey(query).split(" ").filter(Boolean),folder=this.folders[kind];
    for(const file of catalogFiles(this.app,folder)) {
      const fm=frontmatter(await this.app.vault.read(file));if(fm.type!==kind)continue;
      const names=Array.isArray(fm.author||fm.director)?fm.author||fm.director:[fm.author||fm.director];
      const haystack=titleKey([fm.title,file.basename,fm.original_title,...names].filter(Boolean).join(" "));
      if(tokens.every(t=>haystack.includes(t))&&(!filmYear||String(fm.year)===filmYear))local.push({kind,source:"vault",id:file.path,title:cleanTitle(fm.title||file.basename),author:names.filter(Boolean).join(", "),year:fm.year,publisher:fm.publisher});
    }
    if(local.length)partial({items:local,warnings:["Ищу также во внешних источниках…"]});
    try {const remote=await this.api.search(kind,query,filmYear);return {items:[...local,...remote.items],warnings:remote.warnings};}
    catch(e) {if(local.length)return {items:local,warnings:[e.message]};throw e;}
  }
  async onload() {
    const data=await this.loadData();this.options={folders:{...FOLDERS},bases:{...BASES}};
    for(const group of ["folders","bases"])for(const kind of ["film","book"])if(data?.[group]?.[kind]){try{this.options[group][kind]=catalogPath(data[group][kind],group==="bases"?".base":"");}catch{new Notice("Некорректный путь каталога: использован путь по умолчанию.");}}
    this.addTail=Promise.resolve();this.api=new Api(k=>this.key(k));this.modals=new Set();this.widgets=new Set();
    this.registerView(VIEW,leaf=>new CatalogView(leaf,this));
    this.addCommand({id:"open-catalog",name:"Открыть кино и книги",callback:()=>this.openCatalog()});
    this.addCommand({id:"open-books",name:"Открыть книги",callback:()=>this.openCatalog("book")});
    this.addCommand({id:"add-film",name:"Добавить фильм",callback:()=>this.openPicker("film")});
    this.addCommand({id:"add-book",name:"Добавить книгу",callback:()=>this.openPicker("book")});
    this.addRibbonIcon("library","Кино и книги",()=>this.openCatalog());
    this.registerMarkdownCodeBlockProcessor("media-catalog",(source,element,ctx)=>{const kind=source.trim();if(!["film","book"].includes(kind)){element.setText("Укажите film или book внутри блока media-catalog.");return;}ctx.addChild(new CatalogWidget(this,element,kind,ctx.sourcePath));});
    this.addSettingTab(new PickerSettings(this.app,this));
  }
  onunload() {for(const m of this.modals||[])m.close();for(const w of this.widgets||[])w.unload();}
}
module.exports=MediaPicker;
module.exports._test={Api,SearchController,canonicalISBN,safeName,frontmatter,duplicateFiles,addCard,cardText,PickerModal,CatalogWidget,CatalogView,catalogPath,catalogFiles,baseText,FOLDERS,BASES};
