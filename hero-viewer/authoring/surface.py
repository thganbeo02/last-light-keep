"""Part-local pigment and wear. Only the isolated heraldic motifs sample sheet artwork."""
import numpy as np

def noise(x,y,z,scale):
    cell=np.floor(x/scale)*12.9898+np.floor(y/scale)*78.233+np.floor(z/scale)*37.719
    return np.mod(np.sin(cell)*43758.5453,1)

def paint(name,finish,world,tri,bounds,base,img,mantle_edge):
    x,y,z=world.transpose(2,0,1)
    low,high=bounds
    normal=np.cross(tri[1]-tri[0],tri[2]-tri[0])
    normal/=np.linalg.norm(normal)
    if normal@(tri.mean(0)-(low+high)/2)<0: normal=-normal
    lighting=.94+normal@[-.19,-.24,.13]
    grain=noise(x,y,z,5)
    broad=noise(x,y,z,16)
    rgb=np.asarray(base)*lighting+(grain[...,None]-.5)*6+(broad[...,None]-.5)*10
    height=np.maximum(1,high[1]-low[1])
    t=(y-low[1])/height
    if finish in ('blue','plum','linen'):
        rgb+=6*np.cos((x+.35*z)/9)[...,None]
        if any(word in name.lower() for word in ('tabard','cape tail','torn','skirt panel','stole','mantle fold','shoulder mantle')):
            edge=t+.08*(grain-.5)+.12*(broad-.5)
            worn=np.array([181,148,114] if finish=='blue' else [169,96,46] if finish=='plum' else [137,91,65])
            blend=np.clip((edge-.81)*5,0,.9)[...,None]
            rgb=rgb*(1-blend)+worn*blend
    if mantle_edge is not None:
        center=(mantle_edge.max(0)+mantle_edge.min(0))/2
        radius=(mantle_edge.max(0)-mantle_edge.min(0))/2
        angle=np.arctan2((x-center[0])/radius[0],(z-center[2])/radius[2])
        stations=np.arctan2((mantle_edge[:,0]-center[0])/radius[0],(mantle_edge[:,2]-center[2])/radius[2])
        distance=np.interp(angle,stations,mantle_edge[:,1],period=2*np.pi)-y
        width=6 if name.endswith(("3","4")) else 13
        border=distance<width+4*broad
        trim=np.array([141,88,53]) if width==6 else np.array([196,122,51])
        rgb=np.where(border[...,None],trim*lighting+(grain[...,None]-.5)*14,rgb)
        rgb*=np.where(distance<2,.70,1)[...,None]
    if "clasp" in name:
        center=(low+high)/2
        radius=np.hypot((x-center[0])/(high[0]-center[0]),(y-center[1])/(high[1]-center[1]))
        rgb*=np.where((radius>.35)&(radius<.40),.72,1)[...,None]
        rgb+=np.where(radius<.34,12*np.cos(5*np.arctan2(y-center[1],x-center[0])),0)[...,None]
    if finish in ('iron','silver','gold','shield'):
        scratch=(np.mod(x*.65+y+z*.47,61)<1.0)&(broad>.72)
        rgb+=scratch[...,None]*32
    if name=='Painted kite shield':
        # Map the decorated field to itself; the rim and backing have separate finishes.
        rgb=img[np.clip(y.astype(int),285,618),np.clip(x.astype(int),295,450)].astype(float)
    if name=='Heraldic surcoat':
        crest=(x>=230)&(x<=275)&(y>=307)&(y<=379)&(z>1180)
        motif=img[y.astype(int),x.astype(int)]
        rgb=np.where(crest[...,None],motif,rgb)
    if finish in ('coal','amber'):
        hot=noise(x,y,z,9)
        rgb=np.stack((216+38*hot,55+141*hot,9+33*hot),axis=-1)
    return rgb
