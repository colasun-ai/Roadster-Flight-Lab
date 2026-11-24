// Shared geometry definitions: visual ramps and colliders use the same vertices.
export const ramps=[
 {id:'suspension-hill',x:-35,z:35,w:12,profile:[[-15,0],[-5,.6],[5,.6],[15,0]]},
 {id:'training-jump',x:0,z:105,w:12,profile:[[-12,0],[-10,.015],[-8,.075],[-6,.20],[-4,.40],[-2,.73],[0,1.2],[.3,1.2]]},
 {id:'stunt-jump',x:-250,z:250,w:20,profile:Array.from({length:31},(_,i)=>{const t=i/30;return[-45+45*t,5*t*t];})}
];
export function solidRamp(r){
 const vertices=[],top=[],shell=[],base=-.12;
 for(const [dz,h] of r.profile)vertices.push(r.x-r.w/2,h,r.z+dz,r.x+r.w/2,h,r.z+dz,r.x-r.w/2,base,r.z+dz,r.x+r.w/2,base,r.z+dz);
 for(let i=0;i<r.profile.length-1;i++){
  const a=i*4,b=a+4;top.push(a,b,a+1,a+1,b,b+1);
  shell.push(a+2,a+3,b+2,a+3,b+3,b+2,a,a+2,b,a+2,b+2,b,a+1,b+1,a+3,a+3,b+1,b+3);
 }
 const end=(r.profile.length-1)*4;shell.push(0,1,2,1,3,2,end,end+2,end+1,end+1,end+2,end+3);
 return{kind:'ramp',id:r.id,vertices,indices:[...top,...shell],topIndexCount:top.length,profile:r.profile,x:r.x,z:r.z,w:r.w};
}
const controls=[[-110,-230],[-110,280],[-65,670],[80,760],[270,670],[330,450],[330,60],[260,-220],[80,-300]];
export function circuitSamples(count=480){
 const out=[];for(let j=0;j<=count;j++){
  const t=(j%count)/count*controls.length,k=Math.floor(t),f=t-k,n=controls.length;
  const p=[-1,0,1,2].map(i=>controls[(k+i+n)%n]);
  const value=d=>.5*((2*p[1][d])+(-p[0][d]+p[2][d])*f+(2*p[0][d]-5*p[1][d]+4*p[2][d]-p[3][d])*f*f+(-p[0][d]+3*p[1][d]-3*p[2][d]+p[3][d])*f*f*f);
  out.push({x:value(0),z:value(1)});
 }return out;
}
// Low, bevelled rumble strips. The same closed hull is used for drawing and
// collision; no vertical 7 cm wall across a moving tire's contact patch.
export function curbGeometry(x,z,yaw,halfLength,color){
 const vertices=[],cross=[[-.45,-.02],[-.45,0],[-.18,.035],[.18,.035],[.45,0],[.45,-.02]],n=cross.length;
 for(const dz of [-halfLength,halfLength])for(const [dx,y]of cross)vertices.push(x+Math.cos(yaw)*dx+Math.sin(yaw)*dz,y,z-Math.sin(yaw)*dx+Math.cos(yaw)*dz);
 const indices=[];
 for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,i+n,j,j+n,i+n);}
 for(let i=1;i<n-1;i++)indices.push(0,i+1,i,n,n+i,n+i+1);
 for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 return{kind:'curb',role:'curb',vertices,indices,color,x,z,yaw,halfLength};
}
export function terrainHeight(x,z){
 const dx=Math.max(0,Math.abs(x-20)-520),dz=Math.max(0,Math.abs(z-700)-1450),d=Math.hypot(dx,dz),t=Math.min(1,d/500),blend=t*t*(3-2*t);
 return blend*(24+20*Math.sin(x*.0028+z*.0015)**2+35*Math.sin(z*.0038-x*.0018)**2+18*Math.sin(x*.006)**2);
}
export function terrainGeometry(){
 const vertices=[],indices=[],nx=110,nz=150;
 for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const x=-2200+i*40,z=-1500+j*40;vertices.push(x,terrainHeight(x,z)-.018,z);}
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+nx+1;indices.push(a,b,a+1,a+1,b,b+1);}
 // The foundation already collides at y=0. Do not put a second, nearly
 // coplanar collision sheet underneath it: CCD can catch internal edges at
 // high speed. Only the genuinely raised landscape needs terrain collision.
 const collisionIndices=[];for(let i=0;i<indices.length;i+=3){const tri=indices.slice(i,i+3);if(tri.some(n=>vertices[n*3+1]>.01))collisionIndices.push(...tri);}
 return{kind:'terrain',vertices,indices,collisionIndices};
}
export function facilityBoxes(){
 const out=[],box=(x,y,z,w,h,l,color)=>out.push({x,y,z,w,h,l,color});
 for(let i=0;i<8;i++){const z=-100+i*18;box(-46,2.6,z,15,5.2,16,0xb9b8a8);box(-46,5.35,z,17,.3,17.5,0x3a4547);box(-54,1.7,z,.12,3.3,13,0x3a494d);box(-54.1,3.8,z,.15,.24,13,0x9eb9b9);}
 box(-45,7.3,-90,12,3.5,24,0x4b666b);box(-45,9.2,-90,13,.25,25,0xe0dccc);
 for(let z=-100;z<40;z+=20){box(-83,2.5,z,.2,5,.2,0x697478);box(-61,2.5,z,.2,5,.2,0x697478);}box(-72,5.1,-30,26,.25,160,0xdad7c5);
 for(const x of [-325,-360]){box(x,5,-110,25,10,50,0x929e9d);box(x,10.1,-110,27,.3,52,0x3b4a4d);}
 return out;
}
