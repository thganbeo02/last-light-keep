"""Bake the sheet paint onto fixed UVs, then write two independent glTF 2.0 binaries.
Run from hero-viewer with python -m authoring.export <aldric sheet> <corwin sheet>.
Requires Pillow and NumPy. No viewer-time projection or camera-dependent materials.
"""
from pathlib import Path
import io, json, struct, sys
import numpy as np
from PIL import Image
from . import mesh, aldric, corwin
from .registration import quarter_x
from .details import finish_part
from .surface import paint

CFG={
    "aldric": dict(front=248,side=1134,back=1554,foot=730,top=61,crops=[(9,6,463,786),(478,6,932,786),(882,6,1336,786),(1323,6,1777,786)]),
    "corwin": dict(front=211,side=1050,back=1542,foot=774,top=79,crops=[(0,27,454,827),(455,27,909,827),(873,27,1327,827),(1308,27,1762,827)])
}
SWATCH={"iron":(127,113,113),"silver":(164,146,134),"blue":(74,76,109),"leather":(86,56,43),"skin":(202,137,99),"hair":(66,46,43),"silverhair":(140,128,126),"gold":(198,139,55),"dark":(61,44,39),"plum":(69,52,61),"linen":(194,158,132),"trim":(121,80,61),"bronze":(165,98,36),"shield":(99,94,114),"amber":(255,149,19),"glass":(255,164,49),"coal":(255,100,14)}
METAL={"iron":.20,"silver":.22,"gold":.28,"bronze":.24,"shield":.14}
ASSETS=Path(__file__).resolve().parents[1]/"assets"

def barycentric(tri,x,y):
    a,b,c=tri
    ab,ac=b-a,c-a
    det=ab[0]*ac[1]-ab[1]*ac[0]
    if abs(det)<1e-6: return None
    u=((x-a[0])*ac[1]-(y-a[1])*ac[0])/det
    v=(ab[0]*(y-a[1])-ab[1]*(x-a[0]))/det
    return np.stack((1-u-v,u,v),axis=-1)

def project(p,cfg,view):
    x,y,z=p.T
    if view==0: return np.stack((x,y,z),axis=1)
    if view==1: return np.stack((z,y,-x),axis=1)
    if view==3:
        u=quarter_x('aldric' if cfg['front']==248 else 'corwin',p)
        return np.stack((u,y,.883*z-.469*x),axis=1)
    return np.stack((cfg['back']-(x-cfg['front']),y,-z),axis=1)

def bake(hero,source):
    cfg=CFG[hero]
    sheet=Image.open(source).convert("RGB")
    if sheet.size != (1774,887):
        raise ValueError("Model landmarks require the original 1774 × 887 reference sheet.")
    for i,box in enumerate(cfg['crops']):
        # Exclude the neighboring silhouette and palette from the margins.
        stops=([0,467,940,1300,1774] if hero=='aldric' else [0,446,916,1291,1774])
        crop=Image.new("RGB",(box[2]-box[0],box[3]-box[1]),"white")
        left=max(stops[i],box[0]); right=min(stops[i+1],box[2])
        bottom=min(cfg['foot']+17,box[3])
        crop.paste(sheet.crop((left,box[1],right,bottom)),(left-box[0],0))
        crop.save(ASSETS/f"{hero}-{i}.webp",quality=94,method=6)
    img=np.asarray(sheet)
    mesh.parts.clear()
    (aldric if hero=='aldric' else corwin).build()
    from .fit import apply
    apply(hero,mesh.parts)
    faces=[]; owners=[]; materials=[]
    for j,(name,finish,triangles) in enumerate(mesh.parts):
        for tri in triangles:
            if np.linalg.norm(np.cross(tri[1]-tri[0],tri[2]-tri[0]))>.05:
                faces.append(tri); owners.append(j); materials.append(finish)
    tris=np.array(faces)
    normal=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
    normal/=np.linalg.norm(normal,axis=1)[:,None]
    # Pack a local, planar UV island per hard facet. A two-pixel gutter carries edge color into mip levels.
    uvlocal=[]; sizes=[]
    for tri in tris:
        d1,d2=tri[1]-tri[0],tri[2]-tri[0]
        basis=d1/np.linalg.norm(d1)
        u=d2@basis
        v=np.linalg.norm(d2-u*basis)
        uv=np.array([[0,0],[np.linalg.norm(d1),0],[u,v]])*.95
        uv-=uv.min(axis=0)
        uvlocal.append(uv+2.5)
        sizes.append(np.ceil(uv.max(axis=0)).astype(int)+6)
    width=2048
    locations=[None]*len(tris)
    x=y=row=0
    for i in sorted(range(len(tris)),key=lambda i:-sizes[i][1]):
        w,h=sizes[i]
        if x+w>width: y+=row; x=row=0
        locations[i]=(x,y); x+=w; row=max(row,h)
    height=y+row
    atlas=np.zeros((height,width,3),np.uint8)
    uvout=[]
    mantle_edges={}
    bounds=[]
    for j,(name,_,faces) in enumerate(mesh.parts):
        if name.startswith("Layered shoulder mantle"):
            # The lower cap fan follows the 32 stations of the hem in angular order.
            mantle_edges[j]=np.array([f[1] for f in faces[32:64]])
        points=np.concatenate(faces)
        bounds.append((points.min(0),points.max(0)))
    for i,tri in enumerate(tris):
        w,h=sizes[i]; x,y=locations[i]
        yy,xx=np.mgrid[0:h,0:w]
        weights=barycentric(uvlocal[i],xx+.5,yy+.5)
        weights=np.maximum(0,weights)
        weights/=weights.sum(axis=-1,keepdims=True)
        world=weights@tri
        finish=materials[i]
        name=mesh.parts[owners[i]][0]
        color=paint(name,finish,world,tri,bounds[owners[i]],SWATCH[finish],img,mantle_edges.get(owners[i]))
        if name in ("Angular face","Scarred face","Squared beard","Short black beard",
                    "Heavy brow","Angled brow","Moustache","Ear","Grey sideburn","Silver temple streak","Hood lining"):
            color=finish_part(hero,name,finish,world,normal[i],img,color)
        atlas[y:y+h,x:x+w]=np.clip(color,0,255).astype(np.uint8)
        uvout.append((uvlocal[i]+[x,y])/[width,height])
    encoded=io.BytesIO()
    Image.fromarray(atlas).save(encoded,format="JPEG",quality=94,subsampling=0,optimize=True)
    glb(hero,cfg,tris,np.array(uvout),np.asarray(owners),encoded.getvalue())
    print(hero,len(mesh.parts),"parts,",len(tris),"triangles, atlas",atlas.shape,flush=True)
    return tris,np.array(uvout),atlas,np.asarray(owners)

