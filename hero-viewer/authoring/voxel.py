"""Voxel rebuild: fill the modeled shapes into a cube grid and give every surface cube one
solid colour from the drawing that sees it. Cubes cannot stretch paint across slanted or
hidden faces, so the model reads the same from any angle.
Run from hero-viewer: python -m authoring.voxel <hero> <sheet> [cube px] [palette size, 0 for none]
Writes assets/<hero>-voxel.glb.
"""
from pathlib import Path
import json, struct, sys
import numpy as np
from PIL import Image
from collections import deque
from . import mesh, aldric, corwin
from .export import CFG, ASSETS
from .fit import apply

def occupancy(hero,v):
    mesh.parts.clear(); (aldric if hero=='aldric' else corwin).build(); apply(hero,mesh.parts)
    tris=np.array([t for _,finish,faces in mesh.parts if finish!='glass' for t in faces])
    pts=tris.reshape(-1,3)
    lo=np.floor(pts.min(0)/v)*v-v; hi=np.ceil(pts.max(0)/v)*v+v
    shape=tuple(((hi-lo)/v).astype(int)+1)
    shell=np.zeros(shape,bool)
    # Sample every triangle at half a voxel and mark the cubes it passes through.
    for a,b,c in tris:
        n=int(np.ceil(max(np.linalg.norm(b-a),np.linalg.norm(c-a),np.linalg.norm(c-b))/(v/2)))+1
        i,j=np.mgrid[0:n+1,0:n+1]; keep=i+j<=n
        u,w=i[keep]/n,j[keep]/n
        p=a+np.outer(u,b-a)+np.outer(w,c-a)
        idx=((p-lo)/v).astype(int)
        shell[idx[:,0],idx[:,1],idx[:,2]]=True
    # Everything the outside cannot reach is solid.
    outside=np.zeros(shape,bool); q=deque([(0,0,0)]); outside[0,0,0]=True
    while q:
        x,y,z=q.popleft()
        for dx,dy,dz in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
            X,Y,Z=x+dx,y+dy,z+dz
            if 0<=X<shape[0] and 0<=Y<shape[1] and 0<=Z<shape[2] and not outside[X,Y,Z] and not shell[X,Y,Z]:
                outside[X,Y,Z]=True; q.append((X,Y,Z))
    return ~outside,lo

def colours(hero,occ,lo,v,img):
    cfg=CFG[hero]
    nx,ny,nz=occ.shape
    pad=np.pad(occ,1)
    surface=occ&~(pad[2:,1:-1,1:-1]&pad[:-2,1:-1,1:-1]&pad[1:-1,2:,1:-1]&pad[1:-1,:-2,1:-1]&pad[1:-1,1:-1,2:]&pad[1:-1,1:-1,:-2])
    centre=lambda a,axis:lo[axis]+(a+.5)*v
    col=np.zeros(occ.shape+(3,)); known=np.zeros(occ.shape,bool); weight=np.zeros(occ.shape)
    lum=img.min(-1).astype(int); spread=img.max(-1).astype(int)-lum
    background=(lum>226)&(spread<22)
    def sample(sx,sy):
        h=v/2
        x0,x1=int(round(sx-h)),int(round(sx+h)); y0,y1=int(round(sy-h)),int(round(sy+h))
        if x0<0 or y0<0 or x1>img.shape[1] or y1>img.shape[0]: return None
        block=img[y0:y1,x0:x1].reshape(-1,3); ok=~background[y0:y1,x0:x1].reshape(-1)
        if ok.sum()<block.shape[0]*.6: return None
        return np.median(block[ok],axis=0)
    has=occ.any
    # First solid cube along each view's ray. Front looks down -z, back up +z, side from -x.
    views=[]
    front=np.where(has(2),nz-1-np.argmax(occ[:,:,::-1],axis=2),-1)
    back=np.where(has(2),np.argmax(occ,axis=2),-1)
    side=np.where(has(0),np.argmax(occ,axis=0),-1)
    exposed=lambda i,j,k,d:not pad[1+i+d[0],1+j+d[1],1+k+d[2]]
    for i in range(nx):
        for j in range(ny):
            for k,(sx_fn,d,w) in ((front[i,j],(lambda i,j,k:(centre(i,0),centre(j,1)),(0,0,1),1.0)),
                                 (back[i,j],(lambda i,j,k:(cfg['back']-(centre(i,0)-cfg['front']),centre(j,1)),(0,0,-1),.9))):
                if k<0: continue
                s=sx_fn(i,j,k)
                c=sample(*s)
                score=w*(1 if exposed(i,j,k,d) else .4)
                if c is not None and score>weight[i,j,k]: col[i,j,k]=c; weight[i,j,k]=score; known[i,j,k]=True
    for j in range(ny):
        for k in range(nz):
            i=side[j,k]
            if i<0: continue
            c=sample(centre(k,2),centre(j,1))
            score=.95*(1 if exposed(i,j,k,(-1,0,0)) else .4)
            if c is not None and score>weight[i,j,k]: col[i,j,k]=c; weight[i,j,k]=score; known[i,j,k]=True
    # Unseen cubes copy the nearest seen cube's colour (no averaging, which invents
    # in-between shades). Nearest is by straight-line distance through the grid.
    from scipy.ndimage import distance_transform_edt
    _,(ii,jj,kk)=distance_transform_edt(~known,return_indices=True)
    fill=occ&~known
    col[fill]=col[ii[fill],jj[fill],kk[fill]]
    return col,surface

