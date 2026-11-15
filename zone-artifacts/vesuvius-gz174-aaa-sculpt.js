import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// GUSTAVA ZONE 2040 / GZ174: original V62 geologic motion preview on the actual V62 GLB.
// The original V62 GLB is preserved; only runtime animation and sound playback change.
const $ = s => document.querySelector(s);
const stage = $('#stage'), status = $('#status'), retry = $('#retry');
const progress = $('#progress'), pauseBtn = $('#pause');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101a25);
scene.fog = new THREE.FogExp2(0x101a25, 0.13);
const camera = new THREE.PerspectiveCamera(35, 1, 0.018, 120);
camera.position.set(.90, .92, 1.13);
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
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
 ['Vesuvius_GZ174_PhotobasaltRealFissures.part01.bin',20000000],
 ['Vesuvius_GZ174_PhotobasaltRealFissures.part02.bin',20000000],
 ['Vesuvius_GZ174_PhotobasaltRealFissures.part03.bin',20000000],
 ['Vesuvius_GZ174_PhotobasaltRealFissures.part04.bin',20000000],
 ['Vesuvius_GZ174_PhotobasaltRealFissures.part05.bin',17495416]
];
const totalBytes = 97495416;
let root = null, mixer = null, animatedRock = null, animationSeconds = 0, lastFrame = performance.now();
let playing = true, speed = 1.0, loading = false;
let emitters = [], hotSampleCount = 0, landingRig = null;
const coinAxis = new THREE.Vector3(1,0,0);
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
 const pos = {hero:[.90,.92,1.13],top:[.45,2.1,.64],bottom:[.44,-.82,1.07],macro:[.60,.81,.77]}[name];
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
 if(!playing){
  stopSound();
  if(audioWanted)audioBtn.textContent='🔊 Звук включён (пауза)';
 }else if(audioWanted)startAudio();
};
$('#speed').value='1';
$('#speedVal').textContent='1.00×';
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
let audioWanted=false, clipDuration=18;
let soundContext=null, soundBuffer=null, soundSource=null, soundGain=null;
let soundEpochTime=0,soundEpochAnimation=0,soundEpochSpeed=speed,soundRequest=0;

volume.oninput=e=>{
 const level=Number(e.target.value)/100;
 if(soundContext&&soundGain)soundGain.gain.setTargetAtTime(level,soundContext.currentTime,.025);
};

