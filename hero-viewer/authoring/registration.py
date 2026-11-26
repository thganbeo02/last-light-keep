"""Horizontal landmarks for the painted three-quarter pose, in original sheet pixels.
The artist shifts individual pieces between views. Register each rigid assembly locally
so, for example, a cheek never acquires a second ear from the neighboring side plane.
"""
import numpy as np

def quarter_landmarks(hero,parts):
    groups={}
    keys=[]
    for name,material,faces in parts:
        p=np.asarray(faces).reshape(-1,3)
        near=p[:,0].mean()<(248 if hero=='aldric' else 211)
        side='near' if near else 'far'
        if hero=='aldric':
            if any(k in name for k in ['sole','toe','instep']): key=('foot',side)
            elif any(k in name for k in ['pauldron','Pauldron']): key=('shoulder',side)
            elif any(k in name for k in ['Gauntlet','gauntlet']) or name in ['Leather sleeve','Upper arm plate','Elbow cop','Vambrace']: key=('hand',side)
            elif any(k in name for k in ['crown','Hair mass','Nape','temple']): key=('hair',)
            elif name in ['Angular face','Ear','Heavy brow','Nose','Squared beard','Moustache','Grey sideburn']: key=('face',)
            elif 'shield' in name.lower() and 'strap' not in name and 'grip' not in name and 'forearm' not in name: key=('shield',)
            elif 'clasp' in name: key=('clasp',)
            elif name in ['Torn tabard skirt','Heraldic surcoat','Sword belt','Brass belt buckle','Buckle tongue']: key=('torso',)
            elif 'scabbard' in name.lower() or name in ['Sword grip','Sword pommel','Sword crossguard']:key=('sword',)
            else:key=None
        else:
            if any(k in name for k in ['boot','outsole','strap','tongue']):key=('foot',side)
            elif 'hood' in name.lower() or 'fringe' in name: key=('hood',)
            elif name in ['Scarred face','Angled brow','Hooked nose','Short black beard','Moustache','Neck']:key=('face',)
            elif name in ['Resting fist','Resting knuckle','Resting thumb','Overlapping linen binding']:key=('hand','near')
            elif name in ['Lantern hand','Gripping finger','Gripping thumb']:key=('hand','far')
            elif any(k in name.lower() for k in ['rail','chimney','cage','glass','coal','hanger','swivel']):key=('lantern',)
            elif 'clasp' in name:key=('clasp',)
            else:key=None
        keys.append(key)
        if key is not None: groups.setdefault(key,[]).append(p)
    targets=({
        ('foot','near'):(586,723),('foot','far'):(739,891),
        ('shoulder','near'):(551,699),('shoulder','far'):(777,880),
        ('hand','near'):(552,648),('hand','far'):(816,891),
        ('hair',):(605,804),('face',):(653,794),('shield',):(799,925),
        ('clasp',):(676,723),('torso',):(651,812),('sword',):(602,713)
    } if hero=='aldric' else {
        ('foot','near'):(513,627),('foot','far'):(663,815),('hood',):(534,758),
        ('face',):(639,737),('hand','near'):(511,610),('hand','far'):(762,857),
        ('lantern',):(775,889),('clasp',):(620,669)
    })
    maps={}
    for key,parts in groups.items():
        p=np.vstack(parts)
        u=quarter_x(hero,p)
        maps[key]=(u.min(),u.max(),*targets[key])
    return [maps.get(k) for k in keys]

def quarter_x(hero,p):
    fx,sz,ax=(248,1134,730) if hero=='aldric' else (211,1050,649)
    return ax+np.cos(np.deg2rad(28))*(p[:,0]-fx)+np.sin(np.deg2rad(28))*(p[:,2]-sz)
