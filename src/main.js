"use strict";
const { Plugin, Modal, ItemView, Component, MarkdownRenderChild, MarkdownRenderer, PluginSettingTab, Setting, Notice, requestUrl, parseYaml, stringifyYaml, normalizePath, getLanguage } = require("obsidian");
const EN = require("./en.json");
function translate(value,locale="ru") {if(locale==="ru"||typeof value!=="string")return value;if(EN[value])return EN[value];const prefix="Путь базы должен оканчиваться на ";return value.startsWith(prefix)?EN[prefix]+value.slice(prefix.length):value;}
function defaultMetadataLocale(language) {const lang=String(language||"en").replace(/_/g,"-").toLowerCase();const regions={ru:"RU",en:"US",de:"DE",fr:"FR",es:"ES",it:"IT",pt:"BR",ja:"JP",ko:"KR",zh:"CN",nl:"NL",pl:"PL",uk:"UA",tr:"TR",ar:"SA",hi:"IN",sv:"SE",fi:"FI",cs:"CZ"};if(/^[a-z]{2,3}-[a-z]{2}$/.test(lang))return lang.split("-")[0]+"-"+lang.split("-")[1].toUpperCase();return regions[lang]?lang+"-"+regions[lang]:"en-US";}
const STATUS_CODES=["planned","in_progress","completed","on_hold","dropped"];
const STATUS_ALIASES={planned:["planned","want to watch","want to read","хочу посмотреть","хочу прочитать","в планах"],in_progress:["in_progress","watching","reading","смотрю","читаю","в процессе"],completed:["completed","watched","read","done","просмотрено","посмотрено","посмотрел","прочитано","прочитал","прочитана","завершено"],on_hold:["on_hold","on hold","paused","на паузе","отложено"],dropped:["dropped","abandoned","брошено","бросил"]};
function statusCode(value) {const v=typeof value==="string"?value.trim().toLowerCase():"";return STATUS_CODES.find(k=>STATUS_ALIASES[k].includes(v))||"other";}
function statusLabel(kind,code,locale) {return translate(({planned:kind==="film"?"Хочу посмотреть":"Хочу прочитать",in_progress:kind==="film"?"Смотрю":"Читаю",completed:kind==="film"?"Просмотрено":"Прочитано",on_hold:"На паузе",dropped:"Брошено",other:"Другие статусы"})[code],locale);}

