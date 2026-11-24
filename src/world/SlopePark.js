// Local s points down a test lane (+Z). Lateral u is measured in metres (+X).
export const slopeGroups=[
 {name:'爬坡与坡起',color:'#357f7a'},
 {name:'纵向起伏',color:'#486aa1'},
 {name:'侧倾与交叉轴',color:'#92703b'},
 {name:'飞坡与落地',color:'#b95539'}
];
const clamp01=x=>Math.min(1,Math.max(0,x));
const ease=x=>{const t=clamp01(x);return t*t*(3-2*t);};
const wave=t=>Math.sin(Math.PI*t)**2;
const gate=(s,l,r,blend)=>ease((s-l)/blend)*ease((r-s)/blend);
const integral=(x,k)=>x<=0?0:x<k?x*x/(2*k):x-k/2;
function climb(grade,run,flat){
 const blend=5,ascent=s=>integral(s,blend)-integral(s-run,blend);
 return {length:2*(run+blend)+flat,height:s=>grade*(ascent(s)-ascent(s-run-blend-flat))};
}
function deck(length,height,step=1){return {length,height,step};}
function jump(run,rise,gap,landing,landingHeight){
 const parts=[[0,run],[run+gap,run+gap+landing]];
 const down=s=>{
  const t=(s-run-gap)/landing;
  return landingHeight*(t<.32?ease(t/.32):1-ease((t-.32)/.68));
 };
 return {...deck(parts[1][1],s=>s<=run?rise*(s/run)**2:s<run+gap?0:down(s),.5),parts};
}
const designs=[
 ['缓坡起步','8% 坡度 · 上坡定速',25,climb(.08,34,12)],
 ['中坡驻车','15% 坡度 · 半坡再起步',25,climb(.15,32,12)],
 ['长坡制动','25% 坡度 · 长下坡控速',30,climb(.25,42,8)],
 ['短陡坡','35% 坡度 · 坡顶接地',20,climb(.35,25,7)],
 ['极陡爬坡','45% 坡度 · 低速牵引',18,climb(.45,25,10)],
 ['长波起伏','三道长波 · 观察俯仰',40,deck(108,s=>1.65*wave(s/36))],
 ['短波连坡','六道短波 · 连续回弹',25,deck(72,s=>.48*wave(s/12),.5)],
 ['渐强波浪','坡高逐级增加 · 悬挂行程',30,deck(84,s=>(.45+1.75*s/84)*wave(s/21),.5)],
 ['双峰夹谷','两侧高台 · 谷底压缩',30,deck(90,s=>3.2*wave(s/45)**1.5)],
 ['搓板路','短间距浅波 · 轮胎贴地',18,deck(50,s=>.075*gate(s,0,50,3)*wave(s/2.5),.125)],
 ['左高侧坡','横坡 16% · 向右侧倾',20,deck(70,(s,u)=>gate(s,0,70,14)*.16*(6-u))],
 ['右高侧坡','横坡 22% · 向左侧倾',20,deck(70,(s,u)=>gate(s,0,70,14)*.22*(6+u))],
 ['反向扭转坡','横坡左右转换 · 侧倾回正',25,deck(88,(s,u)=>gate(s,0,88,14)*(1.15+.18*u*Math.cos(Math.PI*s/88)))],
 ['交叉轴波浪','左右轮错峰 · 对角悬挂',12,deck(60,(s,u)=>.23*gate(s,0,60,6)*(1+(2*ease((u+.8)/1.6)-1)*Math.sin(2*Math.PI*s/10)),.4)],
 ['S 弯倾斜路','并线式 S 弯 · 弯中载荷',25,{...deck(100,(s,u)=>gate(s,0,100,12)*(.85+.13*u*Math.cos(2*Math.PI*s/100))),shift:s=>8*wave(s/100)}],
 ['桌面跳台','平顶连接两坡 · 可慢速驶过',45,deck(52,s=>2.4*ease(s/21)*(1-ease((s-31)/21)),.5)],
 ['短距飞坡','渐升起跳 · 八米间隔接坡',50,jump(24,2.4,8,29,1.25)],
 ['双段连跳','两次起跳 · 中段重新接地',38,{...deck(88,s=>{const t=s>=46?s-46:s;return t<=17?1.55*(t/17)**2:t<22||t>42?0:1.05*wave((t-22)/20);},.5),parts:[[0,17],[22,42],[46,63],[68,88]]}],
 ['断崖落差','平顶末端 · 低速跌落',22,{...deck(38,s=>2.25*ease(s/26),.5),parts:[[0,38]]}],
 ['长距大跳','高弧起跳 · 长缓冲接坡',65,jump(40,6,14,46,2.4)]
];

export const slopeCourses=designs.map(([name,purpose,speed,shape],i)=>{
 const row=Math.floor(i/5),col=i%5;
 return {...shape,id:String.fromCharCode(65+row)+(col+1),group:row,name,purpose,speed,
  x:-437+col*50,z:640+row*245,width:12,parts:shape.parts??[[0,shape.length]]};
});
export const slopeSpines=[-465,-205];
export const slopeCrossings=Array.from({length:5},(_,i)=>578+i*245);
export const runUp=41;
export function slopeStart(c){return {x:c.x,z:c.z-runUp,y:.006,yaw:0};}
export function onSlopeGround(x,z){return x>=-482&&x<=-185&&z>=493&&z<=1575;}
export function slopePoint(c,s,u){return [c.x+(c.shift?.(s)??0)+u,Math.max(0,c.height(s,u)),c.z+s];}

// Keep seams welded; the bottom and side walls close each embankment down
// below the existing ground. A lateral grid resolves separate wheel tracks.
export function buildSlopeSolid(c,range){
 const [start,end]=range,rows=Math.ceil((end-start)/(c.step??1)),across=c.group===2?12:2;
 const vertices=[],surface=[],shell=[],rim=[];
 const cols=across+1;
 for(let i=0;i<=rows;i++){
  const s=i===rows?end:start+(end-start)*i/rows,first=i*cols;
  for(let j=0;j<cols;j++)vertices.push(...slopePoint(c,s,(j/across-.5)*c.width));
  if(i<rows)for(let j=0;j<across;j++){
   const a=first+j,b=a+cols;surface.push(a,b,a+1,a+1,b,b+1);
  }
 }
 for(let j=0;j<cols;j++)rim.push(j);
 for(let i=1;i<=rows;i++)rim.push(i*cols+across);
 for(let j=across-1;j>=0;j--)rim.push(rows*cols+j);
 for(let i=rows-1;i>0;i--)rim.push(i*cols);
 const base=vertices.length/3;
 // The underside follows the plan of the lane, including curved outlines.
 for(let n=0;n<base;n++)vertices.push(vertices[3*n],-.16,vertices[3*n+2]);
 for(let i=0;i<surface.length;i+=3)shell.push(base+surface[i],base+surface[i+2],base+surface[i+1]);
 for(let k=0;k<rim.length;k++){
  const a=rim[k],b=rim[(k+1)%rim.length];
  shell.push(a,b,base+a,b,base+b,base+a);
 }
 return {kind:'slope',course:c.id,vertices,indices:[...surface,...shell],topIndexCount:surface.length,rows,cols};
}
