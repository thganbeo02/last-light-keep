"""Nudge each modeled assembly so the front, side and back silhouettes match the sheet.
Run from hero-viewer: python -m authoring.fit <hero> <sheet>. Writes authoring/fit-<hero>.json,
which export.bake applies after building. Moves are small (at most 8 px, 8% scale) so the
modeled structure stays as authored; the three-quarter view is left out because the
painted pose is not a rigid turn of the other views.
"""
from pathlib import Path
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from . import mesh, aldric, corwin
from .export import CFG
from .score import view_coords, figure_mask, STOPS

HERE=Path(__file__).resolve().parent
MAX_MOVE,MAX_SCALE=8,.08
# Connected pieces move together, so a fit can never part a hand from its grip or a
# cuff from its forearm. Sided assemblies are fitted separately per side.
ALDRIC_ARM=('Leather sleeve','Upper arm plate','Elbow cop','Vambrace','Gauntlet cuff')
ALDRIC_LEG=('Boot sole','Square toe and heel','Boot instep strap','Greave','Greave cuff','Quilted cuisse','Overlapping thigh lame')
ASSEMBLIES={
    'aldric':[('shield',False,lambda n:'shield' in n.lower()),
              ('sword',False,lambda n:'scabbard' in n.lower() or n in ('Sword grip','Sword pommel','Sword crossguard')),
              ('face',False,lambda n:n in ('Angular face','Ear','Heavy brow','Nose','Squared beard','Moustache','Grey sideburn','Neck')),
              ('hair',False,lambda n:n in ('Hair mass','Swept crown lock','Nape lock','Silver temple streak')),
              ('torso',False,lambda n:n in ('Heraldic surcoat','Torn tabard skirt','Sword belt','Brass belt buckle','Buckle tongue','Sloped cuirass flank')),
              ('pauldron',False,lambda n:n in ('Domed pauldron','Pauldron bound lip','Pauldron lozenge')),
              ('arm',True,lambda n:n in ALDRIC_ARM or 'auntlet' in n),
              ('leg',False,lambda n:n in ALDRIC_LEG)],
    'corwin':[('lantern arm',False,lambda n:any(k in n.lower() for k in ('lantern','rail','chimney','cage','glass','coal','hanger','swivel','rivet'))
                                          or n in ('Gripping finger','Gripping thumb','Raised forearm','Raised wrist wrap','Bent sleeve')),
              ('hood',False,lambda n:'hood' in n.lower() or 'fringe' in n or 'curl' in n),
              ('face',False,lambda n:n in ('Scarred face','Angled brow','Hooked nose','Short black beard','Moustache','Neck')),
              ('near arm',False,lambda n:n.startswith('Resting') or n in ('Scarred upper arm','Overlapping linen binding')),
              ('skirt',False,lambda n:n.startswith('Scorched skirt panel')),
              ('stole',False,lambda n:'stole' in n),
              ('belt',False,lambda n:n in ('Double leather belt','Square brass chain link')),
              ('leg',True,lambda n:n in ('Leather boot','Block heel and outsole','Ankle strap','Boot tongue'))],
}

def groups(hero,parts):
    center=CFG[hero]['front']
    keys=[]
    for name,finish,faces in parts:
        side='near' if np.concatenate(faces)[:,0].mean()<center else 'far'
        match=next(((g,sided) for g,sided,m in ASSEMBLIES[hero] if m(name)),None)
        if match is None: key=f'{name} ({side})'
        else: key=f'{match[0]} ({side})' if match[1] else match[0]
        keys.append(key)
    return keys

def transform(faces,params,center):
    dx,dy,dz,sx,sy,sz=params
    return [(f-center)*[sx,sy,sz]+center+[dx,dy,dz] for f in faces]

def apply(hero,parts):
    path=HERE/f'fit-{hero}.json'
    if not path.exists(): return
    fit=json.loads(path.read_text())
    keys=groups(hero,parts)
    for key in set(keys):
        if key not in fit: continue
        idx=[i for i,k in enumerate(keys) if k==key]
        pts=np.concatenate([np.concatenate(parts[i][2]) for i in idx])
        center=(pts.min(0)+pts.max(0))/2
        for i in idx:
            name,finish,faces=parts[i]
            parts[i]=(name,finish,transform(faces,fit[key],center))

def raster(tris,hero,view):
    p=view_coords(hero,np.asarray(tris),view)[...,:2]
    lo=np.floor(p.reshape(-1,2).min(0)).astype(int)-1; hi=np.ceil(p.reshape(-1,2).max(0)).astype(int)+2
    img=Image.new('1',tuple(hi-lo),0); d=ImageDraw.Draw(img)
    for t in p-lo: d.polygon([tuple(v) for v in t],fill=1)
    return lo,np.asarray(img)

