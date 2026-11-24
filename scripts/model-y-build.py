#!/usr/bin/env python3
"""Derive an original-detail driving rig from the 2026 Model Y GLB.

NumPy required. Original file is read-only. Source connected components are
partitioned into body, original rolling assemblies, and fixed brake assemblies.
No faces are cut, synthesized, hidden, replaced, or decimated. Optional bounded
inner-liner repair changes only explicitly reported lower-shell vertex positions.
"""
from pathlib import Path
import argparse,copy,hashlib,importlib.util,io,json,struct
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('model_y_utils',Path(__file__).with_name('model-y-utils.py'))
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
EXPECTED_SHA='9f49e0596dfc80576fdf1b8b55e9ba47516528ffae75ffa5162ce5dc13cbd254'
EXPECTED_REPAIRED_SHA='663f37ec764c2c89158f1f073c2322fb5ffedb2e07813d134014e099d7d4dee6'
HISTORICAL_DIMENSIONS={'length':4.796,'bodyWidth':1.920,'widthWithMirrors':2.129,'height':1.611,'wheelbase':2.890,'frontTrack':1.636,'rearTrack':1.622}

def build(source,destination,repair_inner_liners=False,metadata_destination=None,promote_repair=False):
    if source.resolve()==destination.resolve():raise ValueError('The original GLB may not be overwritten')
    raw,doc,binary=U.read_glb(source)
    if hashlib.sha256(raw).hexdigest()!=EXPECTED_SHA:raise ValueError('Source differs from inspected Model Y; inspect it before rebuilding')
    records=U.decode_geometry(doc,binary);by_mesh={r['meshId']:r for r in records}
    all_points=np.concatenate([r['attrs']['POSITION'] for r in records]);lo=all_points.min(0);hi=all_points.max(0)
    # Forward direction is established by front_white_light (+Z) versus
    # back_red_Light (-Z). Source axes already match the vehicle interface.
    assert by_mesh[5]['attrs']['POSITION'][:,2].min()>by_mesh[4]['attrs']['POSITION'][:,2].max()
    scale=HISTORICAL_DIMENSIONS['length']/(hi[2]-lo[2])
    tire_meshes={'FL':17,'FR':19,'RL':18,'RR':20}
    centers={};radii={};widths={}
    for id,m in tire_meshes.items():
        q=by_mesh[m]['attrs']['POSITION'];center=(q.min(0)+q.max(0))/2
        centers[id]=center;radii[id]=float(np.linalg.norm((q-center)[:,1:],axis=1).max()*scale);widths[id]=float(np.ptp(q[:,0])*scale)
    front=(centers['FL']+centers['FR'])/2;rear=(centers['RL']+centers['RR'])/2
    origin=np.array([np.mean([p[0] for p in centers.values()]),lo[1],(front[2]+rear[2])/2])
    def transform(q):return (np.asarray(q)-origin)*scale
    # Only these source groups contain wheel-related pieces. Body components in
    # merged groups are retained under Body when they exceed the wheel envelope.
    candidate_meshes={12,15,16,17,18,19,20,21,23,24,25,26,27,28,29,33,34,36,38,39}
    selections={};manifest=[]
    for r in records:
        labels=np.full(len(r['faces']),'Body',dtype=object)
        if r['meshId'] in candidate_meshes:
            parts=U.components(r)
            for part_id,part in enumerate(parts):
                q=r['attrs']['POSITION'][part['vertexIds']];candidate=[]
                for id,center in centers.items():
                    relative=q-center
                    if np.max(np.abs(relative[:,0]))<.195 and np.linalg.norm(relative[:,1:],axis=1).max()<radii[id]/scale+.012:
                        candidate.append(id)
                if len(candidate)>1:raise ValueError('Ambiguous wheel component')
                if not candidate:continue
                wheel=candidate[0]
                # Red caliper halves, black pads, and the eight black bolt
                # details per axle belong to the nonrolling brake assembly.
                fixed=r['meshId'] in {25,38,39} or (r['meshId'] in {23,24} and part['triangles']==500)
                label=('Caliper_' if fixed else 'Rolling_')+wheel
                labels[part['faceIds']]=label
                manifest.append(dict(sourceMesh=r['meshId'],sourceNode=r['nodeId'],component=part_id,classification=label,
                    triangles=part['triangles'],sourceBoundsMin=part['min'].tolist(),sourceBoundsMax=part['max'].tolist(),
                    reason='red caliper / black brake pad / caliper bolt detail' if fixed else 'original tire, sidewall, rim, hub/hat, rotor, drilled rotor detail or center logo within wheel envelope'))
        selections[r['meshId']]=labels
    # Require all original tire faces to be exclusively in their matching rig.
    for id,m in tire_meshes.items():assert np.all(selections[m]=='Rolling_'+id)
    # The detailed main rims are the two complete 7220-face components in each
    # silver material group. Both front/rear on both sides must be extracted.
    for m in [15,16]:assert sum(p['triangles'] for p in manifest if p['sourceMesh']==m and p['classification'].startswith('Rolling'))==14440
    assert sum(p['triangles'] for p in manifest if p['sourceMesh'] in {38,39})==26080
    for r in records:r['attrs']['POSITION']=transform(r['attrs']['POSITION'])
    repair_report=dict(applied=False)
    if repair_inner_liners:
        # The front inner walls are part of source mesh30's main lower-shell
        # component. Only that complete component is eligible; separate lamp
        # housings/A-pillars and the outer black lip are never displaced.
        r=by_mesh[30];q=r['attrs']['POSITION'];old=q.copy();parts=U.components(r)
        main=next(p for p in parts if p['triangles']==1652)
        eligible=np.zeros(len(q),dtype=bool);eligible[main['vertexIds']]=True
        front_z=float(transform(front)[2]);a=np.abs(q[:,0]);dz=np.abs(q[:,2]-front_z)
        def smoothstep(lo,hi,value):
            t=np.clip((value-lo)/(hi-lo),0,1);return t*t*(3-2*t)
        weight=(1-smoothstep(.53,.72,dz))*(1-smoothstep(.80,.86,q[:,1]))*(1-smoothstep(.67,.72,a))
        weight*=eligible
        # A flat clamp would collapse the original inner-wall thickness strips.
        # A 150mm translation with a wide C1 inner transition retains distinct
        # layers and strictly ordered X coordinates in the full-weight region.
        retreat=.15*smoothstep(.25,.50,a)*weight
        q[:,0]=np.sign(q[:,0])*(a-retreat)
        moved=np.linalg.norm(q-old,axis=1)>1e-12;affected=np.any(moved[r['faces']],axis=1)
        # Preserve authored hard edges: average face normals only among
        # vertices that shared both the old location and old authored normal.
        reference_normals=r['attrs']['NORMAL'].copy();original_normals=reference_normals.copy()
        keys=np.round(np.column_stack([old,original_normals])/1e-7).astype(np.int64)
        _,group=np.unique(keys,axis=0,return_inverse=True)
        f=r['faces'];face_normals=np.cross(q[f[:,1]]-q[f[:,0]],q[f[:,2]]-q[f[:,0]])
        accum=np.zeros((group.max()+1,3))
        for corner in range(3):np.add.at(accum,group[f[:,corner]],face_normals)
        new_normals=accum[group];length=np.linalg.norm(new_normals,axis=1)
        touched_groups=np.unique(group[f[affected].reshape(-1)]);touched=np.isin(group,touched_groups)&(length>1e-15)
        original_normals[touched]=new_normals[touched]/length[touched,None];r['attrs']['NORMAL']=original_normals
        assert np.allclose(q[a>=.90],old[a>=.90],atol=0,rtol=0),'Outer lip must not move'
        assert np.array_equal(r['attrs']['NORMAL'][a>=.90],reference_normals[a>=.90]),'Outer lip shading must not change'
        assert not np.any(moved&~eligible),'Other lower-shell components must not move'
        repair_report=dict(applied=True,sourceMesh=30,node='MY_Body_Mesh_30',method='front inner-liner/lower-shell complete main component: 150mm inward X-only translation, smooth inner blend from abs(X)0.25 to0.50m preserving original wall thickness; full weight within front-axle ±0.53m/Y<=0.80m/abs(X)<=0.67m; smooth fade out by ±0.72m/Y0.86m/abs(X)0.72m',
            movedVertices=int(np.sum(moved)),affectedTriangles=int(np.sum(affected)),updatedNormalVertices=int(np.sum(touched)),
            maximumVertexDisplacementMeters=float(np.linalg.norm(q-old,axis=1).max()),meanMovedVertexDisplacementMeters=float(np.linalg.norm(q-old,axis=1)[moved].mean()),
            changedBoundsMin=old[moved].min(0).tolist(),changedBoundsMax=old[moved].max(0).tolist(),
            originalTrianglesRetained=True,uvRetained=True,outerBlackLipAbsXAtLeast090Unchanged=True,outerBlackLipNormalsUnchanged=True,otherSourceMeshesUnchanged=True,
            normalMethod='area-weighted face normals recomputed in original position+normal hard-edge groups; only affected groups updated',
            status='candidate only: must pass full all-Body triangle SAT and visual review before promotion')
    out={key:copy.deepcopy(doc[key]) for key in ['asset','materials','textures','samplers','extensionsUsed','extensionsRequired'] if key in doc}
    out['asset']['generator']='Roadster Flight Lab v0.7 lossless Model Y wheel rig processor'
    out.update(scene=0,scenes=[{'name':'ModelY','nodes':[0]}],nodes=[],meshes=[],accessors=[],bufferViews=[],images=[])
    data=bytearray()
    def view(blob,target=None):
        data.extend(b'\0'*((-len(data))%4));v=dict(buffer=0,byteOffset=len(data),byteLength=len(blob))
        if target is not None:v['target']=target
        out['bufferViews'].append(v);data.extend(blob);return len(out['bufferViews'])-1
    def write_accessor(array,type,component,target=None,bounds=False):
        array=np.asarray(array,dtype=U.DTYPES[component]);a=dict(bufferView=view(array.tobytes(),target),componentType=component,count=len(array),type=type)
        if bounds:a.update(min=array.min(0).tolist(),max=array.max(0).tolist())
        out['accessors'].append(a);return len(out['accessors'])-1
    image_info=[]
    for im in doc['images']:
        v=doc['bufferViews'][im['bufferView']];blob=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
        image=copy.deepcopy(im);image['bufferView']=view(blob);out['images'].append(image)
        decoded=Image.open(io.BytesIO(blob));decoded.load();w,h=decoded.size
        image_info.append(dict(width=w,height=h,format=decoded.format,bytes=len(blob),sha256=hashlib.sha256(blob).hexdigest(),mimeType=im.get('mimeType')))
    def node(name,parent=None,translation=None,extras=None):
        result=dict(name=name,children=[])
        if translation is not None:result['translation']=np.asarray(translation).tolist()
        if extras:result['extras']=extras
        out['nodes'].append(result);idx=len(out['nodes'])-1
        if parent is not None:out['nodes'][parent]['children'].append(idx)
        return idx
    root=node('ModelY',extras={'vehicle':{'units':'meters','forward':'+Z','up':'+Y','left':'+X','rollingAxis':'+X','license':'CC-BY-NC-4.0','sourceSha256':EXPECTED_SHA}})
    body=node('Body',root);emitted=[];body_names={};wheel_output=[]
    def emit(r,selected,name,parent,pivot=None):
        faces=r['faces'][selected];used,indices=np.unique(faces,return_inverse=True)
        attrs={k:v[used].copy() for k,v in r['attrs'].items()}
        if pivot is not None:attrs['POSITION']-=pivot
        attributes={key:write_accessor(values,'VEC'+str(values.shape[1]),5126,34962,key=='POSITION') for key,values in attrs.items()}
        primitive=dict(attributes=attributes,indices=write_accessor(indices.astype('<u4').reshape(-1,1),'SCALAR',5125,34963),material=r['material'])
        out['meshes'].append(dict(name=name,primitives=[primitive]));i=node(name,parent);out['nodes'][i]['mesh']=len(out['meshes'])-1
        emitted.append(dict(name=name,sourceMesh=r['meshId'],label=selections[r['meshId']][selected][0],vertices=len(used),triangles=len(faces)))
        return name
    for id in ['FL','FR','RL','RR']:
        center=transform(centers[id]);suspension=node(f'Wheel_{id}_Suspension',root,center)
        steering=node(f'Wheel_{id}_Steering',suspension) if id[0]=='F' else suspension
        rotation=node(f'Wheel_{id}_Rotation',steering);wheel=node(f'Wheel_{id}',rotation)
        rolling_names=[];caliper_names=[]
        for r in records:
            for kind,parent,names in [('Rolling_',wheel,rolling_names),('Caliper_',steering,caliper_names)]:
                selected=np.flatnonzero(selections[r['meshId']]==kind+id)
                if not len(selected):continue
                names.append(emit(r,selected,('Wheel_'+id+'_Mesh_' if kind=='Rolling_' else 'Caliper_'+id+'_Mesh_')+str(r['meshId']),parent,center))
        stats=[e for e in emitted if e['label']=='Rolling_'+id];fixed=[e for e in emitted if e['label']=='Caliper_'+id]
        wheel_output.append(dict(id=id,center=center.tolist(),radius=radii[id],width=widths[id],sourceTireMesh=tire_meshes[id],
            suspensionNode=f'Wheel_{id}_Suspension',steeringNode=f'Wheel_{id}_Steering' if id[0]=='F' else None,
            rotationNode=f'Wheel_{id}_Rotation',meshGroup=f'Wheel_{id}',rollingNodes=rolling_names,caliperNodes=caliper_names,
            triangles=sum(e['triangles'] for e in stats),caliperTriangles=sum(e['triangles'] for e in fixed),
            sourceCenter=centers[id].tolist(),groundCorrectionMeters=[0,0,0]))
    for r in records:
        selected=np.flatnonzero(selections[r['meshId']]=='Body')
        if len(selected):body_names[r['meshId']]=emit(r,selected,f'MY_Body_Mesh_{r["meshId"]}',body)
    for n in out['nodes']:
        if not n['children']:del n['children']
    original_triangles=sum(len(r['faces']) for r in records);original_vertices=sum(len(r['attrs']['POSITION']) for r in records)
    assert sum(e['triangles'] for e in emitted)==original_triangles
    assert sum(e['vertices'] for e in emitted)==original_vertices
    out['buffers']=[{'byteLength':len(data)}]
    json_blob=json.dumps(out,separators=(',',':'),ensure_ascii=False).encode();json_blob+=b' '*((-len(json_blob))%4);data+=b'\0'*((-len(data))%4)
    result=struct.pack('<4sII',b'glTF',2,28+len(json_blob)+len(data))+struct.pack('<II',len(json_blob),0x4e4f534a)+json_blob+struct.pack('<II',len(data),0x004e4942)+data
    if promote_repair and hashlib.sha256(result).hexdigest()!=EXPECTED_REPAIRED_SHA:
        raise ValueError('Promotion differs from the fully verified repaired candidate; verify it separately before changing the expected hash')
    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(result)
    dims=np.ptp(transform(all_points),axis=0)
    front_track=abs(wheel_output[0]['center'][0]-wheel_output[1]['center'][0]);rear_track=abs(wheel_output[2]['center'][0]-wheel_output[3]['center'][0])
    headlamp_emitters=[]
    for part in U.components(by_mesh[5]):
        if part['triangles']==98:
            q=by_mesh[5]['attrs']['POSITION'][part['vertexIds']];headlamp_emitters.append(dict(position=((q.min(0)+q.max(0))/2).tolist(),sourceNode=body_names[5]))
    metadata=dict(version=1,vehicleId='model-y-performance-2026',units='meters',
        axes=dict(up='+Y',forward='+Z',left='+X',rollingAxis='+X for all wheels',positiveRolling='forward +Z',positiveSteering='left +X'),
        source=dict(path=str(source),bytes=len(raw),sha256=EXPECTED_SHA,vertices=original_vertices,triangles=original_triangles,nodes=len(doc['nodes']),meshes=len(doc['meshes']),materials=len(doc['materials']),images=len(doc['images']),asset=doc['asset']),
        scale=scale,sourceWorldOrigin=origin.tolist(),rootOrigin='single ground translation from all tire bottoms; XZ midpoint between axle centers',
        dimensions=dict(length=float(dims[2]),widthWithMirrors=float(dims[0]),height=float(dims[1]),
            bodyWidth=float(np.ptp(by_mesh[3]['attrs']['POSITION'][:,0])),historicalReference=HISTORICAL_DIMENSIONS),
        wheels=wheel_output,wheelbase=float(abs((front[2]-rear[2])*scale)),frontTrack=float(front_track),rearTrack=float(rear_track),
        capabilities=dict(cockpit=False,doors=False,hood=False,trunk=False,steeringWheel=False,headlights=True,brakeLights=True,reverseLights=False,indicators=False),
        cockpitStatus='Not available: source interior exists but driver-eye position and visibility have not been validated. No placeholder cockpit camera is advertised.',
        interactions={},interactionStatus='Source mesh names are material groups; no authored door/hood/steering hinges. No invented moving body interactions.',
        lights=dict(headlights=[body_names[5]],brake=[body_names[4]],reverse=[],indicatorLeft=[],indicatorRight=[]),
        lightingStatus='Front-white and rear-red named source light surfaces mapped; no separated reverse/turn-signal emitters are established. Dynamic appearance not validated here.',
        headlightEmitters=headlamp_emitters,images=image_info,
        centerOfMassReference=dict(position=[0,.57,-.0291],status='v0.7 runtime engineering reference from ModelYConfig, not a measured Tesla center of mass'),
        rigLimits=dict(maximumFrontSteeringDegrees=35,recommendedMaximumFrontSteeringDegrees=28,recommendedCompressionMeters=.04,recommendedDroopMeters=.09,
            status='192 poses at 0/±28 deg, -90/0/+40 mm, rolling every45 deg: zero red-painted body crossings; retained black inner-liner crossings under steering. Localized 0/90 deg roll crossing points stay at abs(X)<=0.601798m.',
            originalRestBodyIntersections=0,retainedInnerLinerCrossingsUnderSteering=True,
            caution='80mm compression intersects black arch/underbody close to exterior abs(X)=0.930-0.949m. Not recommended. No body geometry removed. Not a real suspension or tire-deformation measurement.'),
        originalAppearance=dict(status='user-supplied 2026 Model Y Performance model; no separate exterior rebuild',
            differences=['All original tires have equal geometry width and radius; official front/rear staggered tire sizes are not reproduced','Body/height/track proportions differ from official dimensions after a single uniform length fit','No part-specific scaling or wheel replacement has been applied']),
        license=dict(name='CC-BY-NC-4.0',author='BloxBloger',authorUrl='https://sketchfab.com/BloxBloger',
            sourceUrl='https://sketchfab.com/3d-models/2026-tesla-model-y-performance-8a0bc252f9da4015a02a7bd99efd4847',licenseUrl='https://creativecommons.org/licenses/by-nc/4.0/',
            provenance='embedded source asset.extras; attribution and noncommercial terms retained',
            modificationNotice='Roadster Flight Lab: uniform metric scaling, original component regrouping into four wheel/brake rigs, axis-centered pivots and node renaming. Original author geometry/materials/texture retained.'),
        segmentation=dict(method='complete position-connected components (1e-7 source-unit diagnostic welding); original vertices/UV/faces preserved',
            caliperRule='Red caliper halves, black pad pieces and 500-face black caliper bolt details are excluded from rotation; original wheel rims/hub hats/rotors and logo details roll.',
            manifest=manifest,emitted=emitted),
        innerLinerRepair=repair_report,
        output=dict(path=str(destination.relative_to(ROOT)),bytes=len(result),sha256=hashlib.sha256(result).hexdigest(),vertices=original_vertices,triangles=original_triangles,nodes=len(out['nodes']),meshes=len(out['meshes']),materials=len(out['materials']),images=len(out['images'])),
        originalUnchanged=hashlib.sha256(source.read_bytes()).hexdigest()==EXPECTED_SHA)
    if repair_inner_liners:
        metadata['originalAppearance']['status']='Independent local front inner-liner clearance repair candidate; exterior paint, outer black lip, all rolling/brake geometry remain unchanged'
        metadata['license']['modificationNotice']+=' Local front inner-liner wall vertices were additionally retreated inward by up to150mm with smooth transitions; all original faces and UV coordinates retained.'
        metadata['rigLimits']['retainedInnerLinerCrossingsUnderSteering']=False
        metadata['rigLimits']['status']='Repaired candidate: target 0/±28deg, -90/0/+40mm, rolling every45deg. See hash-matched verification report; native appearance review remains required.'
        verification=ROOT/('reports/model-y-wheel-verification.json' if promote_repair else 'reports/model-y-wheel-verification-candidate.json')
        if verification.exists():
            checked=json.loads(verification.read_text())
            if checked.get('outputSha256')==metadata['output']['sha256']:
                metadata['innerLinerRepair']['verification']=dict(report=str(verification.relative_to(ROOT)),sampleCount=len(checked['clearanceSweep']),allBodyTrianglePairs=sum(s['intersectingTrianglePairs'] for s in checked['clearanceSweep']))
        if promote_repair:
            metadata['originalAppearance']['status']='Final v0.7 local front inner-liner clearance repair; exterior paint, outer black lip, all rolling/brake geometry remain unchanged'
            metadata['rigLimits']['maximumFrontSteeringDegrees']=28
            metadata['rigLimits']['status']='Final repaired v0.7: 192 poses at0/±28deg, -90/0/+40mm, rolling every45deg; zero intersections against all static Body triangles. Three.js appearance reviewed before promotion.'
            metadata['innerLinerRepair']['status']='Final v0.7: promoted after hash-matched 192-pose zero-all-Body SAT, 0E/0W Validator and real Three.js visual review'
            metadata['innerLinerRepair']['visualVerification']=dict(screenshot='reports/screenshots/model-y-inner-liner-candidate.png',boundary='Parent integration reported real Three.js preview; final GLB is byte-identical to that reviewed candidate')
    metadata_destination=metadata_destination or destination.parent/('model-y-geometry-candidate.json' if repair_inner_liners and not promote_repair else 'model-y-geometry.json')
    metadata_destination.write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
    summary={key:metadata[key] for key in ['scale','dimensions','wheelbase','frontTrack','rearTrack','wheels','output','originalUnchanged']}
    summary['innerLinerRepair']=repair_report
    (ROOT/('reports/model-y-geometry-report-candidate.json' if repair_inner_liners and not promote_repair else 'reports/model-y-geometry-report.json')).write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
    return metadata

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,default=(Path(__file__).resolve().parents[1]/'assets/originals/2026_tesla_model_y_performance.glb'));parser.add_argument('--output',type=Path);parser.add_argument('--metadata-output',type=Path);parser.add_argument('--repair-inner-liners',action='store_true');parser.add_argument('--promote-repair',action='store_true',help='Explicitly generate the hash-verified final repaired canonical asset after review');args=parser.parse_args()
    if args.promote_repair and not args.repair_inner_liners:parser.error('--promote-repair requires --repair-inner-liners')
    destination=args.output or ROOT/('public/models/model-y-performance-drive-ready-candidate.glb' if args.repair_inner_liners and not args.promote_repair else 'public/models/model-y-performance-drive-ready.glb')
    if args.repair_inner_liners and not args.promote_repair and destination.resolve()==(ROOT/'public/models/model-y-performance-drive-ready.glb').resolve():parser.error('Use a separate candidate output or explicit --promote-repair for a reviewed final asset')
    build(args.source,destination,args.repair_inner_liners,args.metadata_output,args.promote_repair)
