const fs=require('fs');
(0,eval)(fs.readFileSync(__dirname+'/sim.js','utf8').replace(/^const CFG/m,'var CFG').replace(/^class Sim/m,'var Sim = class Sim')+`\n;globalThis.CFG=CFG;globalThis.Sim=Sim;globalThis.buildBody=buildBody;`);
const B=buildBody(); const sim=new Sim(B); if(process.env.IT)sim.iters=+process.env.IT; if(process.env.GA)sim.grabAlpha=+process.env.GA; if(process.env.GR)sim.grabR=+process.env.GR; if(process.env.MS)sim.maxStretch=+process.env.MS; if(process.env.HS)sim.handleSpeed=+process.env.HS;
const NL=B.NL,nCol=B.nCol, dt=1/60, S=+process.env.S||10;
const topV=(f)=>{let best=-1,bs=1e9;for(let c=0;c<nCol;c++){const v=(NL-1)*nCol+c;const s=f(sim.pos,v);if(s<bs){bs=s;best=v}}return best};
function run(name, vsel, dir, dist){
  sim.reset(0); for(let i=0;i<60;i++) sim.step(dt,S);
  const v=vsel();
  const hit={x:sim.pos[3*v],y:sim.pos[3*v+1]+0.01,z:sim.pos[3*v+2]};
  sim.beginGrab(hit,[-0.5,-0.7,-0.5]);
  let worst=0,minR=9,t0=process.hrtime.bigint(),steps=0;
  const T=[hit.x+dir[0]*dist,hit.y+dir[1]*dist,hit.z+dir[2]*dist];
  for(let i=0;i<70;i++){ const f=Math.min(1,i/25); sim.updateGrab(hit.x+(T[0]-hit.x)*f,hit.y+(T[1]-hit.y)*f,hit.z+(T[2]-hit.z)*f,0,dt); sim.step(dt,S);steps++; if(i%3==0){const s=sim.stats(); worst=Math.max(worst,s.inverted); minR=Math.min(minR,s.minTetRatio);}}
  const dragWorst=worst; let maxH=0; for(let i=0;i<sim.nV;i++)maxH=Math.max(maxH,sim.pos[3*i+1]); sim.endGrab(); let rel=0, impact=0;
  for(let i=0;i<120;i++){sim.step(dt,S);if(i%3)continue;const s=sim.stats();worst=Math.max(worst,s.inverted);minR=Math.min(minR,s.minTetRatio);}
  for(let i=0;i<300;i++)sim.step(dt,S);
  const e=sim.stats();
  console.log(name.padEnd(8),'dragInv',dragWorst,'maxH',maxH.toFixed(1),'worstInv',worst,'minRatio',minR.toFixed(2),'endKE',e.keMJ.toExponential(1),'endVol',e.relVol.toFixed(4),'ms/step',(Number(process.hrtime.bigint()-t0)/1e6/(steps+520)).toFixed(2));
}
const dirs={right:[1,0.7,0],up:[0.2,1,0],back:[0,0.6,-1],front:[0.3,0.4,1]};
const tip=()=>topV((p,v)=>p[3*v+2]), cR=()=>topV((p,v)=>-p[3*v]), cL=()=>topV((p,v)=>p[3*v]), fl=()=>topV((p,v)=>Math.hypot(p[3*v],p[3*v+2]+0.1));
const cases=(process.env.CASES||'tip:back,cornerR:right').split(',').map(x=>x.split(':'));const sels={tip,cornerR:cR,flesh:fl};
for(const [n,dn] of cases) run(n+'/'+dn,sels[n],dirs[dn],+process.env.D||3.2);