def fit(hero,sheet):
    mesh.parts.clear(); (aldric if hero=='aldric' else corwin).build()
    parts=[p for p in mesh.parts]
    keys=groups(hero,parts)
    names=sorted(set(keys),key=keys.index)
    img=np.asarray(Image.open(sheet).convert('RGB'))
    ref=figure_mask(img); ref[CFG[hero]['foot']+18:]=False
    views=[(0,0),(1,2),(2,3)]
    shape=img.shape[:2]
    gtris={};gcenter={}
    for key in names:
        tris=[t for i,k in enumerate(keys) if k==key for t in parts[i][2] if parts[i][1]!='glass']
        gtris[key]=np.array(tris) if tris else np.zeros((0,3,3))
        pts=np.concatenate([np.concatenate(parts[i][2]) for i,k in enumerate(keys) if k==key])
        gcenter[key]=(pts.min(0)+pts.max(0))/2
    params={k:np.array([0,0,0,1,1,1.]) for k in names}
    def masks(key,prm):
        if not len(gtris[key]): return [None]*3
        t=np.array(transform(list(gtris[key]),prm,gcenter[key]))
        return [raster(t,hero,v) for v,_ in views]
    count=[np.zeros(shape,np.int16) for _ in views]
    def paint(c,m,sign):
        if m is None: return
        (x0,y0),a=m; h,w=a.shape
        ys,xs=slice(max(0,y0),min(shape[0],y0+h)),slice(max(0,x0),min(shape[1],x0+w))
        c[ys,xs]+=sign*a[ys.start-y0:ys.stop-y0,xs.start-x0:xs.stop-x0]
    current={k:masks(k,params[k]) for k in names}
    for k in names:
        for c,m in zip(count,current[k]): paint(c,m,1)
    strips=[slice(STOPS[hero][s],STOPS[hero][s+1]) for _,s in views]
    def stats():
        out=[]
        for c,st in zip(count,strips):
            u=c[:,st]>0; r=ref[:,st]
            out.append([(u&r).sum(),u.sum(),r.sum()])
        return np.array(out,float)
    S=stats()
    iou=lambda S:np.mean(S[:,0]/(S[:,1]+S[:,2]-S[:,0]))
    def trial(key,prm):
        new=masks(key,prm); T=S.copy()
        for vi,(c,st) in enumerate(zip(count,strips)):
            old=current[key][vi]; nm=new[vi]
            boxes=[m for m in (old,nm) if m is not None]
            if not boxes: continue
            x0=max(st.start,min(m[0][0] for m in boxes)); x1=min(st.stop,max(m[0][0]+m[1].shape[1] for m in boxes))
            y0=max(0,min(m[0][1] for m in boxes)); y1=min(shape[0],max(m[0][1]+m[1].shape[0] for m in boxes))
            if x1<=x0 or y1<=y0: continue
            before=c[y0:y1,x0:x1]>0; r=ref[y0:y1,x0:x1]
            loc=c[y0:y1,x0:x1].copy()
            for m,sign in ((old,-1),(nm,1)):
                if m is None: continue
                (mx,my),a=m
                yy=slice(max(y0,my),min(y1,my+a.shape[0])); xx=slice(max(x0,mx),min(x1,mx+a.shape[1]))
                if yy.stop>yy.start and xx.stop>xx.start:
                    loc[yy.start-y0:yy.stop-y0,xx.start-x0:xx.stop-x0]+=sign*a[yy.start-my:yy.stop-my,xx.start-mx:xx.stop-mx]
            after=loc>0
            T[vi,0]+=(after&r).sum()-(before&r).sum(); T[vi,1]+=after.sum()-before.sum()
        return iou(T),new,T
    start=iou(S)
    for step,sstep in [(3,.03),(2,.02),(1,.01),(1,.01)]:
        for key in names:
            for axis in range(6):
                for sign in (1,-1):
                    while True:
                        prm=params[key].copy(); prm[axis]+=sign*(step if axis<3 else sstep)
                        if abs(prm[axis]-(0 if axis<3 else 1))>(MAX_MOVE if axis<3 else MAX_SCALE)+1e-9: break
                        score,new,T=trial(key,prm)
                        if score<=iou(S)+2e-6: break
                        for c,m in zip(count,current[key]): paint(c,m,-1)
                        for c,m in zip(count,new): paint(c,m,1)
                        current[key]=new; params[key]=prm; S=T
        print(f'{hero}: step {step} mean silhouette {iou(S):.4f}',flush=True)
    out={k:[round(float(v),3) for v in p] for k,p in params.items() if not np.allclose(p,[0,0,0,1,1,1])}
    (HERE/f'fit-{hero}.json').write_text(json.dumps(out,indent=1)+'\n')
    print(f'{hero}: {start:.4f} -> {iou(S):.4f}, {len(out)} of {len(names)} assemblies moved')

if __name__=='__main__':
    fit(sys.argv[1],sys.argv[2])
