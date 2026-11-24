// Plan-R1 selects features by vertex proximity and expects stable polygon order.
const cellSize=75;
export class MapFeatureIndex{
 constructor(features){
  this.features=features;
  this.cells=new Map();
  for(let i=0;i<features.length;i++){
   const keys=new Set(features[i].points.map(([x,z])=>Math.floor(x/cellSize)+','+Math.floor(z/cellSize)));
   for(const key of keys){
    if(!this.cells.has(key))this.cells.set(key,[]);
    this.cells.get(key).push(i);
   }
  }
 }
 nearby(ego,limit){
  if(limit<=0)return [];
  const x=Math.floor(ego.x/cellSize),z=Math.floor(ego.z/cellSize),ids=new Set();
  for(let i=x-1;i<=x+1;i++)for(let j=z-1;j<=z+1;j++){
   for(const id of this.cells.get(i+','+j)??[])ids.add(id);
  }
  const result=[];
  for(const id of [...ids].sort((a,b)=>a-b)){
   const f=this.features[id];
   if(f.points.some(([px,pz])=>(px-ego.x)**2+(pz-ego.z)**2<cellSize**2)){
    result.push(f);
    if(result.length===limit)break;
   }
  }
  return result;
 }
}
