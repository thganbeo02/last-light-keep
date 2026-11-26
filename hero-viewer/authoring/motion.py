"""Rigid armor articulation and reusable glTF clips for Aldric's workshop model."""
from math import sin, cos, pi, radians
import numpy as np
from .fit import groups
from .combat_motion import COMBAT_CLIPS, WORKSHOP_SLASH_BEATS, combat_pose, sample_game_slash, slash_pose

def animate(doc, parts, positions, attribute):
    nodes=doc['nodes']
    meshes=doc['meshes']
    root=doc['scenes'][0]['nodes'][0]
    nodes[root]['children']=[]
    joints={}
    origins={}
    parents={}
    contact={}
    rigid_contact={}
    cloth={}
    def joint(name,parent,origin):
        origin=np.array(origin,float)
        node=len(nodes)
        joints[name]=node
        origins[name]=origin
        parents[name]=parent
        nodes.append(dict(name=name,translation=(origin-origins.get(parent,0)).tolist(),children=[]))
        nodes[joints.get(parent,root)]['children'].append(node)
    joint('Pelvis',None,(0,.81,0))
    joint('Chest','Pelvis',(0,.87,0))
    joint('Head','Chest',(0,1.29,0))
    joint('Cape','Chest',(0,1.30,-.12))
    for suffix,side in [('R',-1),('L',1)]:
        joint('Hip'+suffix,'Pelvis',(side*.20,.81,-.02))
        joint('Knee'+suffix,'Hip'+suffix,(side*.245,.46,-.025))
        joint('Ankle'+suffix,'Knee'+suffix,(side*.255,.135,-.015))
        joint('Shoulder'+suffix,'Chest',(side*.24,1.31,-.035))
        joint('Elbow'+suffix,'Shoulder'+suffix,(side*.34,1.01,-.035))
    joint('Shield','ElbowL',(.36,.75,.25))
    joint('SheathedHilt','Pelvis',(-.20,.88,.12))
    for i,((name,_,faces),group) in enumerate(zip(parts,groups('aldric',parts))):
        side='R' if np.concatenate(faces)[:,0].mean()<248 else 'L'
        target='Chest'
        if group in ('face','hair'): target='Head'
        elif 'cape tail' in name or 'cape, torn' in name: target='Cape'
        elif name in ('Boot sole','Square toe and heel','Boot instep strap'): target='Ankle'+side
        elif group.startswith('leg'): target=('Hip' if name in ('Quilted cuisse','Overlapping thigh lame') else 'Knee')+side
        elif group.startswith('arm') or group.startswith('pauldron'):
            target=('Shoulder' if name in ('Leather sleeve','Upper arm plate','Domed pauldron','Pauldron bound lip','Pauldron lozenge') else 'Elbow')+side
        elif group=='shield': target='Shield'
        elif name in ('Sword grip','Sword pommel','Sword crossguard'): target='SheathedHilt'
        elif group=='sword' or 'belt' in name.lower() or 'buckle' in name.lower() or 'tabard' in name.lower(): target='Pelvis'
        nodes[joints[target]]['children'].append(i)
        nodes[i]['translation']=(-origins[target]).tolist()
        if target=='Cape' or name in ('Folded cape collar','Back tabard'):
            cloth[i]=target
        points=(np.concatenate(faces)-[248,730,1134])*[1.8/669,-1.8/669,1.8/669]
        local_points=points-origins[target]
        contact.setdefault(target,[]).append(local_points)
        if i not in cloth:
            rigid_contact.setdefault(target,[]).append(local_points)

    # Skill props share unit geometry and are hidden in the reference pose.
    cube=np.array([[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],float)/2
    corners=[[0,2,1,0,3,2],[4,5,6,4,6,7],[0,4,7,0,7,3],[1,2,6,1,6,5],[3,7,6,3,6,2],[0,1,5,0,5,4]]
    pos=cube[np.array(corners).ravel()]
    normals=np.cross(pos[1::3]-pos[::3],pos[2::3]-pos[::3])
    normals/=np.linalg.norm(normals,axis=1)[:,None]
    geom=dict(POSITION=attribute(pos,'VEC3',True),NORMAL=attribute(normals.repeat(3,0),'VEC3'))
    defs={}
    for material,color in [('Standard blue',[.075,.105,.22,1]),('Brass',[.64,.36,.08,1]),('Steel',[.47,.51,.55,1]),('Hilt leather',[.13,.068,.042,1]),('Spectral gold',[.96,.61,.18,.42])]:
        mat=dict(name=material,pbrMetallicRoughness=dict(baseColorFactor=color,metallicFactor=.12,roughnessFactor=.65))
        if material=='Spectral gold': mat.update(alphaMode='BLEND',emissiveFactor=[.65,.32,.05])
        matid=len(doc['materials']);doc['materials'].append(mat)
        defs[material]=len(meshes);meshes.append(dict(primitives=[dict(attributes=geom,material=matid)]))
    def prop(parent,label,material,position,size):
        nodes[joints[parent]]['children'].append(len(nodes))
        nodes.append(dict(name=label,mesh=defs[material],translation=position,scale=size))
    joint('DrawnSword','ElbowR',(-.414,.656,.048))
    nodes[joints['DrawnSword']]['scale']=[0,0,0]
    joint('Blade','DrawnSword',(-.414,.746,.048))
    prop('DrawnSword','Sword handle','Hilt leather',[0,0,0],[.041,.15,.042])
    prop('DrawnSword','Drawn pommel','Brass',[0,-.09,0],[.058,.039,.054])
    prop('DrawnSword','Drawn crossguard','Brass',[0,.085,0],[.17,.031,.045])
    prop('Blade','Sword blade','Steel',[0,.233,0],[.065,.47,.024])
    prop('Blade','Sword tip','Steel',[0,.477,0],[.036,.045,.019])
    joint('Standard','ElbowR',(-.414,.656,.039))
    joint('Gate',None,(0,.01,.43))
    for key in ('Standard','Gate'): nodes[joints[key]]['scale']=[0,0,0]
    prop('Standard','Standard staff','Brass',[0,.175,0],[.021,.72,.021])
    prop('Standard','Blue pennon','Standard blue',[-.13,.395,0],[.25,.20,.014])
    prop('Standard','Pennon binding','Brass',[-.13,.301,.009],[.25,.018,.012])
    for x in (-.49,.49): prop('Gate','Gate pillar','Spectral gold',[x,.66,0],[.073,1.32,.09])
    for x in (-.32,-.16,0,.16,.32): prop('Gate','Gate bar','Spectral gold',[x,.6,0],[.023,1.19,.045])
    for y in (.35,1.12,1.32): prop('Gate','Gate crossbar','Spectral gold',[0,y,0],[1.04,.055,.082])

    for name,origin in [('GatePosts',(0,.01,.56)),('GateLintel',(0,1.47,.56)),
                        ('Portcullis',(0,1.46,.56)),('GroundLight',(0,.016,.56))]:
        joint(name,None,origin)
        nodes[joints[name]]['scale']=[0,0,0]
    for x in (-.63,.63):
        prop('GatePosts','Spectral pier','Spectral gold',[x,.72,0],[.14,1.44,.17])
        for y in (.07,.48,.94,1.39):
            prop('GatePosts','Pier masonry band','Spectral gold',[x,y,-.015],[.18,.11,.19])
    prop('GateLintel','Spectral lintel','Spectral gold',[0,0,0],[1.45,.13,.17])
    prop('GateLintel','Keystone','Spectral gold',[0,.065,.02],[.19,.14,.20])
    for x in (-.46,-.23,0,.23,.46):
        prop('Portcullis','Portcullis bar','Spectral gold',[x,-.69,0],[.038,1.36,.05])
    for y in (-.25,-.92):
        prop('Portcullis','Portcullis crossrail','Spectral gold',[0,y,0],[1.05,.035,.045])
    prop('GroundLight','Ground seal','Spectral gold',[0,0,0],[1.45,.022,.075])
    joint('CrestLight','Shield',(.394,.724,.328))
    nodes[joints['CrestLight']]['scale']=[0,0,0]
    prop('CrestLight','Lantern spark','Spectral gold',[0,0,0],[.052,.068,.012])

    def rotation(x=0,y=0,z=0):
        a,b,c=[radians(v)/2 for v in (x,y,z)]
        return [sin(a)*cos(b)*cos(c)+cos(a)*sin(b)*sin(c),cos(a)*sin(b)*cos(c)-sin(a)*cos(b)*sin(c),cos(a)*cos(b)*sin(c)+sin(a)*sin(b)*cos(c),cos(a)*cos(b)*cos(c)-sin(a)*sin(b)*sin(c)]
    def multiply(a,b):
        av,bv=np.asarray(a[:3]),np.asarray(b[:3])
        return [*(a[3]*bv+b[3]*av+np.cross(av,bv)),a[3]*b[3]-av@bv]

    # Time, shoulder pitch, outward swing, elbow bend, chest turn, staff lean.
    rally=np.array([
        (0,0,0,0,0,0),
        (.13,-17,-18,-24,-4,24),
        (.27,-62,-30,-54,-9,19),
        (.46,-117,-43,-22,-5,9),
        (.53,-120,-45,-24,-3,7),
        (.69,-117,-43,-25,-3,9),
        (.84,-65,-28,-50,-7,18),
        (1,0,0,0,0,22),
    ])

    def inverse(q):
        return [-v for v in q[:3]]+[q[3]]

    # Both boots stay flat through the brace. Solve the knee against a fixed
    # ankle target so a change in pelvis height cannot move a planted foot.
    def planted_leg(side,pelvis,ankle):
        hip=origins['Hip'+side]+pelvis
        target=origins['Ankle'+side]+ankle
        rest_offset=origins['Ankle'+side]-origins['Hip'+side]
        dx,dy,dz=target-hip-[rest_offset[0],0,rest_offset[2]]
        roll=np.arctan2(dx,-dy)
        down=np.hypot(dx,dy)
        knee=np.arccos(np.clip((down**2+dz**2-.35**2-.325**2)/(2*.35*.325),-1,1))
        pitch=-np.arctan2(dz,down)-np.arctan2(.325*sin(knee),.35+.325*cos(knee))
        upper=multiply(rotation(z=np.degrees(roll)),rotation(np.degrees(pitch)))
        lower=rotation(np.degrees(knee))
        return upper,lower,inverse(multiply(upper,lower))

    contact={name:np.unique(np.concatenate(vertices),axis=0) for name,vertices in contact.items()}
    rigid_contact={name:np.unique(np.concatenate(vertices),axis=0) for name,vertices in rigid_contact.items()}

    def apply(q,v):
        axis=np.asarray(q[:3])
        perpendicular=2*np.cross(axis,v)
        return v+q[3]*perpendicular+np.cross(axis,perpendicular)

    def world_transform(name,pose):
        parent=parents[name]
        q=pose.get((name,'rotation'),[0,0,0,1])
        origin=np.asarray(pose.get((name,'translation'),nodes[joints[name]]['translation']))
        if parent is None:
            return q,origin
        parent_q,parent_origin=world_transform(parent,pose)
        return multiply(parent_q,q),apply(parent_q,origin)+parent_origin

    def rest_on_ground(pose,shield_held=True,cloth_draped=False):
        lowest=np.inf
        support=rigid_contact if cloth_draped else contact
        for name,vertices in support.items():
            if name=='Shield' and not shield_held: continue
            q,origin=world_transform(name,pose)
            lowest=min(lowest,(apply(q,vertices)+origin)[:,1].min())
        pose['Pelvis','translation'][1]-=lowest

    def drop_shield(pose,frame,release):
        start_q,start=release
        rotation_mix=np.interp(frame,[7,11,15,20,23,27],[0,.12,.33,.85,1,1])
        flat_q=rotation(-90,0,18)
        direction=1 if np.dot(start_q,flat_q)>=0 else -1
        q=(1-rotation_mix)*np.asarray(start_q)+direction*rotation_mix*np.asarray(flat_q)
        q/=np.linalg.norm(q)
        impact=np.interp(frame,[7,11],[0,1])
        slide=np.interp(frame,[7,11,20,27],[0,.25,.90,1])
        center=start+[.35*slide,0,.15*slide]
        floor=.009-apply(q,contact['Shield'])[:,1].min()
        bounce=np.interp(frame,[11,13,16,27],[0,.033,0,0])
        center[1]=(1-impact)*start[1]+impact*floor+bounce
        parent_q,parent_center=world_transform('ElbowL',pose)
        undo_parent=inverse(parent_q)
        pose['Shield','rotation']=multiply(undo_parent,q)
        pose['Shield','translation']=apply(undo_parent,center-parent_center).tolist()

    cloth_frames=range(15,28)
    def drape_cloth(pose,frame):
        # Preserve the attachment to the shoulder and let the loose length
        # spread laterally below the rigid body as it reaches the floor.
        settled=np.interp(frame,[15,19,23,27],[0,.65,1,1])
        for index,joint_name in cloth.items():
            base=positions[index]
            q,origin=world_transform(joint_name,pose)
            local=base-origins[joint_name]
            world=apply(q,local)+origin
            part=parts[index][0]
            if part=='Folded cape collar':
                weight=settled*np.clip((-.07-base[:,2])/.13,0,1)*.65
            else:
                y=base[:,1]
                root=np.percentile(y,95)
                weight=settled*np.clip((root-y)/.18,0,1)
            target=world.copy()
            ripple=.008+.018*(1+np.cos(29*world[:,0]+11*world[:,2]))/2
            # Original depth gives the layered cloth a little thickness on the floor.
            target[:,1]=ripple+.06*np.clip(base[:,2]+.34,0,.35)
            target[:,0]+=.13*np.tanh(base[:,0]*8)
            target[:,2]+=.07*weight
            world+=(target-world)*weight[:,None]
            world[:,1]=np.maximum(world[:,1],.005)
            delta=apply(inverse(q),world-origin)-local
            primitive=meshes[index]['primitives'][0]
            primitive.setdefault('targets',[]).append(dict(POSITION=attribute(delta,'VEC3',True)))

    rest_offsets={name:np.asarray(nodes[node]['translation']) for name,node in joints.items()}
    doc['animations']=[]
    for name,duration in [('Idle',3.4),('March',1.25),('March v2',1.4),('Rally the Line',2.4),('Shield Wall',2.1),('The Gate Holds',3.1),('Shield Wall v2',2.2),('The Gate Holds v2',3.4),*COMBAT_CLIPS]:
        tracks={}
        times=np.linspace(0,duration,round(duration*30)+1 if name in ("Shield Wall v2","The Gate Holds v2") or (name,duration) in COMBAT_CLIPS else 49)
        if name=='Normal Attack':
            times=np.unique(np.r_[np.linspace(0,duration,37),WORKSHOP_SLASH_BEATS])
            slash=sample_game_slash(times)
        for index,t in enumerate(times/duration):
            wave=sin(2*pi*t)
            lift=sin(pi*t)**2
            hold=np.interp(t,[0,.12,.32,.73,.96,1],[0,-.09,1,1,0,0])
            pose={}
            def rotate(j,*angles): pose[j,'rotation']=rotation(*angles)
            def move(j,dy): pose[j,'translation']=(np.asarray(nodes[joints[j]]['translation'])+[0,dy,0]).tolist()
            if name=='Idle':
                move('Chest',.012*lift);rotate('Head',-1.8*lift,2*wave);rotate('Cape',2*wave)
                rotate('ShoulderL',-2*lift);rotate('ElbowR',-2.8*lift)
            elif name=='March':
                move('Pelvis',-.036*wave**2)
                rotate('Chest',2*lift,5*wave);rotate('Head',0,-4*wave);rotate('Cape',5*wave)
                for side,phase in [('R',wave),('L',-wave)]:
                    rotate('Hip'+side,-25*phase);rotate('Knee'+side,25*max(0,phase))
                    rotate('Shoulder'+side,15*phase);rotate('Elbow'+side,-7*max(0,-phase))
            elif name=='March v2':
                # Solve the hip and knee to a traveling ankle. Contact moves at
                # constant speed; swing clears the floor and slows before landing.
                settle=-.049-.014*cos(4*pi*t)
                pose['Pelvis','translation']=(origins['Pelvis']+[.021*sin(2*pi*t+.35),settle,0]).tolist()
                rotate('Chest',2,4*cos(2*pi*t),1.6*wave)
                rotate('Head',-1,-3*cos(2*pi*t),-wave)
                rotate('Cape',3+3*sin(2*pi*t-.4),-2*cos(2*pi*t))
                for side,offset in [('L',0),('R',.5)]:
                    phase=(t+offset)%1
                    if phase<.60:
                        u=phase/.60
                        stride=.156*(1-2*u)
                        pitch=np.interp(u,[0,.19,.78,1],[-10,0,0,14])
                        height=max(0,-sin(radians(pitch))*.17,sin(radians(pitch))*.20)
                    else:
                        u=(phase-.60)/.40
                        stride=-.156+.312*(u*u*(3-2*u))
                        pitch=14-24*u
                        height=.047*(1-u)+.030*u+.092*sin(pi*u)**2
                    down=.675+settle-height
                    knee=np.arccos(np.clip((down**2+stride**2-.35**2-.325**2)/(2*.35*.325),-1,1))
                    hip=-np.arctan2(stride,down)-np.arctan2(.325*sin(knee),.35+.325*cos(knee))
                    rotate('Hip'+side,np.degrees(hip))
                    rotate('Knee'+side,np.degrees(knee))
                    rotate('Ankle'+side,pitch-np.degrees(hip+knee))
                    swing=cos(2*pi*phase)
                    rotate('Shoulder'+side,(7 if side=='L' else 23)*swing)
                    rotate('Elbow'+side,-4-(2 if side=='L' else 7)*(1-swing))
            elif name=='Rally the Line':
                segment=np.clip(np.searchsorted(rally[:,0],t)-1,0,len(rally)-2)
                start,end=rally[segment:segment+2]
                u=(t-start[0])/(end[0]-start[0])
                progress=u*u*(3-2*u)
                shoulder,swing,elbow,chest,lean=start[1:]+progress*(end[1:]-start[1:])
                rotate('ShoulderR',shoulder,0,swing)
                rotate('ElbowR',elbow)
                rotate('Chest',0,chest)
                # Lead the lift with a glance to his right, then tilt up as
                # the pennon rises. Bring his eyes forward during the lowering.
                gaze=np.interp(t,[0,.07,.22,.46,.69,.89,1],[0,.25,1,1,1,.25,0])
                tilt=np.interp(t,[0,.13,.27,.46,.69,.84,1],[0,3,-6,-27,-25,-7,0])
                rotate('Head',tilt,-52*gaze-chest,4*gaze)
                rotate('Cape',4*sin(2*pi*t))
                # Keep the pole upright independently of the armor, anchored in the same fist.
                forearm=multiply(multiply(rotation(0,chest),rotation(shoulder,0,swing)),rotation(elbow))
                pose['Standard','rotation']=multiply(inverse(forearm),rotation(-12,10,lean))
                visible=np.interp(t,[0,.035,.13,.86,.98,1],[0,0,1,1,0,0])
                pose['Standard','scale']=[visible]*3
            elif name in ('Shield Wall v2','The Gate Holds v2'):
                seconds=t*duration
                def cue(times,values):
                    return np.interp(seconds,times,values)

                gate=name=='The Gate Holds v2'
                if gate:
                    brace=cue([0,.11,.35,.60,1.0,1.45,2.75,3.4],[0,.82,1,1,.49,.19,.19,0])
                    skid=cue([0,.10,.35,2.86,3.35],[0,0,1,1,0])
                    retreat=cue([2.86,3.10,3.35],[0,.026,0])
                    pelvis=np.array([-.047*brace,-.095*brace-.040*skid,-.087*brace-.031*skid])
                    feet={'L':(0,0,0),'R':(-.062*skid,retreat,-.22*skid)}
                    reach=cue([0,.60,.80,1.0,1.12,1.45],[0,0,.40,1,.9,0])
                    rotate('ShoulderR',-55*reach,0,60*reach)
                    rotate('ElbowR',-27*reach,12*reach)
                    rotate('Cape',cue([0,.12,.30,.52,.70],[0,9,15,-4,0]))
                    rotate('Head',19*brace,11*brace-20*reach)
                    shield=brace*.78+.13*reach
                    line=cue([0,1.0,1.18,2.93,3.16],[0,0,1,1,0])
                    posts=cue([0,1.13,1.54,2.90,3.32],[0,0,1,1,0])
                    lintel=cue([0,1.49,1.68,2.74,2.87],[0,0,1,1,0])
                    grate=cue([0,1.68,1.73,2.67,3.18],[0,0,1,1,0])
                    drop=cue([0,1.68,1.91,1.97,2.03],[1,1,0,.040,0])
                    pose['GroundLight','scale']=[line,1 if line>0 else 0,1]
                    pose['GatePosts','scale']=[1,posts,1]
                    pose['GateLintel','scale']=[lintel]*3
                    pose['Portcullis','scale']=[grate,1 if grate else 0,grate]
                    move('Portcullis',drop*1.36)
                    spark=cue([.96,1.0,1.15,1.31],[0,1,.52,0])
                    pose['CrestLight','scale']=[spark]*3
                else:
                    step=cue([0,.35,.61,1.67,2.14],[0,0,1,1,0])
                    lift_foot=cue([0,.35,.47,.61,1.67,1.9,2.14],[0,0,.054,0,0,.056,0])
                    shield=cue([0,.34,.61,.70,.87,1.0,1.60,2.13],[0,.20,.38,1,.79,.98,.98,0])
                    weight=cue([0,.35,.63,1.63,2.16],[0,1,.10,.10,0])
                    pelvis=np.array([-.065*weight+.051*step,-.035*weight-.073*step,.075*step])
                    feet={'L':(.094*step,lift_foot,.225*step),'R':(0,0,0)}
                    rotate('Head',-4*shield,5*weight)
                    rotate('ShoulderR',16*shield,0,-7*shield)
                    rotate('ElbowR',-19*shield)
                    rotate('Cape',-4*shield)
                pose['Pelvis','translation']=(origins['Pelvis']+pelvis).tolist()
                for side,ankle in feet.items():
                    for part,q in zip(('Hip','Knee','Ankle'),planted_leg(side,pelvis,ankle)):
                        pose[part+side,'rotation']=q
                rotate('Chest',4*shield,-8*shield)
                move('ShoulderL',.08*shield)
                rotate('ShoulderL',-61*shield,-19*shield,-12*shield)
                rotate('ElbowL',38*shield,7*shield)
            elif name=='Normal Attack':
                slash_pose(slash[index],pose,rotate)
                rest_on_ground(pose)
            elif (name,duration) in COMBAT_CLIPS:
                combat_pose(name,t*duration*30,pose,rotate,rest_offsets,planted_leg)
                if name=='Defeated':
                    frame=index
                    rest_on_ground(pose,shield_held=frame<=7,cloth_draped=frame>=15)
                    if frame in cloth_frames:
                        drape_cloth(pose,frame)
                    if frame==7:
                        release=world_transform('Shield',pose)
                    if frame>7:
                        drop_shield(pose,frame,release)
                    else:
                        pose['Shield','rotation']=[0,0,0,1]
                        pose['Shield','translation']=nodes[joints['Shield']]['translation']
            else:
                gate=name=='The Gate Holds'
                move('Pelvis',-.038*hold);rotate('HipL',-11*hold);rotate('KneeL',18*hold)
                rotate('ShoulderL',-22*hold,-17*hold,-16*hold);rotate('ElbowL',-9*hold)
                rotate('Chest',8*hold,-12*hold);rotate('Head',-5*hold,10*hold)
                rotate('ShoulderR',(-40 if gate else -10)*hold);rotate('Cape',-6*hold)
                if gate:
                    growth=np.interp(t,[0,.27,.48,.76,.98,1],[0,0,1,1,0,0])
                    pose['Gate','scale']=[growth**.4,growth, growth]
            for key,value in pose.items(): tracks.setdefault(key,[]).append(value)
        clock=attribute(times[:,None],'SCALAR',True)
        clip=dict(name=name,channels=[],samplers=[])
        for (joint_name,path),values in tracks.items():
            output=attribute(np.asarray(values),'VEC4' if path=='rotation' else 'VEC3')
            clip['channels'].append(dict(sampler=len(clip['samplers']),target=dict(node=joints[joint_name],path=path)))
            clip['samplers'].append(dict(input=clock,output=output,interpolation='LINEAR'))
        if name=='Defeated':
            weights=np.zeros((len(times),len(cloth_frames)))
            weights[list(cloth_frames),np.arange(len(cloth_frames))]=1
            output=attribute(weights.reshape(-1,1),'SCALAR')
            sampler=len(clip['samplers'])
            clip['samplers'].append(dict(input=clock,output=output,interpolation='LINEAR'))
            for index in cloth:
                clip['channels'].append(dict(sampler=sampler,target=dict(node=index,path='weights')))
        doc['animations'].append(clip)