def faces(occ,col,lo,v):
    pad=np.pad(occ,1)
    quads=[]; colors=[]; normals=[]
    corners={  # outward normal -> quad corners in unit-cube coords, counter-clockwise from outside
        (1,0,0):[(1,0,0),(1,1,0),(1,1,1),(1,0,1)], (-1,0,0):[(0,0,0),(0,0,1),(0,1,1),(0,1,0)],
        (0,1,0):[(0,1,0),(0,1,1),(1,1,1),(1,1,0)], (0,-1,0):[(0,0,0),(1,0,0),(1,0,1),(0,0,1)],
        (0,0,1):[(0,0,1),(1,0,1),(1,1,1),(0,1,1)], (0,0,-1):[(0,0,0),(0,1,0),(1,1,0),(1,0,0)]}
    idx=np.argwhere(occ)
    for d,cs in corners.items():
        nb=pad[idx[:,0]+1+d[0],idx[:,1]+1+d[1],idx[:,2]+1+d[2]]
        sel=idx[~nb]
        if not len(sel): continue
        base=lo+sel*v
        quads.append(base[:,None,:]+np.array(cs)[None]*v)
        colors.append(col[sel[:,0],sel[:,1],sel[:,2]])
        normals.append(np.repeat([d],len(sel),0))
    return np.concatenate(quads),np.concatenate(colors),np.concatenate(normals)

def write_glb(hero,quads,colors,normals,path):
    cfg=CFG[hero]; scale=1.8/(cfg['foot']-cfg['top'])
    pos=((quads-[cfg['front'],cfg['foot'],cfg['side']])*[scale,-scale,scale]).reshape(-1,3).astype('<f4')
    nrm=np.repeat((normals*[1,-1,1]).astype('<f4'),4,0)
    srgb=np.clip(colors/255,0,1)
    linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
    rgb=np.repeat(np.c_[np.rint(linear*255),np.full(len(linear),255)].astype('u1'),4,0)
    n=len(quads)
    # Wind each quad so its triangles face along the cube face's outward normal.
    p=pos.reshape(n,4,3); out=(normals*[1,-1,1])
    ccw=np.einsum('ij,ij->i',np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),out)>0
    order=np.where(ccw[:,None],[0,1,2,0,2,3],[0,2,1,0,3,2])
    ind=(np.arange(n)[:,None]*4+order).reshape(-1).astype('<u4')
    data=bytearray(); views=[]; acc=[]
    def add(arr,kind,ctype,target=34962,bounds=False,normalized=False):
        while len(data)%4: data.append(0)
        views.append(dict(buffer=0,byteOffset=len(data),byteLength=arr.nbytes,target=target)); data.extend(arr.tobytes())
        a=dict(bufferView=len(views)-1,componentType=ctype,count=arr.shape[0] if arr.ndim>1 else arr.size,type=kind)
        if bounds: a.update(min=arr.min(0).tolist(),max=arr.max(0).tolist())
        if normalized: a['normalized']=True
        acc.append(a); return len(acc)-1
    attrs=dict(POSITION=add(pos,'VEC3',5126,bounds=True),NORMAL=add(nrm,'VEC3',5126),COLOR_0=add(rgb,'VEC4',5121,normalized=True))
    indices=add(ind,'SCALAR',5125,34963)
    doc=dict(asset=dict(version='2.0',generator='Last Light Keep • voxel rebuild'),scene=0,scenes=[dict(nodes=[0])],
             nodes=[dict(name=hero.title(),mesh=0)],
             meshes=[dict(name=hero.title()+' voxels',primitives=[dict(attributes=attrs,indices=indices,material=0)])],
             materials=[dict(name='voxel paint',pbrMetallicRoughness=dict(metallicFactor=0,roughnessFactor=.92))],
             buffers=[dict(byteLength=len(data))],bufferViews=views,accessors=acc)
    meta=json.dumps(doc,separators=(',',':')).encode(); meta+=b' '*(-len(meta)%4); data+=b'\0'*(-len(data)%4)
    out=struct.pack('<4sII',b'glTF',2,28+len(meta)+len(data))+struct.pack('<I4s',len(meta),b'JSON')+meta+struct.pack('<I4s',len(data),b'BIN\0')+data
    Path(path).write_bytes(out)

def palette(hero,img,k=32,seed=7):
    # Voxel art uses a limited palette. Learn it from the figure so anti-aliased
    # blends and in-between shades snap to clean, flat cube colours.
    lum=img.min(-1).astype(int); spread=img.max(-1).astype(int)-lum
    fig=~((lum>226)&(spread<22)); fig[CFG[hero]['foot']+18:]=False
    px=img[fig].astype(float)
    rng=np.random.default_rng(seed); px=px[rng.choice(len(px),min(len(px),60000),replace=False)]
    c=px[rng.choice(len(px),k,replace=False)]
    for _ in range(25):
        lab=np.argmin(((px[:,None]-c[None])**2).sum(-1),1)
        c=np.array([px[lab==i].mean(0) if (lab==i).any() else c[i] for i in range(k)])
    return c

def build(hero,sheet,v=4,k=32):
    img=np.asarray(Image.open(sheet).convert('RGB'))
    occ,lo=occupancy(hero,v)
    col,surface=colours(hero,occ,lo,v,img)
    if k:
        pal=palette(hero,img,k)
        flat=col[occ]
        col[occ]=pal[np.argmin(((flat[:,None]-pal[None])**2).sum(-1),1)]
    quads,colors,normals=faces(occ,col,lo,v)
    write_glb(hero,quads,colors,normals,ASSETS/f'{hero}-voxel.glb')
    print(f'{hero}: {occ.sum()} cubes, {len(quads)} faces, {(ASSETS/f"{hero}-voxel.glb").stat().st_size/1e6:.1f} MB',flush=True)
    return quads,colors

if __name__=='__main__':
    build(sys.argv[1],sys.argv[2],float(sys.argv[3]) if len(sys.argv)>3 else 4,int(sys.argv[4]) if len(sys.argv)>4 else 32)
