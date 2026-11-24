#!/usr/bin/env python3
"""Rebuild supplied Model 3 GLB without decimation or replacement wheels.

Requires Python 3.10+ and NumPy. Run from any directory. The source is read only.
Only rigid transformations, a single global scale, and a documented 6 mm front
wheel placement correction are applied. Every source triangle is retained once.
"""
from pathlib import Path
import argparse, copy, hashlib, json, struct
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DTYPES = {5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'}
WIDTHS = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def read_glb(path):
    raw = path.read_bytes()
    magic, version, size = struct.unpack_from('<4sII',raw)
    assert magic == b'glTF' and version == 2 and size == len(raw)
    off=12; doc=None; binary=None
    while off<len(raw):
        size,kind=struct.unpack_from('<II',raw,off);off+=8
        if kind==0x4e4f534a:doc=json.loads(raw[off:off+size])
        elif kind==0x004e4942:binary=raw[off:off+size]
        off+=size
    return raw,doc,binary

def build(source, destination):
    if source.resolve() == destination.resolve():
        raise ValueError('Output must differ from the read-only original GLB')
    raw,src,buf=read_glb(source)
    def accessor(index):
        a=src['accessors'][index];v=src['bufferViews'][a['bufferView']]
        dt=np.dtype(DTYPES[a['componentType']]);w=WIDTHS[a['type']]
        return np.ndarray((a['count'],w),dtype=dt,buffer=buf,
            offset=v.get('byteOffset',0)+a.get('byteOffset',0),
            strides=(v.get('byteStride',w*dt.itemsize),dt.itemsize)).copy()
    parents={c:i for i,n in enumerate(src['nodes']) for c in n.get('children',[])}
    matrices={}
    def matrix(i):
        if i not in matrices:
            n=src['nodes'][i]
            m=np.array(n.get('matrix',np.eye(4).T.ravel()),float).reshape(4,4).T
            assert not any(k in n for k in ('translation','rotation','scale')), 'Unexpected source TRS'
            matrices[i]=matrix(parents[i])@m if i in parents else m
        return matrices[i]
    def descendants(i):
        return [i]+[j for c in src['nodes'][i].get('children',[]) for j in descendants(c)]
    geometry={}
    total_vertices=0;total_triangles=0
    for i,n in enumerate(src['nodes']):
        if 'mesh' not in n:continue
        primitives=[]
        for p in src['meshes'][n['mesh']]['primitives']:
            attrs={k:accessor(v) for k,v in p['attributes'].items()}
            m=matrix(i)
            attrs['POSITION']=attrs['POSITION']@m[:3,:3].T+m[:3,3]
            faces=accessor(p['indices']).ravel().reshape(-1,3)
            if 'NORMAL' in attrs:
                attrs['NORMAL']=attrs['NORMAL']@np.linalg.inv(m[:3,:3])
                attrs['NORMAL']/=np.linalg.norm(attrs['NORMAL'],axis=1)[:,None]
            primitives.append(dict(attrs=attrs,faces=faces,material=p.get('material')))
            total_vertices+=len(attrs['POSITION']);total_triangles+=len(faces)
        geometry[i]=primitives
    all_points=np.vstack([p['attrs']['POSITION'] for ps in geometry.values() for p in ps])
    lo=all_points.min(0);hi=all_points.max(0)
    scale=4.694/(hi[2]-lo[2])
    orientation=np.diag([-1.,1.,-1.])
    # Exact tire bounding-box centers (source wheels.3), per side/axle.
    wheel_sources={'F':list(range(286,293)), 'R':list(range(294,301))}
    tire_sources={'F':290,'R':298}
    wheel_centers={};wheel_radii={};wheel_widths={}
    for axle in ['F','R']:
        tire=geometry[tire_sources[axle]][0]['attrs']['POSITION']
        for side,sign in [('L',-1),('R',1)]:
            q=tire[tire[:,0]*sign>0]
            center=(q.min(0)+q.max(0))/2
            id=axle+side
            wheel_centers[id]=center
            wheel_radii[id]=float(np.max(np.linalg.norm((q-center)[:,1:],axis=1))*scale)
            wheel_widths[id]=float(np.ptp(q[:,0])*scale)
    axle_front=(wheel_centers['FL']+wheel_centers['FR'])/2
    axle_rear=(wheel_centers['RL']+wheel_centers['RR'])/2
    origin=np.array([(lo[0]+hi[0])/2,lo[1],(axle_front[2]+axle_rear[2])/2])
    def point(q):return (np.asarray(q)-origin)@orientation.T*scale
    for ps in geometry.values():
        for p in ps:
            p['attrs']['POSITION']=point(p['attrs']['POSITION'])
            if 'NORMAL' in p['attrs']:p['attrs']['NORMAL']=p['attrs']['NORMAL']@orientation.T
    # Build fresh binary to avoid unused-accessor warnings. All PNG payloads copied byte-for-byte.
    out={k:copy.deepcopy(src[k]) for k in ['asset','materials','textures','samplers'] if k in src}
    out['asset']['generator']='Roadster Flight Lab v0.6 Model 3 geometric rig processor'
    out.update(scene=0,scenes=[{'name':'Model3','nodes':[0]}],nodes=[],meshes=[],accessors=[],bufferViews=[],images=[])
    if 'extensionsUsed' in src:out['extensionsUsed']=copy.deepcopy(src['extensionsUsed'])
    if 'extensionsRequired' in src:out['extensionsRequired']=copy.deepcopy(src['extensionsRequired'])
    binary=bytearray()
    def view(data,target=None):
        while len(binary)%4:binary.append(0)
        idx=len(out['bufferViews']);v=dict(buffer=0,byteOffset=len(binary),byteLength=len(data))
        if target:v['target']=target
        out['bufferViews'].append(v);binary.extend(data);return idx
    def write_accessor(array,type,component,target=None,bounds=False):
        array=np.asarray(array,dtype=DTYPES[component])
        a=dict(bufferView=view(array.tobytes(),target),componentType=component,count=len(array),type=type)
        if bounds:a.update(min=array.min(0).tolist(),max=array.max(0).tolist())
        out['accessors'].append(a);return len(out['accessors'])-1
    image_hashes=[]
    for image in src['images']:
        v=src['bufferViews'][image['bufferView']];start=v.get('byteOffset',0);data=buf[start:start+v['byteLength']]
        im=copy.deepcopy(image);im['bufferView']=view(data);out['images'].append(im)
        w,h=struct.unpack_from('>II',data,16)
        image_hashes.append(dict(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),width=w,height=h))
    def node(name,parent=None,translation=None,extras=None):
        n=dict(name=name,children=[])
        if translation is not None:n['translation']=np.asarray(translation).tolist()
        if extras:n['extras']=extras
        idx=len(out['nodes']);out['nodes'].append(n)
        if parent is not None:out['nodes'][parent]['children'].append(idx)
        return idx
    root=node('Model3',extras={'vehicle':{'units':'meters','forward':'+Z','up':'+Y','left':'+X','sourceLicense':'CC-BY-4.0'}})
    body=node('Body',root)
    emitted=[];source_to_output={};wheel_stats=[]
    def mesh_node(name,primitives,parent,pivot=None,source_id=None,selection=None,delta=None):
        op=[]
        for p in primitives:
            faces=p['faces']
            if selection is not None:
                sides=p['attrs']['POSITION'][faces,0]*selection
                # A triangle must belong completely to one side. No cuts through faces.
                assert np.all(np.all(sides>0,axis=1)|np.all(sides<0,axis=1)), 'Wheel triangle crosses centerline'
                faces=faces[np.all(sides>0,axis=1)]
            used,indices=np.unique(faces,return_inverse=True)
            attrs={k:v[used].copy() for k,v in p['attrs'].items()}
            if pivot is not None:attrs['POSITION']-=pivot
            if delta is not None:attrs['POSITION']+=delta
            attributes={}
            for key,values in attrs.items():
                attributes[key]=write_accessor(values,'VEC'+str(values.shape[1]),5126,34962,key=='POSITION')
            primitive=dict(attributes=attributes,indices=write_accessor(indices.astype('<u4').reshape(-1,1),'SCALAR',5125,34963))
            if p['material'] is not None:primitive['material']=p['material']
            op.append(primitive)
            emitted.append((name,attrs['POSITION'],indices.reshape(-1,3),p['material']))
        out['meshes'].append(dict(name=name,primitives=op));idx=node(name,parent)
        out['nodes'][idx]['mesh']=len(out['meshes'])-1
        if source_id is not None:source_to_output[source_id]=name
        return idx
    claimed=set()
    hubs={'FL':[12,13],'FR':[9,10],'RL':[7],'RR':[5]}
    for id in ['FL','FR','RL','RR']:
        nominal=point(wheel_centers[id]);center=nominal.copy();center[1]=wheel_radii[id]
        # Only front wheels need a 6 mm rigid downward shift: the source rear group is 1.8% larger.
        delta=center-nominal
        suspension=node(f'Wheel_{id}_Suspension',root,center)
        steering=node(f'Wheel_{id}_Steering',suspension) if id[0]=='F' else suspension
        rotation=node(f'Wheel_{id}_Rotation',steering)
        group=node(f'Wheel_{id}',rotation)
        count=0
        for source_id in wheel_sources[id[0]]:
            before=len(emitted)
            mesh_node(f'Wheel_{id}_Part_{source_id}',geometry[source_id],group,pivot=nominal,selection=1 if id[1]=='L' else -1,source_id=None)
            count+=sum(len(e[2]) for e in emitted[before:]);claimed.add(source_id)
        for source_id in hubs[id]:
            mesh_node(f'Caliper_{id}_{source_id}',geometry[source_id],steering,pivot=nominal,source_id=source_id)
            claimed.add(source_id)
        wheel_stats.append(dict(id=id,center=center.tolist(),radius=wheel_radii[id],width=wheel_widths[id],triangles=count,
            sourceWheelNodes=wheel_sources[id[0]],placementCorrectionMeters=delta.tolist(),
            suspensionNode=f'Wheel_{id}_Suspension',steeringNode=f'Wheel_{id}_Steering' if id[0]=='F' else None,
            rotationNode=f'Wheel_{id}_Rotation',meshGroup=f'Wheel_{id}',caliperNodes=[source_to_output[s] for s in hubs[id]]))
    interactions={}
    definitions=[('door_fl',184,'Door_FL_Hinge',[0,1,0],-65),('door_fr',218,'Door_FR_Hinge',[0,1,0],65),
        ('door_rl',202,'Door_RL_Hinge',[0,1,0],-65),('door_rr',235,'Door_RR_Hinge',[0,1,0],65),
        ('hood',279,'Hood_Hinge',[1,0,0],-55),('trunk',158,'Trunk_Hinge',[1,0,0],65),
        ('steering_wheel',20,'Steering_Wheel_Pivot',None,0)]
    for id,source_id,name,axis,angle in definitions:
        pivot=point(matrix(source_id)[:3,3]);group=node(name,body,pivot)
        if axis is None:
            axis=matrix(source_id)[:3,1]@orientation.T;axis=(axis/np.linalg.norm(axis)).tolist()
        interactions[id]=dict(node=name,pivot=pivot.tolist(),axis=axis,maxAngleDegrees=angle,
            sourcePivotNode=source_id,sourcePivotName=src['nodes'][source_id]['name'],status='original source hinge retained; engineering motion limits')
        for j in descendants(source_id):
            if j not in geometry:continue
            mesh_node('M3_'+str(j)+'_'+src['nodes'][j]['name'].replace(' ','_').replace('.','_'),geometry[j],group,pivot=pivot,source_id=j);claimed.add(j)
    for source_id,primitives in geometry.items():
        if source_id in claimed:continue
        mesh_node('M3_'+str(source_id)+'_'+src['nodes'][source_id]['name'].replace(' ','_').replace('.','_'),primitives,body,source_id=source_id)
    # No empty child arrays are needed in glTF; leave transforms editable TRS.
    for n in out['nodes']:
        if not n['children']:del n['children']
    def names(indices):return [source_to_output[i] for i in indices]
    lights={
        'headlights':names([55,56,259,261]),'brake':names([49,60,47,177,179]),
        'reverse':names([181]),'indicatorLeft':names([68,265,173]),'indicatorRight':names([70,263,171])}
    transformed=point(all_points)
    metadata=dict(version=1,vehicleId='model3-2018-performance',units='meters',
        axes=dict(up='+Y',forward='+Z',left='+X',rollingAxis='+X for all wheels',positiveRolling='forward +Z',positiveSteering='left +X'),
        source=dict(path=str(source),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),vertices=total_vertices,triangles=total_triangles,
            nodes=len(src['nodes']),meshes=len(src['meshes']),materials=len(src['materials']),images=len(src['images']),asset=src['asset']),
        scale=scale,sourceWorldOrigin=origin.tolist(),rootOrigin='ground level, midpoint of the two axles in XZ',
        dimensions=dict(length=4.694,widthWithMirrors=float(np.ptp(transformed[:,0])),height=float(np.ptp(transformed[:,1])),
            bodyWidth=float((109.187+109.135)*scale),historicalReference=dict(length=4.694,width=1.849,widthWithMirrors=2.088,height=1.443,wheelbase=2.875,frontTrack=1.580,rearTrack=1.580)),
        wheels=wheel_stats,wheelbase=float(abs((axle_front[2]-axle_rear[2])*scale)),
        frontTrack=float(abs(wheel_stats[0]['center'][0]-wheel_stats[1]['center'][0])),
        rearTrack=float(abs(wheel_stats[2]['center'][0]-wheel_stats[3]['center'][0])),
        cockpit=dict(position=[0.415,1.05,-0.18],target=[0.10,0.92,2.0],fov=68,status='engineering eye point in original left-hand-drive cabin; verified steering wheel and center screen visible'),
        interactions=interactions,lights=lights,images=image_hashes,
        headlightEmitters=[dict(position=((geometry[i][0]['attrs']['POSITION'].min(0)+geometry[i][0]['attrs']['POSITION'].max(0))/2).tolist(),sourceNode=source_to_output[i]) for i in [55,56]],
        rigLimits=dict(recommendedCompressionMeters=0.020,recommendedDroopMeters=0.090,maximumFrontSteeringDegrees=35,
            basis='source external wheel arches clear at +25 mm and intersect at +30 mm; 20 mm chosen with 5 mm sampled margin; inner black liners and original suspension decor still intersect as documented in reports/model3-wheel-verification.json',
            engineeringLimitsNotFactorySpecifications=True),
        centerOfMassReference=dict(position=[0,0.52,-0.04],status='engineering estimate; not a measured Tesla value'),
        visualIdentity=dict(status='2018 Model 3 source mesh; exact Performance Upgrade appearance not established',
            knownDifferences=['Wheel pattern and size not verified as factory 20-inch Sport Wheels','No verified Performance rear spoiler or red Performance brake calipers','Source rear wheels are 1.807% larger than front wheels','Body/track proportions differ from the historical manual; a single uniform scale retains source appearance']),
        transforms=dict(wheelFrontDownwardCorrection='front centers rigidly moved down approximately 6 mm to make four visual tires contact the same ground',
            scaling='single uniform global scale; no body part stretching, decimation, wheel replacement, or hidden original wheel geometry'),
        license=dict(name='CC-BY-4.0',author='Ameer Studio',authorUrl='https://sketchfab.com/uchiha.321abc',
            sourceUrl='https://sketchfab.com/3d-models/tesla-2018-model-3-5ef9b845aaf44203b6d04e2c677e444f',
            licenseUrl='https://creativecommons.org/licenses/by/4.0/',provenance='embedded asset.extras in supplied source; source-page availability must be rechecked for public release'))
    out_triangles=sum(len(e[2]) for e in emitted)
    assert out_triangles==total_triangles, (out_triangles,total_triangles)
    out['buffers']=[dict(byteLength=len(binary))]
    j=json.dumps(out,separators=(',',':'),ensure_ascii=False).encode();j+=b' '*((-len(j))%4)
    binary+=b'\0'*((-len(binary))%4)
    result=struct.pack('<4sII',b'glTF',2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(result)
    try:
        output_label = str(destination.relative_to(ROOT))
    except ValueError:
        output_label = str(destination.resolve())
    metadata['output']=dict(path=output_label,sha256=hashlib.sha256(result).hexdigest(),bytes=len(result),triangles=out_triangles,
        vertices=sum(len(e[1]) for e in emitted),meshes=len(out['meshes']),nodes=len(out['nodes']),materials=len(out['materials']),images=len(out['images']))
    metadata['originalUnchanged']=hashlib.sha256(source.read_bytes()).hexdigest()==metadata['source']['sha256']
    (destination.parent/'model3-geometry.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:metadata[k] for k in ['scale','wheelbase','frontTrack','rearTrack','wheels','output','originalUnchanged']},indent=2))
    return metadata,out,emitted

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=(Path(__file__).resolve().parents[1]/'assets/originals/tesla_2018_model_3.glb'))
    parser.add_argument('--output',type=Path,default=ROOT/'public/models/model3-drive-ready.glb')
    args=parser.parse_args();build(args.source,args.output)
