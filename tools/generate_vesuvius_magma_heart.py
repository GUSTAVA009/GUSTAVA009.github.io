"""Original GUSTAVA Vesuvius Magma Heart SFX. Synthesized, not sampled.
8s 48k stereo seamless loop. Only updates generated audio and current V62 audio reference.
"""
import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import butter,sosfiltfilt
from pathlib import Path
import subprocess,json,math
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'zone-artifacts'/'audio'
OUT.mkdir(parents=True,exist_ok=True)
sr=48000;N=8*sr;t=np.arange(N)/sr;rng=np.random.default_rng(550621)
def band(lo,hi):
 x=rng.normal(size=N)
 sos=butter(3,[lo,hi],btype='bandpass',fs=sr,output='sos')
 pad=12000
 return sosfiltfilt(sos,np.r_[x[-pad:],x,x[:pad]])[pad:pad+N]
def add(bus,at,y,amp=1):
 idx=(round(at*sr)+np.arange(len(y)))%N
 np.add.at(bus,idx,y*amp)
breath=np.interp(t,[0,1.1,2.4,3.5,4.15,4.9,6.2,7.35,8],
 [.55,.71,.54,.87,1,.66,.52,.73,.55])
slow=1+.19*np.sin(2*np.pi*t/8*3-.28)+.11*np.sin(2*np.pi*t/8*5+1.7)
phase=2*np.pi*(44*t+.28*np.sin(2*np.pi*t/8*2)+.06*np.sin(2*np.pi*t/8*5))
sub=(.48*np.sin(phase)+.23*np.sin(phase*2+.8)+.14*np.sin(phase*3+1.4))*breath*slow
bass=band(36,138);bass=bass/np.std(bass)*.11*breath
stone=band(135,750);stone=stone/np.std(stone)
rough=.045*stone*(.68+.32*np.sin(2*np.pi*t/8*4-.4)**2)
crackle=np.zeros(N)
pop_times=[.09,.29,.64,.88,1.24,1.68,1.93,2.15,2.62,2.84,3.04,3.44,3.63,3.82,4,4.19,4.42,4.67,4.94,5.29,5.55,5.82,6.14,6.46,6.84,7.10,7.43,7.78,7.95]
for p in pop_times:
 m=max(64,int(rng.uniform(.009,.052)*sr));tt=np.arange(m)/sr
 f=rng.uniform(1000,3700)
 env=(1-np.exp(-tt*1250))*np.exp(-tt/rng.uniform(.006,.018))
 frag=(np.sin(2*np.pi*f*tt+rng.uniform(0,6))*.3+rng.normal(size=m)*.7)*env
 amp=rng.uniform(.08,.19)*(1.25 if 3.4<p<4.6 else 1)
 add(crackle,p,frag,amp*rng.choice([-1,1]))
for _ in range(115):
 p=float(rng.uniform(0,8))
 if rng.random()<.3:p=float(np.mod(rng.normal(4.05,.5),8))
 m=int(sr*rng.uniform(.002,.009));tt=np.arange(m)/sr
 frag=rng.normal(size=m)*np.exp(-tt/rng.uniform(.00075,.0028))
 add(crackle,p,frag,rng.uniform(.007,.035))
hiss=band(900,6600);hiss/=np.std(hiss)
heat=hiss*.010*np.maximum(.08,.50+.22*np.sin(2*np.pi*t/8*2+.45)+.15*np.sin(2*np.pi*t/8*5-1.3))
sweep=band(180,900);sweep/=np.std(sweep)
sweep*=.06*np.exp(-.5*((t-4.12)/.45)**2)
mono=sub+bass+rough+crackle+heat+sweep
left=mono+.036*np.roll(rough,683)+.06*np.roll(crackle,816)
right=mono+.04*np.roll(rough,1009)+.062*np.roll(crackle,1182)
pan=.055*np.sin(2*np.pi*t/8+1.4)
audio=np.column_stack([left*(1-pan),right*(1+pan)])
audio-=np.mean(audio,axis=0)
fade=round(sr*.052);w=np.linspace(0,1,fade)[:,None];sm=w*w*(3-2*w)
audio[-fade:]-=(audio[-1]-audio[0])[None,:]*sm
meter=pyln.Meter(sr)
audio=pyln.normalize.loudness(audio,float(meter.integrated_loudness(audio)),-27.5)
peak=float(np.max(np.abs(audio)))
if peak>.47:audio*=.47/peak
assert np.max(np.abs(audio[0]-audio[-1]))<1e-7
wav=OUT/'Vesuvius_Magma_Heart_Original_8s_48k24.wav'
ogg=OUT/'Vesuvius_Magma_Heart_Original_8s.ogg'
mp3=OUT/'Vesuvius_Magma_Heart_Preview.mp3'
sf.write(wav,audio,sr,subtype='PCM_24')
for file,codec,args in [(ogg,'libvorbis',['-q:a','6']),(mp3,'libmp3lame',['-q:a','2'])]:
 subprocess.run(['ffmpeg','-nostats','-hide_banner','-loglevel','error','-y','-i',str(wav),'-c:a',codec,*args,str(file)],check=True)
measured=float(meter.integrated_loudness(audio))
assert measured<-24.0
qa={'result':'PASS_ORIGINAL_MAGMA_HEART_SFX','duration_s':8,'channels':2,'sr':48000,
    'lufs':round(measured,2),'peak_dBFS':round(20*np.log10(np.max(np.abs(audio))),2),
    'loop_boundary_delta':float(np.max(np.abs(audio[0]-audio[-1]))),
    'files':{p.name:p.stat().st_size for p in [wav,ogg,mp3]}}
(OUT/'Vesuvius_Magma_Heart_QA.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf8')
print('MAGMA_HEART_QA',json.dumps(qa,ensure_ascii=False))
