#!/usr/bin/env python3
# Python 3.12+, numpy 2.3.5, scipy 1.18.1, manifold3d 3.5.4.
# Input model is read only. Front wheels reuse same-side rear geometry as explicitly requested.
from pathlib import Path
import sys, json, struct, copy, hashlib
import numpy as np

HERE=Path(__file__).resolve().parent

def read_glb(path):
    raw=Path(path).read_bytes();off=12;doc=None;binary=None
    while off<len(raw):
        n,kind=struct.unpack_from('<II',raw,off);off+=8
        if kind==0x4e4f534a:doc=json.loads(raw[off:off+n])
        if kind==0x004e4942:binary=raw[off:off+n]
        off+=n
    def acc(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
        dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
        w={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        return np.ndarray((a['count'],w),dtype=dt,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',np.dtype(dt).itemsize*w),np.dtype(dt).itemsize)).copy()
    p=doc['meshes'][0]['primitives'][0]
    props=np.column_stack([acc(p['attributes'][n]) for n in ['POSITION','NORMAL','TEXCOORD_0']])
    faces=acc(p['indices']).reshape(-1,3)
    im=doc['images'][0];v=doc['bufferViews'][im['bufferView']]
    image=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
    return doc,props,faces,image

def mesh_stats(props,faces):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    p=props[:,:3];unique,inv=np.unique(np.round(p.astype(np.float64),7),axis=0,return_inverse=True)
    wf=inv[faces];edges=np.sort(np.concatenate([wf[:,[0,1]],wf[:,[1,2]],wf[:,[2,0]]]),axis=1)
    ue,counts=np.unique(edges,axis=0,return_counts=True)
    graph=coo_matrix((np.ones(len(ue)),(ue[:,0],ue[:,1])),shape=(len(unique),len(unique)))
    nc,_=connected_components(graph,directed=False)
    area=np.linalg.norm(np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]]),axis=1)
    lengths=np.linalg.norm(props[:,3:6],axis=1)
    return dict(vertices=len(p),triangles=len(faces),boundsMin=p.min(axis=0).tolist(),boundsMax=p.max(axis=0).tolist(),dimensions=np.ptp(p,axis=0).tolist(),positionWeldedComponents=nc,boundaryEdges=int(sum(counts==1)),nonManifoldEdges=int(sum(counts>2)),degenerateTriangles=int(sum(area<1e-12)),nonfiniteValues=int(sum(~np.isfinite(props).ravel())),normalLengthMin=float(lengths.min()),normalLengthMax=float(lengths.max()),uvMin=props[:,6:8].min(axis=0).tolist(),uvMax=props[:,6:8].max(axis=0).tolist())

def connected_face_labels(props,faces):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    unique,inv=np.unique(props[:,:3],axis=0,return_inverse=True)
    wf=inv[faces];edges=np.concatenate([wf[:,[0,1]],wf[:,[1,2]],wf[:,[2,0]]])
    g=coo_matrix((np.ones(len(edges),dtype=np.int8),(edges[:,0],edges[:,1])),shape=(len(unique),len(unique)))
    _,labels=connected_components(g,directed=False)
    fl=labels[wf[:,0]];roots,counts=np.unique(fl,return_counts=True)
    return fl,roots[np.argsort(-counts)]

def subset(props,faces):
    used,inv=np.unique(faces,return_inverse=True)
    return props[used].copy(),inv.reshape(-1,3).astype(np.uint32)