function shortDescription(raw,fm={}) {
  const body=raw.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,"");
  const heading=/(?:^|\n)## (?:О чём|О книге|Synopsis|About the book)[ \t]*\r?\n/.exec(body);
  if(!heading)return cleanTitle(text(fm.summary)).slice(0,280);
  const rest=body.slice(heading.index+heading[0].length),end=rest.search(/(?:^|\n)## /),section=end<0?rest:rest.slice(0,end);
  return cleanTitle(section.replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[*_`]/g,"").replace(/\s+/g," ")).slice(0,280);
}
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
function baseText(kind,folder,locale="ru") {
  const creator=kind==="film"?"director":"author";
  const tr=v=>translate(v,locale),order=["file.name",creator,"year","summary","status","rating"],cards={type:"cards",name:tr("Карточки"),order,image:"note.cover",imageFit:"contain",imageAspectRatio:0.67};
  return stringifyYaml({filters:{and:["file.inFolder("+JSON.stringify(folder)+")","type == "+JSON.stringify(kind)]},properties:{title:{displayName:tr("Название")},status:{displayName:tr("Статус")},rating:{displayName:tr("Моя оценка")},[creator]:{displayName:tr(kind==="film"?"Режиссёр":"Автор")},year:{displayName:tr("Год")},summary:{displayName:tr("Описание")}},views:[cards,{type:"table",name:tr("Таблица"),order,sort:[{property:"title",direction:"ASC"}]},...STATUS_CODES.map(code=>({...cards,name:statusLabel(kind,code,locale),filters:STATUS_ALIASES[code].map(s=>"status == "+JSON.stringify(s)).join(" || ")}))]});
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = v => typeof v === "string" ? v.trim() : "";
const number = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const year = v => { const m = String(v || "").match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? Number(m[1]) : null; };
const arr = v => Array.isArray(v) ? v : [];
const isoDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
function cleanTitle(v) { return text(v).normalize("NFC").replace(/[\u0000-\u001f]/g, " ").slice(0, 500); }
function bookAuthor(value) {
  return (Array.isArray(value)?value:[value]).map(v=>cleanTitle(v).replace(/\[\[([^\]]+)\]\]/g,(_,link)=>link.split("|").pop().split("/").pop()).trim()).filter(v=>v&&!/^(автор|author|авторы)$/i.test(v)).join(", ");
}
function metadataEmpty(key,value) {
  return emptyValue(value)||(key==="author"&&!bookAuthor(value))||(key==="year"&&/^YYYY$/i.test(text(value)))||(key==="title"&&/^(название книги|название фильма|book title|movie title)$/i.test(text(value)));
}
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
function htmlText(value) {
  return String(value||"").replace(/<[^>]*>/g," ").replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,v)=>v[0]==="#"?String.fromCodePoint(v[1].toLowerCase()==="x"?parseInt(v.slice(2),16):Number(v.slice(1))):({amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" "})[v.toLowerCase()]).replace(/\s+/g," ").trim();
}
function htmlAttrs(tag){const result={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g))result[m[1]]=htmlText(m[3]);return result;}
function chitaiSearch(html){const items=[],seen=new Set();for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){const a=htmlAttrs(m[1]),id=a.href?.match(/^\/product\/[^/?#]+-(\d+)$/)?.[1];if(!id||!a.title||seen.has(id))continue;const label=a.title.match(/^(.*?)\s*\(([^()]*)\)$/);items.push({kind:"book",source:"chitai",id,path:a.href,title:cleanTitle(label?label[1]:a.title),author:label?label[2].trim():""});seen.add(id);}return items.slice(0,24);}
function chitaiDetails(html,item){
  let book;const visit=value=>{if(!value||typeof value!=="object")return;if(value['@type']==="Book"&&String(value.url).endsWith("-"+item.id)&&(!book||Object.keys(value).length>Object.keys(book).length))book=value;for(const v of Object.values(value))if(v&&typeof v==="object")Array.isArray(v)?v.forEach(visit):visit(v);};
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(htmlAttrs(m[1]).type==="application/ld+json"){try{visit(JSON.parse(m[2]));}catch{}}
  if(!book?.name||!String(book.url).endsWith("-"+item.id))throw new Error("Читай-город вернул другую книгу или изменил разметку.");
  const authors=[];
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){const a=htmlAttrs(m[1]);if(a.class?.includes("new-product-authors-item__link")&&a.href?.startsWith("/author/")){const name=htmlText(m[2]);if(name&&!authors.includes(name))authors.push(name);}}
  for(const a of Array.isArray(book.author)?book.author:[book.author])if(text(a?.name)&&!authors.includes(a.name))authors.push(a.name);
  const description=htmlText(book.description);
  let published=null;for(const m of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)){const value=htmlText(m[1]);if(value.startsWith("Год издания ")){published=year(value);break;}}
  const source="https://www.chitai-gorod.ru"+item.path,cover=validURL(typeof book.image==="string"?book.image:book.image?.url);
  return {kind:"book",source:"chitai",source_id:item.id,description,fields:{title:cleanTitle(book.name),author:authors,year:published,pages:number(Number(book.numberOfPages))||null,publisher:typeof book.publisher==="string"?book.publisher:text(book.publisher?.name)||null,isbn:[...isbnSet(Array.isArray(book.isbn)?book.isbn:String(book.isbn||"").split(/[,;]/))],cover:smallCover(cover),cover_source:source,source_url:source,genre:[],external_ratings:[]}};
}
function smallCover(url,width=304,height=438){if(!validURL(url))return null;const u=new URL(url);if(u.hostname==="img-gorod.ru"||u.hostname.endsWith(".img-gorod.ru")){u.searchParams.set("width",String(width));u.searchParams.set("height",String(height));}return u.href;}
async function localCover(app,rec,api,folders=FOLDERS){
  if(!validURL(rec.fields.cover))return rec;
  const downloaded=await api.cover(rec.fields.cover),folder=catalogPath(folders[rec.kind])+"/Обложки";
  await ensureFolder(app.vault,folder);
  const stem=safeName(rec.source+"-"+rec.source_id),base=folder+"/"+stem;let path=base+"."+downloaded.extension,n=0;
  while(app.vault.getAbstractFileByPath(path)){const old=app.vault.getAbstractFileByPath(path);if(!Array.isArray(old.children)){const bytes=new Uint8Array(await app.vault.readBinary(old)),incoming=new Uint8Array(downloaded.data);if(bytes.length===incoming.length&&bytes.every((v,i)=>v===incoming[i]))return {...rec,fields:{...rec.fields,cover:"[["+path+"]]"}};}path=base+"-"+(++n)+"."+downloaded.extension;}
  await app.vault.createBinary(path,downloaded.data);
  return {...rec,fields:{...rec.fields,cover:"[["+path+"]]"}};
}
class Api {
  constructor(keys, transport=requestUrl, delay=sleep, now=()=>Date.now(), metadataLocale=()=>"ru-RU") {
    this.chitaiTail=Promise.resolve();this.lastChitai=-Infinity;this.keys=keys; this.transport=transport; this.delay=delay; this.now=now; this.metadataLocale=metadataLocale;this.olTail=Promise.resolve(); this.lastOL=-Infinity;this.wikiTail=Promise.resolve();this.lastWiki=-Infinity;this.cache=new Map();
  }
  async response(url, headers={}) {
    let r, timer;
    try {
      r=await Promise.race([this.transport({url,headers,throw:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("timeout")),20000);})]);
    } catch { throw new Error("Ошибка сети, TLS или превышено время ожидания. Проверьте подключение на этом устройстве."); }
    finally {clearTimeout(timer);}
    if (r.status<200 || r.status>=300) throw new Error(errorText(r.status));
    return r;
  }
  async json(url,headers={}) {
    const r=await this.response(url,headers);
    const data=r.json;
    if (!data || typeof data!=="object") throw new Error("Источник вернул некорректные данные.");
    return data;
  }
  chitai(url){const job=this.chitaiTail.then(async()=>{const wait=this.lastChitai+1050-this.now();if(wait>0)await this.delay(wait);try{return await this.response(url,{"User-Agent":"Mozilla/5.0"});}finally{this.lastChitai=this.now();}});this.chitaiTail=job.catch(()=>{});return job;}
  kinopoisk(path,params={}){const token=text(this.keys("kinopoisk"));if(!token)throw new Error("Укажите ключ Кинопоиска в настройках плагина.");return this.json("https://kinopoiskapiunofficial.tech/api/"+path+"?"+new URLSearchParams(params),{"X-API-KEY":token});}
  async cover(url){
    const host=new URL(url).hostname,isChitai=host==="img-gorod.ru"||host.endsWith(".img-gorod.ru");
    for(const [width,height] of isChitai?[[304,438],[240,346],[160,231]]:[[304,438]]){
      const target=smallCover(url,width,height),r=isChitai?await this.chitai(target):await this.response(target),b=new Uint8Array(r.arrayBuffer);
      const tag=offset=>String.fromCharCode(...b.slice(offset,offset+4));
      const boxSize=b.length>=16?new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0):0;
      let avif=false;
      if(tag(4)==="ftyp"&&boxSize>=16&&boxSize<=b.length){
        avif=["avif","avis"].includes(tag(8));
        for(let offset=16;!avif&&offset+4<=boxSize;offset+=4)avif=["avif","avis"].includes(tag(offset));
      }
      const extension=b[0]===255&&b[1]===216&&b[2]===255?"jpg":b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71?"png":tag(0)==="RIFF"&&tag(8)==="WEBP"?"webp":avif?"avif":null;
      if(!extension)throw new Error("Источник вернул не изображение обложки.");
      if(b.length<=150*1024)return {data:r.arrayBuffer,extension};
    }throw new Error("Обложка больше 150 КБ. Выберите другое издание или источник.");
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
  async wiki(params) {
    const job=this.wikiTail.then(async()=>{const wait=this.lastWiki+1050-this.now();if(wait>0)await this.delay(wait);try{const data=await this.json("https://www.wikidata.org/w/api.php?"+new URLSearchParams({format:"json",...params}));if(data.error)throw new Error("Источник временно недоступен.");return data;}finally{this.lastWiki=this.now();}});this.wikiTail=job.catch(()=>{});return job;
  }
  async entities(ids,props="labels|descriptions|claims") {if(!ids.length)return {};return (await this.wiki({action:"wbgetentities",ids:ids.join("|"),props,languages:this.metadataLocale().split("-")[0]+"|en",languagefallback:"1"})).entities||{};}
  wikiLabel(entity,field="labels") {const values=entity?.[field]||{};return text(values[this.metadataLocale().split("-")[0]]?.value||values.en?.value||Object.values(values)[0]?.value);}
  claims(entity,property) {return arr(entity?.claims?.[property]).filter(c=>c.rank!=="deprecated"&&c.mainsnak?.snaktype==="value").map(c=>c.mainsnak.datavalue?.value).filter(v=>v!=null);}
  isFilm(entity) {return this.claims(entity,"P31").some(v=>["Q11424","Q24869","Q506240","Q202866","Q226730"].includes(v.id));}
  async wikiSearch(query,filmYear) {
    const found=await this.wiki({action:"wbsearchentities",search:query,language:this.metadataLocale().split("-")[0],uselang:this.metadataLocale().split("-")[0],type:"item",limit:"20"});
    const ids=arr(found.search).map(i=>i.id).filter(id=>/^Q\d+$/.test(id)),entities=await this.entities(ids);
    return {items:ids.map(id=>entities[id]).filter(e=>e&&this.isFilm(e)).map(e=>({kind:"film",source:"wikidata",id:e.id,title:this.wikiLabel(e),author:this.wikiLabel(e,"descriptions"),year:year(this.claims(e,"P577")[0]?.time)})).filter(i=>i.title&&(!filmYear||String(i.year)===filmYear)),warnings:[]};
  }
  async search(kind,query,filmYear="",provider="auto",author="") {
    if(kind==="book"&&query&&typeof query==="object") {
      const title=cleanTitle(query.title),creator=bookAuthor(query.author),steps=[...[...isbnSet(query.isbn)].map(id=>[id,""]),...(title&&creator?[[title,creator]]:[]),...(title?[[title,""]]:[])],warnings=[];
      for(const [term,writer] of steps){const result=await this.search(kind,term,"",provider,writer);warnings.push(...result.warnings);if(result.items.length)return {items:result.items,warnings:[...new Set(warnings)]};}
      return {items:[],warnings:[...new Set(warnings)]};
    }
    if(kind==="film"&&filmYear&&!/^\d{4}$/.test(filmYear))throw new Error("Год фильма: четыре цифры или пустое поле.");
    const available=kind==="film"?[...(this.keys("kinopoisk")?["kinopoisk"]:[]),...(this.keys("tmdb")?["tmdb"]:[]),"wikidata"]:["chitai","openlibrary",...(this.keys("google")?["google"]:[])];
    const chosen=provider==="auto"?available:[provider];
    if(chosen.some(name=>!available.includes(name)))throw new Error("Для выбранного источника требуется ключ API.");
    const signature=JSON.stringify([kind,query,author,filmYear,chosen,this.metadataLocale()]),cached=this.cache.get(signature);if(cached&&this.now()-cached.at<300000)return cached.result;
    const items=[],warnings=[];
    for(const source of chosen){try{const result=await this.searchDirect(kind,query,filmYear,source,author);items.push(...result.items);warnings.push(...result.warnings);if(kind==="book"&&provider==="auto"&&result.items.length)break;}catch(e){warnings.push(source+": "+e.message);}}
    const result={items,warnings};if(!warnings.length){if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(signature,{at:this.now(),result});}return result;
  }
  async searchDirect(kind, query, filmYear="",provider="auto",author="") {
    if(provider==="chitai"){const term=[query,author].filter(Boolean).join(" "),r=await this.chitai("https://www.chitai-gorod.ru/search?"+new URLSearchParams({phrase:term}));return {items:chitaiSearch(r.text),warnings:[]};}
    if(provider==="kinopoisk"){const params={keyword:query,type:"FILM",page:"1"};if(filmYear){params.yearFrom=filmYear;params.yearTo=filmYear;}const d=await this.kinopoisk("v2.2/films",params);return {items:arr(d.items).filter(m=>Number.isInteger(m.kinopoiskId)&&text(m.nameRu||m.nameOriginal)).map(m=>({kind:"film",source:"kinopoisk",id:String(m.kinopoiskId),title:cleanTitle(m.nameRu||m.nameOriginal),year:year(m.year),author:cleanTitle(m.nameOriginal)})),warnings:[]};}
    if(provider==="wikidata")return this.wikiSearch(query,filmYear);
    if(kind==="film") {
      const params={query,language:this.metadataLocale(),include_adult:"false"};
      if(filmYear) { if(!/^\d{4}$/.test(filmYear)) throw new Error("Год фильма: четыре цифры или пустое поле."); params.primary_release_year=filmYear; }
      const data=await this.tmdb("search/movie",params);
      return {items:arr(data.results).filter(m=>Number.isInteger(m.id)&&text(m.title||m.original_title)).slice(0,12).map(m=>({kind,source:"tmdb",id:String(m.id),title:cleanTitle(m.title||m.original_title),author:cleanTitle(m.original_title),year:year(m.release_date)})),warnings:[]};
    }
    const items=[], warnings=[]; const isbn=canonicalISBN(query);
    const searches=[];if(provider!=="google")searches.push((async()=>{
      try {
        const params={q:isbn?"isbn:"+isbn:[query,author].filter(Boolean).join(" "),lang:this.metadataLocale().split("-")[0],limit:"12",fields:"key,title,author_name,first_publish_year,cover_edition_key,edition_key,editions,editions.key,editions.title,editions.publish_date,editions.publisher,editions.language,editions.isbn", "editions.limit":"3"};
        let data;if(isbn)data=await this.ol("search.json",params);else{data=await this.ol("search.json",{...params,q:"title:\""+query.replace(/[\"\\]/g," ")+"\""+(author?" author:\""+author.replace(/[\"\\]/g," ")+"\"":"")});if(!arr(data.docs).length)data=await this.ol("search.json",params);}
        for(const work of arr(data.docs)) {
          const editions=arr(work.editions?.docs);if(!editions.length){const fallback=text(work.cover_edition_key)||arr(work.edition_key).find(id=>/^OL\d+M$/.test(id));if(fallback)editions.push({key:fallback,title:work.title});}
          for(const e of editions) {
            const id=text(e.key).split("/").pop(); if(!/^OL\d+M$/.test(id)) continue;
            items.push({kind,source:"openlibrary",id,title:cleanTitle(e.title||work.title),author:arr(work.author_name).filter(x=>typeof x==="string").join(", "),authors:arr(work.author_name).filter(x=>typeof x==="string"),year:year(arr(e.publish_date)[0]||e.publish_date),publisher:arr(e.publisher).join(", "),language:arr(e.language).join(", "),isbn:arr(e.isbn),first_published:number(work.first_publish_year)});
          }
        }
      } catch(e) { warnings.push("Open Library: "+e.message); }
    })());
    if(provider!=="openlibrary"&&this.keys("google")) searches.push((async()=>{
      try {
        const d=await this.google("volumes",{q:isbn?"isbn:"+isbn:[query,author].filter(Boolean).join(" "),maxResults:"8",printType:"books"});
        for(const v of arr(d.items)) { const i=v.volumeInfo||{}; if(!/^[\w-]+$/.test(text(v.id))||!text(i.title)) continue;
          items.push({kind,source:"google",id:v.id,title:cleanTitle(i.title),author:arr(i.authors).join(", "),year:year(i.publishedDate),publisher:text(i.publisher),language:text(i.language),isbn:arr(i.industryIdentifiers).filter(x=>/^ISBN/.test(x.type||"")).map(x=>String(x.identifier))}); }
      } catch(e) { warnings.push("Google Books: "+e.message); }
    })());
    await Promise.all(searches);
    const seen=new Set(); return {items:items.filter(i=>i.title&&!seen.has(i.source+":"+i.id)&&seen.add(i.source+":"+i.id)).sort((a,b)=>Number(titleKey(b.title)===titleKey(query))-Number(titleKey(a.title)===titleKey(query))).slice(0,24),warnings};
  }
  async wikiCover(entity) {
    const languages=[...new Set([this.metadataLocale().split("-")[0],"en"])];
    for(const lang of languages){if(!/^[a-z]{2,3}$/.test(lang))continue;const title=text(entity.sitelinks?.[lang+"wiki"]?.title);if(!title)continue;
      try{const data=await this.json("https://"+lang+".wikipedia.org/w/api.php?"+new URLSearchParams({action:"query",format:"json",prop:"pageimages|pageprops",titles:title,piprop:"thumbnail",pithumbsize:"500",pilicense:"any",redirects:"1"}));
        for(const page of Object.values(data.query?.pages||{})){const cover=validURL(page.thumbnail?.source);if(page.pageprops?.wikibase_item===entity.id&&cover&&new URL(cover).hostname==="upload.wikimedia.org")return {cover,cover_source:"https://"+lang+".wikipedia.org/wiki/"+encodeURIComponent(page.title.replace(/ /g,"_"))};}
      }catch{} // Image failure must not discard usable film metadata.
    }
    return {};
  }
  async details(item) {
    const ratings=[], at=isoDate();
    if(item.source==="wikidata") {
      if(!/^Q\d+$/.test(item.id))throw new Error("Некорректный идентификатор фильма.");
      const entity=(await this.entities([item.id],"labels|descriptions|claims|sitelinks"))[item.id];if(!entity||!this.isFilm(entity))throw new Error("Источник вернул другой фильм.");
      const ids=[...this.claims(entity,"P57"),...this.claims(entity,"P136"),...this.claims(entity,"P495")].map(v=>v.id).filter(id=>/^Q\d+$/.test(id||""));const related=await this.entities([...new Set(ids)].slice(0,40),"labels");
      const labels=property=>this.claims(entity,property).map(v=>this.wikiLabel(related[v.id])).filter(Boolean),src="https://www.wikidata.org/wiki/"+item.id;
      return {kind:"film",source:"wikidata",source_id:item.id,description:this.wikiLabel(entity,"descriptions"),fields:{title:this.wikiLabel(entity),year:year(this.claims(entity,"P577")[0]?.time),director:labels("P57"),genre:labels("P136"),country:labels("P495"),wikidata_id:item.id,imdb_id:text(this.claims(entity,"P345")[0])||null,tmdb_id:text(this.claims(entity,"P4947")[0])||null,source_url:src,...await this.wikiCover(entity),external_ratings:[]}};
    }
    if(item.source==="chitai"){if(!/^[0-9]+$/.test(item.id)||!/^\/product\/[^/?#]+-[0-9]+$/.test(item.path)||!item.path.endsWith("-"+item.id))throw new Error("Некорректный идентификатор книги.");return chitaiDetails((await this.chitai("https://www.chitai-gorod.ru"+item.path)).text,item);}
    if(item.source==="kinopoisk"){
      if(!/^[0-9]+$/.test(item.id))throw new Error("Некорректный идентификатор фильма.");
      const m=await this.kinopoisk("v2.2/films/"+item.id);if(String(m.kinopoiskId)!==item.id||!text(m.nameRu||m.nameOriginal))throw new Error("Источник вернул другой фильм.");
      const staff=await this.kinopoisk("v1/staff",{filmId:item.id}),source="https://www.kinopoisk.ru/film/"+item.id+"/";
      if(number(m.ratingKinopoisk)!==null&&number(m.ratingKinopoiskVoteCount)>0)ratings.push(`Кинопоиск: ${m.ratingKinopoisk} /10, оценок ${m.ratingKinopoiskVoteCount}, на ${at} — ${source}`);
      return {kind:"film",source:"kinopoisk",source_id:item.id,description:text(m.description),fields:{title:cleanTitle(m.nameRu||m.nameOriginal),original_title:cleanTitle(m.nameOriginal)||null,year:year(m.year),director:arr(staff).filter(p=>p.professionKey==="DIRECTOR").map(p=>text(p.nameRu||p.nameEn)).filter(Boolean),runtime:number(m.filmLength),genre:arr(m.genres).map(g=>g.genre),country:arr(m.countries).map(c=>c.country),kinopoisk_id:item.id,imdb_id:text(m.imdbId)||null,cover:validURL(m.posterUrlPreview)||validURL(m.posterUrl),cover_source:source,source_url:source,external_ratings:ratings}};
    }
    if(item.source==="tmdb") {
      if(!/^\d+$/.test(item.id)) throw new Error("Некорректный идентификатор фильма.");
      const m=await this.tmdb("movie/"+item.id,{language:this.metadataLocale(),append_to_response:"credits,external_ids"});
      if(String(m.id)!==item.id || !text(m.title||m.original_title)) throw new Error("Источник вернул другой фильм.");
      const src="https://www.themoviedb.org/movie/"+item.id;
      if(number(m.vote_average)!==null && number(m.vote_count)>0) ratings.push(`TMDB: ${m.vote_average} /10, оценок ${m.vote_count}, на ${at} — ${src}`);
      return {kind:"film",source:"tmdb",source_id:item.id,description:text(m.overview),fields:{title:cleanTitle(m.title||m.original_title),original_title:cleanTitle(m.original_title)||null,director:arr(m.credits?.crew).filter(c=>c.job==="Director").map(c=>text(c.name)).filter(Boolean),year:year(m.release_date),runtime:number(m.runtime)||null,genre:arr(m.genres).map(g=>text(g.name)).filter(Boolean),country:arr(m.production_countries).map(c=>text(c.name)).filter(Boolean),tmdb_id:item.id,imdb_id:text(m.external_ids?.imdb_id||m.imdb_id)||null,cover:typeof m.poster_path==="string"&&/^\/[\w./-]+$/.test(m.poster_path)?"https://image.tmdb.org/t/p/w342"+m.poster_path:null,cover_source:src,source_url:src,external_ratings:ratings}};
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
    const authors=[],refs=[...arr(e.authors)];
    if(!refs.length)for(const work of arr(e.works).slice(0,3)){const key=text(work.key);if(!/^\/works\/OL\d+W$/.test(key))continue;try{const w=await this.ol(key.slice(1)+".json");refs.push(...arr(w.authors).map(a=>a.author||a));}catch{}}
    for(const a of refs.slice(0,4)) { const key=text(a.key); if(!/^\/authors\/OL\d+A$/.test(key)) continue;
      try { const d=await this.ol(key.slice(1)+".json"); if(text(d.name)) authors.push(d.name); } catch {} }
    if(!authors.length)authors.push(...arr(item.authors).filter(v=>typeof v==="string"&&v.trim()));
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
    const movie=rec.kind==="film"&&["kinopoisk_id","tmdb_id","imdb_id"].some(k=>rec.fields[k]&&String(fm[k])===String(rec.fields[k]));
    const book=rec.kind==="book"&&[...isbnSet(fm.isbn)].some(i=>ids.has(i));
    if(sameSource||movie||book) matches.push(file);
    else if(titleKey(fm.title||file.basename)===titleKey(rec.fields.title)) similar.push(file);
  }
  return {matches,similar};
}
function cardText(rec,locale="ru",initialStatus="planned") {
  const f=rec.fields;if(statusCode(initialStatus)==="other")throw new Error("Неизвестный статус каталога.");
  const fm={...f,type:rec.kind,status:statusLabel(rec.kind,statusCode(initialStatus),"ru").toLowerCase(),summary:cleanTitle((rec.description||"").replace(/\s+/g," ")).slice(0,280),rating:null,started:null,finished:null,added:isoDate(),source:rec.source,source_id:rec.source_id,tags:[rec.kind==="film"?"кино":"книга"]};
  if(rec.kind==="book") { fm.original_title=null;fm.highlights=null;fm.isbn=arr(f.isbn).map(String); }
  const heading=translate(rec.kind==="film"?"О чём":"О книге",locale);
  return "---\n"+stringifyYaml(fm).trimEnd()+"\n---\n\n# "+f.title+"\n\n## "+heading+"\n\n"+(rec.description||"")+"\n\n## "+translate(rec.kind==="film"?"Мой отзыв":"Мои мысли",locale)+"\n\n## "+translate("Источник метаданных",locale)+"\n\n"+f.source_url+"\n\n";
}
async function ensureFolder(vault,folder) {
  let path="";for(const part of folder.split("/")) {path=path?path+"/"+part:part;
    const old=vault.getAbstractFileByPath(path);
    if(old) { if(!Array.isArray(old.children))throw new Error("Путь каталога занят файлом."); }
    else { try { await vault.createFolder(path); } catch(e) { if(!Array.isArray(vault.getAbstractFileByPath(path)?.children))throw e; } }
  }
}
async function addCard(app,rec,allowSeparate=false,folders=FOLDERS,locale="ru",initialStatus="planned",api=new Api(()=>"")) {
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
  let coverFailed=false;
  try{rec=await localCover(app,rec,api,folders);}catch{coverFailed=true;rec={...rec,fields:{...rec.fields,cover:null}};}
  const file=await app.vault.create(path,cardText(rec,locale,initialStatus));
  if(coverFailed)new Notice("Не удалось сохранить обложку. Карточка сохранена; повторите заполнение позже.",10000);
  return {created:file};
}

function providerSelect(plugin,container,kind,value,onChange) {
  const label=container.createEl("label",{text:plugin.t("Источник поиска")}),select=label.createEl("select");select.setAttribute("aria-label",plugin.t("Источник поиска"));
  for(const [id,name] of (kind==="film"?[["auto",plugin.t("Автоматически — API в приоритете")],["kinopoisk","Кинопоиск"],["wikidata","Wikidata"],["tmdb","TMDB"]]:[["auto",plugin.t("Автоматически — API в приоритете")],["chitai","Читай-город"],["openlibrary","Open Library"],["google","Google Books"]]))select.createEl("option",{text:name,attr:{value:id}});
  select.value=value;select.addEventListener("change",()=>onChange(select.value));return select;
}
function strictFrontmatter(raw) {
  const match=String(raw).match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!match){if(/^\ufeff?---(?:\r?\n|$)/.test(raw))throw new Error("Некорректный YAML: заметка пропущена.");return {values:{},body:raw};}
  const values=parseYaml(match[1])??{};if(typeof values!=="object"||Array.isArray(values))throw new Error("Некорректный YAML: заметка пропущена.");return {values,body:raw.slice(match[0].length)};
}
const emptyValue=value=>value==null||typeof value==="string"&&!value.trim()||Array.isArray(value)&&!value.length;
function metadataPatch(raw,rec) {
  const {values}=strictFrontmatter(raw);if(!emptyValue(values.type)&&values.type!==rec.kind)throw new Error("Тип заметки не совпадает.");
  const patch={},allowed=["title","original_title","director","author","year","runtime","genre","country","kinopoisk_id","tmdb_id","imdb_id","wikidata_id","cover","cover_source","source_url","external_ratings","publisher","pages","language","isbn","first_published"];
  for(const key of allowed)if(metadataEmpty(key,values[key])&&!emptyValue(rec.fields[key]))patch[key]=rec.fields[key];
  if(validURL(values.cover)&&validURL(rec.fields.cover))patch.cover=rec.fields.cover;
  if(emptyValue(values.type))patch.type=rec.kind;
  if(emptyValue(values.source)&&emptyValue(values.source_id)){patch.source=rec.source;patch.source_id=rec.source_id;}
  if(emptyValue(values.summary)&&rec.description)patch.summary=cleanTitle(rec.description.replace(/\s+/g," ")).slice(0,280);
  return patch;
}
async function scanNotes(plugin,folder,kind,recursive=true) {
  folder=catalogPath(folder);const root=plugin.app.vault.getAbstractFileByPath(folder);if(!Array.isArray(root?.children))throw new Error("Папка не найдена.");
  if(folder==="Media catalog backups"||folder.startsWith("Media catalog backups/"))throw new Error("Папка резервных копий исключена из сканирования.");
  const rows=[],warnings=[];
  for(const file of catalogFiles(plugin.app,folder).sort((a,b)=>a.path.localeCompare(b.path))){if(file.path.startsWith("Media catalog backups/")||!recursive&&file.path.slice(folder.length+1).includes("/"))continue;
    try{const raw=await plugin.app.vault.read(file),{values}=strictFrontmatter(raw);if(!emptyValue(values.type)&&values.type!==kind)continue;
      const storedTitle=cleanTitle(values.title),title=/^(название книги|название фильма|book title|movie title)$/i.test(storedTitle)?cleanTitle(file.basename):storedTitle||cleanTitle(file.basename),release=kind==="film"?year(values.year)||year(file.basename):null,ids=[...isbnSet(values.isbn)],author=bookAuthor(values.author);
      const query=kind==="book"&&ids.length?ids[0]:kind==="book"?[title,author].filter(Boolean).join(" "):title.replace(/\s*\((?:19|20)\d{2}\)\s*$/,"");
      rows.push({file,raw,query,bookQuery:kind==="book"?{title,author,isbn:ids}:null,year:release?String(release):""});
    }catch{warnings.push(file.path+": "+plugin.t("Некорректный YAML: заметка пропущена."));}
  }return {rows,warnings};
}
class ScanModal extends Modal {
  constructor(plugin,kind){super(plugin.app);this.plugin=plugin;this.kind=kind;this.closed=false;this.serial=0;this.index=0;this.rows=[];this.provider=plugin.options.providers[kind];}
  onOpen(){const c=this.contentEl;c.addClass("ksandr-media-picker");c.createEl("h2",{text:this.plugin.t("Сканировать папку")});c.createEl("p",{text:this.plugin.t("Поиск отправляет только название, автора, год или ISBN. Сохранение заполняет пустые поля после выбора; текст и личные поля сохраняются.")});
    const label=c.createEl("label",{text:this.plugin.t("Папка карточек")});this.folder=label.createEl("input");this.folder.value=this.plugin.folders[this.kind];this.folder.setAttribute("aria-label",this.plugin.t("Папка карточек"));
    const sub=c.createEl("label",{text:this.plugin.t("Включать подпапки")});this.recursive=sub.createEl("input",{attr:{type:"checkbox"}});this.recursive.checked=true;
    this.source=providerSelect(this.plugin,c,this.kind,this.provider,value=>{this.provider=value;if(this.rows.length&&!this.busy)this.showCurrent();});
    const start=c.createEl("button",{text:this.plugin.t("Собрать очередь"),cls:"mod-cta"});start.addEventListener("click",async()=>{if(this.busy)return;const seq=++this.serial;this.busy=true;start.disabled=true;try{const result=await scanNotes(this.plugin,this.folder.value,this.kind,this.recursive.checked);if(this.closed||seq!==this.serial)return;this.rows=result.rows;this.index=0;this.work.empty();for(const message of result.warnings)this.work.createEl("p",{text:message});if(!this.queue)this.queue=c.createDiv();await this.showCurrent();}catch(e){if(!this.closed)this.work.setText(this.plugin.t(e.message));}finally{this.busy=false;start.disabled=false;}});
    this.work=c.createDiv();this.undo=c.createEl("button",{text:this.plugin.t("Отменить последнее заполнение")});this.undo.disabled=!this.plugin.lastMetadataChange;this.undo.addEventListener("click",async()=>{if(this.busy)return;this.busy=true;this.undo.disabled=true;try{await this.plugin.enqueueAdd(()=>this.plugin.undoMetadata());}catch(e){new Notice(this.plugin.t(e.message));}finally{this.busy=false;this.undo.disabled=!this.plugin.lastMetadataChange;}});
  }
  async showCurrent(){const seq=++this.serial;if(this.closed)return;if(this.stage){this.stage.unload();this.stage=null;}this.stage=new Component();this.stage.load();const c=this.queue||this.work;c.empty();const row=this.rows[this.index];if(!row){c.createEl("p",{text:this.plugin.t(this.rows.length?"Очередь завершена.":"Подходящих заметок в папке нет. Проверьте папку и поле type (film или book).")});return;}
    c.createEl("h3",{text:(this.index+1)+" / "+this.rows.length+" · "+row.file.path});const open=c.createEl("button",{text:this.plugin.t("Открыть заметку")});this.stage.registerDomEvent(open,"click",()=>this.app.workspace.getLeaf("tab").openFile(row.file));
    const query=c.createEl("input");query.value=row.query;query.setAttribute("aria-label",this.plugin.t("Название"));const y=c.createEl("input");y.value=row.year;y.setAttribute("aria-label",this.plugin.t("Год"));if(this.kind!=="film")y.hidden=true;
    const find=c.createEl("button",{text:this.plugin.t("Найти варианты")}),skip=c.createEl("button",{text:this.plugin.t("Пропустить")});this.stage.registerDomEvent(skip,"click",()=>{if(this.busy)return;this.index++;this.showCurrent();});
    const result=c.createDiv(),preview=c.createDiv();let request=0;
    const search=async()=>{const ticket=++request;preview.empty();result.setText(this.plugin.t("Ищу…"));try{const found=await this.plugin.api.search(this.kind,this.kind==="book"&&query.value===row.query?row.bookQuery:query.value,y.value.trim(),this.provider);if(this.closed||seq!==this.serial||ticket!==request)return;result.empty();for(const warning of found.warnings)result.createEl("p",{text:this.plugin.t(warning)});if(!found.items.length)result.createEl("p",{text:this.plugin.t("Ничего не найдено. Попробуйте название с автором или другой язык.")});
      for(const item of found.items){const b=result.createEl("button",{text:[item.title,item.author,item.year,item.source].filter(Boolean).join(" · "),cls:"kmp-result"});this.stage.registerDomEvent(b,"click",async()=>{const selection=++request;preview.setText(this.plugin.t("Загружаю выбранное издание…"));try{const rec=await this.plugin.api.details(item);if(this.closed||seq!==this.serial||selection!==request)return;const raw=await this.app.vault.read(row.file),patch=metadataPatch(raw,rec);preview.empty();preview.createEl("h4",{text:rec.fields.title});if(validURL(rec.fields.cover))preview.createEl("img",{cls:"kmp-cover",attr:{src:rec.fields.cover,alt:rec.fields.title,loading:"lazy"}});preview.createEl("p",{text:rec.description||this.plugin.t("Нет описания")});preview.createEl("p",{text:this.plugin.t("Будут заполнены только пустые поля:")});for(const [key,value] of Object.entries(patch))preview.createEl("p",{text:key+": "+(Array.isArray(value)?value.join(", "):value)});
        if(!Object.keys(patch).length){preview.createEl("p",{text:this.plugin.t("Нет пустых полей для заполнения.")});return;}
        const save=preview.createEl("button",{text:this.plugin.t("Заполнить пустые поля"),cls:"mod-cta"});this.stage.registerDomEvent(save,"click",async()=>{if(this.busy||this.closed||seq!==this.serial||selection!==request)return;this.busy=true;save.disabled=true;try{await this.plugin.enqueueAdd(()=>this.plugin.mergeMetadata(row.file,rec,raw));this.undo.disabled=false;if(!this.closed){this.index++;await this.showCurrent();}}catch(e){if(!this.closed)preview.createEl("p",{text:this.plugin.t(e.message)});}finally{this.busy=false;save.disabled=false;}});
      }catch(e){if(!this.closed&&seq===this.serial&&selection===request)preview.setText(this.plugin.t(e.message));}});}
    }catch(e){if(!this.closed&&seq===this.serial&&ticket===request)result.setText(this.plugin.t(e.message));}};
    this.stage.registerDomEvent(find,"click",search);this.stage.registerDomEvent(query,"input",()=>{++request;preview.empty();});this.stage.registerDomEvent(y,"input",()=>{++request;preview.empty();});void search();
  }
  onClose(){this.closed=true;++this.serial;if(this.stage)this.stage.unload();this.contentEl.empty();}
}


function mediaWikiLink(file){if(!file?.path||file.extension!=="md"||/[\[\]#^|\r\n]/.test(file.path))throw new Error("Невозможно создать ссылку на этот файл.");return "[["+file.path.replace(/\.md$/,"")+"]]";}
function linkedTaskPaths(app,file,values){
  const links=values.media_catalog_tasks;if(links==null)return [];if(!Array.isArray(links)||links.some(link=>typeof link!=="string"))throw new Error("Поле media_catalog_tasks должно содержать список ссылок.");
  return links.map(link=>{const name=link.replace(/^\[\[|\]\]$/g,"").split("|")[0];return app.metadataCache?.getFirstLinkpathDest(name,file.path)?.path||(name.endsWith(".md")?name:name+".md");});
}
function validTaskDate(value){if(!value)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+"T00:00:00Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
class TaskNotesModal extends Modal {
  constructor(plugin,file){super(plugin.app);this.plugin=plugin;this.file=file;this.closed=false;this.busy=false;this.serial=0;}
  onOpen(){this.render().catch(e=>{if(!this.closed)this.contentEl.setText(this.plugin.t(e.message));});}
  async render(){const seq=++this.serial,c=this.contentEl;c.empty();c.addClass("ksandr-media-picker");if(this.stage)this.stage.unload();this.stage=new Component();this.stage.load();
    c.createEl("h2",{text:this.plugin.t("В задачу — TaskNotes")});
    let api,media,tasks;try{api=this.plugin.taskNotesApi();media=await this.plugin.mediaForTask(this.file);if(typeof api.lifecycle?.ready==="function")await api.lifecycle.ready();tasks=await api.tasks.list();if(!Array.isArray(tasks))throw new Error("Не удалось получить задачи TaskNotes.");}catch(e){if(!this.closed&&seq===this.serial){c.createEl("p",{text:this.plugin.t(e.message)});const retry=c.createEl("button",{text:this.plugin.t("Обновить")});this.stage.registerDomEvent(retry,"click",()=>this.render());}return;}
    if(this.closed||seq!==this.serial)return;
    const refs=new Set(linkedTaskPaths(this.app,this.file,media.values)),mediaLink=mediaWikiLink(this.file),linked=[];
    for(const task of tasks){if(typeof task.path!=="string")continue;const file=this.app.vault.getAbstractFileByPath(task.path);if(file?.extension!=="md")continue;let linkedByBody=false;try{linkedByBody=(await this.app.vault.read(file)).includes(mediaLink);}catch{}if(this.closed||seq!==this.serial)return;if(refs.has(task.path)||linkedByBody)linked.push(task);}
    c.createEl("p",{text:String(media.values.title||this.file.basename)});c.createEl("p",{text:this.plugin.t("Задача и карточка связаны ссылками. Статусы книги или фильма автоматически не меняются.")});
    const message=c.createEl("p");message.setAttribute("role","status");
    const run=async action=>{if(this.busy||this.closed)return;this.busy=true;try{await action();if(!this.closed)await this.render();}catch(e){if(!this.closed&&seq===this.serial)message.setText(this.plugin.t(e.message));else if(!this.closed)new Notice(this.plugin.t(e.message));}finally{this.busy=false;}};
    const buttons=(task,parent)=>{const open=parent.createEl("button",{text:this.plugin.t("Открыть задачу")});this.stage.registerDomEvent(open,"click",()=>run(()=>this.plugin.openTaskNote(task.path)));
      if(api.hasCapability("time.write")&&api.hasCapability("time.read")&&typeof api.time?.start==="function"&&typeof api.time?.active==="function"){
        const start=parent.createEl("button",{text:this.plugin.t("Начать сейчас")});this.stage.registerDomEvent(start,"click",()=>run(()=>this.plugin.enqueueAdd(()=>this.plugin.startMediaTask(task.path))));
        if(typeof api.time.stop==="function"){const stop=parent.createEl("button",{text:this.plugin.t("Остановить таймер")});this.stage.registerDomEvent(stop,"click",()=>run(()=>this.plugin.enqueueAdd(()=>this.plugin.stopMediaTask(task.path))));}
      }
    };
    if(linked.length){c.createEl("h3",{text:this.plugin.t("Связанные задачи")});for(const task of linked){const row=c.createDiv({cls:"kmp-task-row"});row.createEl("p",{text:[task.title,task.status].filter(Boolean).join(" · ")});buttons(task,row);}}
    const titleLabel=c.createEl("label",{text:this.plugin.t("Название задачи")}),title=titleLabel.createEl("input");title.value=this.plugin.t(media.values.type==="book"?"Читать":"Посмотреть")+" — "+String(media.values.title||this.file.basename);title.setAttribute("aria-label",this.plugin.t("Название задачи"));
    const dateLabel=c.createEl("label",{text:this.plugin.t("Запланировать на — необязательно")}),date=dateLabel.createEl("input",{attr:{type:"date"}});date.setAttribute("aria-label",this.plugin.t("Запланировать на — необязательно"));
    let allowSeparate=null;if(linked.length){const separate=c.createEl("label",{text:this.plugin.t("Создать отдельную задачу или сеанс")});allowSeparate=separate.createEl("input",{attr:{type:"checkbox"}});}
    const create=c.createEl("button",{text:this.plugin.t("Создать задачу"),cls:"mod-cta"});create.disabled=linked.length>0;if(allowSeparate)this.stage.registerDomEvent(allowSeparate,"change",()=>{create.disabled=!allowSeparate.checked;});
    this.stage.registerDomEvent(create,"click",()=>run(()=>this.plugin.enqueueAdd(()=>this.plugin.createMediaTask(this.file,title.value,date.value,Boolean(allowSeparate?.checked)))));
    c.createEl("h3",{text:this.plugin.t("Добавить в существующую задачу")});const query=c.createEl("input",{attr:{type:"search",placeholder:this.plugin.t("Поиск задач по названию")}});query.setAttribute("aria-label",this.plugin.t("Поиск задач по названию"));const results=c.createDiv({cls:"kmp-results"});
    const filter=()=>{results.empty();const tokens=titleKey(query.value).split(" ").filter(Boolean),matches=tasks.filter(task=>typeof task.path==="string"&&task.path!==this.file.path&&!refs.has(task.path)&&!task.archived&&tokens.every(token=>titleKey(task.title||task.path).includes(token)));for(const task of matches.slice(0,30)){const button=results.createEl("button",{text:[task.title||task.path,task.status].filter(Boolean).join(" · ")+" · "+this.plugin.t("Добавить ссылку"),cls:"kmp-result"});this.stage.registerDomEvent(button,"click",()=>run(()=>this.plugin.enqueueAdd(()=>this.plugin.linkMediaTask(this.file,task.path))));}if(matches.length>30)results.createEl("p",{text:this.plugin.t("Уточните поиск — показаны первые 30 задач.")});if(!matches.length)results.createEl("p",{text:this.plugin.t("Задачи не найдены.")});};this.stage.registerDomEvent(query,"input",filter);filter();
    if(this.plugin.lastTaskLink){const undo=c.createEl("button",{text:this.plugin.t("Отменить последнюю привязку")});this.stage.registerDomEvent(undo,"click",()=>run(()=>this.plugin.enqueueAdd(()=>this.plugin.undoTaskLink())));}
  }
  onClose(){this.closed=true;++this.serial;if(this.stage)this.stage.unload();this.contentEl.empty();}
}

class PickerModal extends Modal {
  constructor(plugin,kind) { super(plugin.app);this.plugin=plugin;this.kind=kind;this.seq=0;this.closed=true;this.busy=false;this.allowSeparate=false; }
  onOpen() {
    this.closed=false;const c=this.contentEl;c.addClass("ksandr-media-picker");
    c.createEl("h2",{text:this.kind==="film"?this.plugin.t("Добавить фильм"):this.plugin.t("Добавить книгу")});
    this.query=c.createEl("input",{type:"search",placeholder:this.kind==="film"?this.plugin.t("Название фильма"):this.plugin.t("Название книги; можно добавить автора")});
    this.query.setAttribute("aria-label",this.plugin.t("Название"));
    if(this.kind==="film") {this.yearInput=c.createEl("input",{type:"text",placeholder:this.plugin.t("Год — необязательно")});this.yearInput.setAttribute("inputmode","numeric");this.yearInput.setAttribute("aria-label",this.plugin.t("Год выпуска"));}
    this.status=c.createEl("p",{text:this.plugin.t("Введите хотя бы два символа.")});this.status.setAttribute("role","status");this.status.setAttribute("aria-live","polite");
    this.results=c.createDiv({cls:"kmp-results"});this.preview=c.createDiv({cls:"kmp-preview"});
    this.controller=new SearchController((q,y,partial)=>this.plugin.search?this.plugin.search(this.kind,q,y,partial,this.providerValue||this.plugin.options.providers[this.kind]):this.plugin.api.search(this.kind,q,y),state=>this.render(state));
    const change=()=>{++this.seq;this.record=null;this.allowSeparate=false;this.preview.empty();this.controller.input(this.query.value,this.yearInput?.value.trim()||"");};
    this.query.addEventListener("input",change);this.yearInput?.addEventListener("input",change);
    this.provider=providerSelect(this.plugin,c,this.kind,this.plugin.options.providers[this.kind],value=>{this.providerValue=value;change();});
    this.query.focus();
  }
  render(state) {
    this.results.empty();
    const msg={idle:this.plugin.t("Введите хотя бы два символа."),waiting:"",loading:this.plugin.t("Ищу…"),error:state.error,done:state.items?.length?this.plugin.t("Выберите вариант."):this.plugin.t("Ничего не найдено. Попробуйте название с автором или другой язык.")};
    this.status.setText(this.plugin.t(msg[state.state]||""));
    for(const w of state.warnings||[])this.results.createEl("p",{text:this.plugin.t(w)});
    for(const item of state.items||[]) {
      const button=this.results.createEl("button",{text:[item.title,item.author,item.year,item.publisher,item.language,item.source].filter(Boolean).join(" · "),cls:"kmp-result"});
      button.addEventListener("click",()=>this.select(item));
    }
  }
  async select(item) {
    if(item.source==="vault") {
      ++this.seq;this.preview.empty();this.preview.createEl("h3",{text:item.title});this.preview.createEl("p",{text:this.plugin.t("Эта карточка уже есть в каталоге.")});
      const b=this.preview.createEl("button",{text:this.plugin.t("Открыть карточку"),cls:"mod-cta"});
      b.addEventListener("click",async()=>{const file=this.app.vault.getAbstractFileByPath(item.id);if(file&&item.id.startsWith(this.plugin.folders[this.kind]+"/")&&item.id.endsWith(".md")){await this.app.workspace.getLeaf(false).openFile(file);this.close();}});return;
    }
    const seq=++this.seq;this.preview.empty();this.preview.createEl("p",{text:this.plugin.t("Загружаю выбранное издание…")});
    try {
      const rec=await this.plugin.api.details(item);if(this.closed||seq!==this.seq)return;
      this.record=rec;this.allowSeparate=false;this.showPreview(rec);
    } catch(e) { if(!this.closed&&seq===this.seq){this.preview.empty();this.preview.createEl("p",{text:this.plugin.t(e.message)});} }
  }
  showPreview(rec) {
    const p=this.preview;p.empty();p.createEl("h3",{text:rec.fields.title});
    p.createEl("p",{text:rec.description||this.plugin.t("Нет описания"),cls:"kmp-card-summary"});
    if(validURL(rec.fields.cover)){const img=p.createEl("img",{attr:{src:rec.fields.cover,alt:this.plugin.t("Обложка"),loading:"lazy"}});img.addClass("kmp-cover");}
    for(const [label,key] of [[this.plugin.t("Автор / режиссёр"),rec.kind==="film"?"director":"author"],[this.plugin.t("Год издания / выпуска"),"year"],[this.plugin.t("Первое издание"),"first_published"],[this.plugin.t("Издательство"),"publisher"],[this.plugin.t("Язык"),"language"],[this.plugin.t("Страниц"),"pages"],["ISBN","isbn"],[this.plugin.t("Длительность, мин"),"runtime"]]) {
      const value=rec.fields[key]; if(value!=null&&value!==""&&(!Array.isArray(value)||value.length))p.createEl("p",{text:label+": "+(Array.isArray(value)?value.join(", "):value)});
    }
    p.createEl("a",{text:this.plugin.t("Открыть источник"),attr:{href:rec.fields.source_url,target:"_blank",rel:"noopener noreferrer"}});
    this.addButton=p.createEl("button",{text:this.plugin.t("Добавить в каталог"),cls:"mod-cta"});this.addButton.disabled=this.busy;
    this.addButton.addEventListener("click",()=>this.add(rec));
  }
  async add(rec) {
    if(this.busy||this.closed)return;this.busy=true;this.addButton.disabled=true;
    try {
      const result=await this.plugin.enqueueAdd(async()=>addCard(this.app,rec,this.allowSeparate,this.plugin.folders,this.plugin.locale,await this.plugin.storedStatus(rec.kind,"planned"),this.plugin.api));
      if(this.closed)return;
      if(result.similar) {
        this.preview.createEl("p",{text:this.plugin.t("Карточка с таким названием уже есть. Проверьте автора и издание.")});
        for(const file of result.similar){const b=this.preview.createEl("button",{text:this.plugin.t("Открыть: ")+file.basename});b.addEventListener("click",()=>this.app.workspace.getLeaf(false).openFile(file));}
        const b=this.preview.createEl("button",{text:this.plugin.t("Подтверждаю: это другое издание / произведение")});
        b.addEventListener("click",()=>{this.allowSeparate=true;this.add(rec);});return;
      }
      if(result.multiple)new Notice(this.plugin.t("Найдено несколько карточек с одним ID. Открыта первая; файлы не изменены."));
      else new Notice(result.existing?this.plugin.t("Карточка уже есть — открываю."):this.plugin.t("Карточка добавлена."));
      await this.app.workspace.getLeaf(false).openFile(result.existing||result.created);this.close();
    } catch(e) { if(!this.closed)this.preview.createEl("p",{text:this.plugin.t(e.message)}); }
    finally {this.busy=false;if(this.addButton)this.addButton.disabled=false;}
  }
  onClose() {this.closed=true;++this.seq;this.controller?.close();this.contentEl.empty();}
}
class CatalogWidget extends MarkdownRenderChild {
  constructor(plugin,element,kind,sourcePath="",mode="cards") {super(element);this.plugin=plugin;this.element=element;this.kind=kind;this.sourcePath=sourcePath;this.mode=["cards","table","kanban"].includes(mode)?mode:"cards";this.serial=0;this.closed=false;}
  onload() {this.closed=false;this.plugin.widgets.add(this);this.refresh().catch(()=>{if(!this.closed)new Notice(this.plugin.t("Не удалось открыть каталог."));});}
  async refresh() {
    const seq=++this.serial,c=this.element;c.empty();c.addClass("kmp-catalog");
    if(this.renderer){this.removeChild(this.renderer);this.renderer=null;}
    this.renderer=this.addChild(new Component());
    const bar=c.createDiv({cls:"kmp-catalog-bar"});
    bar.createEl("h3",{text:this.kind==="film"?this.plugin.t("Кино"):this.plugin.t("Книги")});
    const add=bar.createEl("button",{text:this.kind==="film"?this.plugin.t("＋ Добавить фильм"):this.plugin.t("＋ Добавить книгу"),cls:"mod-cta"});
    this.renderer.registerDomEvent(add,"click",()=>this.plugin.openPicker(this.kind));
    const scan=bar.createEl("button",{text:this.plugin.t("Сканировать папку")});this.renderer.registerDomEvent(scan,"click",()=>this.plugin.openScanner(this.kind));
    const controls=c.createDiv({cls:"kmp-layouts"});controls.setAttribute("aria-label",this.plugin.t("Представления"));
    for(const [mode,label] of [["cards",this.plugin.t("Карточки")],["table",this.plugin.t("Таблица")],["kanban",this.plugin.t("Канбан")]]) {
      const button=controls.createEl("button",{text:this.plugin.t(label)});button.setAttribute("aria-pressed",String(this.mode===mode));
      this.renderer.registerDomEvent(button,"click",()=>{this.mode=mode;this.onModeChange?.(mode);this.refresh().catch(()=>new Notice(this.plugin.t("Не удалось открыть каталог.")));});
    }
    const refresh=bar.createEl("button",{text:this.plugin.t("Обновить")});this.renderer.registerDomEvent(refresh,"click",()=>this.refresh());
    const basePath=this.plugin.bases[this.kind],base=this.plugin.app.vault.getAbstractFileByPath(basePath);
    if(base?.extension==="base"&&this.mode!=="table"){const open=bar.createEl("button",{text:this.plugin.t("Открыть файл базы")});this.renderer.registerDomEvent(open,"click",()=>this.plugin.app.workspace.getLeaf(false).openFile(base));}
    if(this.plugin.lastStatusChange){const undo=bar.createEl("button",{text:this.plugin.t("Отменить смену статуса")});this.renderer.registerDomEvent(undo,"click",async()=>{try{await this.plugin.enqueueAdd(()=>this.plugin.undoStatus());await this.refresh();}catch(e){new Notice(this.plugin.t(e.message));}});}
    if(this.mode!=="table") {
      c.createEl("p",{text:this.plugin.t(this.mode==="kanban"?this.plugin.t("Перетащите карточку в колонку или выберите статус в ней."):this.plugin.t("Обложки, названия, описания и выбор статуса.")),cls:"kmp-help"});
      if(!base){const setup=bar.createEl("button",{text:this.plugin.t("Создать недостающий каталог")});this.renderer.registerDomEvent(setup,"click",async()=>{setup.disabled=true;try{await this.plugin.enqueueAdd(()=>this.plugin.createCatalog(this.kind));if(!this.closed&&seq===this.serial)await this.refresh();}catch(e){new Notice(this.plugin.t(e.message));}finally{setup.disabled=false;}});}
      try{await this.renderCards(c,seq);}catch(e){if(!this.closed&&seq===this.serial)c.createEl("p",{text:this.plugin.t("Не удалось загрузить карточки.")});}return;
    }
    c.createEl("p",{text:this.plugin.t("Свойства и сортировка в штатном Bases."),cls:"kmp-help"});
    if(!base||base.extension!=="base") {
      c.createEl("p",{text:this.plugin.t("Файл базы пока не найден: ")+basePath+this.plugin.t(". Проверьте путь в настройках или создайте каталог.")});
      const setup=c.createEl("button",{text:this.plugin.t("Создать недостающий каталог")});
      this.renderer.registerDomEvent(setup,"click",async()=>{setup.disabled=true;try{await this.plugin.enqueueAdd(()=>this.plugin.createCatalog(this.kind));if(!this.closed&&seq===this.serial)await this.refresh();}catch(e){if(!this.closed)new Notice(e.message);}finally{setup.disabled=false;}});return;
    }
    const open=bar.createEl("button",{text:this.plugin.t("Открыть файл базы")});
    this.renderer.registerDomEvent(open,"click",()=>this.plugin.app.workspace.getLeaf(false).openFile(base));
    const target=c.createDiv({cls:"kmp-base markdown-rendered"});
    try {const config=parseYaml(await this.plugin.app.vault.read(base)),view=arr(config?.views).find(v=>v.type==="table");const suffix=typeof view?.name==="string"&&!/[\[\]|\r\n]/.test(view.name)?"#"+view.name:"";await MarkdownRenderer.render(this.plugin.app,"![["+basePath+suffix+"]]",target,this.sourcePath,this.renderer);}
    catch {if(!this.closed&&seq===this.serial)target.setText("Не удалось встроить Bases. Включите штатный плагин Bases и откройте файл базы кнопкой выше.");}
  }
  async renderCards(container,seq) {
    const items=[];
    for(const file of catalogFiles(this.plugin.app,this.plugin.folders[this.kind])) {
      const raw=await this.plugin.app.vault.read(file),fm=frontmatter(raw);if(fm.type===this.kind)items.push({file,fm,summary:shortDescription(raw,fm)});
    }
    if(this.closed||seq!==this.serial)return;
    items.sort((a,b)=>String(a.fm.title||a.file.basename).localeCompare(String(b.fm.title||b.file.basename),this.plugin.locale));
    const board=container.createDiv({cls:this.mode==="kanban"?"kmp-board":"kmp-card-grid"});
    if(!items.length)container.createEl("p",{text:this.plugin.t("Карточек пока нет. Добавьте фильм или книгу.")});
    if(this.mode==="kanban") {
      const codes=[...STATUS_CODES,...(items.some(i=>statusCode(i.fm.status)==="other")?["other"]:[])];
      for(const code of codes){const list=items.filter(i=>statusCode(i.fm.status)===code),column=board.createDiv({cls:"kmp-column"});column.createEl("h4",{text:statusLabel(this.kind,code,this.plugin.locale)+" · "+list.length});
        if(code!=="other") {this.renderer.registerDomEvent(column,"dragover",event=>{event.preventDefault();});this.renderer.registerDomEvent(column,"drop",async event=>{event.preventDefault();const path=event.dataTransfer?.getData("application/x-media-catalog-note");const item=items.find(i=>i.file.path===path);if(item)await this.changeStatus(item,code);});}
        for(const item of list)this.renderCard(column,item);if(!list.length)column.createEl("p",{text:this.plugin.t("Пусто"),cls:"kmp-help"});
      }
    }else for(const item of items)this.renderCard(board,item);
  }
  renderCard(container,item) {
    const {file,fm,summary}=item,card=container.createEl("article",{cls:"kmp-media-card"});card.setAttribute("draggable",String(this.mode==="kanban"));
    this.renderer.registerDomEvent(card,"dragstart",event=>{event.dataTransfer?.setData("application/x-media-catalog-note",file.path);if(event.dataTransfer)event.dataTransfer.effectAllowed="move";});
    const openNote=async()=>{try{await this.plugin.app.workspace.getLeaf("tab").openFile(file);}catch{new Notice(this.plugin.t("Не удалось открыть заметку."));}};
    const cover=card.createEl("button",{cls:"kmp-media-cover",attr:{type:"button","aria-label":this.plugin.t("Открыть заметку")+": "+String(fm.title||file.basename)}});
    this.renderer.registerDomEvent(cover,"click",openNote);
    let url=validURL(fm.cover);
    if(!url&&typeof fm.cover==="string") {const local=this.plugin.app.metadataCache?.getFirstLinkpathDest(fm.cover.replace(/^\[\[|\]\]$/g,""),file.path);if(local)url=this.plugin.app.vault.getResourcePath(local);}
    const fallback=()=>{cover.empty();cover.createEl("span",{text:this.plugin.t("Обложка недоступна")});};
    if(url){const image=cover.createEl("img",{attr:{src:url,alt:String(fm.title||file.basename),loading:"lazy"}});image.setAttribute("draggable","false");this.renderer.registerDomEvent(image,"error",fallback);}else fallback();
    const title=card.createEl("button",{text:String(fm.title||file.basename),cls:"kmp-card-title"});this.renderer.registerDomEvent(title,"click",openNote);
    const creator=fm.author||fm.director;card.createEl("p",{text:[Array.isArray(creator)?creator.join(", "):creator,fm.year].filter(Boolean).join(" · "),cls:"kmp-card-meta"});
    card.createEl("p",{text:summary||this.plugin.t("Нет описания"),cls:"kmp-card-summary"});
    const open=card.createEl("button",{text:this.plugin.t("Открыть заметку"),cls:"kmp-card-open",attr:{type:"button"}});this.renderer.registerDomEvent(open,"click",openNote);
    const task=card.createEl("button",{text:this.plugin.t("В задачу"),cls:"kmp-card-open",attr:{type:"button"}});this.renderer.registerDomEvent(task,"click",()=>this.plugin.openTaskModal(file));
    let taskPaths=[];try{taskPaths=linkedTaskPaths(this.plugin.app,file,fm);}catch(e){card.createEl("p",{text:this.plugin.t(e.message),cls:"kmp-help"});}
    for(const path of taskPaths){const taskFile=this.plugin.app.vault.getAbstractFileByPath(path);if(taskFile?.extension==="md"){const linked=card.createEl("button",{text:this.plugin.t("Задача: ")+taskFile.basename,cls:"kmp-card-open"});this.renderer.registerDomEvent(linked,"click",()=>this.plugin.openTaskNote(path).catch(e=>new Notice(this.plugin.t(e.message))));}}
    const label=card.createEl("label",{text:this.plugin.t("Статус")}),select=label.createEl("select");select.setAttribute("aria-label",this.plugin.t("Статус")+": "+String(fm.title||file.basename));
    const current=statusCode(fm.status);if(current==="other")select.createEl("option",{text:typeof fm.status==="string"?fm.status:this.plugin.t("Без статуса"),attr:{value:"other"}});
    for(const code of STATUS_CODES)select.createEl("option",{text:statusLabel(this.kind,code,this.plugin.locale),attr:{value:code}});select.value=current;
    this.renderer.registerDomEvent(select,"change",async()=>{const code=select.value;select.disabled=true;try{await this.changeStatus(item,code);}finally{select.disabled=false;}});
  }
  async changeStatus(item,code) {try{await this.plugin.enqueueAdd(()=>this.plugin.changeStatus(item.file,code,item.fm.status));if(!this.closed)await this.refresh();}catch(e){new Notice(this.plugin.t(e.message));if(!this.closed)await this.refresh();}}
  onunload() {this.closed=true;++this.serial;this.plugin.widgets.delete(this);this.element.empty();}
}
class CatalogView extends ItemView {
  constructor(leaf,plugin) {super(leaf);this.plugin=plugin;this.kind="film";this.mode="cards";}
  getViewType() {return VIEW;}
  getDisplayText() {return this.plugin.t("Кино и книги");}
  getIcon() {return "library";}
  getState() {return {kind:this.kind,mode:this.widget?.mode||this.mode};}
  async setState(state,result) {this.kind=state?.kind==="book"?"book":"film";this.mode=["cards","table","kanban"].includes(state?.mode)?state.mode:this.mode;await this.render();await super.setState(state,result);}
  async onOpen() {await this.render();}
  async render() {
    if(this.widget){this.removeChild(this.widget);this.widget=null;}
    const c=this.contentEl;c.empty();c.addClass("kmp-library");
    const tabs=c.createDiv({cls:"kmp-tabs"});
    for(const [kind,label] of [["film",this.plugin.t("Кино")],["book",this.plugin.t("Книги")]]) {
      const b=tabs.createEl("button",{text:label});b.setAttribute("aria-pressed",String(this.kind===kind));
      b.addEventListener("click",async()=>{this.kind=kind;await this.render();this.app.workspace.requestSaveLayout();});
    }
    this.widget=this.addChild(new CatalogWidget(this.plugin,c.createDiv(),this.kind,"",this.mode));this.widget.onModeChange=mode=>{this.mode=mode;this.app.workspace.requestSaveLayout();};
  }
  async onClose() {if(this.widget){this.removeChild(this.widget);this.widget=null;}this.contentEl.empty();}
}
class PickerSettings extends PluginSettingTab {
  display() {
    const c=this.containerEl;c.empty();new Setting(c).setName(this.plugin.t("Источники")).setHeading();
    new Setting(c).setName(this.plugin.t("Язык интерфейса")).setDesc(this.plugin.t("Язык интерфейса и язык данных настраиваются отдельно. Перезапустите плагин после смены языка интерфейса.")).addDropdown(d=>d.addOption("auto",this.plugin.t("Автоматически")).addOption("ru","Русский").addOption("en","English").setValue(this.plugin.options.uiLanguage).onChange(async value=>{try{await this.plugin.enqueueAdd(async()=>{const next={...this.plugin.options,uiLanguage:value};await this.plugin.saveData(next);this.plugin.options=next;});}catch{new Notice(this.plugin.t("Не удалось сохранить настройки."));}}));
    new Setting(c).setName(this.plugin.t("Язык метаданных фильмов")).setDesc(this.plugin.t("Код языка, например ru-RU, en-US или de-DE. Язык издания книги берётся из источника и не переводится.")).addText(t=>{t.setValue(this.plugin.options.metadataLocale);t.inputEl.addEventListener("change",async()=>{const value=t.inputEl.value.trim();if(!/^[a-z]{2,3}-[A-Z]{2}$/.test(value)){new Notice(this.plugin.t("Неверный код языка."));return;}try{await this.plugin.enqueueAdd(async()=>{const next={...this.plugin.options,metadataLocale:value};await this.plugin.saveData(next);this.plugin.options=next;});}catch{new Notice(this.plugin.t("Не удалось сохранить настройки."));}});});
    c.createEl("p",{text:this.plugin.t("Ключи сохраняются в локальном хранилище этого устройства, вне файлов Vault. На Mac и телефоне настройте их отдельно. Книги можно искать в Open Library без ключа.")});
    for(const [key,label,description] of [["kinopoisk","Кинопоиск API key","Ключ kinopoiskapiunofficial.tech. Хранится только на этом устройстве."],["tmdb","TMDB Read Access Token",this.plugin.t("Для поиска фильмов. API Read Access Token из настроек TMDB.")],["google","Google Books API key",this.plugin.t("Дополнительный источник книг. Можно оставить пустым.")]]) {
      new Setting(c).setName(label).setDesc(description).addText(t=>{t.inputEl.type="password";t.setValue(this.plugin.key(key));t.onChange(v=>{try{this.plugin.setKey(key,v);}catch{new Notice(this.plugin.t("Локальное хранилище ключей недоступно."));}});});
    }
    for(const [kind,label] of [["film","Кино"],["book","Книги"]]){const box=c.createDiv();box.createEl("h4",{text:this.plugin.t(label)});providerSelect(this.plugin,box,kind,this.plugin.options.providers[kind],async value=>{try{await this.plugin.enqueueAdd(async()=>{const next={...this.plugin.options,providers:{...this.plugin.options.providers,[kind]:value}};await this.plugin.saveData(next);this.plugin.options=next;});}catch{new Notice(this.plugin.t("Не удалось сохранить настройки."));}});}
    c.createEl("p",{text:this.plugin.t("Книги: сначала Читай-город, затем Open Library; Google Books доступен с ключом. Кино: Кинопоиск с ключом, TMDB и Wikidata.")});
    c.createEl("p",{text:this.plugin.t("Другие плагины Obsidian имеют доступ к среде приложения и локальному хранилищу. Ключи не записываются в data.json и не синхронизируются этим плагином.")});
    new Setting(c).setName(this.plugin.t("Каталоги")).setHeading();
    for(const [kind,label] of [["film",this.plugin.t("Кино")],["book",this.plugin.t("Книги")]]) {
      for(const [group,name,suffix] of [["folders",this.plugin.t("Папка карточек"),""],["bases",this.plugin.t("Файл базы"),".base"]]) {
        new Setting(c).setName(label+": "+name).setDesc(this.plugin.t("Путь внутри хранилища сохраняется после выхода из поля. Существующие файлы автоматически не перемещаются.")).addText(t=>{t.setValue(this.plugin[group][kind]);t.inputEl.addEventListener("change",async()=>{try{const path=catalogPath(t.inputEl.value,suffix);await this.plugin.enqueueAdd(async()=>{const next={...this.plugin.options,[group]:{...this.plugin[group],[kind]:path}};await this.plugin.saveData(next);this.plugin.options=next;});}catch(e){new Notice(e.message);}});});
      }
    }
    new Setting(c).setName(this.plugin.t("Открыть библиотеку")).addButton(b=>b.setButtonText(this.plugin.t("Кино и книги")).onClick(()=>this.plugin.openCatalog()));
    c.createEl("p",{text:this.plugin.t("Сначала укажите папки и файлы базы. Новые Bases создаются только по кнопке в каталоге. При изменении путей закройте и снова откройте библиотеку.")});
    new Setting(c).setName(this.plugin.t("Использование данных")).setHeading();
    c.createEl("p",{text:this.plugin.t("Поиск отправляет название, автора, год, ISBN и выбранный ID в выбранные источники: Читай-город, Open Library, Wikidata и подключённые Кинопоиск / TMDB / Google Books. Текст заметок, отзывы и хайлайты не отправляются. Телеметрии нет.")});
    c.createEl("p",{text:this.plugin.t("This product uses the TMDB API but is not endorsed or certified by TMDB. Данные фильмов и изображения предоставлены TMDB; каждая карточка содержит ссылку на источник.")});
    c.createEl("a",{text:"The Movie Database (TMDB)",attr:{href:"https://www.themoviedb.org/",target:"_blank",rel:"noopener noreferrer"}});
  }
}
class MediaPicker extends Plugin {
  taskNotesApi(capability="tasks.write"){
    const registry=this.app.plugins,plugin=typeof registry?.getPlugin==="function"?registry.getPlugin("tasknotes"):registry?.plugins?.tasknotes,api=plugin?.api;
    if(api?.apiVersion!==1||typeof api.hasCapability!=="function"||!api.hasCapability("tasks.read")||!api.hasCapability(capability)||typeof api.tasks?.list!=="function"||typeof api.tasks?.get!=="function"||typeof api.tasks?.create!=="function")throw new Error(this.t("Включите TaskNotes с поддержкой Runtime API v1. Плагин не устанавливается автоматически."));return api;
  }
  async mediaForTask(file){if(this.app.vault.getAbstractFileByPath(file.path)!==file||file.extension!=="md"||file.path.startsWith("Media catalog backups/"))throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));const raw=await this.app.vault.read(file),parsed=strictFrontmatter(raw);if(!["film","book"].includes(parsed.values.type))throw new Error(this.t("Откройте карточку фильма или книги."));linkedTaskPaths(this.app,file,parsed.values);return {raw,...parsed};}
  openTaskModal(file){const modal=new TaskNotesModal(this,file);this.modals.add(modal);const original=modal.onClose.bind(modal);modal.onClose=()=>{original();this.modals.delete(modal);};modal.open();}
  async openTaskNote(path){const file=this.app.vault.getAbstractFileByPath(path);if(file?.extension!=="md")throw new Error(this.t("Файл задачи не найден."));await this.app.workspace.getLeaf("tab").openFile(file);}
  async createMediaTask(file,title,scheduled="",allowSeparate=false){
    const api=this.taskNotesApi(),media=await this.mediaForTask(file);title=cleanTitle(title);if(!title)throw new Error(this.t("Укажите название задачи."));if(!validTaskDate(scheduled))throw new Error(this.t("Неверная дата задачи."));
    if(!allowSeparate){const refs=new Set(linkedTaskPaths(this.app,file,media.values)),link=mediaWikiLink(file);for(const task of await api.tasks.list()){if(refs.has(task.path)){new Notice(this.t("Связанная задача уже есть. Открываю её."));await this.openTaskNote(task.path);return task;}const taskFile=this.app.vault.getAbstractFileByPath(task.path);if(taskFile?.extension==="md"&&(await this.app.vault.read(taskFile)).includes(link)){await this.linkMediaTask(file,task.path);new Notice(this.t("Связанная задача уже есть. Открываю её."));await this.openTaskNote(task.path);return task;}}}
    const task=await api.tasks.create({title,...(scheduled?{scheduled}:{}),details:mediaWikiLink(file),creationContext:"api"},{source:ID,reason:"user created a linked media task"});
    if(typeof task?.path!=="string")throw new Error(this.t("TaskNotes не вернул путь задачи. Проверьте список задач перед повтором."));
    try{await this.linkMediaTask(file,task.path);}catch{new Notice(this.t("Задача создана, но обратная ссылка не сохранена. Откройте задачу и повторите привязку."));await this.openTaskNote(task.path);return task;}
    await this.openTaskNote(task.path);return task;
  }
  async applyTaskSnapshot(change,before,after){if(this.app.vault.getAbstractFileByPath(change.file.path)!==change.file)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));return this.app.vault.process(change.file,current=>{if(this.app.vault.getAbstractFileByPath(change.file.path)!==change.file||current!==before)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));return after;});}
  async linkMediaTask(file,path){
    const api=this.taskNotesApi(),task=await api.tasks.get(path),taskFile=this.app.vault.getAbstractFileByPath(path);if(!task||taskFile?.extension!=="md"||taskFile===file||path.startsWith("Media catalog backups/"))throw new Error(this.t("Файл задачи не найден."));
    const media=await this.mediaForTask(file),taskRaw=await this.app.vault.read(taskFile),link=mediaWikiLink(file),refs=linkedTaskPaths(this.app,file,media.values),changes=[];
    if(!taskRaw.includes(link))changes.push({file:taskFile,before:taskRaw,after:taskRaw+(taskRaw.endsWith("\n")?"\n":"\n\n")+link+"\n"});
    if(!refs.includes(path)){const after="---\n"+stringifyYaml({...media.values,media_catalog_tasks:[...arr(media.values.media_catalog_tasks),mediaWikiLink(taskFile)]}).trimEnd()+"\n---\n"+media.body;changes.push({file,before:media.raw,after});}
    if(!changes.length)return task;
    for(const change of changes)change.backup=await this.snapshotMetadata(change.file,change.before);
    const written=[];try{for(const change of changes){if(this.app.vault.getAbstractFileByPath(change.file.path)!==change.file)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));await this.applyTaskSnapshot(change,change.before,change.after);written.push(change);}}
    catch(error){let rollbackFailed=false;for(const change of written.reverse()){try{await this.applyTaskSnapshot(change,change.after,change.before);}catch{rollbackFailed=true;}}if(rollbackFailed)throw new Error(this.t("Привязка прервана изменением файла. Проверьте ссылки и содержимое обеих заметок."));throw error;}
    this.lastTaskLink={changes};for(const widget of this.widgets)widget.refresh().catch(()=>{});new Notice(this.t("Задача связана с карточкой."));return task;
  }
  async undoTaskLink(){const last=this.lastTaskLink;if(!last)throw new Error(this.t("Нет изменения для отмены."));for(const change of last.changes)if(this.app.vault.getAbstractFileByPath(change.file.path)!==change.file||await this.app.vault.read(change.file)!==change.after)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));
    const undone=[];try{for(const change of [...last.changes].reverse()){await this.applyTaskSnapshot(change,change.after,change.before);undone.push(change);}}catch(error){let failed=false;for(const change of undone.reverse()){try{await this.applyTaskSnapshot(change,change.before,change.after);}catch{failed=true;}}if(failed)throw new Error(this.t("Привязка прервана изменением файла. Проверьте ссылки и содержимое обеих заметок."));throw error;}this.lastTaskLink=null;for(const widget of this.widgets)widget.refresh().catch(()=>{});new Notice(this.t("Изменение отменено."));
  }
  async startMediaTask(path){const api=this.taskNotesApi("time.write");if(!api.hasCapability("time.read")||typeof api.time?.active!=="function"||typeof api.time?.start!=="function")throw new Error(this.t("В этой версии TaskNotes таймер недоступен."));const active=await api.time.active();if(active.some(entry=>entry.taskPath===path)){await this.openTaskNote(path);new Notice(this.t("Таймер этой задачи уже запущен."));return;}if(active.length)throw new Error(this.t("Уже идёт таймер другой задачи. Остановите его в TaskNotes перед запуском."));if(!await api.tasks.get(path))throw new Error(this.t("Файл задачи не найден."));const taskFile=this.app.vault.getAbstractFileByPath(path);if(taskFile?.extension!=="md")throw new Error(this.t("Файл задачи не найден."));await this.snapshotMetadata(taskFile,await this.app.vault.read(taskFile));await api.time.start(path,{description:this.t("Чтение / просмотр")},{source:ID,reason:"user started a media session"});await this.openTaskNote(path);new Notice(this.t("Таймер запущен."));}
  async stopMediaTask(path){const api=this.taskNotesApi("time.write");if(!api.hasCapability("time.read")||typeof api.time?.active!=="function"||typeof api.time?.stop!=="function")throw new Error(this.t("В этой версии TaskNotes таймер недоступен."));const active=await api.time.active();if(active.some(entry=>entry.taskPath===path)){const taskFile=this.app.vault.getAbstractFileByPath(path);if(taskFile?.extension!=="md")throw new Error(this.t("Файл задачи не найден."));await this.snapshotMetadata(taskFile,await this.app.vault.read(taskFile));await api.time.stop(path,{source:ID,reason:"user stopped a media session"});}new Notice(this.t("Таймер остановлен."));}

  openScanner(kind){const modal=new ScanModal(this,kind);this.modals.add(modal);const original=modal.onClose.bind(modal);modal.onClose=()=>{original();this.modals.delete(modal);};modal.open();}
  async snapshotMetadata(file,raw){if(this.app.vault.getAbstractFileByPath(file.path)!==file||await this.app.vault.read(file)!==raw)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));return raw;}
  async mergeMetadata(file,rec,expected){
    if(this.app.vault.getAbstractFileByPath(file.path)!==file||file.path.startsWith("Media catalog backups/"))throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));
    const raw=await this.app.vault.read(file);if(raw!==expected)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));
    const patch=metadataPatch(raw,rec);if(!Object.keys(patch).length)return;
    let coverFailed=false;
    if(patch.cover){try{rec=await localCover(this.app,rec,this.api,this.folders);patch.cover=rec.fields.cover;}catch{coverFailed=true;delete patch.cover;}}
    if(!Object.keys(patch).length){if(coverFailed)new Notice(this.t("Не удалось сохранить обложку. Повторите заполнение позже."),10000);return;}
    const {values,body}=strictFrontmatter(raw),next="---\n"+stringifyYaml({...values,...patch}).trimEnd()+"\n---\n"+body,backup=await this.snapshotMetadata(file,raw);
    await this.app.vault.process(file,current=>{if(current!==raw)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));return next;});this.lastMetadataChange={file,before:raw,after:next,backup};new Notice(this.t("Пустые поля заполнены."));if(coverFailed)new Notice(this.t("Не удалось сохранить обложку. Остальные поля сохранены; повторите заполнение позже."),10000);
  }
  async undoMetadata(){const change=this.lastMetadataChange;if(!change)throw new Error(this.t("Нет изменения для отмены."));if(this.app.vault.getAbstractFileByPath(change.file.path)!==change.file)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));await this.app.vault.process(change.file,current=>{if(current!==change.after)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));return change.before;});this.lastMetadataChange=null;new Notice(this.t("Изменение отменено."));}
  async storedStatus(kind,code) {return statusLabel(kind,code,"ru").toLowerCase();}
  get locale() {const language=this.options?.uiLanguage||"auto";return (language==="auto"?(typeof getLanguage==="function"?getLanguage():"en"):language).startsWith("ru")?"ru":"en";}
  t(message) {if(this.locale==="ru")return message;for(const prefix of ["Open Library: ","Google Books: ","openlibrary: ","google: ","tmdb: ","wikidata: "])if(typeof message==="string"&&message.startsWith(prefix))return prefix+translate(message.slice(prefix.length),"en");return translate(message,"en");}
  async changeStatus(file,code,expected) {
    if(!STATUS_CODES.includes(code))throw new Error(this.t("Не удалось изменить статус."));
    const raw=await this.app.vault.read(file),fm=frontmatter(raw);
    if(!["film","book"].includes(fm.type)||!file.path.startsWith(this.folders[fm.type]+"/")||JSON.stringify(fm.status)!==JSON.stringify(expected))throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));
    if(statusCode(fm.status)===code)return;
    const stored=await this.storedStatus(fm.type,code);
    await this.app.fileManager.processFrontMatter(file,current=>{if(current.type!==fm.type||JSON.stringify(current.status)!==JSON.stringify(expected))throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));current.status=stored;});
    this.lastStatusChange={path:file.path,file,kind:fm.type,before:expected,after:stored};new Notice(this.t("Статус изменён."));
  }
  async undoStatus() {
    const change=this.lastStatusChange;if(!change)throw new Error(this.t("Нет изменения для отмены."));const file=this.app.vault.getAbstractFileByPath(change.path);if(!file||file!==change.file)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));
    await this.app.fileManager.processFrontMatter(file,current=>{if(current.type!==change.kind||current.status!==change.after)throw new Error(this.t("Карточка была изменена. Обновите каталог и повторите."));if(change.before===undefined)delete current.status;else current.status=change.before;});this.lastStatusChange=null;new Notice(this.t("Изменение отменено."));
  }
  get folders() {return this.options?.folders||FOLDERS;}
  get bases() {return this.options?.bases||BASES;}
  async createCatalog(kind) {
    const path=catalogPath(this.bases[kind],".base"),folder=catalogPath(this.folders[kind]);
    if(this.app.vault.getAbstractFileByPath(path))throw new Error(this.t("По этому пути уже есть файл или папка. Существующие файлы не изменены."));
    await ensureFolder(this.app.vault,folder);
    const parent=path.split("/").slice(0,-1).join("/");if(parent)await ensureFolder(this.app.vault,parent);
    await this.app.vault.create(path,baseText(kind,folder,this.locale));new Notice(this.t("Каталог создан."));
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
  async search(kind,query,filmYear,partial=()=>{},provider="auto") {
    const local=[], tokens=titleKey(query).split(" ").filter(Boolean),folder=this.folders[kind];
    for(const file of catalogFiles(this.app,folder)) {
      const fm=frontmatter(await this.app.vault.read(file));if(fm.type!==kind)continue;
      const names=Array.isArray(fm.author||fm.director)?fm.author||fm.director:[fm.author||fm.director];
      const haystack=titleKey([fm.title,file.basename,fm.original_title,...names].filter(Boolean).join(" "));
      if(tokens.every(t=>haystack.includes(t))&&(!filmYear||String(fm.year)===filmYear))local.push({kind,source:"vault",id:file.path,title:cleanTitle(fm.title||file.basename),author:names.filter(Boolean).join(", "),year:fm.year,publisher:fm.publisher});
    }
    if(local.length)partial({items:local,warnings:[this.t("Ищу также во внешних источниках…")]});
    try {const remote=await this.api.search(kind,query,filmYear,provider);return {items:[...local,...remote.items],warnings:remote.warnings};}
    catch(e) {if(local.length)return {items:local,warnings:[e.message]};throw e;}
  }
  async onload() {
    const data=await this.loadData();this.options={folders:{...FOLDERS},bases:{...BASES},uiLanguage:["ru","en"].includes(data?.uiLanguage)?data.uiLanguage:"auto",metadataLocale:/^[a-z]{2,3}-[A-Z]{2}$/.test(data?.metadataLocale||"")?data.metadataLocale:defaultMetadataLocale(typeof getLanguage==="function"?getLanguage():"en")};
    if(this.locale==="en")for(const [kind,name] of [["film","Movies"],["book","Books"]])if(!this.app.vault.getAbstractFileByPath(FOLDERS[kind])&&!this.app.vault.getAbstractFileByPath(BASES[kind])){this.options.folders[kind]="Media/"+name;this.options.bases[kind]="Media/"+name+".base";}
    for(const group of ["folders","bases"])for(const kind of ["film","book"])if(data?.[group]?.[kind]){try{this.options[group][kind]=catalogPath(data[group][kind],group==="bases"?".base":"");}catch{new Notice(this.t("Некорректный путь каталога: использован путь по умолчанию."));}}
    this.options.providers={film:["auto","kinopoisk","tmdb","wikidata"].includes(data?.providers?.film)?data.providers.film:"auto",book:["auto","chitai","google","openlibrary"].includes(data?.providers?.book)?data.providers.book:"auto"};
    this.addTail=Promise.resolve();this.api=new Api(k=>this.key(k),requestUrl,sleep,()=>Date.now(),()=>this.options.metadataLocale);this.modals=new Set();this.widgets=new Set();
    this.registerView(VIEW,leaf=>new CatalogView(leaf,this));
    this.addCommand({id:"open-catalog",name:this.t("Открыть кино и книги"),callback:()=>this.openCatalog()});
    this.addCommand({id:"open-books",name:this.t("Открыть книги"),callback:()=>this.openCatalog("book")});
    this.addCommand({id:"add-film",name:this.t("Добавить фильм"),callback:()=>this.openPicker("film")});
    this.addCommand({id:"add-book",name:this.t("Добавить книгу"),callback:()=>this.openPicker("book")});
    for(const kind of ["film","book"])this.addCommand({id:"scan-"+kind,name:this.t(kind==="film"?"Сканировать папку кино":"Сканировать папку книг"),callback:()=>this.openScanner(kind)});
    this.addCommand({id:"task-from-media-note",name:this.t("Добавить открытую карточку в TaskNotes"),callback:()=>{const file=this.app.workspace.getActiveFile?.();if(file)this.openTaskModal(file);else new Notice(this.t("Откройте карточку фильма или книги."));}});
    this.addRibbonIcon("library",this.t("Кино и книги"),()=>this.openCatalog());
    this.registerMarkdownCodeBlockProcessor("media-catalog",(source,element,ctx)=>{const kind=source.trim();if(!["film","book"].includes(kind)){element.setText(this.t("Укажите film или book внутри блока media-catalog."));return;}ctx.addChild(new CatalogWidget(this,element,kind,ctx.sourcePath));});
    this.addSettingTab(new PickerSettings(this.app,this));
  }
  onunload() {for(const m of this.modals||[])m.close();for(const w of this.widgets||[])w.unload();}
}
module.exports=MediaPicker;
module.exports._test={chitaiSearch,chitaiDetails,smallCover,localCover,TaskNotesModal,mediaWikiLink,linkedTaskPaths,validTaskDate,ScanModal,scanNotes,metadataPatch,strictFrontmatter,providerSelect,Api,SearchController,canonicalISBN,safeName,frontmatter,duplicateFiles,addCard,cardText,PickerModal,CatalogWidget,CatalogView,catalogPath,catalogFiles,baseText,FOLDERS,BASES,statusCode,statusLabel,shortDescription,translate};
