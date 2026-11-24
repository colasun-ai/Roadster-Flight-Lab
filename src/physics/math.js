export const v=(x=0,y=0,z=0)=>({x,y,z});
export const add=(a,b)=>v(a.x+b.x,a.y+b.y,a.z+b.z);
export const sub=(a,b)=>v(a.x-b.x,a.y-b.y,a.z-b.z);
export const mul=(a,s)=>v(a.x*s,a.y*s,a.z*s);
export const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
export const cross=(a,b)=>v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
export const length=a=>Math.hypot(a.x,a.y,a.z);
export const norm=a=>mul(a,1/Math.max(length(a),1e-12));
export const clamp=(a,l,h)=>Math.max(l,Math.min(h,a));
export function rotate(a,q){const b=cross(v(q.x,q.y,q.z),a),c=cross(v(q.x,q.y,q.z),b);return add(a,add(mul(b,2*q.w),mul(c,2)));}
