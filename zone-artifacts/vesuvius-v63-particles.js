import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// GUSTAVA ZONE 2040 / V63: real-time geometry-based crack emitters on the actual V62 GLB.
// V62 geometry, maps, root motion and original 8-second animation remain unchanged.
const $ = s => document.querySelector(s);
const stage = $('#stage'), status = $('#status'), retry = $('#retry');
const progress = $('#progress'), pauseBtn = $('#pause');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101a25);
scene.fog = new THREE.FogExp2(0x101a25, 0.13);
const camera = new THREE.PerspectiveCamera(35, 1, 0.018, 120);
camera.position.set(1.35, 1.04, 1.82);
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .64, 0);
controls.minDistance = .45;
controls.maxDistance = 5;
controls.enableDamping = true;
controls.dampingFactor = .06;
controls.update();

scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x17202c, 2.1));
const key = new THREE.DirectionalLight(0xffedd7, 3.4); key.position.set(-1.2, 2.4, 2.1); scene.add(key);
const fill = new THREE.DirectionalLight(0x93bfe0, 1.7); fill.position.set(1.6, .65, -1.0); scene.add(fill);
const lavaLight = new THREE.PointLight(0xff5a19, 7, 2.0, 2.0);
lavaLight.position.set(.04, .59, .1); scene.add(lavaLight);

const parts = [
 ['Vesuvius_V62_OriginalV60_NaturalStoneRim.part01.bin',20000000],
 ['Vesuvius_V62_OriginalV60_NaturalStoneRim.part02.bin',20000000],
 ['Vesuvius_V62_OriginalV60_NaturalStoneRim.part03.bin',20000000],
 ['Vesuvius_V62_OriginalV60_NaturalStoneRim.part04.bin',20000000],
 ['Vesuvius_V62_OriginalV60_NaturalStoneRim.part05.bin',13290984]
];
const totalBytes = 93290984;
let root = null, mixer = null, animationSeconds = 0, lastFrame = performance.now();
let playing = true, speed = 1, loading = false;
let emitters = [], hotSampleCount = 0;
const tmp = new THREE.Object3D();
const vUp = new THREE.Vector3(0,1,0), tmpQ = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const particlesEnabled = {spark: true, coal: true};
const seed = (n) => { const x = Math.sin(n*127.1+16.35)*43758.5453; return x-Math.floor(x); };
const clamp = THREE.MathUtils.clamp;
function say(message){status.textContent = message;}
function onResize(){
 const w=Math.max(200,stage.clientWidth),h=Math.max(300,stage.clientHeight);
 camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h,false);
}
new ResizeObserver(onResize).observe(stage);
function setPreset(name) {
 const pos = {hero:[1.35,1.04,1.82],top:[.45,2.1,.64],bottom:[.44,-.82,1.07],macro:[.60,.81,.77]}[name];
 if(!pos)return;
 camera.position.set(...pos);controls.target.set(0,.64,0);controls.update();
}
$('#hero').onclick=()=>setPreset('hero');
$('#top').onclick=()=>setPreset('top');
$('#bottom').onclick=()=>setPreset('bottom');
$('#macro').onclick=()=>setPreset('macro');
pauseBtn.onclick=()=>{playing=!playing;pauseBtn.textContent=playing?'⏸ Пауза':'▶ Продолжить';};
$('#speed').oninput=e=>{speed=Number(e.target.value);$('#speedVal').textContent=speed.toFixed(2)+'×';};
$('#exposure').oninput=e=>{renderer.toneMappingExposure=Number(e.target.value);$('#exposureVal').textContent=Math.round(100*Number(e.target.value))+'%';};
$('#sparkToggle').onchange=e=>{particlesEnabled.spark=e.target.checked;emitters.filter(v=>v.kind==='spark').forEach(v=>{v.outer.visible=e.target.checked;});};
$('#coalToggle').onchange=e=>{particlesEnabled.coal=e.target.checked;emitters.filter(v=>v.kind==='coal').forEach(v=>{v.outer.visible=e.target.checked;if(v.core)v.core.visible=e.target.checked;});};

