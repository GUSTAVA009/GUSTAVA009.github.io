#!/usr/bin/env python3
"""Surgically replace only V60 rim rock albedo/normal; preserve UV, mesh and animations."""
from pathlib import Path
import io,json,math,struct,hashlib,copy
import numpy as np
from scipy.ndimage import gaussian_filter,map_coordinates
from PIL import Image,ImageDraw

R=Path(__file__).resolve().parents[1]
MODEL=R/'zone-artifacts'/'models'
D=R/'zone-artifacts'/'_v62'
D.mkdir(exist_ok=True,parents=True)
parts=sorted(MODEL.glob('Vesuvius_V60_V55Original_DualCrack.part??.bin'))
assert len(parts)==5
raw=b''.join(p.read_bytes() for p in parts)
assert raw[:4]==b'glTF'
version,headerlen=struct.unpack_from('<II',raw,4)
assert version==2 and len(raw)-headerlen==8
jlen,jtag=struct.unpack_from('<I4s',raw,12)
assert jtag==b'JSON'
g=json.loads(raw[20:20+jlen]);original=copy.deepcopy(g)
binhead=20+jlen
blen,btag=struct.unpack_from('<I4s',raw,binhead)
assert btag==b'BIN\x00'
oldbin=raw[binhead+8:binhead+8+blen]
assert len(oldbin)==blen

def decoded_img(index):
    im=g['images'][index];view=g['bufferViews'][im['bufferView']]
    return Image.open(io.BytesIO(oldbin[view['byteOffset']:view['byteOffset']+view['byteLength']])).convert('RGB')
def mat_by_fragment(needle):
    vals=[(i,m) for i,m in enumerate(g['materials']) if needle in m['name']]
    assert len(vals)==1,(needle,vals)
    return vals[0]
def textured_image_for(material,slot):
    tex=material['pbrMetallicRoughness']['baseColorTexture'] if slot=='base' else material[slot]
    return g['textures'][tex['index']]['source']

_,top=mat_by_fragment('M_GZ55_Top_TrueTangentNormals')
_,bottom=mat_by_fragment('M_GZ55_Bottom_TrueTangentNormals')
rimindex,rim=mat_by_fragment('M_GZ55_Rim_CharcoalCooling')
assert 'normalTexture' not in rim
original_top=json.dumps(top,sort_keys=True)
original_bottom=json.dumps(bottom,sort_keys=True)
original_animation=json.dumps(g['animations'],sort_keys=True)
original_mesh=json.dumps(g['meshes'],sort_keys=True)

old_side=decoded_img(textured_image_for(rim,'base'))
top_photo=decoded_img(textured_image_for(top,'base'))
bottom_photo=decoded_img(textured_image_for(bottom,'base'))
top_norm=decoded_img(textured_image_for(top,'normalTexture'))
assert old_side.size==(4096,1024)
assert top_photo.size==(4096,4096) and bottom_photo.size==(4096,4096)
W,H=old_side.size

# Reuse the already-approved REAL rock textures from the top and bottom.
# Side U maps circumference, V is height. Periodic U warping eliminates tile seam.
def source_luminance(im):
    rgb=np.asarray(im,dtype=np.float32)
    value=.27*rgb[:,:,0]+.62*rgb[:,:,1]+.11*rgb[:,:,2]
    warm=(rgb[:,:,0]>rgb[:,:,1]*1.34)&(rgb[:,:,0]>46)
    value[warm]=np.minimum(value[warm],28.0)
    return value
