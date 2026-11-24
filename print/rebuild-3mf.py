"""Create a genuine closed, single-piece static 1:24 3MF; never changes the GLB."""
from pathlib import Path
import sys, struct, json, hashlib, zipfile, io
import numpy as np
import manifold3d as M

source=Path(sys.argv[1]);dest=Path(sys.argv[2]);raw=source.read_bytes()
if source.resolve()==dest.resolve() or dest.exists() or dest.with_suffix('.json').exists():
    raise FileExistsError('Choose a new output path; source and existing files are never overwritten.')
jn=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jn]);binary=raw[28+jn:]
def acc(i):
    a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
    dt={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']];w={'SCALAR':1,'VEC3':3,'VEC2':2}[a['type']]
    return np.ndarray((a['count'],w),dtype=dt,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',np.dtype(dt).itemsize*w),np.dtype(dt).itemsize)).copy()
solids=[];input_stats={}
def walk(i,parent):
    n=doc['nodes'][i];t=parent+np.array(n.get('translation',[0,0,0]))
    assert 'rotation' not in n or n['rotation']==[0,0,0,1]
    assert 'scale' not in n or n['scale']==[1,1,1]
    if 'mesh' in n:
        mesh=doc['meshes'][n['mesh']];ps=[];fs=[];offset=0
        for p in mesh['primitives']:
            xyz=acc(p['attributes']['POSITION'])
            ps.append(xyz);fs.append(acc(p['indices']).reshape(-1,3)+offset);offset+=len(xyz)
        p=np.concatenate(ps)+t;f=np.concatenate(fs)
        p,inv=np.unique(p.astype(np.float32),axis=0,return_inverse=True);f=inv[f]
        s=M.Manifold(M.Mesh(np.ascontiguousarray(p),np.ascontiguousarray(f,dtype=np.uint32)))
        assert s.status()==M.Error.NoError,(n['name'],s.status())
        solids.append(s);input_stats[n['name']]={'triangles':len(f),'closed':True}
    for child in n.get('children',[]):walk(child,t)
for i in doc['scenes'][0]['nodes']:walk(i,np.zeros(3))
print('Loaded five original closed solids',flush=True)
# 1.8 mm radius at 1:24 = 43.2 mm full scale, concealed in the wheel hubs/chassis.
# Cylinders are axles ONLY; all original tire/rim geometry is retained.
for z,y in [(1.2788189546410051,.33804292334653646),(-1.527328160898259,.3543520360377672)]:
    axle=M.Manifold.cylinder(1.75,.0432,.0432,48,True).rotate([0,90,0]).translate([0,y,z])
    solids.append(axle)
solid=M.Manifold.batch_boolean(solids,M.OpType.Add)
assert solid.status()==M.Error.NoError,solid.status()
parts=solid.decompose();print('Connected solids after axle union',len(parts),flush=True)
assert len(parts)==1,'Axles must actually join all five original solids'
mesh=solid.to_mesh();p=np.asarray(mesh.vert_properties)[:,:3].astype(np.float64)
f=np.asarray(mesh.tri_verts)
# Proper rotation Y-up -> print Z-up, length along X, in millimetres.
p=p[:,[2,0,1]]*(1000/24);p-=np.array([p[:,0].min(),p[:,1].min(),p[:,2].min()])
u,inv=np.unique(p,axis=0,return_inverse=True);f=inv[f];p=u
edges=np.sort(np.concatenate([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]]),axis=1)
_,counts=np.unique(edges,axis=0,return_counts=True)
areas=np.linalg.norm(np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]),axis=1)/2
assert np.all(counts==2) and np.all(areas>1e-10)
print('Writing 3MF',len(p),'vertices',len(f),'triangles',flush=True)
buf=io.StringIO();buf.write('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Roadster static display 1:24</metadata><metadata name="Description">Original model retained; hidden front and rear axles boolean-unite the wheels. Engineering length 191.667mm; non-functional static wheels; supports required. No printer settings or G-code.</metadata><resources><object id="1" type="model" name="Roadster 1-24 static"><mesh><vertices>')
for x,y,z in p:buf.write(f'<vertex x="{x:.7f}" y="{y:.7f}" z="{z:.7f}"/>')
buf.write('</vertices><triangles>')
for a,b,c in f:buf.write(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>')
buf.write('</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
dest.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    z.writestr('3D/3dmodel.model',buf.getvalue())
result={'file':dest.name,'sourceSha256':hashlib.sha256(raw).hexdigest(),'scale':'1:24 using temporary 4.600m vehicle length (not official)','dimensionsMillimeters':np.ptp(p,axis=0).tolist(),'vertices':len(p),'triangles':len(f),'connectedComponents':len(parts),'boundaryEdges':int(sum(counts==1)),'nonManifoldEdges':int(sum(counts!=2)),'degenerateTriangles':int(sum(areas<=1e-10)),'volumeCubicMillimeters':solid.volume()*(1000/24)**3,'axleRadiusMillimeters':1.8,'wheelFunction':'static; original wheels joined to body by concealed axles','texture':'monochrome geometric print; emissive PNG is not a printable material','supportsRequired':True,'thinFeaturesNotThickened':True,'zipCRCValid':zipfile.ZipFile(dest).testzip() is None,'inputMeshes':input_stats}
dest.with_suffix('.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2),flush=True)
