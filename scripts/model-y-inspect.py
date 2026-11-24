#!/usr/bin/env python3
"""Read-only inspection of the supplied Model Y source GLB."""
from pathlib import Path
import importlib.util,json,hashlib
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('model_y_utils',Path(__file__).with_name('model-y-utils.py'))
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
SOURCE=(Path(__file__).resolve().parents[1]/'assets/originals/2026_tesla_model_y_performance.glb')
raw,d,binary=U.read_glb(SOURCE);geometry=U.decode_geometry(d,binary)
report={'sourcePath':str(SOURCE),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'asset':d['asset'],'nodes':len(d['nodes']),'meshes':len(d['meshes']),'materials':len(d['materials']),'images':len(d['images']),'vertices':sum(len(r['attrs']['POSITION']) for r in geometry),'triangles':sum(len(r['faces']) for r in geometry),'records':[]}
all_points=np.concatenate([r['attrs']['POSITION'] for r in geometry]);report['bounds']={'min':all_points.min(0).tolist(),'max':all_points.max(0).tolist(),'dimensions':np.ptp(all_points,axis=0).tolist()}
for r in geometry:
    parts=U.components(r);out={'meshId':r['meshId'],'nodeId':r['nodeId'],'material':r['material'],'materialName':d['materials'][r['material']]['name'],'triangles':len(r['faces']),'components':[]}
    for i,p in enumerate(parts):out['components'].append(dict(componentId=i,triangles=p['triangles'],vertices=p['vertices'],min=p['min'].tolist(),max=p['max'].tolist()))
    report['records'].append(out)
    print('MESH',r['meshId'],out['materialName'],'components',len(parts))
    for p in out['components'][:30]:print(p)
path=ROOT/'reports/model-y-inspection.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n');print('WROTE',path)
