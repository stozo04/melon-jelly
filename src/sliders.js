const fs=require('fs');
(0,eval)(fs.readFileSync(__dirname+'/sim.js','utf8').replace(/^const CFG/m,'var CFG').replace(/^class Sim/m,'var Sim = class Sim')+`\n;globalThis.Sim=Sim;globalThis.buildBody=buildBody;`);
const B=buildBody();
const [f,d]=[+process.argv[2],+process.argv[3]];
const sim=new Sim(B); sim.setParams(f,d); sim.reset(0.3);
for(let i=0;i<30;i++)sim.step(1/60,10);
sim.nudge();
let worstInv=0,minVol=9,maxVol=0,minY=9,ke2=0,tSettle=null,maxSub=0;
for(let i=0;i<900;i++){sim.step(1/60,10); maxSub=Math.max(maxSub,sim.lastSub); if(i%3==0){const s=sim.stats(); worstInv=Math.max(worstInv,s.inverted);minVol=Math.min(minVol,s.relVol);maxVol=Math.max(maxVol,s.relVol); if(i==120)ke2=s.keMJ; if(tSettle===null&&i>20&&s.keMJ<0.002)tSettle=(i/60).toFixed(1);} for(let k=1;k<sim.pos.length;k+=3)minY=Math.min(minY,sim.pos[k]);}
const e=sim.stats();
console.log(`firm ${f} damp ${d}: worstInv ${worstInv} vol ${minVol.toFixed(3)}-${maxVol.toFixed(3)} minY ${minY.toFixed(4)} KE@2s ${ke2.toFixed(3)} settle(KE<.002mJ)@ ${tSettle}s endKE ${e.keMJ.toExponential(1)} maxSub ${maxSub}`);
