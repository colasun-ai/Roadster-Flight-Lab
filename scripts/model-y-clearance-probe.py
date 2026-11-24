#!/usr/bin/env python3
"""Localize tire/body crossings; retains all original source surfaces."""
from pathlib import Path
import argparse,importlib.util,json,math
import numpy as np
from rtree import index
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('verify',Path(__file__).with_name('model-y-verify.py'));V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)

def intersection_points(a,b):
    points=[]
    for edges,plane in [(a,b),(b,a)]:
        normal=np.cross(plane[1]-plane[0],plane[2]-plane[0]);length=np.linalg.norm(normal)
        if length<1e-15:continue
        normal/=length
        v0=plane[1]-plane[0];v1=plane[2]-plane[0];d00=np.dot(v0,v0);d01=np.dot(v0,v1);d11=np.dot(v1,v1);den=d00*d11-d01*d01
        if abs(den)<1e-24:continue
        for i in range(3):
            p,q=edges[i],edges[(i+1)%3];d0=np.dot(p-plane[0],normal);d1=np.dot(q-plane[0],normal)
            if abs(d0-d1)<1e-15 or d0*d1>1e-16:continue
            t=d0/(d0-d1)
            if t < -1e-7 or t>1+1e-7:continue
            x=p+t*(q-p);v2=x-plane[0];d20=np.dot(v2,v0);d21=np.dot(v2,v1);u=(d11*d20-d01*d21)/den;v=(d00*d21-d01*d20)/den
            if u>=-1e-6 and v>=-1e-6 and u+v<=1+1e-6:points.append(x)
    return points

def main(args):
    _,doc,buf=V.U.read_glb(ROOT/'public/models/model-y-performance-drive-ready.glb');records=V.U.decode_geometry(doc,buf);m=json.loads((ROOT/'public/models/model-y-geometry.json').read_text());byname={r['sourceNodeName']:r for r in records}
    body=[r for r in records if r['sourceNodeName'].startswith('MY_Body_')];triangles=np.concatenate([r['attrs']['POSITION'][r['faces']] for r in body]);labels=np.concatenate([[r['sourceNodeName']]*len(r['faces']) for r in body]);bounds=np.column_stack([triangles.min(1),triangles.max(1)])
    prop=index.Property();prop.dimension=3;tree=index.Index(((i,tuple(bb),None) for i,bb in enumerate(bounds)),properties=prop);rows=[]
    for wheel in m['wheels']:
        if args.wheel and wheel['id'] not in args.wheel:continue
        id=wheel['id'];center=np.array(wheel['center']);tire=byname[f'Wheel_{id}_Mesh_{wheel["sourceTireMesh"]}'];local=tire['attrs']['POSITION']-center
        for steering in args.steers if id[0]=='F' else [0]:
            t=math.radians(steering);c,s=math.cos(t),math.sin(t);ry=np.array([[c,0,s],[0,1,0],[-s,0,c]])
            for travel in args.travels:
                for roll in args.rolls:
                    t=math.radians(roll);c,s=math.cos(t),math.sin(t);rx=np.array([[1,0,0],[0,c,-s],[0,s,c]])
                    q=np.einsum('ij,kj->ik',local,ry@rx)+center+[0,travel,0];points={};pairs={}
                    for a in q[tire['faces']]:
                        idx=np.fromiter(tree.intersection(tuple(np.r_[a.min(0)-1e-8,a.max(0)+1e-8])),dtype=np.int64)
                        if not len(idx):continue
                        hit=idx[V.triangle_pairs_intersect(a,triangles[idx])]
                        for j in hit:
                            name=labels[j];pairs[name]=pairs.get(name,0)+1;points.setdefault(name,[]).extend(intersection_points(a,triangles[j]))
                    detail={}
                    for name,pp in points.items():
                        if not pp:detail[name]={'pairs':pairs[name],'points':0};continue
                        pp=np.array(pp);ax=np.abs(pp[:,0]);detail[name]=dict(pairs=pairs[name],points=len(pp),min=pp.min(0).tolist(),max=pp.max(0).tolist(),maxAbsX=float(ax.max()),
                            pointsAbsXOver090=int(np.sum(ax>=.90)),pointsAbsXOver094=int(np.sum(ax>=.94)))
                    row=dict(wheel=id,steeringDegrees=steering,suspensionMeters=travel,rollingDegrees=roll,bodyParts=pairs,intersectionPointBounds=detail);rows.append(row);print(json.dumps(row),flush=True)
    result=dict(method='Exact SAT crossing pairs plus triangle-edge/plane intersection points. Absolute X thresholds .90/.94m are conservative spatial diagnostics, not material-based visible-surface certification. Painted shell is source Mesh3; black static lower shell/arch/liner is Mesh30.',samples=rows)
    args.output.write_text(json.dumps(result,indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--wheel',nargs='+');p.add_argument('--steers',type=float,nargs='+',default=[-28,28]);p.add_argument('--travels',type=float,nargs='+',default=[-.09,0,.04]);p.add_argument('--rolls',type=float,nargs='+',default=[0]);p.add_argument('--output',type=Path,default=ROOT/'reports/model-y-wheel-verification-localized.json');main(p.parse_args())
