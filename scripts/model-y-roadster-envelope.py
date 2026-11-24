#!/usr/bin/env python3
"""Read-only regression of the existing Roadster's actual suspension envelope.

Shared lossless GLB reader/SAT implementation from Model Y diagnostics. Does
not alter Roadster geometry/configuration or substitute a visual clip test.
"""
from pathlib import Path
import hashlib,importlib.util,json,math,subprocess,time
import numpy as np
from rtree import index
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('verify',Path(__file__).with_name('model-y-verify.py'));V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
spec=importlib.util.spec_from_file_location('probe',Path(__file__).with_name('model-y-clearance-probe.py'));P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P)

def main():
    start=time.time();path=ROOT/'public/models/roadster-drive-ready.glb';raw,doc,buf=V.U.read_glb(path);config_path=ROOT/'src/vehicle/VehicleConfig.js';config_raw=config_path.read_bytes()
    cfg=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {config} from './src/vehicle/VehicleConfig.js';console.log(JSON.stringify(config));"],cwd=ROOT))
    assert cfg['travel']==.015 and cfg['droop']==.04 and abs(cfg['maxInnerSteer']-math.radians(35))<1e-12,'Roadster config changed; inspect before extending this audit'
    records=V.U.decode_geometry(doc,buf);bodies=[r for r in records if r['sourceNodeName']=='Body'];triangles=np.concatenate([r['attrs']['POSITION'][r['faces']] for r in bodies]);body_primitives=np.concatenate([[r['primitiveId']]*len(r['faces']) for r in bodies]);labels=np.concatenate([[r['material']]*len(r['faces']) for r in bodies])
    prop=index.Property();prop.dimension=3;bounds=np.column_stack([triangles.min(1),triangles.max(1)]);tree=index.Index(((i,tuple(bb),None) for i,bb in enumerate(bounds)),properties=prop)
    output=ROOT/'reports/roadster-suspension-envelope.json';result=dict(complete=False,modelSha256=hashlib.sha256(raw).hexdigest(),configSha256=hashlib.sha256(config_raw).hexdigest(),
        scope='Read-only current packaged Roadster GLB vs actual VehicleConfig.js. All rolling assembly triangles, all stationary Body primitives, maximum independently swept wheel steering. No hidden/deleted surfaces and no physics/config changes.',
        clearanceMethod='rtree AABB broad phase then original triangle surface SAT with coplanar edge axes; 1e-9m epsilon. This is sampled geometry, not proof between samples, volume containment, deforming tire behavior, driving trajectory or native rendering.',
        appearanceClassification='The Roadster body uses an atlas and shared material, without authored paint/liner selection sets. Any detected crossings are localized but cannot be definitively called interior vs exterior without manual semantic review. Zero whole-Body crossings would prove zero sampled outer-surface crossings too.',
        settings=dict(suspensionMeters=[-cfg['droop'],0,cfg['travel']],frontSteeringDegrees=[0,-35,35],rollingDegrees=list(range(0,360,45))),
        bodyTriangles=len(triangles),samples=[])
    for wheel in cfg['wheels']:
        id=wheel['id'];center=np.array(wheel['center']);rolling=[r for r in records if r['sourceNodeName']=='Wheel_'+id];faces=np.concatenate([r['faces'] for r in rolling]);local=rolling[0]['attrs']['POSITION']-center
        assert len(rolling)==1
        for steer in result['settings']['frontSteeringDegrees'] if id[0]=='F' else [0]:
            t=math.radians(steer);c,s=math.cos(t),math.sin(t);ry=np.array([[c,0,s],[0,1,0],[-s,0,c]])
            for travel in result['settings']['suspensionMeters']:
                for roll in result['settings']['rollingDegrees']:
                    t=math.radians(roll);c,s=math.cos(t),math.sin(t);rx=np.array([[1,0,0],[0,c,-s],[0,s,c]]);q=np.einsum('ij,kj->ik',local,ry@rx)+center+[0,travel,0]
                    hits={};points=[];pairs=0
                    for a in q[faces]:
                        idx=np.fromiter(tree.intersection(tuple(np.r_[a.min(0)-1e-8,a.max(0)+1e-8])),dtype=np.int64)
                        if not len(idx):continue
                        hit=idx[V.triangle_pairs_intersect(a,triangles[idx])];pairs+=len(hit)
                        for j in hit:
                            label=f'Body primitive {body_primitives[j]} material {labels[j]}';hits[label]=hits.get(label,0)+1;points.extend(P.intersection_points(a,triangles[j]))
                    row=dict(wheel=id,steeringDegrees=steer,suspensionMeters=travel,rollingDegrees=roll,rollingTriangles=len(faces),intersectingTrianglePairs=pairs,bodyParts=hits)
                    if points:
                        p=np.array(points);row['intersectionPointsBounds']=dict(min=p.min(0).tolist(),max=p.max(0).tolist(),count=len(p))
                    result['samples'].append(row);output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(row),flush=True)
    baseline=[r for r in result['samples'] if r['steeringDegrees']==0 and r['suspensionMeters']==0];other=[r for r in result['samples'] if r not in baseline]
    result.update(complete=True,modelUnchanged=path.read_bytes()==raw,configUnchanged=config_path.read_bytes()==config_raw,seconds=round(time.time()-start,3),
        baselineStaticIntersections=sum(r['intersectingTrianglePairs'] for r in baseline),nonbaselineSampleIntersections=sum(r['intersectingTrianglePairs'] for r in other),
        totalSampleCount=len(result['samples']),passAllSampledBodyClearance=all(r['intersectingTrianglePairs']==0 for r in result['samples']))
    output.write_text(json.dumps(result,indent=2)+'\n')
    report=f'''# Roadster 当前悬挂包络核验\n\n本次仅只读检查现有模型和车辆配置。GLB SHA256：`{result['modelSha256']}`；配置 SHA256：`{result['configSha256']}`。\n\n按当前压缩 +15 mm、回弹 −40 mm，前轮 0/±35°、四轮滚动 0…315° 每 45° 检查，共 {len(result['samples'])} 个姿态。采用完整原车轮组件三角面与全部 {len(triangles):,} 个静态车身三角面进行精确表面 SAT 检查；未修改模型、配置、材质、UV 或既有物理。\n\n静止不转向基线相交对数：{result['baselineStaticIntersections']}；其他姿态相交对数：{result['nonbaselineSampleIntersections']}；全部采样车身间隙通过：{result['passAllSampledBodyClearance']}。详见 JSON 的逐姿态结果及交点范围。\n\n车身使用共享图集材质，没有可信的外漆/内衬独立集合；若有相交，不能仅按材质自动判定是否可见，需要人工复核。若全部车身均为零相交，则采样外漆/外眉也均为零。此结果仅证明所列离散姿态的三角面表面未相交，不证明连续角度、体积包含、轮胎形变或真实驾驶中的动态碰撞，也不能替代轨迹回归和原生 App 测试。\n\n原 GLB 保持不变：{result['modelUnchanged']}；原车辆配置保持不变：{result['configUnchanged']}。\n'''
    (ROOT/'reports/roadster-suspension-envelope.md').write_text(report);print('WROTE',output,flush=True)

if __name__=='__main__':main()
