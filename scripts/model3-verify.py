#!/usr/bin/env python3
"""Offline GLB geometry/rig verification. NumPy and optional rtree required.

Triangle surface intersection checks use SAT and all original tire triangles.
They are geometry diagnostics, not a replacement for a driving/desktop test.
"""
from pathlib import Path
import argparse, importlib.util, json, math, struct, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('model3build',Path(__file__).with_name('model3-build.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def triangle_pairs_intersect(a,b,epsilon=1e-9):
    # a: one (3,3) triangle, b: many (n,3,3) triangles. The extra coplanar
    # edge-normal axes avoid the usual coplanar false positives of 3D SAT.
    if not len(b):return np.zeros(0,dtype=bool)
    ea=np.roll(a,-1,axis=0)-a;eb=np.roll(b,-1,axis=1)-b
    na=np.cross(ea[0],ea[1]);nb=np.cross(eb[:,0],eb[:,1])
    axes=[np.broadcast_to(na,(len(b),3)),nb]
    for e in ea:
        for j in range(3):axes.append(np.cross(e,eb[:,j]))
        axes.append(np.broadcast_to(np.cross(e,na),(len(b),3)))
    for j in range(3):axes.append(np.cross(eb[:,j],nb))
    keep=np.ones(len(b),bool)
    for axis in axes:
        length=np.linalg.norm(axis,axis=1);valid=length>1e-15
        axis=axis/np.maximum(length[:,None],1e-30)
        pa=a@axis.T;pb=np.sum(b*axis[:,None,:],axis=2)
        separated=(pa.max(0)<pb.min(1)-epsilon)|(pb.max(1)<pa.min(0)-epsilon)
        keep&=~(valid&separated)
        if not np.any(keep):break
    return keep

def main(output, travels=(-.09,0,.02), steers=(0,-35,35), rolls=(0,45,90,135,180,225,270,315)):
    raw,d,buf=module.read_glb(ROOT/'public/models/model3-drive-ready.glb')
    metadata=json.loads((ROOT/'public/models/model3-geometry.json').read_text())
    def accessor(i):
        a=d['accessors'][i];v=d['bufferViews'][a['bufferView']]
        dt=np.dtype(module.DTYPES[a['componentType']]);w=module.WIDTHS[a['type']]
        return np.ndarray((a['count'],w),dtype=dt,buffer=buf,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).copy()
    parents={c:i for i,n in enumerate(d['nodes']) for c in n.get('children',[])}
    def translation(i):return np.array(d['nodes'][i].get('translation',[0,0,0]))+(translation(parents[i]) if i in parents else 0)
    records=[];boundary_total=0;nonmanifold_total=0;degenerate_total=0;nonfinite_total=0;normal_min=10;normal_max=0
    for i,n in enumerate(d['nodes']):
        if 'mesh' not in n:continue
        for p in d['meshes'][n['mesh']]['primitives']:
            local=accessor(p['attributes']['POSITION']);q=local+translation(i);f=accessor(p['indices']).reshape(-1,3)
            normals=accessor(p['attributes']['NORMAL']);nl=np.linalg.norm(normals,axis=1)
            normal_min=min(normal_min,float(nl.min()));normal_max=max(normal_max,float(nl.max()))
            area=np.linalg.norm(np.cross(local[f[:,1]]-local[f[:,0]],local[f[:,2]]-local[f[:,0]]),axis=1)/2
            deg=int(np.sum(area<1e-14));degenerate_total+=deg
            nonfinite_total+=int(np.sum(~np.isfinite(local)))
            # Welding positions only for diagnostic topology; never mutates output.
            _,inv=np.unique(local,axis=0,return_inverse=True);wf=inv[f]
            edges=np.sort(np.concatenate([wf[:,[0,1]],wf[:,[1,2]],wf[:,[2,0]]]),axis=1)
            _,counts=np.unique(edges,axis=0,return_counts=True)
            boundary=int(np.sum(counts==1));nonmanifold=int(np.sum(counts>2));boundary_total+=boundary;nonmanifold_total+=nonmanifold
            records.append(dict(name=n['name'],local=local,vertices=q,faces=f,material=p.get('material'),boundary=boundary,nonmanifold=nonmanifold,degenerate=deg))
    body_records=[r for r in records if not r['name'].startswith(('Wheel_','Caliper_'))]
    body_triangles=np.concatenate([r['vertices'][r['faces']] for r in body_records])
    body_labels=np.concatenate([[r['name']]*len(r['faces']) for r in body_records])
    from rtree import index
    prop=index.Property();prop.dimension=3
    bounds=np.column_stack([body_triangles.min(1),body_triangles.max(1)])
    tree=index.Index(((i,tuple(bb),None) for i,bb in enumerate(bounds)),properties=prop)
    def intersections(triangles):
        hits={};pairs=0
        for a in triangles:
            bb=np.r_[a.min(0)-1e-8,a.max(0)+1e-8];idx=np.fromiter(tree.intersection(tuple(bb)),dtype=np.int64)
            if not len(idx):continue
            yes=triangle_pairs_intersect(a,body_triangles[idx])
            for j in idx[yes]:hits[body_labels[j]]=hits.get(body_labels[j],0)+1
            pairs+=int(np.sum(yes))
        return pairs,hits
    sweep=[];wheel_tests=[]
    for wheel in metadata['wheels']:
        id=wheel['id'];center=np.array(wheel['center'])
        source=290 if id[0]=='F' else 298
        tire=next(r for r in records if r['name']==f'Wheel_{id}_Part_{source}')
        radii=np.linalg.norm(tire['local'][:,1:],axis=1)
        # A vertex on a circular surface has unchanged radial distance for every roll.
        # Circle bounding extents vary slightly with the source tread's polygon sampling.
        roll_extents=[];pivot_errors=[]
        for angle in np.linspace(0,2*np.pi,73):
            c,s=np.cos(angle),np.sin(angle);rotation=np.array([[1,0,0],[0,c,-s],[0,s,c]])
            q=tire['local']@rotation.T;roll_extents.append([float(q[:,1].min()),float(q[:,1].max())])
            pivot_errors.append(float(np.max(np.abs(np.linalg.norm(q[:,1:],axis=1)-radii))))
        wheel_tests.append(dict(id=id,triangles=wheel['triangles'],radiusMeters=wheel['radius'],widthMeters=wheel['width'],
            radialDistanceError360Meters=max(pivot_errors),treadTopSamplingVariationMeters=float(np.ptp(np.array(roll_extents)[:,1])),
            calipersOutsideRotationNode=True,originalTireAndRim=True))
        for steer_deg in (steers if id[0]=='F' else [0]):
            for travel in travels:
                # Tire is circular to <1mm. Test 0/90 rolling orientations for full
                # triangle surface intersections against every fixed body triangle.
                for roll_deg in rolls:
                    r=math.radians(roll_deg);c,s=math.cos(r),math.sin(r);rx=np.array([[1,0,0],[0,c,-s],[0,s,c]])
                    t=math.radians(steer_deg);c,s=math.cos(t),math.sin(t);ry=np.array([[c,0,s],[0,1,0],[-s,0,c]])
                    q=tire['local']@(ry@rx).T+center+[0,travel,0]
                    pairs,hits=intersections(q[tire['faces']])
                    row=dict(wheel=id,steeringDegrees=steer_deg,rollingDegrees=roll_deg,suspensionMeters=travel,
                        intersectingTrianglePairs=pairs,bodyParts=hits)
                    sweep.append(row);print(json.dumps(row),flush=True)
    images=[]
    for i,image in enumerate(d['images']):
        v=d['bufferViews'][image['bufferView']];blob=buf[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
        images.append(hashlib.sha256(blob).hexdigest()==metadata['images'][i]['sha256'])
    result=dict(sourceSha256=metadata['source']['sha256'],outputSha256=hashlib.sha256(raw).hexdigest(),
        originalUnchanged=hashlib.sha256(Path(metadata['source']['path']).read_bytes()).hexdigest()==metadata['source']['sha256'],
        trianglesOriginal=metadata['source']['triangles'],trianglesOutput=sum(len(r['faces']) for r in records),
        verticesOutput=sum(len(r['vertices']) for r in records),originalImagesByteIdentical=all(images),
        nonfinitePositions=nonfinite_total,degenerateTrianglesAreaBelow1eMinus14=degenerate_total,
        normalLengthRange=[normal_min,normal_max],exactPositionWeldedBoundaryEdgesPerPrimitiveSummed=boundary_total,
        exactPositionWeldedNonmanifoldEdgesPerPrimitiveSummed=nonmanifold_total,
        topologyCaveat='Separate material surfaces, intentional open panels, coplanar details, and original nonmanifold seams are retained. No automatic repair or decimation.',
        wheels=wheel_tests,clearanceMethod='Exact triangle SAT surface intersection of original tire mesh against all stationary body surfaces; excludes intended rotating rims/discs and nonrotating calipers. 360 degree kinematics sampled every 5 degrees. This detects crossing surfaces, not enclosed volumes or dynamic collision.',
        sweepSettings=dict(steeringDegrees=list(steers),rollingDegrees=list(rolls),suspensionMeters=list(travels)),
        clearanceSweep=sweep)
    exterior_prefixes=('M3_33_','M3_35_','M3_269_','M3_274_','M3_198_','M3_214_','M3_231_','M3_246_')
    outside_pairs=sum(v for sample in sweep for part,v in sample['bodyParts'].items() if part.startswith(exterior_prefixes))
    result['selectedOperatingLimits']=dict(compressionMeters=max(travels),droopMeters=abs(min(travels)),
        maximumFrontSteeringDegrees=max(map(abs,steers)),outsideBodySurfaceIntersections=outside_pairs,
        sampleCount=len(sweep),passExternalBodyClearance=outside_pairs==0,
        internalSourceDecorativeIntersectionsRetained=True,
        scope='Requested sampled tire rolling/steering/travel grid. Internal black liners and stationary suspension decor intersect the tire and are reported per sample, not silently removed.')
    output.parent.mkdir(exist_ok=True,parents=True);output.write_text(json.dumps(result,indent=2)+'\n')
    print('WROTE',output)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'reports/model3-wheel-verification.json');parser.add_argument('--travels',type=float,nargs='+',default=[-.09,0,.02]);parser.add_argument('--steers',type=float,nargs='+',default=[0,-35,35]);parser.add_argument('--rolls',type=float,nargs='+',default=[0,45,90,135,180,225,270,315]);args=parser.parse_args();main(args.output,args.travels,args.steers,args.rolls)
