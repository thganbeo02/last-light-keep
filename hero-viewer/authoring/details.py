"""Fixed surface paint for small overlapping parts, where neighboring faces occlude the sheet."""
import numpy as np

def finish_part(hero,name,finish,world,normal,img,baked):
    x,y,z=world.transpose(2,0,1)
    xi=np.rint(x).astype(int)
    yi=np.rint(y).astype(int)
    zi=np.rint(z).astype(int)
    front=img[yi,xi].astype(float)
    # The frontal artwork includes mouths, eyes and scars. Bind those marks only to
    # their own face planes. Reprojection onto a nearby curl creates a second eye.
    aldric=hero=='aldric'
    side_facing=abs(normal[0])>abs(normal[2])*.96
    if name in ('Angular face','Scarred face','Squared beard','Short black beard'):
        skin=name in ('Angular face','Scarred face')
        beard='beard' in name.lower()
        # Both eye corners cross the bevel between the forehead plane and temple.
        # Register the full eye opening to the front sheet on that bevel as well.
        # Below the modelled eyebrow keep the pupil and its highlight intact.
        eye_top,eye_bottom=(171,190) if aldric else (162,178)
        eye_band=(y>=eye_top)&(y<=eye_bottom)
        temple_band=(y>=eye_top-16)&(y<=eye_bottom+7)
        eye_front=temple_band&(z>(1160 if aldric else 1102))
        if side_facing:
            # The ear, sideburn and curls are separate geometry. Sample the cheek
            # forward of the ear when filling the skin beneath them.
            if skin:
                s=np.clip(zi,1153,1190) if aldric else np.clip(zi,1105,1124)
                source=img[yi,s].astype(float)
                if aldric:
                    color=np.array([188.,119.,83.])+((y%13<6)*4)[:,:,None]
                    ok=(source[:,:,0]-source[:,:,1]>28)&(source[:,:,0]>128)
                    cheek=np.where(ok[:,:,None],source,color)
                    return np.where(eye_front[:,:,None],front,cheek)
                # The profile contains another view of the eye. Use cheek pigment
                # beneath the temple so it cannot form a second horizontal eyelid.
                cheek=np.where(eye_band[:,:,None],img[np.clip(yi+15,0,img.shape[0]-1),s],source)
                return np.where(eye_front[:,:,None],front,cheek)
            if beard:
                s=np.clip(zi,1160,1208) if aldric else np.clip(zi,1100,1132)
                source=img[yi,s].astype(float)
                base=np.array([91,72,65]) if aldric else np.array([62,44,40])
                ok=source[:,:,0]-source[:,:,1]<34
                return np.where(ok[:,:,None],source,base)
        if skin:
            # Pale skin under a separately raised brow prevents duplicated eyebrows on orbit.
            brow_line=(168 if aldric else 154)+(.16 if aldric else .12)*(18-abs(x-(247 if aldric else 225))%38)
            under=(abs(y-brow_line)<6)&(front[:,:,0]<110)&~eye_band
            return np.where(under[:,:,None],np.array([159,94,62]),front)
        return front
    if name in ('Heavy brow','Angled brow','Moustache','Dark curled fringe','Hood-side curl'):
        brown=np.array([59.,39.,35.]) if aldric else np.array([45.,30.,28.])
        dark=(front[:,:,0]<100)&(front[:,:,0]-front[:,:,1]<45)
        shade=(np.floor(x/11)%3-1)*3+(np.floor(y/9)%3-1)*2
        return np.where(dark[:,:,None],front,brown+shade[:,:,None])
    if name=='Ear':
        if side_facing:
            # Keep the ear recess on the broad outside facet.
            ear_x=np.clip(np.rint(1130+(z-1143)*.79).astype(int),1116,1145)
            return img[np.clip(yi,172,211),ear_x]
        return front
    if name=='Grey sideburn' or name=='Silver temple streak':
        noise=3*(np.floor(z/11)%3-1)+3*(np.floor(y/12)%2)
        patch=img[yi,np.clip(zi,1090,1152)].astype(float) if side_facing else front
        valid=(abs(patch[:,:,0]-patch[:,:,1])<37)&(patch[:,:,0]>68)&(patch[:,:,2]>patch[:,:,1]*.78)
        return np.where(valid[:,:,None],patch,np.array([126,112,107])+noise[:,:,None])
    if name=='Hood lining':
        return np.array([43,30,34])+((np.floor(z/15)+np.floor(y/24))%3)[:,:,None]*2.4
    if name in ('Gold-brown hood binding and lining','Faceted hood shell','Hood nape fold'):
        # Exclude cheek, teeth and beard color from exterior cloth.
        r,g,b=baked.transpose(2,0,1)
        foreign=(r>g*1.45)&(r>137)&(b>g*.64)
        return np.where(foreign[:,:,None],np.array([97,64,56]),baked)
    if name in ('Captain\'s cape clasp','Mantle sun clasp'):
        # Both clasps sit over other cloth in every projection. Use a single frontal medallion.
        cx,cy,rad=(189,287,24) if aldric else (169,283,24)
        inside=(x-cx)**2+(y-cy)**2<(rad-1)**2
        return np.where(inside[:,:,None],front,[150,96,35])
    return baked
