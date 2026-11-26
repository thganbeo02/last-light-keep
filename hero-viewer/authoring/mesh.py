"""Faceted modeling tools. Coordinates are front X, sheet Y, and profile X in reference pixels."""
from math import cos, sin, pi
import numpy as np

parts = []

def part(name, finish, faces):
    parts.append((name, finish, [np.array(t, float) for t in faces]))

def strip_faces(a, b, closed=True):
    faces = []
    for i in range(len(a) if closed else len(a)-1):
        j = (i+1) % len(a)
        faces.extend(((a[i], b[i], b[j]), (a[i], b[j], a[j])))
    return faces

def fan(ring):
    center = np.mean(ring, axis=0)
    return [(center, p, ring[(i+1) % len(ring)]) for i,p in enumerate(ring)]

def solid(name, finish, rings):
    faces = fan(rings[0]) + fan(rings[-1])
    for a,b in zip(rings, rings[1:]):
        faces += strip_faces(a,b)
    part(name, finish, faces)

def ring(y, left, right, rear, front, cut=.20):
    w, d = (right-left)*cut, (front-rear)*cut
    return [(left+w,y,front),(right-w,y,front),(right,y,front-d),(right,y,rear+d),
            (right-w,y,rear),(left+w,y,rear),(left,y,rear+d),(left,y,front-d)]

def loft(name, finish, rows, cut=.20):
    solid(name,finish,[ring(*r,cut=cut) for r in rows])

def block(name,finish,x,y,z,w,h,d,bevel=2):
    b=min(w*.18,d*.18,h*.24,bevel)
    rows=[(y-h/2,x-w/2+b,x+w/2-b,z-d/2+b,z+d/2-b),
          (y-h/2+b,x-w/2,x+w/2,z-d/2,z+d/2),
          (y+h/2-b,x-w/2,x+w/2,z-d/2,z+d/2),
          (y+h/2,x-w/2+b,x+w/2-b,z-d/2+b,z+d/2-b)]
    loft(name,finish,rows)

def plate(name,finish,path,thick,axis=2):
    a=np.array(path,float)
    b=a.copy()
    b[:,axis]-=thick
    # Ear clipping preserves concave hems and the open hood aperture.
    from .polygon import triangulate
    flat=np.delete(a,axis,axis=1)
    idx=triangulate(flat)
    part(name,finish,strip_faces(a,b)+[r[list(t)] for r in (a,b) for t in idx])

def tube(name,finish,path,radius,sides=8):
    points=np.asarray(path,float)
    rings=[]
    for i,p in enumerate(points):
        axis=points[min(i+1,len(points)-1)]-points[max(i-1,0)]
        axis=axis/np.linalg.norm(axis)
        base=np.array([1.,0,0]) if abs(axis[0])<.8 else np.array([0.,1,0])
        u=np.cross(axis,base)
        u/=np.linalg.norm(u)
        v=np.cross(axis,u)
        r=radius if np.isscalar(radius) else radius[i]
        rings.append([p+r*(cos(j*2*pi/sides)*u+sin(j*2*pi/sides)*v) for j in range(sides)])
    solid(name,finish,rings)

def loop(name,finish,x,y,z,w,h,r,side=False):
    path=[(-.3,-.5),(.3,-.5),(.5,-.30),(.5,.30),(.3,.5),(-.3,.5),(-.5,.3),(-.5,-.3),(-.3,-.5)]
    tube(name,finish,[(x+(0 if side else a*w),y+b*h,z+(a*w if side else 0)) for a,b in path],r,6)

def disc(name,finish,x,y,z,r,depth):
    rings=[[(x+sin(i*pi/5)*rad,y+cos(i*pi/5)*rad,zz) for i in range(10)]
           for zz,rad in [(z-depth,r*.82),(z-depth*.72,r),(z-2,r),(z,r*.78)]]
    solid(name,finish,rings)

def cloth(name,finish,grid,thickness=4):
    a=np.asarray(grid,float)
    b=a.copy()
    b[:,:,2]-=thickness
    faces=[]
    for layer in (a,b):
        for p,q in zip(layer,layer[1:]):
            faces+=strip_faces(p,q,False)
    for p,q in [(a[0],b[0]),(a[-1],b[-1]),(a[:,0],b[:,0]),(a[:,-1],b[:,-1])]:
        faces+=strip_faces(p,q,False)
    part(name,finish,faces)