top_lum=source_luminance(top_photo)
bottom_lum=source_luminance(bottom_photo)
u=np.arange(W,dtype=np.float32)[None,:]/W
v=(np.arange(H,dtype=np.float32)[:,None]+.5)/H
tau=np.float32(2*math.pi)
sx_t=(4*u+.054*np.sin(tau*7*u+v*4.0)+.029*np.sin(tau*19*u-v*10)+v*.11)%1
sy_t=(.39+v*.29+.085*np.sin(tau*5*u+v*6.7)+.039*np.sin(tau*17*u-v*4.1))%1
sx_b=(5*u+.039*np.sin(tau*11*u-v*4.3)+.027*np.cos(tau*23*u+v*7.5)+v*.08)%1
sy_b=(.53+v*.24+.072*np.sin(tau*6*u+v*5.8)+.045*np.cos(tau*13*u-v*3.7))%1
def warped(src,uu,vv):
    return map_coordinates(src,[(vv*src.shape[0]).astype(np.float32),
                                (uu*src.shape[1]).astype(np.float32)],order=1,mode='grid-wrap')
rock_top=warped(top_lum,sx_t,sy_t)
rock_bottom=warped(bottom_lum,sx_b,sy_b)
mix=.47+.14*np.sin(tau*3*u+v*9.0)+.09*np.sin(tau*13*u-v*6.6)
mix=np.clip(mix,.19,.79)
rock=rock_top*(1-mix)+rock_bottom*mix
# Physically isotropic stone grain rather than long horizontal grain/printed lines.
rng=np.random.default_rng(62062)
coarse=gaussian_filter(rng.normal(size=(H,W)).astype(np.float32),sigma=(42,9),mode=('reflect','wrap'))
medium=gaussian_filter(rng.normal(size=(H,W)).astype(np.float32),sigma=(14,3),mode=('reflect','wrap'))
fine=gaussian_filter(rng.normal(size=(H,W)).astype(np.float32),sigma=(3.5,.8),mode=('reflect','wrap'))
for arr in [coarse,medium,fine]:
    arr-=arr.mean();arr/=max(1e-6,arr.std())
rock+=3.8*coarse+2.25*medium+.95*fine
rock+=.82*(rock_top-gaussian_filter(rock_top,sigma=(12,3),mode=('reflect','wrap')))
rock=np.clip(rock*1.08-1.8,7,84)
base=np.stack([rock*1.08,rock*1.015,rock*.955],axis=-1).astype(np.uint8)

# Create authentic tangent-space micro-relief from the original normal map plus rock height.
normal_input=np.asarray(top_norm,dtype=np.uint8)
nx_src=warped(normal_input[:,:,0].astype(np.float32),sx_t,sy_t)
ny_src=warped(normal_input[:,:,1].astype(np.float32),sx_t,sy_t)
height=(medium*.00023+coarse*.00030+fine*.000055+rock*.000014).astype(np.float32)
mm_dx=(2*math.pi*.35)/W;mm_dy=.11/H
dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))/(2*mm_dx)
dy=np.gradient(height,mm_dy,axis=0)
nx=(nx_src/127.5-1)*.52-dx*.82
ny=(ny_src/127.5-1)*.52-dy*.58
nz=np.ones_like(nx)
mag=np.sqrt(nx*nx+ny*ny+nz*nz)
normal=np.stack([nx/mag,ny/mag,nz/mag],axis=-1)
normal=np.uint8(np.clip(normal*.5*255+127.5,0,255))