class Writer:
    def __init__(self,source_doc,image):
        self.bin=bytearray()
        self.doc={'asset':{'version':'2.0','generator':'Roadster wheel refit - reproducible Python / Manifold'},'scene':0,'scenes':[{'name':'Roadster','nodes':[0]}],'nodes':[{'name':'Roadster','children':[]}],'meshes':[],'materials':copy.deepcopy(source_doc['materials']),'images':[],'textures':copy.deepcopy(source_doc['textures']),'samplers':copy.deepcopy(source_doc['samplers']),'accessors':[],'bufferViews':[]}
        self.doc['images']=[{'name':'shaded-original','mimeType':'image/png','bufferView':self.view(image)}]
        self.doc['materials'].append({'name':'Wheelwell_Interior','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[0.025,0.025,0.025,1],'metallicFactor':0,'roughnessFactor':1},'emissiveFactor':[0.015,0.015,0.015]})
    def view(self,data,target=None):
        while len(self.bin)%4:self.bin.append(0)
        i=len(self.doc['bufferViews']);v={'buffer':0,'byteOffset':len(self.bin),'byteLength':len(data)}
        if target:v['target']=target
        self.doc['bufferViews'].append(v);self.bin.extend(data)
        return i
    def acc(self,data,kind):
        is_index=kind=='SCALAR';a=np.asarray(data,dtype='<u4' if is_index else '<f4')
        view=self.view(a.tobytes(),34963 if is_index else 34962)
        acc={'bufferView':view,'componentType':5125 if is_index else 5126,'count':int(a.size if is_index else len(a)),'type':kind}
        if kind=='VEC3':acc.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        i=len(self.doc['accessors']);self.doc['accessors'].append(acc);return i
    def mesh(self,name,props,faces,material_ids=None):
        n=props[:,3:6];n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-20)
        attrs={'POSITION':self.acc(props[:,:3],'VEC3'),'NORMAL':self.acc(n,'VEC3'),'TEXCOORD_0':self.acc(props[:,6:8],'VEC2')}
        primitives=[]
        if material_ids is None:material_ids=np.zeros(len(faces),dtype=np.int8)
        for mat in np.unique(material_ids):
            ff=faces[material_ids==mat]
            if len(ff):primitives.append({'attributes':attrs if int(mat)==0 else {k:v for k,v in attrs.items() if k!='TEXCOORD_0'},'indices':self.acc(ff.reshape(-1),'SCALAR'),'material':int(mat),'mode':4})
        mi=len(self.doc['meshes']);self.doc['meshes'].append({'name':name,'primitives':primitives});return mi
    def node(self,name,parent=0,**kwargs):
        i=len(self.doc['nodes']);self.doc['nodes'].append(dict(name=name,**kwargs));self.doc['nodes'][parent].setdefault('children',[]).append(i);return i
    def write(self,path):
        self.doc['buffers']=[{'byteLength':len(self.bin)}]
        j=json.dumps(self.doc,separators=(',',':'),ensure_ascii=False).encode();j+=b' '*((-len(j))%4)
        binary=bytes(self.bin);binary+=b'\0'*((-len(binary))%4)
        raw=struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
        Path(path).write_bytes(raw)

def export_single(path,doc,props,faces,image,name='model'):
    w=Writer(doc,image);mi=w.mesh(name,props,faces);w.node(name,mesh=mi);w.write(path)


from pathlib import Path
import sys, argparse, math, json, hashlib, copy, os
sys.path.insert(0,os.environ.get('ROADSTER_MESH_DEPS',str(Path(__file__).resolve().parent/'deps')))

import manifold3d as M
from scipy.optimize import least_squares
from scipy.ndimage import gaussian_filter1d

def manifold_from(props,faces):
    # Preserve separate UV/normal vertices, merge ONLY coincident positions for solid topology.
    _,first,inv=np.unique(props[:,:3],axis=0,return_index=True,return_inverse=True)
    dest=first[inv];dup=dest!=np.arange(len(props))
    oid=M.Manifold.reserve_ids(1)
    mesh=M.Mesh(np.ascontiguousarray(props,dtype=np.float32),np.ascontiguousarray(faces,dtype=np.uint32),
        np.where(dup)[0].astype(np.uint32),dest[dup].astype(np.uint32),
        run_index=np.array([0,faces.size],dtype=np.uint32),run_original_id=np.array([oid],dtype=np.uint32))
    solid=M.Manifold(mesh)
    if solid.status()!=M.Error.NoError:raise RuntimeError(f'Input is not reliably manifold: {solid.status()}')
    return solid,oid

def render_arrays(solid,original_ids):
    mm=solid.to_mesh(normal_idx=0)
    p=np.asarray(mm.vert_properties).copy();f=np.asarray(mm.tri_verts).copy()
    mats=np.ones(len(f),dtype=np.int8)
    for start,end,oid in zip(mm.run_index[:-1],mm.run_index[1:],mm.run_original_id):
        mats[int(start)//3:int(end)//3]=0 if int(oid) in original_ids else 1
    # Boolean caps have their own normals and dark wheelwell material; original UVs are retained.
    normals=p[:,3:6];bad=np.linalg.norm(normals,axis=1)<.1
    if bad.any():
        face_n=np.cross(p[f[:,1],:3]-p[f[:,0],:3],p[f[:,2],:3]-p[f[:,0],:3]);sums=np.zeros((len(p),3))
        for i in range(3):np.add.at(sums,f[:,i],face_n)
        normals[bad]=sums[bad]
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-20)
    return p,f,mats

def cutter_props(solid):
    return solid.set_properties(5,lambda position,properties:[0,0,0,0,0]).calculate_normals(0,35)

def cylinder_x(cy,cz,inner,outer,radius,sign=1):
    xmid=sign*(inner+outer)/2
    return cutter_props(M.Manifold.cylinder(outer-inner,radius,circular_segments=192,center=True).rotate([0,90,0]).translate([xmid,cy,cz]))

def fit_tire(props,guess_y,guess_z,guess_r,side):
    q=props[(side*props[:,0]>.275)&(np.abs(props[:,3])<.55)]
    rr=np.hypot(q[:,1]-guess_y,q[:,2]-guess_z)
    q=q[(rr>guess_r*.91)&(rr<guess_r*1.07)]
    fit=least_squares(lambda c:np.hypot(q[:,1]-c[0],q[:,2]-c[1])-c[2],[guess_y,guess_z,guess_r],loss='soft_l1',f_scale=.0008)
    return fit.x.tolist()

def swept_clearance(center,halfwidth,radius,steer_deg,suspension,margin):
    # Convex hull of a densely sampled cylinder swept through all steering angles.
    # The polygon is circumscribed, so the finite radial sampling cannot undercut the envelope.
    n=144;r=(radius+margin)/math.cos(math.pi/n);th=np.arange(n)*2*math.pi/n
    angles=np.linspace(-steer_deg,steer_deg,max(1,int(steer_deg*2)+1))
    points=[]
    for deg in angles:
        a=math.radians(deg);ca,sa=math.cos(a),math.sin(a)
        for x in [-halfwidth-margin,halfwidth+margin]:
            z=r*np.sin(th);y=r*np.cos(th)
            for dy in [-suspension,suspension]:
                points.append(np.column_stack([ca*x+sa*z,y+dy,-sa*x+ca*z])+center)
    return cutter_props(M.Manifold.hull_points(np.concatenate(points)))

def regularize_tread(wheel):
    """Small, continuous radial correction of ORIGINAL tire vertices. Never substitutes geometry.

    The hub (r < 72% of tire radius) and every X coordinate stay unchanged.
    Original UVs and topology are preserved; new normals follow the corrected surface.
    """
    mm=wheel['solid'].to_mesh(normal_idx=0);p=np.asarray(mm.vert_properties).copy()
    center=wheel['center'];local=p[:,:3]-center
    radius=np.hypot(local[:,1],local[:,2]);angles=np.arctan2(local[:,2],local[:,1])%(2*np.pi)
    n=180;bins=np.floor(angles*n/(2*np.pi)).astype(int)%n
    envelope=np.zeros(n);np.maximum.at(envelope,bins,radius)
    valid=envelope>0
    if valid.sum()<n*.9:raise RuntimeError('Insufficient tire perimeter coverage; refusing automatic tread correction')
    if not valid.all():envelope=np.interp(np.arange(n),np.where(valid)[0],envelope[valid],period=n)
    smooth=gaussian_filter1d(envelope,1.2,mode='wrap');target=float(np.median(smooth))
    support=np.interp(angles*n/(2*np.pi)-.5,np.arange(n),smooth,period=n)
    blend=np.clip((radius/target-.72)/.18,0,1);blend=blend*blend*(3-2*blend)
    new_r=radius*(1+blend*(target/np.maximum(support,1e-8)-1))
    new_r=np.minimum(new_r,target)
    factor=new_r/np.maximum(radius,1e-10)
    p[:,1]=center[1]+local[:,1]*factor;p[:,2]=center[2]+local[:,2]*factor
    displacement=np.linalg.norm(p[:,:3]-np.asarray(mm.vert_properties)[:,:3],axis=1)
    _,first,inv=np.unique(p[:,:3],axis=0,return_index=True,return_inverse=True);dest=first[inv];dup=dest!=np.arange(len(p))
    corrected=M.Manifold(M.Mesh(np.ascontiguousarray(p,dtype=np.float32),np.ascontiguousarray(mm.tri_verts,dtype=np.uint32),np.where(dup)[0].astype(np.uint32),dest[dup].astype(np.uint32),run_index=np.asarray(mm.run_index,dtype=np.uint32),run_original_id=np.asarray(mm.run_original_id,dtype=np.uint32),face_id=np.asarray(mm.face_id,dtype=np.uint32)))
    if corrected.status()!=M.Error.NoError:raise RuntimeError('Tread correction changed manifold topology')
    wheel['solid']=corrected.calculate_normals(0,60)
    wheel['rounding']={'method':'Radial correction of original tire vertices with smooth blend; hub below 72% radius and axial coordinates unchanged; UV retained. No replacement mesh.','maximumVertexDisplacementSourceUnits':float(displacement.max()),'meanVertexDisplacementSourceUnits':float(displacement.mean()),'targetRadiusSourceUnits':target}
    return target

def build(args):
    original_hash=hashlib.sha256(Path(args.input).read_bytes()).hexdigest()
    doc,props,faces,image=read_glb(args.input)
    fl,roots=connected_face_labels(props,faces)
    if len(roots)!=3:raise RuntimeError('Expected original body and two rear wheel components; input differs.')
    body_props,body_faces=subset(props,faces[fl==roots[0]])
    body,body_id=manifold_from(body_props,body_faces)
    pieces={};notes=[]
    rear_raw={}
    for root in roots[1:]:
        pp,ff=subset(props,faces[fl==root]);sign=1 if pp[:,0].mean()>0 else -1
        solid,oid=manifold_from(pp,ff)
        fit=fit_tire(pp,.145,-.628,.146,sign)
        center=np.array([(pp[:,0].max()+pp[:,0].min())/2,fit[0],fit[1]])
        rear_raw[sign]=dict(solid=solid,oid=oid,center=center,fit=fit)
    for sign,label in [(1,'FL'),(-1,'FR')]:
        fit=fit_tire(body_props,.143,.531,.141,sign)
        cy,cz,r=fit
        # Exact solid intersection closes the fused tread at a circular boundary.
        cutter=cylinder_x(cy,cz,.245,.46,r,sign)
        wheel=body^cutter
        parts=sorted(wheel.decompose(),key=lambda x:abs(x.volume()),reverse=True)
        if not parts:raise RuntimeError(f'Front {label} extraction empty')
        wheel=parts[0]
        mm=wheel.to_mesh();pos=np.asarray(mm.vert_properties)[:,:3]
        center=np.array([(pos[:,0].min()+pos[:,0].max())/2,cy,cz])
        pieces[label]=dict(solid=wheel,ids={body_id},center=center,fit=fit,method='Original front tire/rim intersected by circular cutter; fused upper tread/inner boundary closed; no substitute wheel',discardedFragments=len(parts)-1)
        notes.append({'wheel':label,'fit':fit,'centerOriginal':center.tolist(),'frontIntersectionParts':len(parts),'keptVolume':wheel.volume(),'removedFragmentVolume':sum(abs(s.volume()) for s in parts[1:])})
        # The user explicitly selected rear-wheel reuse after inspecting the distorted front rims.
        # Remove the fused original front tire volume, not just its render visibility.
        body=body-cylinder_x(cy,cz,.235,.47,r*1.04,sign)
        notes[-1]['originalFrontIntersectionUsedForCalibrationOnly']=True
        notes[-1]['originalFrontRemovalRadiusSourceUnits']=r*1.04
    for sign,label in [(1,'RL'),(-1,'RR')]:
        data=rear_raw[sign]
        pieces[label]=dict(solid=data['solid'],ids={data['oid']},center=data['center'],fit=data['fit'],method='Exact original geometric connected component; original UV and rim retained',discardedFragments=0)
    for label,wheel in pieces.items():
        if label[0]=='R':
            regularize_tread(wheel)
            wheel['method']+='; original tread vertices locally regularized for continuous rolling'
    front_widths=[]
    for label in ['FL','FR']:
        pp=np.asarray(pieces[label]['solid'].to_mesh().vert_properties)
        front_widths.append(float(np.ptp(pp[:,0])))
    front_radius=float(np.mean([pieces[k]['fit'][2] for k in ['FL','FR']]))
    front_width=float(np.mean(front_widths))
    front_halftrack=(pieces['FL']['center'][0]-pieces['FR']['center'][0])/2
    root_x=(props[:,0].min()+props[:,0].max())/2
    for label,rear_label,sign in [('FL','RL',1),('FR','RR',-1)]:
        target=pieces[label];rear=pieces[rear_label]
        local=rear['solid'].translate(-rear['center'])
        pp=np.asarray(local.to_mesh().vert_properties)[:,:3]
        source_r=float(np.hypot(pp[:,1],pp[:,2]).max());source_width=float(np.ptp(pp[:,0]))
        target['center'][0]=root_x+sign*front_halftrack
        target['solid']=local.scale([front_width/source_width,front_radius/source_r,front_radius/source_r]).translate(target['center'])
        target['ids']=rear['ids'].copy()
        target['rounding']={**rear['rounding'],'sourceRearWheel':rear_label,'frontWidthScale':front_width/source_width,'frontRadialScale':front_radius/source_r}
        target['method']='USER-APPROVED: independent copy of same-side original rear tire and rim; common front radius/width calibrated from original front wheels; original fused front geometry removed from body; no cylinder replacement.'
    source_length=float(np.ptp(props[:,:3],axis=0)[2]);scale=args.length_m/source_length
    # Align axle Z and tread center Y using small wheel-only translations; preserve tire geometry.
    axle_z={ax:np.mean([pieces[ax+s]['center'][2] for s in ['L','R']]) for ax in ['F','R']}
    for label,wheel in pieces.items():
        center=wheel['center'].copy();new_center=center.copy();new_center[2]=axle_z[label[0]]
        # Radius is calibrated to the fitted tire tread, retaining differences in original front/rear sizes.
        mm=wheel['solid'].to_mesh();pos=np.asarray(mm.vert_properties)[:,:3]
        radial=np.hypot(pos[:,1]-center[1],pos[:,2]-center[2]);max_radius=float(radial.max())
        # All tires rest on Y=0 at full rotation; fit center is the roll axis.
        new_center[1]=max_radius
        wheel['solid']=wheel['solid'].translate(new_center-center);wheel['originalCenter']=center.copy();wheel['center']=new_center;wheel['radius']=max_radius
        wheel['halfwidth']=float(max(abs(pos[:,0]-center[0])))
        wheel['width']=float(np.ptp(pos[:,0]))
    suspension=args.suspension_mm/1000/scale;margin=args.clearance_mm/1000/scale
    clearance_solids={}
    for label,wheel in pieces.items():
        env=swept_clearance(wheel['center'],wheel['halfwidth'],wheel['radius'],args.steering_deg if label[0]=='F' else 0,suspension,margin)
        clearance_solids[label]=env
        before=body.num_tri();body=body-env
        print('WHEELWELL',label,'body triangles',before,'->',body.num_tri(),'status',body.status(),flush=True)
        if body.status()!=M.Error.NoError:raise RuntimeError('Wheelwell boolean failed')
    # Retain only the main body, removing any tiny cut-off wheel remnants rather than leaving static tires.
    body_parts=sorted(body.decompose(),key=lambda x:abs(x.volume()),reverse=True)
    if len(body_parts)>1:notes.append({'disconnectedBodyFragmentsRemoved':len(body_parts)-1,'volume':sum(abs(x.volume()) for x in body_parts[1:])})
    body=body_parts[0]
    origin=np.array([(props[:,0].min()+props[:,0].max())/2,0,(props[:,2].min()+props[:,2].max())/2])
    w=Writer(doc,image)
    bp,bf,bmat=render_arrays(body,{body_id});bp[:,:3]=(bp[:,:3]-origin)*scale
    body_mesh=w.mesh('Body',bp,bf,bmat);w.node('Body',mesh=body_mesh)
    report={'inputSha256':original_hash,'inputPath':str(Path(args.input).resolve()),'scale':scale,'temporaryLengthMeters':args.length_m,'lengthIsOfficial':False,'axes':{'up':'+Y','forward':'+Z','left':'+X','right':'-X','rollingAxis':'+X for ALL wheels','positiveRolling':'forward +Z','positiveSteering':'left (+X)'},'rootOrigin':'Ground level, original full-model XZ bounding-box center; geometry transforms baked to meters','sourceOrigin':origin.tolist(),'suspensionTestTravelMeters':args.suspension_mm/1000,'steeringRangeDegrees':[-args.steering_deg,args.steering_deg],'clearanceMarginMeters':args.clearance_mm/1000,'originalTextureSha256':hashlib.sha256(image).hexdigest(),'body':mesh_stats(bp,bf),'wheels':{},'operations':notes,'collisionTests':[]}
    for label,wheel in pieces.items():
        center=(wheel['center']-origin)*scale
        pp,ff,mat=render_arrays(wheel['solid'],wheel['ids']);pp[:,:3]=(pp[:,:3]-wheel['center'])*scale
        mi=w.mesh('Wheel_'+label,pp,ff,mat)
        sn=w.node('Wheel_'+label+'_Suspension',translation=center.tolist())
        parent=sn
        if label[0]=='F':parent=w.node('Wheel_'+label+'_Steering',parent=sn)
        rn=w.node('Wheel_'+label+'_Rotation',parent=parent)
        w.node('Wheel_'+label,parent=rn,mesh=mi)
        stats=mesh_stats(pp,ff)
        report['wheels'][label]=dict(centerMeters=center.tolist(),radiusMeters=wheel['radius']*scale,widthMeters=wheel['width']*scale,sourceCenter=wheel['originalCenter'].tolist(),mesh=stats,method=wheel['method'],treadCorrection={**wheel['rounding'],'maximumVertexDisplacementMeters':wheel['rounding']['maximumVertexDisplacementSourceUnits']*scale},newSurfaceTriangleCount=int(sum(mat==1)),originalSurfaceTriangleCount=int(sum(mat==0)),axleAlignmentTranslationMeters=((wheel['center']-wheel['originalCenter'])*scale).tolist())
    com=[0,.45,0]
    w.node('CenterOfMass_Reference',translation=com,extras={'estimated':True,'purpose':'Reference only. Not a measured center of mass and not physics mass properties.'})
    report['centerOfMassReferenceMeters']=com;report['centerOfMassIsEstimated']=True
    report['wheelbaseMeters']=(axle_z['F']-axle_z['R'])*scale
    report['frontTrackMeters']=report['wheels']['FL']['centerMeters'][0]-report['wheels']['FR']['centerMeters'][0]
    report['rearTrackMeters']=report['wheels']['RL']['centerMeters'][0]-report['wheels']['RR']['centerMeters'][0]
    w.doc['nodes'][0]['extras']={'vehicle':{'units':'meters','forward':'+Z','up':'+Y','left':'+X','rollAxis':'+X','scaleIsTemporary':True,'temporaryLengthMeters':args.length_m,'suspensionTravelMeters':args.suspension_mm/1000,'steeringLimitDegrees':args.steering_deg,'centerOfMassReferenceEstimated':True}}
    # Non-rendered provenance makes automatic reprocessing auditable.
    w.doc['asset']['extras']={'sourceSha256':original_hash,'textureSha256':hashlib.sha256(image).hexdigest(),'processing':'Rear wheels extracted. Front wheels are resized independent copies of same-side rear wheels, explicitly requested by user. Original fused front tire geometry removed; wheelwell clearance subtracted. No cylinder replacement.','provisionalScale':True}
    w.write(args.output)
    # Volumetric overlap and surface-gap tests using real wheel geometry, not bounding boxes.
    for label,wheel in pieces.items():
        local=wheel['solid'].translate(-wheel['center'])
        for steer in ([-args.steering_deg,0,args.steering_deg] if label[0]=='F' else [0]):
            for roll in [0,90,180,270]:
                for dy in [-suspension,0,suspension]:
                    moved=local.rotate([roll,steer,0]).translate(wheel['center']+[0,dy,0])
                    volume=abs((body^moved).volume())*scale**3
                    report['collisionTests'].append({'wheel':label,'steeringDegrees':steer,'rollingDegrees':roll,'suspensionMeters':dy*scale,'intersectionCubicMeters':volume})
        print('CHECKED',label,'max overlap m3',max(t['intersectionCubicMeters'] for t in report['collisionTests'] if t['wheel']==label),flush=True)
    report['outputBytes']=Path(args.output).stat().st_size;report['outputSha256']=hashlib.sha256(Path(args.output).read_bytes()).hexdigest()
    report['originalUnchanged']=hashlib.sha256(Path(args.input).read_bytes()).hexdigest()==original_hash
    report['totalTriangles']=sum(len(m['primitives']) and sum(w.doc['accessors'][p['indices']]['count']//3 for p in m['primitives']) for m in w.doc['meshes'])
    report['nodeTree']=w.doc['nodes'];report['maxOverlapCubicMeters']=max(t['intersectionCubicMeters'] for t in report['collisionTests'])
    Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('SAVED',args.output,report['totalTriangles'],'triangles, overlap',report['maxOverlapCubicMeters'],flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Preserve and extract the original Roadster wheels, repair local cuts, export controllable GLB nodes.')
    parser.add_argument('--input',required=True)
    parser.add_argument('--output',default='roadster-drive-ready.glb')
    parser.add_argument('--report',default='roadster-build-metrics.json')
    parser.add_argument('--length-m',type=float,default=4.6)
    parser.add_argument('--steering-deg',type=float,default=35)
    parser.add_argument('--suspension-mm',type=float,default=15)
    parser.add_argument('--clearance-mm',type=float,default=6)
    args=parser.parse_args()
    if Path(args.input).resolve()==Path(args.output).resolve():raise RuntimeError('Refusing to overwrite input model')
    if Path(args.output).exists():raise FileExistsError('Choose a new output path; this script does not overwrite existing models.')
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.report).parent.mkdir(parents=True,exist_ok=True)
    build(args)
