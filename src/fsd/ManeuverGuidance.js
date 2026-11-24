import {laneShift} from './RibbonShape.js';
import {at,project,distance,wrap} from './RoadNetwork.js';

// The decoder ranks motion tokens against this route. The guided controller
// follows the same manoeuvre with the decoded forward progress and timing.
export function maneuverGuidance(pilot, near, ego, actors) {
  const net=pilot.network;
  pilot.followReason=null;
  let lane=near.lane;
  const active=pilot.changePlan;
  if(active && pilot.passLane && [active.from,active.to].includes(lane.id)){
    const dest=net.lanes.get(active.to),q=project(dest,ego);
    if(q.distance>.25 && q.s<active.start+active.span+9){
      lane=net.lanes.get(active.from);near={...project(lane,ego),lane};
    }else{pilot.changePlan=null;pilot.passLane=null;}
  }
  const inFront=actors.filter(a=>Math.abs(wrap(a.yaw-ego.yaw))<.7)
    .map(a=>({actor:a,q:project(lane,a)}))
    .filter(({q})=>q.distance<1.65&&q.s>near.s)
    .sort((a,b)=>a.q.s-b.q.s)[0];
  let route=pilot.route.slice(), target=lane, change=false;
  const adjacent=lane.adjacent;
  // Budget enough road to finish straightening even if the car accelerates
  // during the pass. Reuse the original span after crossing the lane divider.
  const changeSpan=Math.max(30,ego.speed*2.8);
  const continuing=active?.from===lane.id&&active.to===adjacent?.id;
  if(adjacent && !lane.connector && (continuing||lane.length-near.s>Math.max(35,changeSpan+3))){
    // Leave enough same-direction road to return before a required turn
    // or destination. Starting a pass near the stop used to route us around
    // the block as soon as the new lane no longer reached the destination.
    const finish=lane.id===pilot.destination&&pilot.pin?pilot.pin.s:lane.length;
    const leadGap=inFront?inFront.q.s-near.s:Infinity;
    const cruise=Math.min(22,lane.speedLimit*.94);
    const advantage=inFront?cruise-inFront.actor.speed:0;
    const signal=net.light(lane,pilot.time);
    const approach=(signal===1||signal===2)&&lane.length-near.s<Math.max(48,ego.speed*4+ego.speed**2/8);
    let holdingPass=false;
    if(pilot.overtake?.lane===lane.id){
      const lead=actors.find(a=>a.id===pilot.overtake.id);
      if(lead){
        const gap=near.s-project(lane,lead).s;
        holdingPass=gap<(ego.length+lead.length)/2+Math.max(6,lead.speed*.8)&&finish-near.s>changeSpan+12;
      }
      if(!holdingPass)pilot.overtake=null;
    }
    const routeChange=!holdingPass&&route[1]===adjacent.id;
    const opportunity=!holdingPass&&pilot.assertive&&inFront&&leadGap<Math.max(42,ego.speed*3)
      &&advantage>=Math.max(1.8,cruise*.12)&&pilot.time>pilot.lastChange+5;
    // A pass that needs a return before a turn or pin takes two merges plus
    // enough longitudinal progress to clear both vehicles.
    let roomToPass=false;
    if(opportunity){
      const onward=net.route(adjacent.id,pilot.destination,{allowStartLaneChange:false,avoid:pilot.avoid});
      const departure=ids=>ids.map(id=>net.lanes.get(id)).find(l=>!l.connector&&l.from===lane.to);
      const intended=departure(route),alternate=departure(onward);
      const canContinue=adjacent.id===pilot.destination||(intended&&alternate&&intended.to===alternate.to);
      const required=canContinue?changeSpan+12:Math.max(changeSpan*2,cruise*(leadGap+ego.length+3)/advantage)+changeSpan;
      roomToPass=finish-near.s>required;
    }
    if(!continuing&&inFront&&leadGap<48){
      pilot.followReason=approach?'跟车 · 前方信号灯':!pilot.assertive?'跟车 · 标准模式':
       advantage<Math.max(1.8,cruise*.12)?'跟车 · 前车接近巡航速度':
       !roomToPass?'跟车 · 等待超车路段':null;
    }
    const wantsChange=routeChange||continuing||(opportunity&&roomToPass&&!approach);
    if(wantsChange){
      const mergeTime=Math.min(4,changeSpan/Math.max(6,ego.speed));
      const safe=actors.every(a=>{
        const q=project(adjacent,a),gap=q.s-near.s;
        if(q.distance>2.05)return true;
        const closure=gap>=0?Math.max(0,ego.speed-a.speed):Math.max(0,a.speed-ego.speed);
        const buffer=gap>=0?Math.max(15,ego.speed*1.15):Math.max(13,a.speed*1.3);
        return Math.abs(gap)>buffer+closure*mergeTime;
      });
      if(!safe&&inFront)pilot.followReason='跟车 · 邻道间隙不足';
      if(safe && (continuing||pilot.time>pilot.lastChange+3)){
        target=adjacent;change=true;pilot.followReason=null;
        if(!continuing&&opportunity&&!routeChange)pilot.overtake={id:inFront.actor.id,lane:target.id};
        if(!pilot.changePlan||pilot.passLane!==target.id)pilot.changePlan={from:lane.id,to:target.id,start:near.s,span:changeSpan};
        pilot.passLane=target.id;pilot.lastChange=pilot.time;
        route=pilot.routeFrom({...project(target,ego),lane:target});
      }
    }
  }
  if(!change){pilot.passLane=null;pilot.changePlan=null;}
  if(!change&&route[1]===adjacent?.id&&adjacent)route=net.route(lane.id,pilot.destination,{allowStartLaneChange:false,avoid:pilot.avoid});
  let progress=project(target,ego).s, arc=0,prev=null;
  const corridor=[],stops=[];
  for(const id of route){
    const road=net.lanes.get(id);
    if(prev&&prev.adjacent===road)break;
    const first=prev?0:progress, length=road.length-first;
    const n=Math.max(1,Math.ceil(length/2));
    for(let i=prev?1:0;i<=n;i++){
      const d=length*i/n,s=first+d,p=at(road,s);
      let left=road.connector?1.8:1.8+3.6*road.index;
      let right=road.connector?1.8:7.2-left;
      if(change&&!prev){
        const {start,span}=pilot.changePlan,u=(near.s+d-start)/span,f=laneShift(u);
        const old=at(lane,near.s+d);
        const lateral=(p.x-old.x)*Math.cos(p.yaw)-(p.z-old.z)*Math.sin(p.yaw);
        left+=lateral*(1-f);right-=lateral*(1-f);
        p.x=old.x+(p.x-old.x)*f;p.z=old.z+(p.z-old.z)*f;
        p.yaw+=Math.atan(lateral*(laneShift(u+.001)-laneShift(u-.001))/(.002*span));
      }
      const turnLimit=road.connector&&Math.abs(road.turn)>.55
        ?Math.min(road.speedLimit,Math.sqrt(2.4*road.length/Math.abs(road.turn))):road.speedLimit;
      corridor.push({...p,s:arc+d,limit:turnLimit,left,right});
      if(arc+d>170)break;
    }
    arc+=length;
    if(!road.connector&&net.light(road,pilot.time)===2)stops.push(arc-ego.rearAxle-ego.length/2-1.4);
    if(road.id===pilot.destination&&id===route.at(-1)&&(!pilot.pin||arc-length+pilot.pin.s-first>=-3))stops.push(pilot.pin?arc-length+pilot.pin.s-first:arc-5);
    if(arc>170)break;
    prev=road;
  }
  if(!corridor.length)return null;
  let speed=ego.speed,s=0;
  const aim=[];
  for(let i=1;i<=16;i++){
    const sample=corridor.find(p=>p.s>=s)??corridor.at(-1);
    let cap=Math.min(22,sample.limit*.94);
    for(const p of corridor){if(p.s>=s)cap=Math.min(cap,Math.sqrt((p.limit*.94)**2+5*(p.s-s)));}
    for(const stop of stops)cap=Math.min(cap,Math.sqrt(6*Math.max(0,stop-s)));
    if(!change&&inFront){
      const lead=inFront.q.s-near.s+inFront.actor.speed*i*.5-s;
      cap=Math.min(cap,Math.max(0,inFront.actor.speed+(lead-ego.length-3-ego.speed*.75)*.65));
    }
    const next=Math.max(0,Math.min(speed+1.6,Math.max(speed-2.5,cap)));
    s+=(speed+next)*.25;speed=next;
    const k=corridor.findIndex(p=>p.s>=s),b=k<0?corridor.at(-1):corridor[k],a=k>0?corridor[k-1]:b;
    const f=Math.max(0,Math.min(1,(s-a.s)/Math.max(.001,b.s-a.s)));
    aim.push({x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,yaw:a.yaw+wrap(b.yaw-a.yaw)*f,speed});
  }
  pilot.maneuver=change?'变道':route.slice(0,3).some(id=>net.lanes.get(id).kind==='uturn')?'前方掉头':null;
  return {aim,route,corridor};
}
