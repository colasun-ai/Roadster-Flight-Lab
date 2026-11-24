// The divider oracle uses the map nodes and footprint corners, independently
// of the trajectory guard. Legal crossings within junctions are excluded.
export function medianOverlap(ego,links){
 let worst=0;
 for(const link of links){
  const {a,b}=link,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length;
  const sine=Math.sin(ego.yaw),cosine=Math.cos(ego.yaw),alignment=sine*ux+cosine*uz;
  if(Math.abs(alignment)<.6)continue;
  const trim=node=>node.trim??(['merge','bend'].includes(node.kind)?36:14);
  for(const along of [ego.rearAxle-ego.length/2,ego.rearAxle+ego.length/2])for(const side of [-ego.width/2,ego.width/2]){
   const x=ego.x+along*sine+side*cosine-a.x,z=ego.z+along*cosine-side*sine-a.z;
   const s=x*ux+z*uz,cross=(x*uz-z*ux)*Math.sign(alignment)-(link.median??0);
   if(s>trim(a)&&s<length-trim(b)&&cross>0&&cross<7.2)worst=Math.max(worst,cross);
  }
 }
 return worst;
}