// Produce a seamless loop by equal-power crossfading the OGG's tail into its
// opening. Unlike HTMLAudioElement.loop/currentTime seeking, no gap or pop is
// introduced at the 8-second seam.
function seamlessSoundBuffer(context,original){
 const overlap=Math.min(Math.floor(original.sampleRate*.78),Math.floor(original.length/7));
 const length=original.length-overlap;
 const output=context.createBuffer(original.numberOfChannels,length,original.sampleRate);
 for(let channel=0;channel<original.numberOfChannels;channel++){
  const input=original.getChannelData(channel);
  const dest=output.getChannelData(channel);
  dest.set(input.subarray(overlap,length),overlap);
  for(let i=0;i<overlap;i++){
   const fraction=i/Math.max(1,overlap-1);
   const fromTail=Math.cos(fraction*Math.PI*.5);
   const fromHead=Math.sin(fraction*Math.PI*.5);
   dest[i]=input[length+i]*fromTail+input[i]*fromHead;
  }
 }
 return output;
}
async function ensureSound(){
 if(!soundContext){
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw new Error('Web Audio не поддерживается этим браузером');
  soundContext=new AudioContextClass();
  // Warm magmatic rumble: suppress sub-bass, brittle mids and sharp hiss.
  const highpass=soundContext.createBiquadFilter();
  highpass.type='highpass';highpass.frequency.value=42;highpass.Q.value=.55;
  const lowShelf=soundContext.createBiquadFilter();
  lowShelf.type='lowshelf';lowShelf.frequency.value=160;lowShelf.gain.value=2.8;
  const notch=soundContext.createBiquadFilter();
  notch.type='peaking';notch.frequency.value=1150;notch.Q.value=.85;notch.gain.value=-3.3;
  const lowpass=soundContext.createBiquadFilter();
  lowpass.type='lowpass';lowpass.frequency.value=2050;lowpass.Q.value=.65;
  soundGain=soundContext.createGain();
  soundGain.gain.value=Number(volume.value)/100;
  highpass.connect(lowShelf);lowShelf.connect(notch);notch.connect(lowpass);
  lowpass.connect(soundGain);soundGain.connect(soundContext.destination);
  soundContext._vesuviusInput=highpass;
 }
 if(!soundBuffer){
  const response=await fetch(audio.getAttribute('src'),{cache:'force-cache'});
  if(!response.ok)throw new Error('Аудиофайл HTTP '+response.status);
  const decoded=await soundContext.decodeAudioData(await response.arrayBuffer());
  soundBuffer=seamlessSoundBuffer(soundContext,decoded);
 }
 await soundContext.resume();
}
function stopSound(){
 soundRequest++;
 if(soundSource){
  const source=soundSource;
  soundSource=null;
  try{source.stop();}catch(e){}
  source.disconnect();
 }
}
// The audio clock drives the animated scene, eliminating drift and repeated
// currentTime seeks (the cause of audible breaks at the original loop seam).
function syncAudioToAnimation(changeSpeed=false){
 if(!soundContext||!soundSource||soundContext.state!=='running')return;
 const now=soundContext.currentTime;
 const phaseTime=soundEpochAnimation+(now-soundEpochTime)*soundEpochSpeed;
 animationSeconds=phaseTime;
 if(changeSpeed&&soundBuffer){
  soundEpochTime=now;
  soundEpochAnimation=phaseTime;
  soundEpochSpeed=speed;
  soundSource.playbackRate.setTargetAtTime(
   speed,now,.018);
 }
}
async function startAudio(){
 if(!audioWanted||!playing)return;
 const request=++soundRequest;
 try{
  await ensureSound();
  if(request!==soundRequest||!audioWanted||!playing)return;
  if(soundSource)stopSound();
  soundEpochTime=soundContext.currentTime;
  soundEpochAnimation=animationSeconds;
  soundEpochSpeed=speed;
  const phase=((animationSeconds%soundBuffer.duration)+soundBuffer.duration)%soundBuffer.duration;
  const offset=phase;
  const source=soundContext.createBufferSource();
  source.buffer=soundBuffer;
  source.loop=true;
  source.playbackRate.value=speed;
  source.connect(soundContext._vesuviusInput);
  soundSource=source;
  source.start(0,offset);
  audioBtn.textContent='🔊 Выключить звук';
 }catch(e){
  audioWanted=false;
  stopSound();
  audioBtn.textContent='🔈 Включить звук';
  say('Звук недоступен: '+e.message);
 }
}
audioBtn.onclick=async()=>{
 if(audioWanted){
  audioWanted=false;
  stopSound();
  audioBtn.textContent='🔈 Включить звук';
 }else{
  audioWanted=true;
  if(playing)await startAudio();
  else audioBtn.textContent='🔊 Звук включён (пауза)';
 }
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
  say('Загрузка реальной V62: '+complete+'/5 файлов · '+mbytes.toFixed(1)+' / 97.5 МБ');
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
// GZ174: new 18-second, periodic inertial choreography.
// All motion is applied only to the GLB's existing parent node.
// Mesh vertices, UVs, scale, and all five original materials are untouched.
const volcanoAxis=new THREE.Vector3(1,0,0);
const volcanoBase=new THREE.Quaternion(),volcanoFlip=new THREE.Quaternion();
const volcanoEuler=new THREE.Euler(0,0,0,'YXZ');
const ease=x=>{const a=clamp(x,0,1);return a*a*(3-2*a);};
function updateVolcanoMotion(seconds){
 if(!animatedRock)return;
 const t=((seconds%clipDuration)+clipDuration)%clipDuration;
 const twoPi=Math.PI*2;
 // Periodic breathing is continuous in value and velocity at the loop seam.
 const breath=.012*Math.sin(twoPi*t/clipDuration)+
              .008*Math.sin(4*twoPi*t/clipDuration);
 const lateral=.009*Math.sin(twoPi*t/clipDuration);
 // Withdraw slightly before expelling heat. No trembling or random shaking.
 const charge=ease((t-5.6)/1.60)*(1-ease((t-7.18)/.20));
 const climbStart=7.24,climbEnd=9.58, duration=climbEnd-climbStart;
 let airborne=0, fullTurn=0;
 if(t>=climbStart&&t<climbEnd){
  const u=(t-climbStart)/duration;
  airborne=.68*Math.pow(Math.sin(Math.PI*u),1.35);
  fullTurn=twoPi*ease(u); // one rotation, never an endless coin-spin
 }else if(t>=climbEnd){fullTurn=twoPi;}
 // Short inertia-driven recovery, no landing: the artifact never touches ground.
 const tail=Math.max(0,t-climbEnd);
 const settling=t>=climbEnd && t<14
  ? Math.exp(-1.06*tail)*Math.sin(twoPi*1.07*tail)
  : 0;
 const ring=t>=climbEnd&&t<14
  ? Math.exp(-.92*tail)*Math.sin(twoPi*.86*tail)
  :0;
 animatedRock.position.set(
  lateral+.010*ring,
  .59+breath-.052*charge+airborne+.008*settling,
  .008*Math.sin(twoPi*t/clipDuration)+.009*ring
 );
 const pitch=THREE.MathUtils.degToRad(
  2.1*Math.sin(twoPi*t/clipDuration)+9.5*charge+14.0*settling);
 const roll=THREE.MathUtils.degToRad(
  2.3*Math.sin(4*twoPi*t/clipDuration)-4.0*charge+7.0*ring);
 const yaw=THREE.MathUtils.degToRad(
  7*Math.sin(twoPi*t/clipDuration));
 volcanoEuler.set(pitch,yaw,roll,'YXZ');
 volcanoBase.setFromEuler(volcanoEuler);
 volcanoFlip.setFromAxisAngle(volcanoAxis,fullTurn);
 animatedRock.quaternion.copy(volcanoBase).multiply(volcanoFlip);
 const phaseLabel=t<5.6?'Спокойное парение':
  t<climbStart?'Накопление энергии':
  t<climbEnd?'Вулканический выброс':
  t<13.9?'Инерционное затухание':'Восстановление равновесия';
 if($('#phase'))$('#phase').textContent=phaseLabel;
 // Light responds to volcanic activity without touching PBR texture channels.
 lavaLight.intensity=4.0+2.7*charge+3.1*(airborne/.68)+
  .30*Math.sin(twoPi*t/clipDuration);
}

async function load() {
 if(loading)return;
 loading=true;retry.hidden=true;progress.value=0;
 try {
  const data=await download();
  say('Загружено 97.5 МБ. Распаковываю 3D и читаю 4K PBR...');
  const loader=new GLTFLoader();
  const gltf=await loader.parseAsync(data,'');
  stopSound();
  if(root)scene.remove(root);
  emitters=[];hotSampleCount=0;root=gltf.scene;
  scene.add(root);
  // Insert an identity pivot beneath the animated GLB root. This leaves its
  // translation/rotation and morph animation tracks completely intact.
  animatedRock=root.getObjectByName('GZ55_8Sec_ContinuousFloatAndPlume');
  if(!animatedRock)throw new Error('Не найден оригинальный узел Везувия V62');
  // No reparenting and no geometry modification. Only parent pose is animated.
  landingRig=null;
  root.updateMatrixWorld(true);
  const materialMeshes=findMaterialMeshes(root);
  if(materialMeshes.length!==2)throw new Error('Ожидалось 2 слоя трещин, найдено '+materialMeshes.length);
  for(const {mesh,side} of materialMeshes){
   say('Определяю физические источники '+(side==='TOP'?'верхних':'нижних')+' трещин...');
   await new Promise(requestAnimationFrame);
   const sites=crackSites(mesh);
   hotSampleCount+=sites.length;
   makeEmitter(mesh,sites,260,side);
  }
  if(!gltf.animations.length)throw new Error('Не найдена оригинальная анимация Везувия');
  mixer=new THREE.AnimationMixer(root);
  // Preserve only original ash/ember morph animation; strip original
  // 8-second position/quaternion tracks, which caused the rejected coin motion.
  const morphTracks=gltf.animations[0].tracks.filter(track=>
   track.name.endsWith('.morphTargetInfluences'));
  if(!morphTracks.length)throw new Error('В исходнике V62 отсутствуют треки морфинга частиц');
  const morphClip=new THREE.AnimationClip('V62_OriginalParticlesOnly',
    gltf.animations[0].duration,morphTracks);
  mixer.clipAction(morphClip).setLoop(THREE.LoopRepeat,Infinity).play();
  clipDuration=18;
  animationSeconds=0;
  mixer.setTime(0);
  updateVolcanoMotion(0);
  if(audioWanted&&playing)startAudio();
  say('GZ174 SCULPT (V62 source) · GZ174: живое парение → накопление → один выброс → затухание · новая геометрия сколов · UV и PBR без изменений');
  $('#counter').textContent='520 искр';
  $('#source').textContent='V62 · PBR 4K · натуральный каменный торец';
  progress.value=1;
 }catch(e){
  console.error('Vesuvius loader',e);
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
  if(soundSource&&soundContext&&soundContext.state==='running'){
   syncAudioToAnimation();
  }else{
   animationSeconds+=dt*speed;
  }
  if(mixer)mixer.setTime(animationSeconds);
  updateVolcanoMotion(animationSeconds);
 }
 if(emitters.length)tickParticles(animationSeconds);
 controls.update();
 // Use an integer number of pulsations per original 8-second clip;
 // light brightness has exactly the same value at both ends of the loop.
 if(root){
  // Magma brightness is controlled by updateVolcanoMotion().
 }
 renderer.render(scene,camera);
}
requestAnimationFrame(loop);
load();
