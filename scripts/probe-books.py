"""Read-only live source checks; writes evidence only inside this repository."""
import concurrent.futures, datetime, html.parser, json, pathlib, re, time
import urllib.request, urllib.parse, urllib.error
BOOKS = [
 ('Илиада','Гомер',[]),
 ('Новая версия: Измени себя, не изменяя себе','Андрей Дороничев',['9785006320727','9786018250507']),
 ('Программист-прагматик','Эндрю Хант Дэвид Томас',[]),
 ('Психология влияния','Роберт Чалдини',[]),
 ('Цель','Элияху Голдратт',[]),
]
class Links(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='a' and a.get('title') and re.match(r'^/(product/[^/]+|book/\d+-[^/]+)$',a.get('href','')):
   item={'title':a['title'],'path':a['href']}
   if item not in self.links:self.links.append(item)
def get(url):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25) as r:return r.status,r.read().decode('utf-8')
 except urllib.error.HTTPError as e:return e.code,e.read().decode('utf-8',errors='replace')
 except Exception as e:return 0,str(e)
def check(source):
 rows=[]
 for title,author,isbns in BOOKS:
  attempts=[]
  for term in [*isbns,title+' '+author,title]:
   query=('isbn:'+term if term in isbns else term) if source=='google' else term
   url=({'chitai':'https://www.chitai-gorod.ru/search?phrase=','livelib':'https://www.livelib.ru/find/books/','google':'https://www.googleapis.com/books/v1/volumes?q='}[source]+urllib.parse.quote(query))
   if source=='google':url+='&maxResults=8&printType=books'
   status,body=get(url);items=[]
   if status==200:
    if source=='google':
     for v in json.loads(body).get('items',[]):items.append({'title':v.get('volumeInfo',{}).get('title'),'authors':v.get('volumeInfo',{}).get('authors'),'id':v.get('id')})
    else:
     p=Links();p.feed(body);items=p.links
   attempts.append({'query':query,'url':url,'status':status,'items':items[:24], 'error':body[:600] if status!=200 else None})
   time.sleep(.6)
  row={'title':title,'author':author,'attempts':attempts};rows.append(row)
  print(source,title,[(a['status'],len(a['items'])) for a in attempts],flush=True)
 return source,rows
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=dict(pool.map(check,['chitai','livelib','google']))
 out=pathlib.Path('checks');out.mkdir(exist_ok=True)
 (out/'book-sources.json').write_text(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':results},ensure_ascii=False,indent=2)+'\n')
