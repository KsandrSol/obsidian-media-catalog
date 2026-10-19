import importlib.util,json,pathlib,re,html,concurrent.futures
spec=importlib.util.spec_from_file_location('probe','scripts/probe-books.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
r=json.loads(pathlib.Path('checks/book-sources.json').read_text())
def check(source):
 results=[]
 for row in r['sources'][source]:
  items=row['attempts'][0]['items'];item=items[1] if source=='livelib' and row['title']=='Психология влияния' else items[0]
  url=('https://www.chitai-gorod.ru' if source=='chitai' else 'https://www.livelib.ru')+item['path']
  status,body=p.get(url)
  structured=[]
  for data in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',body,re.S):
   try:structured.append(json.loads(data))
   except ValueError:pass
  meta=re.findall(r'<meta[^>]*(?:property|name)="(?:og:image|og:title|description)"[^>]*>',body)
  results.append({'title':row['title'],'url':url,'status':status,'structured':structured,'meta':meta,'authors_visible':{name:name.lower() in body.lower() for name in row['author'].split()},'page_title':re.findall(r'<title[^>]*>(.*?)</title>',body,re.S)})
  print(source,row['title'],status,meta[:2],flush=True)
 return source,results
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=dict(pool.map(check,['chitai','livelib']))
pathlib.Path('checks/book-details.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
