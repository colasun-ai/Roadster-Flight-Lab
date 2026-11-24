import assert from 'node:assert/strict';
import {RoadNetwork,at} from '../../src/fsd/RoadNetwork.js';
import {maneuverGuidance} from '../../src/fsd/ManeuverGuidance.js';

const net=new RoadNetwork(),lane=net.lanes.get('800:840>1250:840/1');
const output=[];
function caseAt(name,{s=40,style=true,signal=0,rearGap=null,leadSpeed=35/3.6},shouldChange){
 let time=60;
 while(net.light(lane,time)!==signal&&time<300)time++;
 assert.equal(net.light(lane,time),signal);
 const pilot={network:net,route:[lane.id],destination:lane.id,routeFrom:({lane:l})=>net.route(l.id,lane.id),avoid:new Set(),time,assertive:style,lastChange:0};
 const ego={...at(lane,s),speed:35/3.6,length:4.8,width:1.94,rearAxle:1.45};
 const agents=[{...at(lane,s+17),id:'lead',speed:leadSpeed,length:4.7}];
 if(rearGap!==null)agents.push({...at(lane.adjacent,s-rearGap),id:'rear',speed:60/3.6,length:4.8});
 maneuverGuidance(pilot,{lane,s,...at(lane,s)},ego,agents);
 assert.equal(!!pilot.changePlan,shouldChange,name);
 output.push({name,change:!!pilot.changePlan,reason:pilot.followReason});
}
caseAt('35 km/h lead on clear 50 km/h street',{},true);
caseAt('Distant red does not suppress a clear upstream pass',{signal:2},true);
caseAt('Red approach with queue',{signal:2,s:lane.length-44,leadSpeed:0},false);
caseAt('Closing rear traffic in the passing lane',{rearGap:27},false);
caseAt('Lead already near cruising speed',{leadSpeed:46/3.6},false);
caseAt('Standard driving mode',{style:false},false);
console.log(JSON.stringify(output,null,2));