const audio=$('#audio'),audioBtn=$('#audioToggle'),volume=$('#volume');
audio.volume=Number(volume.value)/100;
volume.oninput=e=>{audio.volume=Number(e.target.value)/100;};
audioBtn.onclick=async()=>{
 if(!audio.paused){audio.pause();audioBtn.textContent='🔈 Включить звук';return;}
 try {await audio.play();audioBtn.textContent='🔊 Выключить звук';}
 catch(e){say('Звук недоступен: '+e.message);}
};

async function onePart(i) {
 const [name,wanted]=parts[i];
 for(let attempt=0;attempt<3;attempt++) {
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),120000);
  try {
   const r=await fetch('models/'+name+'?v=62a',{signal:ac.signal,cache:attempt?'reload':'force-cache'});
   if(!r.ok)throw new Error('HTTP '+r.status+' / '+name);
   const b=await r.arrayBuffer();
   if(b.byteLength!==wanted)throw new Error('Неполная часть '+(i+1)+': '+b.byteLength);
   return b;
  }catch(err){if(attempt===2)throw err;await new Promise(ok=>setTimeout(ok,650*(attempt+1)));}
  finally{clearTimeout(timer);}
 }
}
async function download() {
 let next=0,complete=0;const chunks=new Array(parts.length);
 const worker=async()=>{while(next<parts.length) {
  const i=next++;
  chunks[i]=await onePart(i);
  complete++;
  const mbytes=chunks.reduce((n,b)=>n+(b?b.byteLength:0),0)/1e6;
  progress.value=mbytes*1e6/totalBytes;
  say('Загрузка реальной V62: '+complete+'/5 файлов · '+mbytes.toFixed(1)+' / 93.3 МБ');
 }};
 await Promise.all([worker(),worker()]);
 const bytes=new Uint8Array(totalBytes);let offset=0;
 for(const b of chunks){bytes.set(new Uint8Array(b),offset);offset+=b.byteLength;}
 if(offset!==totalBytes)throw new Error('Неправильная длина GLB');
 if(String.fromCharCode(...bytes.subarray(0,4))!=='glTF')throw new Error('Некорректный GLB');
 return bytes.buffer;
}

