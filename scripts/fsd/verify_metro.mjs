import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import R from '@dimforge/rapier3d-compat';
import {RoadNetwork,at,distance} from '../../src/fsd/RoadNetwork.js';
import {TrafficSystem,overlaps} from '../../src/fsd/TrafficSystem.js';
import {CityScene} from '../../src/fsd/CityScene.js';
import * as THREE from 'three';
await R.init();
const network=new RoadNetwork(),world=new R.World({x:0,y:-9.81,z:0});
const traffic=new TrafficSystem(network,world,3),city=new CityScene(new THREE.Scene(),world,network);
const incoming=network.lanes.get('0:-120>0:0/0');
const route=network.route(incoming.id,'0:0>0:120/0');
const [head,follower,cross]=traffic.actors;
const crossRoad=network.lanes.get('-120:0>0:0/1');
function place(a,lane,s,goal){
  Object.assign(a,{lane,s,route:network.route(lane.id,goal),destination:goal,routeIndex:0,
    speed:0,desiredSpeed:10,laneChange:null,...at(lane,s)});
}
place(head,incoming,incoming.length-4,'0:0>0:120/0');
place(follower,incoming,incoming.length-11,'0:0>0:120/0');
place(cross,crossRoad,crossRoad.length-4,'0:0>120:0/1');
traffic.time=0;
while(network.light(incoming,traffic.time)!==0)traffic.time+=.2;
const junction=incoming.to.id;
traffic.reservations.set(junction,follower.id);
traffic.decide(null);
assert.equal(traffic.reservations.get(junction),head.id,'blocked follower must give up reservation');
let collisions=0;
const cleared=new Map();
for(let i=0;i<120*80;i++){
 traffic.step(1/120,null);world.step();
 for(const a of traffic.actors){
   const initial=a===cross?crossRoad:incoming;
   if(!a.lane.connector&&a.lane!==initial&&!cleared.has(a.id))cleared.set(a.id,i/120);
 }
 for(const [a,b] of [[head,follower],[head,cross],[cross,follower]])if(overlaps(a,b,-.05))collisions++;
}
assert.equal(collisions,0);assert.equal(cleared.size,3);
const tunnel=network.lanes.get('580:560>580:1030/1'),centre=at(tunnel,tunnel.length*.5);
const roof=world.castRay(new R.Ray({x:centre.x,y:3,z:centre.z},{x:0,y:1,z:0}),10,true);
assert.ok(roof&&roof.timeOfImpact>3&&roof.timeOfImpact<5);
const length=network.links.reduce((sum,l)=>sum+distance(l.a,l.b),0);
const result={roadKilometres:length/1000,spanX:Math.max(...network.nodes.map(n=>n.x))-Math.min(...network.nodes.map(n=>n.x)),
 spanZ:Math.max(...network.nodes.map(n=>n.z))-Math.min(...network.nodes.map(n=>n.z)),junctions:network.nodes.length,
 lanes:network.roads.length,connectors:network.lanes.size-network.roads.length,trafficClearedSeconds:Object.fromEntries(cleared),
 overlapPhysicsSteps:collisions,tunnelRoofHeight:3+roof.timeOfImpact,route};
await fs.writeFile('reports/metro/verification.json',JSON.stringify(result,null,2));console.log(result);
traffic.dispose();city.dispose();world.free();
