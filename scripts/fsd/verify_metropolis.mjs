import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import R from '@dimforge/rapier3d-compat';
import {RoadNetwork,at,distance} from '../../src/fsd/RoadNetwork.js';
import {CityScene} from '../../src/fsd/CityScene.js';
import {createWorld} from '../../src/physics/PhysicsWorld.js';

const network=new RoadNetwork(),{world}=await createWorld();
const track=[];
world.forEachCollider(c=>{if(!c.parent()&&c.isEnabled())track.push(c);});
const city=new CityScene(new THREE.Scene(),world,network);
assert.ok(track.length&&track.every(c=>!c.isEnabled()));
city.root.updateMatrixWorld(true);world.step();
const asphalt=city.staticMeshes.filter(m=>m.material===city.materials.road);
const ray=new THREE.Raycaster();ray.far=.3;
const down=new THREE.Vector3(0,-1,0),origin=new THREE.Vector3();
const missing=[],raised=[];let checked=0;
for(const lane of network.lanes.values()){
 const n=Math.max(1,Math.ceil(lane.length/(lane.connector?4:22)));
 for(let i=0;i<=n;i++)for(const side of [-.82,0,.82]){
  const p=at(lane,lane.length*(.001+.998*i/n));
  const x=p.x+side*Math.cos(p.yaw),z=p.z-side*Math.sin(p.yaw);
  const coll=world.castRay(new R.Ray({x,y:.40,z},{x:0,y:-1,z:0}),.65,true);
  if(!coll||Math.abs(coll.timeOfImpact-.40)>.035)raised.push({id:lane.id,s:i/n,side,top:coll?.timeOfImpact});
  ray.set(origin.set(x,.15,z),down);
  const local=asphalt.filter(m=>{const b=m.geometry.boundingBox;return x>=b.min.x-.001&&x<=b.max.x+.001&&z>=b.min.z-.001&&z<=b.max.z+.001;});
  if(!ray.intersectObjects(local,false).length)missing.push({id:lane.id,s:i/n,side,x,z});
  checked++;
 }
}
city.dispose();
assert.ok(track.every(c=>c.isEnabled()));
const xs=network.nodes.map(p=>p.x),zs=network.nodes.map(p=>p.z);
const result={roadKm:network.links.reduce((s,l)=>s+distance(l.a,l.b),0)/1000,widthM:Math.max(...xs)-Math.min(...xs),heightM:Math.max(...zs)-Math.min(...zs),nodes:network.nodes.length,roadSegments:network.links.length,directedLanes:network.roads.length,checkedWheelAndCentreSamples:checked,missingVisualRoad:missing.length,incorrectSupport:raised.length,trackCollidersRestored:track.length,missingExamples:missing.slice(0,24),supportExamples:raised.slice(0,24)};
await fs.writeFile('reports/metropolis/surfaces.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));world.free();assert.equal(missing.length,0);assert.equal(raised.length,0);