function emissiveSampler(mesh) {
 const mat = mesh.material;
 const map = mat && mat.emissiveMap;
 if(!map || !map.image)return null;
 try {
  const image = map.image;
  const can=document.createElement('canvas');
  can.width=Math.min(1024,image.width||1024);
  can.height=Math.min(1024,image.height||1024);
  const ctx=can.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0,can.width,can.height);
  const data=ctx.getImageData(0,0,can.width,can.height).data, w=can.width,h=can.height;
  return uv=>{
   if(!uv)return 0;
   const u=((uv.x%1)+1)%1,v=((uv.y%1)+1)%1;
   const x=clamp(Math.floor(u*(w-1)),0,w-1);
   const y=clamp(Math.floor((1-v)*(h-1)),0,h-1);
   const k=(y*w+x)*4;
   return data[k]*.55+data[k+1]*.38+data[k+2]*.07;
  };
 }catch(e){console.warn('Emission map pixel access unavailable',mat.name,e);return null;}
}
function crackSites(mesh) {
 const sampler=new MeshSurfaceSampler(mesh).build();
 const brightness=emissiveSampler(mesh);
 const pos=new THREE.Vector3(), normal=new THREE.Vector3(),uv=new THREE.Vector2();
 const points=[];
 // Select real points on the animated solid, favoring brightest pixels of its own crack-emission map.
 for(let i=0;i<10000;i++){
  sampler.sample(pos,normal,null,uv);
  const glow=brightness?brightness(uv):0;
  points.push({p:pos.clone(),n:normal.clone(),g:glow});
 }
 points.sort((a,b)=>b.g-a.g);
 const upper=points[0]?.g||0;
 const filtered=(upper>8?points.filter((p,i)=>i<1000&&p.g>Math.max(12,upper*.48)):points.slice(0,550));
 // Low-emissive input is still usable, but never silently invent a 2D particle plane.
 const select=filtered.length>=45?filtered:points.slice(0,Math.min(550,points.length));
 return select.map(p=>({position:p.p,normal:p.n,emission:p.g}));
}
function stoneGeometry() {
 const g=new THREE.IcosahedronGeometry(1,0);
 const pos=g.attributes.position;
 for(let i=0;i<pos.count;i++){
  const s=.81+.26*seed(i+23);pos.setXYZ(i,pos.getX(i)*s,pos.getY(i)*(.71+.24*seed(i+49)),pos.getZ(i)*s);
 }
 pos.needsUpdate=true;g.computeVertexNormals();return g;
}
const sparkGeo = new THREE.ConeGeometry(1,1,5,1);
sparkGeo.translate(0,.5,0);
const coalGeo = stoneGeometry();
const coreGeo = new THREE.IcosahedronGeometry(1,0);
const sparkMat=new THREE.MeshBasicMaterial({color:0xffac53,vertexColors:false,transparent:false,depthWrite:true});
const coalMat=new THREE.MeshStandardMaterial({
 color:0x241d1b,roughness:.94,metalness:.02,emissive:0xff4c13,emissiveIntensity:.29
});
const coreMat=new THREE.MeshBasicMaterial({color:0xff680e,transparent:true,opacity:.73,depthWrite:false});
function makeEmitter(mesh,sites,kind,count,side){
 const outer=new THREE.InstancedMesh(kind==='spark'?sparkGeo:coalGeo,kind==='spark'?sparkMat:coalMat,count);
 outer.frustumCulled=false;outer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 outer.name='V63_'+side+'_'+kind+'_THREE_DIMENSIONAL_CRACK_PARTICLES';
 mesh.add(outer);
 let core=null;
 if(kind==='coal'){
  core=new THREE.InstancedMesh(coreGeo,coreMat,count);
  core.frustumCulled=false;core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  core.name='V63_'+side+'_MOLTEN_COAL_CORES';
  mesh.add(core);
 }
 const particles=[];
 for(let i=0;i<count;i++){
  const random=()=>seed(200+i*97+side.length*19+Math.round(i*1.713+5*side.length));
  const j=Math.floor(seed(i*9.33+side.length*37)*sites.length);
  const source=sites[j%sites.length];
  const life=(kind==='spark'?.28:.95)+seed(i*57.9+side.length)* (kind==='spark'?.75:1.45);
  particles.push({
   position:source.position,normal:source.normal,
   life,phase:seed(i*64.23+side.length*18)*life,
   size:(kind==='spark'?.009:.0028)+(kind==='spark'?.009:.0051)*seed(i*33.1+18),
   speed:(kind==='spark'?.15:.040)+(kind==='spark'?.21:.065)*seed(i*13.4+side.length*83),
   drift:seed(i*91.1+side.length*53)*6.283,
   wobble:seed(i*51.1+side.length)*.015+.005,
   spin:seed(i*19.3+side.length*13)*6.283
  });
 }
 for(let i=0;i<count;i++){
  tmpColor.setHSL(kind==='spark'?(.058+.035*seed(i*31)):0.035,kind==='spark'?1:.24,kind==='spark'?.52:.23);
  outer.setColorAt(i,tmpColor);
 }
 if(outer.instanceColor)outer.instanceColor.needsUpdate=true;
 emitters.push({outer,core,kind,count,particles,mesh,side});
}
function findMaterialMeshes(sceneRoot) {
 const result=[];
 sceneRoot.traverse(o=>{
  if(!o.isMesh) return;
  const n=(o.material&&o.material.name)||'';
  if(n.includes('Top_TrueTangentNormals'))result.push({mesh:o,side:'TOP'});
  if(n.includes('Bottom_TrueTangentNormals'))result.push({mesh:o,side:'BOTTOM'});
  // Old V55/V60 moving morphs: hide the triangular/diamond-shaped particles;
  // retain their animation tracks, but replace their actual visual geometry.
  if(/_ASH_920_|_EMBER_480_|RisingParticles|Smooth24Morph_Stream/i.test(o.name))o.visible=false;
 });
 return result;
}
function tickParticles(t) {
 for(const e of emitters){
  // Compensate original 8-second coin flip: emissions always rise in world Y,
  // while their 3D origins stay firmly attached to the rotating rock.
  e.mesh.getWorldQuaternion(tmpQ);tmpQ.invert();
  const worldUp = vUp.clone().applyQuaternion(tmpQ);
  for(let i=0;i<e.count;i++){
   const p=e.particles[i];
   const age=(t+p.phase)%p.life;
   const pct=age/p.life;
   const envelope=Math.min(1,age/.13)*(1-pct)**.8;
   const launch=e.kind==='spark'?.27:.15;
   const vel=worldUp.clone().multiplyScalar(1-launch).addScaledVector(p.normal,launch).normalize();
   const shift=vel.multiplyScalar(p.speed*age);
   shift.x+=Math.sin(p.drift+pct*9)*p.wobble*pct;
   shift.z+=Math.cos(p.drift+pct*8)*p.wobble*pct;
   const offset=p.normal.clone().multiplyScalar(e.kind==='spark'?.0015:.0030);
   const location=p.position.clone().add(offset).add(shift);
   tmp.position.copy(location);
   if(e.kind==='spark'){
    const direction=shift.lengthSq()>1e-8?shift.normalize():worldUp;
    tmp.quaternion.setFromUnitVectors(vUp,direction);
    tmp.rotateY(p.spin);
    const width=(.0009+.0007*Math.sin(p.spin))*envelope;
    tmp.scale.set(Math.max(.00001,width),Math.max(.00001,p.size*envelope),Math.max(.00001,width));
   }else {
    tmp.quaternion.setFromEuler(new THREE.Euler(p.spin+age*1.8,age*2.1+p.drift,p.spin*.4+age));
    const s=p.size*envelope;
    tmp.scale.set(Math.max(.00001,s),Math.max(.00001,s*.82),Math.max(.00001,s*.76));
   }
   tmp.updateMatrix();e.outer.setMatrixAt(i,tmp.matrix);
   if(e.core){
    tmp.scale.multiplyScalar(.31+seed(i*5.4)*.25);
    tmp.updateMatrix();e.core.setMatrixAt(i,tmp.matrix);
   }
  }
  e.outer.instanceMatrix.needsUpdate=true;
  if(e.core)e.core.instanceMatrix.needsUpdate=true;
 }
}
async function load() {
 if(loading)return;
 loading=true;retry.hidden=true;progress.value=0;
 try {
  const data=await download();
  say('Загружено 93.3 МБ. Распаковываю 3D и читаю 4K PBR...');
  const loader=new GLTFLoader();
  const gltf=await loader.parseAsync(data,'');
  if(root)scene.remove(root);
  emitters=[];root=gltf.scene;
  scene.add(root);
  root.updateMatrixWorld(true);
  const materialMeshes=findMaterialMeshes(root);
  if(materialMeshes.length!==2)throw new Error('Ожидалось 2 слоя трещин, найдено '+materialMeshes.length);
  for(const {mesh,side} of materialMeshes){
   say('Определяю физические источники '+(side==='TOP'?'верхних':'нижних')+' трещин...');
   // Let progress text render before the CPU-heavy actual surface sampling.
   await new Promise(requestAnimationFrame);
   const sites=crackSites(mesh);
   hotSampleCount+=sites.length;
   makeEmitter(mesh,sites,'spark',205,side);
   makeEmitter(mesh,sites,'coal',325,side);
  }
  if(!gltf.animations.length)throw new Error('Не найдена оригинальная анимация Везувия');
  mixer=new THREE.AnimationMixer(root);
  mixer.clipAction(gltf.animations[0]).setLoop(THREE.LoopRepeat,Infinity).play();
  // Do not replace texture coordinates, base geometry, or the native animation.
  say('V63 готов: 410 объёмных искр + 650 угольных осколков из '+hotSampleCount+' точек лавовых трещин');
  $('#counter').textContent='410 искр / 650 угольков';
  $('#source').textContent='V62 · PBR 4K · натуральный каменный торец';
  progress.value=1;
 } catch(e){
  console.error('V63 loader',e);
  say('Ошибка 3D: '+(e.message||String(e)));
  retry.hidden=false;
 }finally{loading=false;}
}
retry.onclick=load;
function loop(now) {
 requestAnimationFrame(loop);
 const dt=Math.min(.05,(now-lastFrame)/1000);
 lastFrame=now;
 if(playing){animationSeconds+=dt*speed;if(mixer)mixer.update(dt*speed);}
 if(emitters.length)tickParticles(animationSeconds);
 controls.update();
 if(root)lavaLight.intensity=6.4+1.1*Math.sin(animationSeconds*2.4);
 renderer.render(scene,camera);
}
requestAnimationFrame(loop);
load();
