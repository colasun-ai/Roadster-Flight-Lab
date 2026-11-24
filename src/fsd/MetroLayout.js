// Coordinates in metres, relative to the original city centre. Each corridor
// contributes both the rendered road and the directed driving lanes.
export function metroLayout() {
  const nodes = new Map();
  const links = [];
  function station(x, z, kind = 'junction') {
    const id = [x, z].join(':');
    if (!nodes.has(id)) nodes.set(id, {id, x: x+1000, z: z+600, kind, neighbors: []});
    if (kind !== 'junction') nodes.get(id).kind = kind;
    return nodes.get(id);
  }
  function corridor(a, b, kind = 'street', options = {}) {
    a.neighbors.push(b); b.neighbors.push(a);
    links.push({a, b, kind, ...options});
  }
  for (const x of [-120, 0, 120]) for (const z of [-120, 0, 120]) {
    if (x < 120) corridor(station(x,z), station(x+120,z));
    if (z < 120) corridor(station(x,z), station(x,z+120));
  }
  const west = station(-200,300), market = station(0,300), east = station(320,300);
  // Separate the diagonal ramp mouth from the wide boulevard median.
  east.trim=48;
  const depot = station(550,300,'turnaround');
  corridor(station(-120,120), west);
  corridor(station(0,120), market);
  corridor(station(120,120), east);
  corridor(west,market,'service'); corridor(market,east,'service');
  corridor(east,depot,'boulevard',{median:7.5});
  // Tangential entrance and exit on the same carriageway. The return
  // carriageway reaches the city through the second interchange to the north.
  const westGate=station(-280,390,'merge'), eastGate=station(430,390,'merge');
  const foothill=station(-380,520,'bend'), ridge=station(-380,1050,'bend');
  const north=station(-200,1200,'bend'), lake=station(390,1200,'bend');
  const tunnelNorth=station(580,1030,'bend'), tunnelSouth=station(580,560,'bend');
  corridor(westGate,eastGate,'highway');
  corridor(eastGate,tunnelSouth,'highway'); corridor(tunnelSouth,tunnelNorth,'tunnel');
  corridor(tunnelNorth,lake,'highway'); corridor(lake,north,'highway');
  corridor(north,ridge,'highway'); corridor(ridge,foothill,'highway'); corridor(foothill,westGate,'highway');
  corridor(west,westGate,'ramp'); corridor(east,eastGate,'ramp');
  // Avenues, cross streets and a diagonal through the longer city blocks.
  // The district is original geometry inspired by the NYC Midtown street plan.
  const xs=[800,1250,1700,2150,2600,3050,3500], zs=[-660,-360,-60,240,540,840,1140,1440];
  for(let i=0;i<xs.length;i++)for(let j=0;j<zs.length;j++){
    const n=station(xs[i],zs[j]);
    if(i+1<xs.length)corridor(n,station(xs[i+1],zs[j]),j===3?'boulevard':'street');
    if(j+1<zs.length)corridor(n,station(xs[i],zs[j+1]),i%3===0?'boulevard':'street');
  }
  for(let i=0;i<6;i++){
    const a=station(xs[i],zs[i+1]),b=station(xs[i+1],zs[i+2]);a.trim=32;b.trim=32;
    corridor(a,b,'boulevard');
  }
  station(800,-660).trim=34;
  corridor(station(120,-120),station(800,-660),'service');
  corridor(tunnelSouth,station(800,540),'service');
  const northEntry=station(800,2250,'bend'),northPier=station(2150,2650,'merge');
  const port=station(3900,2500,'bend'),quay=station(4400,1500,'merge');
  const southQuay=station(4400,-780,'bend'),southGate=station(2600,-1200,'merge');
  const docks=station(800,-1120,'bend');
  corridor(lake,northEntry,'ramp');corridor(northEntry,northPier,'highway');
  corridor(northPier,port,'highway');corridor(port,quay,'highway');
  corridor(quay,southQuay,'highway');corridor(southQuay,southGate,'highway');
  corridor(southGate,docks,'highway');corridor(docks,station(800,-660),'ramp');
  corridor(station(2150,1440),northPier,'ramp');corridor(station(3500,1140),quay,'ramp');
  corridor(station(2600,-660),southGate,'ramp');
  return {nodes:[...nodes.values()],links};
}
export const roadSpeed = {street:50,service:50,ramp:50,boulevard:60,highway:100,tunnel:80};
