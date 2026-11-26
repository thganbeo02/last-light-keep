def triangulate(points):
    def cross(a,b,c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    area=sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(points,list(points[1:])+[points[0]]))
    sign=1 if area>0 else -1
    ids=list(range(len(points)))
    faces=[]
    while len(ids)>2:
        for k,b in enumerate(ids):
            a,c=ids[k-1],ids[(k+1)%len(ids)]
            p,q,r=points[[a,b,c]]
            if sign*cross(p,q,r)<=0: continue
            if any(min(sign*cross(p,q,points[i]),sign*cross(q,r,points[i]),sign*cross(r,p,points[i]))>0
                   for i in ids if i not in (a,b,c)): continue
            faces.append((a,b,c))
            ids.pop(k)
            break
        else:
            break
    return faces
