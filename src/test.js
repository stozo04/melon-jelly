const fs=require('fs');
(0,eval)(fs.readFileSync(__dirname+'/sim.js','utf8').replace(/^const CFG/m,'var CFG').replace(/^class Sim/m,'var Sim = class Sim')+`
;globalThis.CFG=CFG;globalThis.Sim=Sim;`);
let t0=Date.now();
const B=buildBody(); const D=buildDecor(B);
const perFace={};D.seeds.forEach(s=>perFace[s.face]=(perFace[s.face]||0)+1);console.log(perFace);console.log('build ms',Date.now()-t0,'verts',B.nV,'tets',B.nT,'edges',B.edges.length/2,'tris',B.tris.length/3,'seeds',D.seeds.length,'bubbles',D.bubbles.length);
// rest-volume sanity
const sim=new Sim(B);
let minV=1e9; for(const v of sim.restVol) minV=Math.min(minV,v);
console.log('min rest tet vol',minV,'total',sim.totalVol,'mass g',sim.massGrams.toFixed(0));
const dt=1/60,S=+process.env.S||6;
function run(sec,label,hook){
  const n=Math.round(sec/dt); let t1=process.hrtime.bigint();
  let maxKE=0, s;
  for(let i=0;i<n;i++){ if(hook)hook(i*dt); sim.step(dt,S); }
  const ms=Number(process.hrtime.bigint()-t1)/1e6/n;
  s=sim.stats();
  console.log(label.padEnd(18),'ms/step',ms.toFixed(2),'relVol',s.relVol.toFixed(3),'minTet',s.minTetRatio.toFixed(2),'inv',s.inverted,'KEmJ',s.keMJ.toExponential(2),'finite',s.finite);
}
sim.reset(0.5);
run(0.5,'drop 0.5s'); run(1.5,'settle +1.5s'); run(3,'settle +3s');
// height sag
let maxY=0,minY=1e9;for(let i=0;i<sim.nV;i++){maxY=Math.max(maxY,sim.pos[3*i+1]);minY=Math.min(minY,sim.pos[3*i+1]);}
console.log('rest height',maxY.toFixed(3),'min y',minY.toFixed(4),'(thickness',CFG.T,')');
// grab the tip top surface and lift
const hitTip=sim.raycast(0,5,-1.3, 0,-1,0);
console.log('hit',hitTip);
sim.beginGrab(hitTip,[0,-0.5,-0.85]);
const start=[hitTip.x,hitTip.y,hitTip.z];
run(1.2,'lift tip',(t)=>{ const f=Math.min(1,t/0.8); sim.updateGrab(start[0],start[1]+f*2.2,start[2]-f*0.6,0,dt);});
run(1.0,'hold',(t)=>sim.updateGrab(start[0],start[1]+2.2,start[2]-0.6,0,dt));
sim.endGrab();
run(0.3,'release +0.3s'); run(1.0,'release +1.3s'); run(2.0,'release +3.3s'); run(4.0,'release +7.3s');
// strong stretch: grab a corner and pull far sideways
const hit2=sim.raycast(1.0,3,0.6, 0,-1,0);
console.log('hit2',hit2&&[hit2.x,hit2.y,hit2.z].map(x=>x.toFixed(2)));
if(hit2){ sim.beginGrab(hit2,[0,-0.5,-0.85]); const s0=[hit2.x,hit2.y,hit2.z];
 run(1.5,'strong stretch',(t)=>{const f=Math.min(1,t/0.6);sim.updateGrab(s0[0]+f*4,s0[1]+f*1.5,s0[2]+f*1,0,dt);});
 sim.endGrab(); run(1,'release'); run(4,'release +5s'); run(4,'+9s');}
sim.nudge(); run(1,'nudge 1s'); run(5,'nudge +6s');
