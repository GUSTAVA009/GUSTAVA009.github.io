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
const particlesEnabled = {spark: true};
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
pauseBtn.onclick=()=>{
 playing=!playing;
 pauseBtn.textContent=playing?'⏸ Пауза':'▶ Продолжить';
 if(!playing)audio.pause();
 else if(audioWanted)startAudio();
};
$('#speed').oninput=e=>{
 speed=Number(e.target.value);
 $('#speedVal').textContent=speed.toFixed(2)+'×';
 if(audioWanted)syncAudioToAnimation(true);
};
$('#exposure').oninput=e=>{renderer.toneMappingExposure=Number(e.target.value);$('#exposureVal').textContent=Math.round(100*Number(e.target.value))+'%';};
$('#sparkToggle').onchange=e=>{
 particlesEnabled.spark=e.target.checked;
 emitters.forEach(v=>{v.outer.visible=e.target.checked;});
};

const audio=$('#audio'),audioBtn=$('#audioToggle'),volume=$('#volume');
let audioWanted=false, clipDuration=8;
audio.volume=Number(volume.value)/100;
audio.preload='metadata';
volume.oninput=e=>{audio.volume=Number(e.target.value)/100;};

// Tie audio phase to the original GLB animation, not independent wall time.
function syncAudioToAnimation(force=false) {
 const duration=audio.duration;
 if(!Number.isFinite(duration)||duration<=0||clipDuration<=0)return;
 const phase=((animationSeconds%clipDuration)+clipDuration)%clipDuration/clipDuration;
 const target=phase*duration;
 const drift=Math.abs(audio.currentTime-target);
 const wrappedDrift=Math.min(drift,Math.abs(duration-drift));
 const rate=clamp(speed*duration/clipDuration,.25,4);
 if(Math.abs(audio.playbackRate-rate)>.001)audio.playbackRate=rate;
 if(force||wrappedDrift>.18)audio.currentTime=target;
}
async function startAudio(){
 if(!audioWanted||!playing)return;
 try{
  syncAudioToAnimation(true);
  await audio.play();
  audioBtn.textContent='🔊 Выключить звук';
 }catch(e){
  audioWanted=false;
  audio.pause();
  audioBtn.textContent='🔈 Включить звук';
  say('Звук недоступен: '+e.message);
 }
}
audioBtn.onclick=async()=>{
 if(audioWanted){
  audioWanted=false;
  audio.pause();
  audioBtn.textContent='🔈 Включить звук';
 }else{
  audioWanted=true;
  if(playing)await startAudio();
  else audioBtn.textContent='🔊 Звук включён (пауза)';
 }
};
audio.addEventListener('loadedmetadata',()=>{if(audioWanted)syncAudioToAnimation(true);});

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
  const mappedUV=new THREE.Vector2();
  return uv=>{
   if(!uv)return 0;
   // Respect GLTF texture.flipY and texture transform, so the source
   // points match the visible glowing fissures on the actual geometry.
   mappedUV.copy(uv);
   map.transformUv(mappedUV);
   const x=clamp(Math.floor(mappedUV.x*(w-1)),0,w-1);
   const y=clamp(Math.floor(mappedUV.y*(h-1)),0,h-1);
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
// ConeGeometry's long axis is local +Y. The per-particle quaternion maps
// local +Y to the true flight direction. No extra 90-degree rotation needed.
const sparkGeo=new THREE.ConeGeometry(1,1,6,1);
sparkGeo.translate(0,.5,0);
const sparkMat=new THREE.MeshBasicMaterial({
 color:0xffac53,vertexColors:false,transparent:false,depthWrite:true
});
function makeEmitter(mesh,sites,count,side) {
 const outer=new THREE.InstancedMesh(sparkGeo,sparkMat,count);
 outer.frustumCulled=false;
 outer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 outer.name='V63_'+side+'_SPARKS_FROM_CRACKS';
 mesh.add(outer);
 const particles=[];
 for(let i=0;i<count;i++){
  const j=Math.floor(seed(i*9.33+side.length*37)*sites.length);
  const source=sites[j%sites.length];
  const life=.28+seed(i*57.9+side.length)*.75;
  particles.push({
   position:source.position,normal:source.normal,
   life,phase:seed(i*64.23+side.length*18)*life,
   size:.009+.009*seed(i*33.1+18),
   speed:.15+.21*seed(i*13.4+side.length*83),
   drift:seed(i*91.1+side.length*53)*6.283,
   wobble:.0015+.006*seed(i*51.1+side.length),
   width:.00085+.00045*seed(i*19.3+side.length*13)
  });
  tmpColor.setHSL(.058+.035*seed(i*31),1,.52);
  outer.setColorAt(i,tmpColor);
 }
 if(outer.instanceColor)outer.instanceColor.needsUpdate=true;
 emitters.push({outer,count,particles,mesh,side});
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
  // Emission sites rotate with the mesh; velocity still rises in world Y.
  e.mesh.getWorldQuaternion(tmpQ);
  tmpQ.invert();
  const worldUp=vUp.clone().applyQuaternion(tmpQ);
  const lateralA=new THREE.Vector3(1,0,0).projectOnPlane(worldUp);
  if(lateralA.lengthSq()<.0001)lateralA.set(0,0,1).projectOnPlane(worldUp);
  lateralA.normalize();
  const lateralB=new THREE.Vector3().crossVectors(worldUp,lateralA).normalize();
  for(let i=0;i<e.count;i++){
   const p=e.particles[i];
   const age=(t+p.phase)%p.life;
   const pct=age/p.life;
   const envelope=Math.min(1,age/.13)*(1-pct)**.8;
   const normal=p.normal.clone().normalize();
   const outwardInfluence=.16+.44*clamp((normal.dot(worldUp)+1)*.5,0,1);
   const direction=worldUp.clone().multiplyScalar(1-outwardInfluence)
     .addScaledVector(normal,outwardInfluence).normalize();
   const shift=direction.clone().multiplyScalar(p.speed*age);
   const sideways=p.wobble*pct*.4;
   shift.addScaledVector(lateralA,Math.sin(p.drift+pct*5.5)*sideways);
   shift.addScaledVector(lateralB,Math.cos(p.drift+pct*5.0)*sideways);
   // Start just above the fissure, not floating off the rock.
   tmp.position.copy(p.position).addScaledVector(normal,.00045).add(shift);
   // Long spark axis follows its velocity, without random extra rotation.
   tmp.quaternion.setFromUnitVectors(vUp,direction);
   tmp.scale.set(
    Math.max(.00001,p.width*envelope),
    Math.max(.00001,p.size*envelope),
    Math.max(.00001,p.width*envelope)
   );
   tmp.updateMatrix();
   e.outer.setMatrixAt(i,tmp.matrix);
  }
  e.outer.instanceMatrix.needsUpdate=true;
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
  emitters=[];hotSampleCount=0;root=gltf.scene;
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
   makeEmitter(mesh,sites,260,side);
  }
  if(!gltf.animations.length)throw new Error('Не найдена оригинальная анимация Везувия');
  mixer=new THREE.AnimationMixer(root);
  mixer.clipAction(gltf.animations[0]).setLoop(THREE.LoopRepeat,Infinity).play();
  clipDuration=Math.max(.01,gltf.animations[0].duration);
  animationSeconds=0;
  mixer.setTime(0);
  if(audioWanted){
   syncAudioToAnimation(true);
   if(playing)startAudio();
  }
  // Preserve original V62 geometry, PBR material maps and 8s animation.
  say('V63 готов: 520 объёмных искр из '+hotSampleCount+' точек лавовых трещин');
  $('#counter').textContent='520 искр';
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
 if(playing){
  animationSeconds+=dt*speed;
  if(mixer)mixer.update(dt*speed);
  if(audioWanted&&!audio.paused)syncAudioToAnimation();
 }else if(!audio.paused)audio.pause();
 if(emitters.length)tickParticles(animationSeconds);
 controls.update();
 if(root)lavaLight.intensity=6.4+1.1*Math.sin(animationSeconds*2.4);
 renderer.render(scene,camera);
}
requestAnimationFrame(loop);
load();