new_jpg=io.BytesIO();Image.fromarray(base,'RGB').save(new_jpg,'JPEG',quality=98,subsampling=0,optimize=True)
new_png=io.BytesIO();Image.fromarray(normal,'RGB').save(new_png,'PNG',compress_level=6)
extra=bytearray(oldbin)
def append_image(name,rawbytes,mime):
    extra.extend(b'\0'*((-len(extra))%4))
    off=len(extra);extra.extend(rawbytes)
    view=len(g['bufferViews'])
    g['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(rawbytes)})
    img=len(g['images'])
    g['images'].append({'name':name,'mimeType':mime,'bufferView':view})
    idx=len(g['textures'])
    sampler=g['textures'][rim['pbrMetallicRoughness']['baseColorTexture']['index']].get('sampler')
    tex={'source':img}
    if sampler is not None:tex['sampler']=sampler
    g['textures'].append(tex)
    return idx
new_albedo=append_image('T_GZ62_Rim_CharcoalRealRock_OriginalTopBottom_4K',new_jpg.getvalue(),'image/jpeg')
new_normal=append_image('T_GZ62_Rim_CharcoalCragNormals_4K',new_png.getvalue(),'image/png')
rim['pbrMetallicRoughness']['baseColorTexture']['index']=new_albedo
rim['normalTexture']={'index':new_normal,'scale':1.0}
rim['pbrMetallicRoughness']['roughnessFactor']=.91
# User-approved molten seam, particles and flip preserved bitwise.
assert json.dumps(top,sort_keys=True)==original_top
assert json.dumps(bottom,sort_keys=True)==original_bottom
assert json.dumps(g['animations'],sort_keys=True)==original_animation
assert json.dumps(g['meshes'],sort_keys=True)==original_mesh
assert g['materials'][rimindex]['emissiveTexture']==original['materials'][rimindex]['emissiveTexture']
for i in range(len(original['bufferViews'])):assert g['bufferViews'][i]==original['bufferViews'][i]
g['buffers'][0]['byteLength']=len(extra)
json_raw=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode('utf8')
json_raw+=b' '*((-len(json_raw))%4)
extra.extend(b'\0'*((-len(extra))%4))
result=b'glTF'+struct.pack('<II',2,12+8+len(json_raw)+8+len(extra))
result+=struct.pack('<I4s',len(json_raw),b'JSON')+json_raw
result+=struct.pack('<I4s',len(extra),b'BIN\0')+extra
assert struct.unpack_from('<I',result,8)[0]==len(result)
assert len(result)<120_000_000

model_name='Vesuvius_V62_OriginalV60_NaturalStoneRim'
full=D/(model_name+'.glb')
full.write_bytes(result)
newparts=[]
for i in range(0,len(result),20_000_000):
    fn=f'{model_name}.part{i//20_000_000+1:02d}.bin'
    b=result[i:i+20_000_000]
    (MODEL/fn).write_bytes(b)
    newparts.append({'name':fn,'size':len(b)})
oldthumb=old_side.copy().resize((880,220))
newthumb=Image.fromarray(base).resize((880,220))
normal_thumb=Image.fromarray(normal).resize((880,220))
cv=Image.new('RGB',(900,830),(21,25,31));draw=ImageDraw.Draw(cv)
for i,(title,im) in enumerate([('V60 ORIGINAL - striped side',oldthumb),
    ('V62 REAL STONE - original top+bottom textures',newthumb),
    ('V62 side 4K normal map',normal_thumb)]):
    y=10+i*272
    draw.text((13,y),title,fill=(239,227,207))
    cv.paste(im,(10,y+26))
cv.save(D/'v62_rim_before_after.jpg',quality=93)
def stripe_metric(image):
    x=np.asarray(image.resize((512,128)).convert('L'),dtype=np.float32)
    return float(np.std(np.mean(x,axis=1)))
report={'result':'PASS_RIM_ONLY_REAL_CHARCOAL_FROM_V60_TOP_BOTTOM',
        'base_glb_sha256':hashlib.sha256(raw).hexdigest(),
        'base_header_error_bytes':len(raw)-headerlen,
        'new_glb_sha256':hashlib.sha256(result).hexdigest(),
        'new_glb_bytes':len(result),'new_glb_header_valid':True,
        'source_models':['V60_TOP_Charcoal4K','V60_BOTTOM_Charcoal4K'],
        'top_material_unchanged':True,'bottom_material_unchanged':True,
        'original_animation_unchanged':True,'original_mesh_uv_unchanged':True,
        'original_rim_lava_unchanged':True,'texture_res':[W,H],
        'albedo_bytes':len(new_jpg.getvalue()),'normal_bytes':len(new_png.getvalue()),
        'old_horizontal_band_metric':stripe_metric(old_side),
        'new_horizontal_band_metric':stripe_metric(Image.fromarray(base)),
        'parts':newparts}
(D/'v62_build_QA.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf8')
print('V62_BUILD_PASS',json.dumps(report,ensure_ascii=False))
