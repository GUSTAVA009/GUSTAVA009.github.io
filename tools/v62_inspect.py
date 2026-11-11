from pathlib import Path
import io,json,struct,hashlib
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1]
parts=sorted((R/'zone-artifacts/models').glob('Vesuvius_V60_V55Original_DualCrack.part??.bin'))
assert len(parts)==5,f'Missing V60 GLB parts {len(parts)}'
raw=b''.join(p.read_bytes() for p in parts)
assert raw[:4]==b'glTF'
version,total=struct.unpack_from('<II',raw,4)
print("V62_HEADER",{"version":version,"header_total":total,"joined_size":len(raw),"part_sizes":[p.stat().st_size for p in parts]},flush=True)
assert version==2 and total in (len(raw),len(raw)-8)
print('KNOWN_V60_HEADER_OFF_BY',len(raw)-total,flush=True)
jsize,jtype=struct.unpack_from('<I4s',raw,12)
assert jtype==b'JSON'
g=json.loads(raw[20:20+jsize])
off=20+jsize
bsize,btype=struct.unpack_from('<I4s',raw,off)
assert btype==b'BIN\x00'
blob=memoryview(raw)[off+8:off+8+bsize]
def image_by_index(idx):
    v=g['bufferViews'][g['images'][idx]['bufferView']]
    return Image.open(io.BytesIO(blob[v['byteOffset']:v['byteOffset']+v['byteLength']])).convert('RGB')
def describe_texture(idx):
    im_idx=g['textures'][idx].get('source')
    if im_idx is None:return {'texture_index':idx,'no_source':True}
    im=g['images'][im_idx]
    return {'texture_index':idx,'image_index':im_idx,'name':im.get('name'),'mime':im.get('mimeType'),'resolution':list(image_by_index(im_idx).size)}
mats=[]
for i,m in enumerate(g['materials']):
    item={'index':i,'name':m.get('name'),'doubleSided':m.get('doubleSided'),'emissiveFactor':m.get('emissiveFactor')}
    for key,tex in [('baseColor',m.get('pbrMetallicRoughness',{}).get('baseColorTexture')),
                    ('metalRough',m.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture')),
                    ('normal',m.get('normalTexture')),('emission',m.get('emissiveTexture'))]:
        if tex is not None:item[key]=describe_texture(tex['index'])
    mats.append(item)
meshes=[]
for j,m in enumerate(g['meshes']):
    a=[]
    for k,prim in enumerate(m.get('primitives',[])):
        mat=prim.get('material')
        a.append({'primitive':k,'material':mat,'material_name':g['materials'][mat].get('name') if mat is not None else None,
                  'attributes':prim.get('attributes'),'indices':prim.get('indices')})
    meshes.append({'index':j,'name':m.get('name'),'primitives':a})
out=R/'zone-artifacts'/'_v62';out.mkdir(exist_ok=True,parents=True)
info={'GLB_total_bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'materials':mats,'meshes':meshes,
      'animations':[x.get('name') for x in g.get('animations',[])],
      'images':[i.get('name') for i in g.get('images',[])],
      'nodes':[{'name':x.get('name'),'mesh':x.get('mesh'),'children':x.get('children',[])} for x in g.get('nodes',[])]}
(out/'v60_asset_inspect.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf8')
thumbs=[]
for mat in mats:
    if not any(x in mat['name'] for x in ['Top_','Bottom_','Rim_']):continue
    for cat in ['baseColor','normal','emission']:
        if cat not in mat:continue
        im=image_by_index(mat[cat]['image_index']);size=im.size
        im.thumbnail((420,270))
        thumbs.append((mat['name']+' '+cat+' '+str(size),im.copy()))
if thumbs:
    canvas=Image.new('RGB',(900,((len(thumbs)+1)//2)*320),(26,30,34));draw=ImageDraw.Draw(canvas)
    for i,(name,im) in enumerate(thumbs):
        x=(i%2)*450+10;y=(i//2)*320+10
        draw.text((x,y),name[:53],fill=(242,233,220))
        canvas.paste(im,(x,y+25))
    canvas.save(out/'v60_source_materials.jpg',quality=91)
print('V62_INSPECTION',json.dumps({'total':len(raw),'sha256':info['sha256'],'materials':mats,'meshes':meshes,'thumb_count':len(thumbs)},ensure_ascii=False))
