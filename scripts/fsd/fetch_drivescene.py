from pathlib import Path
import hashlib,json,concurrent.futures,subprocess
ROOT=Path(__file__).resolve().parents[2]
commit=json.loads((ROOT/'reports/fsd/DriveScene-publisher-commit.json').read_text())['sha']
tree=json.loads((ROOT/'reports/fsd/DriveScene-publisher-tree.json').read_text())['tree']
base='DriveScene-Studio/'
notices=['LICENSE','ASSET-LICENSE.md','CREDITS.md','THREE-LICENSE.txt','MESHOPT-LICENSE.txt']
def wanted(p):
 q=p.removeprefix(base)
 return q in notices or q=='studio/ui-draft/runtime.bundle.js' or (q.startswith('studio/engine/') and (q.endswith(('.js','.html','.css','.glb.gz','.bin.gz','.json.gz')) or q.split('/')[-1] in notices)) or q in ['vehicle-library/README.md','vehicle-library/CREDITS.md']
files=[x for x in tree if x['type']=='blob' and x['path'].startswith(base) and wanted(x['path'])]
def download(x):
 rel=x['path'].removeprefix(base);out=ROOT/'external/DriveScene-Published'/rel;out.parent.mkdir(parents=True,exist_ok=True)
 url=f"https://raw.githubusercontent.com/paxton0209/paxton0209.github.io/{commit}/{x['path']}"
 if not out.exists():
  subprocess.run(['curl','--fail','--location','--max-time','60','--retry','2','--silent','--show-error',url,'--output',str(out)],check=True)
 data=out.read_bytes();assert hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()==x['sha'],rel
 return {'file':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'gitBlobSha1':x['sha'],'source':url}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(download,files))
manifest={'officialPublishedSource':'https://github.com/paxton0209/paxton0209.github.io/tree/main/DriveScene-Studio','commit':commit,'files':results,'codeLicense':'MIT, copyright Peixin','environmentLicense':'CC BY 4.0','vehicleLicenses':'Separate source notices; see downloaded CREDITS.md','totalBytes':sum(x['bytes'] for x in results)}
(ROOT/'reports/fsd/drivescene-resource-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'files':len(results),'bytes':manifest['totalBytes'],'commit':commit}),flush=True)
