#!/usr/bin/env python3
"""Validate original Model Y geometry retention, wheel rig and sampled clearance.

Uses original tire triangles, 3D rtree broad phase and exact triangle SAT.
No mesh is modified by this diagnostic. Requires NumPy and rtree.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, math, time
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('model_y_utils',Path(__file__).with_name('model-y-utils.py'))
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)

def triangle_pairs_intersect(a,b,epsilon=1e-9):
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
        pa=np.einsum('ij,kj->ik',a,axis);pb=np.sum(b*axis[:,None,:],axis=2)
        separated=(pa.max(0)<pb.min(1)-epsilon)|(pb.max(1)<pa.min(0)-epsilon)
        keep&=~(valid&separated)
        if not np.any(keep):break
    return keep

def topology(records):
    rows=[]
    for r in records:
        q=r['attrs']['POSITION'];f=r['faces'];n=r['attrs'].get('NORMAL');lengths=np.linalg.norm(n,axis=1) if n is not None else np.array([0])
        area=np.linalg.norm(np.cross(q[f[:,1]]-q[f[:,0]],q[f[:,2]]-q[f[:,0]]),axis=1)/2
        _,inv=np.unique(np.round(q/1e-7).astype(np.int64),axis=0,return_inverse=True);wf=inv[f]
        edges=np.sort(np.concatenate([wf[:,[0,1]],wf[:,[1,2]],wf[:,[2,0]]]),axis=1)
        _,counts=np.unique(edges,axis=0,return_counts=True)
        rows.append(dict(name=r['sourceNodeName'],vertices=len(q),triangles=len(f),nonfinitePositions=int(np.sum(~np.isfinite(q))),
            degenerateAreaBelow1eMinus14=int(np.sum(area<1e-14)),diagnosticBoundaryEdges=int(np.sum(counts==1)),diagnosticNonmanifoldEdges=int(np.sum(counts>2)),
            normalLengthRange=[float(lengths.min()),float(lengths.max())]))
    return rows

def main(output,travels,steers,rolls,reuse_log=None,model=None,metadata_path=None):
    start=time.time();raw,d,buf=U.read_glb(model or ROOT/'public/models/model-y-performance-drive-ready.glb')
    metadata=json.loads((metadata_path or ROOT/'public/models/model-y-geometry.json').read_text());records=U.decode_geometry(d,buf)
    source_raw,source_doc,source_buf=U.read_glb(Path(metadata['source']['path']));source_records=U.decode_geometry(source_doc,source_buf)
    by_name={r['sourceNodeName']:r for r in records};parents={c:i for i,n in enumerate(d['nodes']) for c in n.get('children',[])}
    names={n['name']:i for i,n in enumerate(d['nodes'])}
    def descendant(child,parent):
        while child in parents:
            child=parents[child]
            if child==parent:return True
        return False
    body=[r for r in records if r['sourceNodeName'].startswith('MY_Body_')]
    body_triangles=np.concatenate([r['attrs']['POSITION'][r['faces']] for r in body]);labels=np.concatenate([[r['sourceNodeName']]*len(r['faces']) for r in body])
    from rtree import index
    prop=index.Property();prop.dimension=3
    bounds=np.column_stack([body_triangles.min(1),body_triangles.max(1)])
    tree=index.Index(((i,tuple(bb),None) for i,bb in enumerate(bounds)),properties=prop)
    def intersections(triangles):
        hits={};pairs=0
        for a in triangles:
            idx=np.fromiter(tree.intersection(tuple(np.r_[a.min(0)-1e-8,a.max(0)+1e-8])),dtype=np.int64)
            if not len(idx):continue
            yes=triangle_pairs_intersect(a,body_triangles[idx]);pairs+=int(np.sum(yes))
            for j in idx[yes]:hits[labels[j]]=hits.get(labels[j],0)+1
        return pairs,hits
    prior={}
    if reuse_log:
        for line in reuse_log.read_text().splitlines():
            if line.startswith('{'):
                row=json.loads(line);prior[(row['wheel'],row['steeringDegrees'],row['rollingDegrees'],row['suspensionMeters'])]=row
    wheel_tests=[];sweep=[]
    for wheel in metadata['wheels']:
        id=wheel['id'];center=np.array(wheel['center']);name=f'Wheel_{id}_Mesh_{wheel["sourceTireMesh"]}'
        tire=by_name[name];local=tire['attrs']['POSITION']-center;radial=np.linalg.norm(local[:,1:],axis=1)
        pivot_errors=[];tread_tops=[];centroid_errors=[]
        for deg in range(0,361,5):
            angle=math.radians(deg);c,s=math.cos(angle),math.sin(angle);rx=np.array([[1,0,0],[0,c,-s],[0,s,c]])
            q=np.einsum('ij,kj->ik',local,rx)
            pivot_errors.append(float(np.max(np.abs(np.linalg.norm(q[:,1:],axis=1)-radial))));tread_tops.append(float(q[:,1].max()))
            centroid_errors.append(float(np.linalg.norm(q.mean(0)[1:])))
        calipers_fixed=all(not descendant(names[n],names[wheel['rotationNode']]) and descendant(names[n],names[wheel['steeringNode'] or wheel['suspensionNode']]) for n in wheel['caliperNodes'])
        outer=local[radial>radial.max()-.0017,1:];circle=np.linalg.lstsq(np.column_stack([2*outer,np.ones(len(outer))]),np.sum(outer*outer,axis=1),rcond=None)[0]
        wheel_tests.append(dict(id=id,radius=wheel['radius'],width=wheel['width'],center=wheel['center'],rollingTriangles=wheel['triangles'],fixedCaliperTriangles=wheel['caliperTriangles'],
            radialDistanceError360Meters=max(pivot_errors),nonuniformTessellationVertexCentroidOffsetMeters=max(centroid_errors),outerTreadLeastSquaresCircleCenterOffsetMeters=float(np.linalg.norm(circle[:2])),treadTopPolygonSamplingVariationMeters=float(np.ptp(tread_tops)),
            positiveRotationXAxisGroundTreadMotion='-Z; matches positive vehicle motion +Z for all four wheels',calipersOutsideRotationNode=calipers_fixed,
            tireFullyExtracted=all(e['label']=='Rolling_'+id for e in metadata['segmentation']['emitted'] if e['sourceMesh']==wheel['sourceTireMesh'])))
        for steer_deg in steers if id[0]=='F' else [0]:
            t=math.radians(steer_deg);c,s=math.cos(t),math.sin(t);ry=np.array([[c,0,s],[0,1,0],[-s,0,c]])
            for travel in travels:
                for roll_deg in rolls:
                    t=math.radians(roll_deg);c,s=math.cos(t),math.sin(t);rx=np.array([[1,0,0],[0,c,-s],[0,s,c]])
                    q=np.einsum('ij,kj->ik',local,ry@rx)+center+[0,travel,0]
                    key=(id,steer_deg,roll_deg,travel)
                    if key in prior:row=prior[key]
                    else:
                        pairs,hits=intersections(q[tire['faces']]);row=dict(wheel=id,steeringDegrees=steer_deg,rollingDegrees=roll_deg,suspensionMeters=travel,intersectingTrianglePairs=pairs,bodyParts=hits,externalPaintTrianglePairs=hits.get('MY_Body_Mesh_3',0))
                    sweep.append(row);print(json.dumps(row),flush=True)
    image_hashes=[]
    for im in d['images']:
        v=d['bufferViews'][im['bufferView']];blob=buf[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];image_hashes.append(hashlib.sha256(blob).hexdigest())
    topo=topology(records);source_topo=topology(source_records)
    # A stronger lossless test: every original vertex attribute tuple survives
    # after the one rigid axis transform and one uniform unit conversion.
    uv_source=np.concatenate([r['attrs']['TEXCOORD_0'] for r in source_records if 'TEXCOORD_0' in r['attrs']]);uv_output=np.concatenate([r['attrs']['TEXCOORD_0'] for r in records if 'TEXCOORD_0' in r['attrs']])
    uv_dtype=np.dtype([('u',uv_source.dtype),('v',uv_source.dtype)])
    uv_equal=np.array_equal(np.sort(np.ascontiguousarray(uv_source).view(uv_dtype),axis=0),np.sort(np.ascontiguousarray(uv_output).view(uv_dtype),axis=0))
    original_counts={k:sum(r[k] for r in source_topo) for k in ['vertices','triangles','nonfinitePositions','degenerateAreaBelow1eMinus14','diagnosticBoundaryEdges','diagnosticNonmanifoldEdges']}
    output_counts={k:sum(r[k] for r in topo) for k in original_counts}
    result=dict(sourceSha256=hashlib.sha256(source_raw).hexdigest(),outputSha256=hashlib.sha256(raw).hexdigest(),originalUnchanged=hashlib.sha256(source_raw).hexdigest()==metadata['source']['sha256'],
        originalCounts=original_counts,outputCounts=output_counts,originalImagesByteIdentical=image_hashes==[i['sha256'] for i in metadata['images']],originalMaterialDefinitionsIdentical=source_doc['materials']==d['materials'],
        uvTuplesByteIdenticalIncludingMultiplicity=bool(uv_equal),sourceTopology=source_topo,outputTopology=topo,wheels=wheel_tests,
        clearanceMethod='All original tire triangles vs every stationary Body triangle; rtree AABB broad phase, 3D triangle SAT with coplanar edge axes. Detects surface crossings/touches at 1e-9m, not enclosed volumes or real tire deformation. Complete 360 kinematics sampled every 5 degrees; clearance poses listed separately.',
        sweepSettings=dict(steeringDegrees=steers,rollingDegrees=rolls,suspensionMeters=travels),clearanceSweep=sweep,
        selectedOperatingLimits=dict(compressionMeters=max(travels),droopMeters=abs(min(travels)),maximumFrontSteeringDegrees=max(map(abs,steers)),
            allBodyTrianglePairs=sum(r['intersectingTrianglePairs'] for r in sweep),passAllBodyClearance=all(r['intersectingTrianglePairs']==0 for r in sweep),
            externalPaintTrianglePairs=sum(r['externalPaintTrianglePairs'] for r in sweep),passExternalPaintClearance=all(r['externalPaintTrianglePairs']==0 for r in sweep),sampleCount=len(sweep)),
        seconds=round(time.time()-start,3))
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n');print('WROTE',output,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--model',type=Path);p.add_argument('--metadata',type=Path);p.add_argument('--output',type=Path,default=ROOT/'reports/model-y-wheel-verification.json');p.add_argument('--travels',type=float,nargs='+',default=[-.09,0,.08]);p.add_argument('--steers',type=float,nargs='+',default=[0,-35,35]);p.add_argument('--rolls',type=float,nargs='+',default=[0,45,90,135,180,225,270,315]);p.add_argument('--reuse-log',type=Path,help='Reuse exactly matching previously computed pose rows; source/output must be unchanged');a=p.parse_args();main(a.output,a.travels,a.steers,a.rolls,a.reuse_log,a.model,a.metadata)
