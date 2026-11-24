"""Lossless GLB reading and position-connected component diagnostics for Model Y."""
from pathlib import Path
import json, struct
import numpy as np

DTYPES={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'}
WIDTHS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}
def read_glb(path):
    raw=Path(path).read_bytes()
    magic,version,length=struct.unpack_from('<4sII',raw)
    assert magic==b'glTF' and version==2 and length==len(raw)
    offset=12;doc=None;binary=None
    while offset<len(raw):
        n,kind=struct.unpack_from('<II',raw,offset);offset+=8
        if kind==0x4e4f534a:doc=json.loads(raw[offset:offset+n])
        elif kind==0x004e4942:binary=raw[offset:offset+n]
        offset+=n
    assert doc is not None and binary is not None
    return raw,doc,binary

def accessor(doc,binary,index):
    a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']]
    assert not a.get('sparse'), 'Sparse accessors need explicit decoding'
    dt=np.dtype(DTYPES[a['componentType']]);width=WIDTHS[a['type']]
    return np.ndarray((a['count'],width),dtype=dt,buffer=binary,
        offset=view.get('byteOffset',0)+a.get('byteOffset',0),
        strides=(view.get('byteStride',width*dt.itemsize),dt.itemsize)).copy()

def node_matrices(doc):
    parents={c:i for i,node in enumerate(doc['nodes']) for c in node.get('children',[])}
    matrices={}
    def matrix(i):
        if i not in matrices:
            n=doc['nodes'][i]
            if 'matrix' in n:m=np.asarray(n['matrix'],dtype=float).reshape(4,4).T
            else:
                x,y,z,w=n.get('rotation',[0,0,0,1]);s=np.asarray(n.get('scale',[1,1,1]))
                r=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                    [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                    [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
                m=np.eye(4);m[:3,:3]=r*s;m[:3,3]=n.get('translation',[0,0,0])
            matrices[i]=matrix(parents[i])@m if i in parents else m
        return matrices[i]
    for i in range(len(doc['nodes'])):matrix(i)
    return matrices

def decode_geometry(doc,binary):
    matrices=node_matrices(doc);records=[]
    for node_id,node in enumerate(doc['nodes']):
        if 'mesh' not in node:continue
        for primitive_id,p in enumerate(doc['meshes'][node['mesh']]['primitives']):
            assert p.get('mode',4)==4,'Only source triangles are accepted'
            attrs={key:accessor(doc,binary,i) for key,i in p['attributes'].items()}
            m=matrices[node_id]
            attrs['POSITION']=np.einsum('ij,kj->ki',m[:3,:3],attrs['POSITION'])+m[:3,3]
            if 'NORMAL' in attrs:
                attrs['NORMAL']=np.einsum('ij,kj->ki',np.linalg.inv(m[:3,:3]).T,attrs['NORMAL'])
                attrs['NORMAL']/=np.linalg.norm(attrs['NORMAL'],axis=1)[:,None]
            if 'TANGENT' in attrs:
                attrs['TANGENT'][:,:3]=np.einsum('ij,kj->ki',m[:3,:3],attrs['TANGENT'][:,:3])
                attrs['TANGENT'][:,:3]/=np.linalg.norm(attrs['TANGENT'][:,:3],axis=1)[:,None]
            faces=accessor(doc,binary,p['indices']).reshape(-1,3)
            if np.linalg.det(m[:3,:3])<0:faces=faces[:,[0,2,1]]
            records.append(dict(nodeId=node_id,meshId=node['mesh'],primitiveId=primitive_id,attrs=attrs,faces=faces,material=p.get('material'),sourceNodeName=node.get('name')))
    return records

def components(record,tolerance=1e-7):
    # Welding is diagnostic only: faces/vertices/UVs of the output stay original.
    pos=record['attrs']['POSITION'];faces=record['faces']
    quantized=np.rint(pos/tolerance).astype(np.int64)
    _,inv=np.unique(quantized,axis=0,return_inverse=True);wf=inv[faces]
    parents=np.arange(inv.max()+1,dtype=np.int64)
    def find(a):
        while parents[a]!=a:
            parents[a]=parents[parents[a]];a=parents[a]
        return a
    for a,b,c in wf:
        ra,rb,rc=find(a),find(b),find(c)
        if ra!=rb:parents[rb]=ra
        if ra!=rc:parents[rc]=ra
    labels=np.array([find(v) for v in wf[:,0]],dtype=np.int64)
    unique,count=np.unique(labels,return_counts=True)
    parts=[]
    for k in np.argsort(-count):
        selected=np.flatnonzero(labels==unique[k]);ids=np.unique(faces[selected]);q=pos[ids]
        parts.append(dict(faceIds=selected,vertexIds=ids,triangles=len(selected),vertices=len(ids),min=q.min(0),max=q.max(0)))
    return parts
