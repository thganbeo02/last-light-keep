"""Render each baked model in sheet coordinates and score it against the artwork.
Run from hero-viewer: python -m authoring.score <aldric sheet> <corwin sheet> [outdir] [hero]
Silhouette is IoU against the painted figure. Paint is the share of overlapping pixels
within 48 RGB of a sheet pixel no more than 2 px away (blocky art punishes 1 px offsets).
Translucent lantern glass is left out, as the viewer draws it at 19% opacity. Writes model | sheet | difference strips to outdir.
"""
from pathlib import Path
import sys
import numpy as np
from PIL import Image
from . import export, mesh
from .export import CFG, barycentric

STOPS={'aldric':[0,467,940,1300,1774],'corwin':[0,446,916,1291,1774]}
QUARTER={'aldric':(730,26),'corwin':(649,23)}

def view_coords(hero,p,view,angle=None):
    cfg=CFG[hero]; x,y,z=p[...,0],p[...,1],p[...,2]
    if view==0: return np.stack((x,y,z),-1)
    if view==1: return np.stack((z,y,-x),-1)
    if view==2: return np.stack((cfg['back']-(x-cfg['front']),y,-z),-1)
    a=np.deg2rad(QUARTER[hero][1] if angle is None else angle)
    u=QUARTER[hero][0]+np.cos(a)*(x-cfg['front'])+np.sin(a)*(z-cfg['side'])
    return np.stack((u,y,np.cos(a)*z-np.sin(a)*x),-1)

def render(hero,tris,uvs,atlas,view,shape,angle=None,skip=None):
    proj=view_coords(hero,tris,view,angle)
    zbuf=np.full(shape,-1e9,np.float32); ids=np.full(shape,-1,np.int32)
    bary=np.zeros(shape+(3,),np.float32)
    for i,tri in enumerate(proj):
        if skip is not None and skip[i]: continue
        x0,y0=np.floor(tri[:,:2].min(0)).astype(int); x1,y1=np.ceil(tri[:,:2].max(0)).astype(int)+1
        x0=max(x0,0); y0=max(y0,0); x1=min(x1,shape[1]); y1=min(y1,shape[0])
        if x1<=x0 or y1<=y0: continue
        yy,xx=np.mgrid[y0:y1,x0:x1]
        w=barycentric(tri[:,:2],xx+.5,yy+.5)
        if w is None: continue
        z=w@tri[:,2]
        hit=(w.min(-1)>=-1e-4)&(z>zbuf[y0:y1,x0:x1])
        zbuf[y0:y1,x0:x1][hit]=z[hit]; ids[y0:y1,x0:x1][hit]=i; bary[y0:y1,x0:x1][hit]=w[hit]
    mask=ids>=0
    uv=np.einsum('nk,nkj->nj',bary[mask],uvs[ids[mask]])
    h,w=atlas.shape[:2]
    out=np.full(shape+(3,),255,np.uint8)
    out[mask]=atlas[np.clip((uv[:,1]*h).astype(int),0,h-1),np.clip((uv[:,0]*w).astype(int),0,w-1)]
    return out,mask

def figure_mask(img):
    lo,hi=img.min(-1).astype(int),img.max(-1).astype(int)
    return ~((lo>226)&(hi-lo<22))

def score(hero,sheet,tris,uvs,atlas,owners,outdir=None):
    skip=np.array([mesh.parts[o][1]=='glass' for o in owners])
    img=np.asarray(Image.open(sheet).convert('RGB'))
    foot=CFG[hero]['foot']+18
    ref=figure_mask(img); ref[foot:]=False
    rows=[]; strips=[]
    for view,name in [(0,'front'),(3,'three-quarter'),(1,'side'),(2,'back')]:
        x0,x1=STOPS[hero][[0,3,1,2].index(view)],STOPS[hero][[0,3,1,2].index(view)+1]
        best=None
        for angle in [None]:  # the viewer turns the model by a fixed angle (QUARTER)
            col,m=render(hero,tris,uvs,atlas,view,img.shape[:2],angle,skip)
            for dx in ([0] if view!=3 else range(-30,31,3)):
                mm=np.roll(m,dx,1)[:,x0:x1]; rr=ref[:,x0:x1]
                iou=(mm&rr).sum()/max(1,(mm|rr).sum())
                if best is None or iou>best[0]: best=(iou,angle,dx,col,m)
        iou,angle,dx,col,m=best
        col=np.roll(col,dx,1)[:,x0:x1]; m=np.roll(m,dx,1)[:,x0:x1]; r=ref[:,x0:x1]; src=img[:,x0:x1]
        both=m&r
        c=col.astype(int); dist=np.full(both.sum(),1e9)
        for oy in range(-2,3):
            for ox in range(-2,3):
                shifted=np.roll(src,(oy,ox),(0,1)).astype(int)
                dist=np.minimum(dist,np.linalg.norm(c[both]-shifted[both],axis=1))
        paint=(dist<48).mean()
        rows.append((name,iou,paint,dist.mean()))
        if view==3: print(f'{hero}: three-quarter fit angle {angle} shift {dx}')
        diff=np.full(src.shape,255,np.uint8)
        diff[m&~r]=(214,64,64); diff[r&~m]=(64,96,214)
        diff[both]=np.clip(255-dist[:,None]*2.2,0,255).astype(np.uint8)
        strips.append(np.vstack([col[:foot],src[:foot],diff[:foot]]))
    print(f'{hero}: '+'  '.join(f'{n} sil {i:.1%} paint {p:.1%}' for n,i,p,_ in rows))
    sil=np.mean([r[1] for r in rows]); paint=np.mean([r[2] for r in rows])
    print(f'{hero}: mean silhouette {sil:.1%}, mean paint {paint:.1%}',flush=True)
    if outdir:
        Path(outdir).mkdir(parents=True,exist_ok=True)
        Image.fromarray(np.hstack(strips)).save(Path(outdir)/f'{hero}-score.png')
    return rows

if __name__=='__main__':
    sheets=sys.argv[1:3]; outdir=sys.argv[3] if len(sys.argv)>3 else None
    only=sys.argv[4] if len(sys.argv)>4 else None
    for hero,path in zip(CFG,sheets,strict=True):
        if only and hero!=only: continue
        tris,uvs,atlas,owners=export.bake(hero,path)
        score(hero,path,tris,uvs,atlas,owners,outdir)