def glb(hero,cfg,tris,uvs,owners,jpg):
    data=bytearray(); views=[]; access=[]; mats=[]; meshes=[]; nodes=[]
    def view(b):
        while len(data)%4: data.append(0)
        idx=len(views); views.append(dict(buffer=0,byteOffset=len(data),byteLength=len(b)))
        data.extend(b); return idx
    image=view(jpg)
    def attribute(a,kind,bounds=False):
        a=np.ascontiguousarray(a,dtype='<f4')
        ac=dict(bufferView=view(a.tobytes()),componentType=5126,count=len(a),type=kind)
        if bounds: ac.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        idx=len(access); access.append(ac); return idx
    scale=1.8/(cfg['foot']-cfg['top'])
    matids={}
    positions=[]
    for j,(name,finish,_) in enumerate(mesh.parts):
        if finish not in matids:
            matids[finish]=len(mats)
            pbr=dict(baseColorTexture=dict(index=0),metallicFactor=METAL.get(finish,0),roughnessFactor=.7 if finish in METAL else .94)
            m=dict(name=finish,pbrMetallicRoughness=pbr,doubleSided=True)
            if finish=='glass':
                pbr['baseColorFactor']=[1,1,1,.19]; m['alphaMode']='BLEND'
                m.update(emissiveFactor=[.40,.12,.008])
            if finish=='amber':
                m.update(alphaMode="BLEND",emissiveTexture=dict(index=0),emissiveFactor=[.89,.48,.04])
                pbr["baseColorFactor"]=[1,1,1,.65]
            if finish=='coal':
                m.update(emissiveTexture=dict(index=0),emissiveFactor=[.18,.075,.018])
            mats.append(m)
        mask=owners==j
        pos=(tris[mask]-[cfg['front'],cfg['foot'],cfg['side']])*[scale,-scale,scale]
        # Orient closed solids outward for correct lighting in standard glTF readers.
        normals=np.cross(pos[:,1]-pos[:,0],pos[:,2]-pos[:,0])
        center=np.mean(pos.reshape(-1,3),axis=0)
        reverse=np.sum(normals*(pos.mean(axis=1)-center),axis=1)<0
        pos[reverse]=pos[reverse][:,[0,2,1]]
        uv=uvs[mask].copy(); uv[reverse]=uv[reverse][:,[0,2,1]]
        normals=np.cross(pos[:,1]-pos[:,0],pos[:,2]-pos[:,0])
        normals/=np.linalg.norm(normals,axis=1)[:,None]
        positions.append(pos.reshape(-1,3))
        attr=dict(POSITION=attribute(positions[-1],'VEC3',True),NORMAL=attribute(normals.repeat(3,axis=0),'VEC3'),TEXCOORD_0=attribute(uv.reshape(-1,2),'VEC2'))
        meshes.append(dict(name=name,primitives=[dict(attributes=attr,material=matids[finish])]))
        nodes.append(dict(name=name,mesh=j))
    root=len(nodes); nodes.append(dict(name=hero.title(),children=list(range(root))))
    doc=dict(asset=dict(version='2.0',generator='Last Light Keep • sheet reconstruction'),scene=0,scenes=[dict(nodes=[root])],nodes=nodes,meshes=meshes,materials=mats,images=[dict(bufferView=image,mimeType='image/jpeg')],textures=[dict(source=0,sampler=0)],samplers=[dict(magFilter=9729,minFilter=9987,wrapS=33071,wrapT=33071)],buffers=[dict(byteLength=len(data))],bufferViews=views,accessors=access)
    if hero=="aldric":
        from .motion import animate
        animate(doc,mesh.parts,positions,attribute)
        doc["buffers"][0]["byteLength"]=len(data)
    meta=json.dumps(doc,separators=(',',':')).encode()
    meta+=b' '*(-len(meta)%4); data+=b'\0'*(-len(data)%4)
    out=struct.pack('<4sII',b'glTF',2,28+len(meta)+len(data))+struct.pack('<I4s',len(meta),b'JSON')+meta+struct.pack('<I4s',len(data),b'BIN\0')+data
    assert len(out)==struct.unpack_from('<I',out,8)[0]
    assert np.isfinite(tris).all() and np.isfinite(uvs).all()
    assert uvs.min()>=0 and uvs.max()<=1
    assert len(meshes)>=len(mesh.parts) and all("uri" not in image for image in doc["images"])
    (ASSETS/f'{hero}.glb').write_bytes(out)

if __name__=='__main__':
    for hero,path in zip(CFG,sys.argv[1:],strict=True): bake(hero,path)
