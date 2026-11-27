"""Rigid articulation, casting cues and emissive props for Corwin's workshop GLB."""
from math import cos, pi, sin
import numpy as np
from .fit import groups

# Seconds, followed by chest, head, casting shoulder/elbow and lantern shoulder/elbow.
# The free hand casts while the lantern stays suspended from an independent pivot.
READY = ((0,0,0),)*6
CASTS = {
    'ember-bolt': [
        (0, *READY),
        (.13, (-9,-21,0),(4,11,0),(15,-24,25),(-68,0,0),(7,5,-8),(4,0,0)),
        (.20, (12,22,-6),(-7,18,0),(-62,22,9),(-9,0,0),(15,12,-12),(8,0,0)),
        (.39, (4,14,0),(-5,18,0),(-55,17,6),(-13,0,0),(4,7,-9),(3,0,0)),
        (.70, *READY),
    ],
    'close-attack': [
        (0, *READY),
        (.067, (-21,-7,4),(9,5,-2),(-26,6,21),(-61,0,0),(14,0,-18),(12,0,0)),
        (.15, (-17,10,3),(12,12,-2),(-63,22,12),(-8,0,0),(10,0,-15),(8,0,0)),
        (.23, (-9,5,0),(7,6,0),(-40,11,14),(-19,0,0),(5,0,-7),(4,0,0)),
        (.36, *READY),
    ],
    'kindle': [
        (0, *READY),
        (.31, (-8,-34,-6),(13,24,0),(-53,-28,39),(-55,0,0),(-18,0,-18),(0,0,0)),
        (.55, (23,32,8),(22,19,-4),(-36,32,15),(-8,0,0),(15,0,-14),(5,0,0)),
        (.86, (11,22,0),(17,20,0),(-41,22,12),(-12,0,0),(5,0,-10),(0,0,0)),
        (1.60, *READY),
    ],
    'ashen-ward': [
        (0, *READY),
        (.31, (-6,22,-7),(-6,18,0),(-30,20,29),(-52,0,0),(-61,5,-23),(30,0,-5)),
        (.53, (-7,31,-9),(-11,22,-5),(-53,38,36),(-20,0,0),(-79,2,-33),(34,-2,-9)),
        (1.12, (-3,21,-5),(-2,14,-3),(-41,27,23),(-23,0,0),(-74,3,-28),(29,2,-5)),
        (1.80, *READY),
    ],
    'undying-coal': [
        (0, *READY),
        (.50, (24,-10,6),(21,-3,-4),(-25,19,24),(-69,0,0),(19,-8,-30),(25,9,3)),
        (.83, (-22,0,1),(-19,4,0),(-91,-12,36),(-15,0,0),(-101,-6,-37),(44,2,7)),
        (1.27, (-13,8,0),(-10,10,5),(-63,14,44),(-27,0,0),(-91,3,-27),(36,2,5)),
        (2.40, *READY),
    ],
    'hurt': [
        (0, *READY),
        (.10, (-19,-14,13),(-14,-13,9),(-21,2,17),(-9,0,0),(17,9,-20),(13,0,0)),
        (.23, (7,3,-5),(10,2,-4),(4,0,3),(0,0,0),(-4,0,-5),(0,0,0)),
        (.47, *READY),
    ],
    'fall': [
        (0, *READY),
        (.27, (23,11,-12),(17,3,-9),(-43,12,22),(-29,0,0),(31,-5,-43),(8,0,0)),
        (.75, (13,9,2),(-5,7,-9),(-51,13,24),(-46,0,0),(-10,6,-25),(29,0,0)),
        (1.30, (8,6,4),(-6,7,-6),(-20,5,28),(-22,0,0),(-15,4,-17),(28,0,0)),
        (1.60, (8,6,4),(-6,7,-6),(-20,5,28),(-22,0,0),(-15,4,-17),(28,0,0)),
    ],
}


def sample(t, keys):
    for (start,*a),(end,*b) in zip(keys,keys[1:]):
        if t <= end:
            f = np.clip((t-start)/(end-start),0,1)
            f = f*f*(3-2*f)
            return np.asarray(a)*(1-f)+np.asarray(b)*f
    return np.asarray(keys[-1][1:])


def cue(t,*keys):
    return sample(t,keys)[0]


def quat(angles):
    a,b,c = np.radians(angles)/2
    return np.array([sin(a)*cos(b)*cos(c)+cos(a)*sin(b)*sin(c),
                     cos(a)*sin(b)*cos(c)-sin(a)*cos(b)*sin(c),
                     cos(a)*cos(b)*sin(c)+sin(a)*sin(b)*cos(c),
                     cos(a)*cos(b)*cos(c)-sin(a)*sin(b)*sin(c)])


def product(a,b):
    return np.r_[a[3]*b[:3]+b[3]*a[:3]+np.cross(a[:3],b[:3]),a[3]*b[3]-a[:3]@b[:3]]


def orient(q,p):
    cross = 2*np.cross(q[:3],p)
    return p+q[3]*cross+np.cross(q[:3],cross)


def inverse(q):
    return np.r_[-q[:3],q[3]]


def animate(doc,parts,cfg,attribute):
    nodes = doc['nodes']
    root = doc['scenes'][0]['nodes'][0]
    nodes[root]['children'] = []
    joints, origins, parents, rests, points = {}, {}, {}, {}, {}
    factor = 1.8/(cfg['foot']-cfg['top'])

    def sheet(p):
        return (np.asarray(p)-[cfg['front'],cfg['foot'],cfg['side']])*[factor,-factor,factor]

    def joint(name,parent,origin):
        origin = np.asarray(origin,float)
        joints[name] = len(nodes)
        origins[name],parents[name] = origin,parent
        rests[name] = origin-origins.get(parent,0)
        nodes.append(dict(name=name,translation=rests[name].tolist(),children=[]))
        nodes[joints.get(parent,root)]['children'].append(joints[name])

    joint('Body',None,(0,0,0))
    joint('Pelvis','Body',(0,.86,0))
    joint('Chest','Pelvis',(0,.98,0))
    joint('Head','Chest',sheet((221,239,1057)))
    for side,s in [('R',-1),('L',1)]:
        joint('Hip'+side,'Pelvis',(s*.225,.60,0))
        joint('Knee'+side,'Hip'+side,(s*.225,.34,0))
        joint('Boot'+side,'Knee'+side,(s*.225,.095,0))
        joint('Coattail'+side,'Pelvis',(s*.12,.92,0))
    joint('ShoulderR','Chest',sheet((110,320,1054)))
    joint('ElbowR','ShoulderR',sheet((83,402,1060)))
    joint('ShoulderL','Chest',sheet((316,313,1049)))
    joint('ElbowL','ShoulderL',sheet((326,406,1063)))
    joint('HandL','ElbowL',sheet((356,357,1195)))
    joint('Lantern','HandL',sheet((375,400,1205)))
    joint('Core','Lantern',sheet((377,534,1212)))
    joint('Lantern handle','Lantern',origins['Lantern'])

    hand = ('Lantern hand','Gripping finger','Gripping thumb')
    for i,((name,_,faces),group) in enumerate(zip(parts,groups('corwin',parts),strict=True)):
        geo = sheet(np.concatenate(faces))
        side = 'R' if geo[:,0].mean()<0 else 'L'
        target = 'Chest'
        if group in ('hood','face') and name!='Neck': target = 'Head'
        elif group.startswith('leg'): target = 'Boot'+side
        elif group=='near arm': target = 'ShoulderR' if name=='Scarred upper arm' else 'ElbowR'
        elif group=='lantern arm':
            target = ('ShoulderL' if name=='Bent sleeve' else 'ElbowL' if name in ('Raised forearm','Raised wrist wrap')
                      else 'HandL' if name in hand else 'Core' if name=='Glowing coal'
                      else 'Lantern handle' if name=='Forged lantern handle' else 'Lantern')
        elif group=='skirt' or 'back mantle fold' in name.lower(): target = 'Coattail'+side
        elif group=='belt' or name=='Inner robe and lower folds' or name=='Ash-stained split stole': target = 'Pelvis'
        nodes[joints[target]]['children'].append(i)
        nodes[i]['translation'] = (-origins[target]).tolist()
        points.setdefault(target,[]).append(geo-origins[target])
    points = {name:np.concatenate(rows) for name,rows in points.items()}

    def mesh(name,triangles,color,glow):
        pos = np.asarray(triangles,float).reshape(-1,3)
        n = np.cross(pos[1::3]-pos[::3],pos[2::3]-pos[::3])
        n /= np.linalg.norm(n,axis=1)[:,None]
        geom = dict(POSITION=attribute(pos,'VEC3',True),NORMAL=attribute(n.repeat(3,0),'VEC3'))
        mat = len(doc['materials'])
        doc['materials'].append(dict(name=name,pbrMetallicRoughness=dict(baseColorFactor=[*color,1],metallicFactor=0),
                                     emissiveFactor=glow,doubleSided=True))
        mesh_index = len(doc['meshes'])
        doc['meshes'].append(dict(name=name,primitives=[dict(attributes=geom,material=mat)]))
        return mesh_index

    rim = [(1,0,0),(0,0,1),(-1,0,0),(0,0,-1)]
    octa = [(tip,a,b) for tip in ((0,1,0),(0,-1,0)) for a,b in zip(rim,rim[1:]+rim[:1])]
    ring = []
    for i in range(24):
        a,b = 2*pi*i/24,2*pi*(i+1)/24
        edge = [(r*cos(t),0,r*sin(t)) for t,r in [(a,.85),(a,1),(b,1),(b,.85)]]
        ring.extend((edge[:3],[edge[0],edge[2],edge[3]]))
    fire = mesh('Ember facets',octa,[1,.36,.034],[1,.28,.02])
    coal = mesh('Dark coals',octa,[.16,.032,.015],[.35,.075,.008])
    ward = mesh('Ward light',ring,[1,.57,.12],[1,.45,.064])
    box = np.array([[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
                    [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]])/2
    sides = [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(0,1,5,4),(3,7,6,2)]
    blocks = [box[list(face)][[0,i,i+1]] for face in sides for i in (1,2)]
    stone = mesh('Ward stone',blocks,[.17,.13,.105],[0,0,0])

    props = []
    def prop(name,geometry,position):
        joint(name,None,position)
        if geometry is not None: nodes[joints[name]]['mesh'] = geometry
        nodes[joints[name]]['scale'] = [0,0,0]
        props.append(name)

    prop('Bolt',fire,(0,0,0))
    prop('Kindle seed',fire,(0,0,0))
    prop('Ward marker',None,(.94,0,.52))
    architecture = [('Base',[0,.07,0],[.43,.14,.43]),('Pier',[0,.28,0],[.30,.42,.30]),
                    ('Crown',[0,.52,0],[.43,.10,.43])]
    architecture += [('Merlon',[x,.61,z],[.10,.10,.10]) for x in (-.16,.16) for z in (-.16,.16)]
    for name,position,size in architecture:
        nodes[joints['Ward marker']]['children'].append(len(nodes))
        nodes.append(dict(name='Ward '+name,mesh=stone,translation=position,scale=size))
    prop('Ward seal',ward,(.94,.035,.52))
    nodes[joints['Ward seal']]['rotation'] = quat((55,0,0)).tolist()
    for i in range(3): prop(f'Coal {i+1}',coal,(.64+.43*i,.035,.56-.2*i))
    for i in range(12): prop(f'Spark {i+1}',fire,(0,0,0))

    identity = quat((0,0,0))

    def world(name,pose):
        p = pose.get((name,'translation'),rests[name])
        q = pose.get((name,'rotation'),identity)
        if parents[name] is None: return np.asarray(p),q
        origin,rotation = world(parents[name],pose)
        return origin+orient(rotation,p),product(rotation,q)

    def lowest(parts,pose):
        return min((p+orient(q,points[part]))[:,1].min()
                   for part in parts for p,q in [world(part,pose)])

    def light(pose,name,position,size):
        pose[name,'translation'] = position
        pose[name,'scale'] = size

    def feet(pose,step,load,phase):
        drop = -.043+.021*(1-cos(2*phase))/2 if step else -.055*load
        pose['Pelvis','translation'] = rests['Pelvis']+[0,drop,0]
        for side,angle in [('R',phase),('L',phase+pi)]:
            z,y,pitch = 0,0,0
            if step:
                stride = (angle/(2*pi))%1
                if stride < .5:
                    z = step*(1-4*stride)
                else:
                    swing = 2*stride-1
                    z = step*(2*swing*swing*(3-2*swing)-1)
                    y = .077*sin(pi*swing)**2
                pitch = cue(stride,(0,-13),(.12,0),(.34,0),(.50,22),(.68,10),(.87,-10),(1,-13))
                # Keep the lowest point of the rolling sole on the foot's path.
                boot = points['Boot'+side]
                rolled = orient(quat((pitch,0,0)),boot)
                contact = rolled[:,1].argmin()
                y += boot[:,1].min()-rolled[contact,1]
                z += boot[contact,2]-rolled[contact,2]
            a,b,down = .26,.245,.505+drop-y
            knee = np.arccos(np.clip((down*down+z*z-a*a-b*b)/(2*a*b),-1,1))
            hip = -np.arctan2(z,down)-np.arctan2(b*sin(knee),a+b*cos(knee))
            pose['Hip'+side,'rotation'] = quat((np.degrees(hip),0,0))
            pose['Knee'+side,'rotation'] = quat((np.degrees(knee),0,0))
            pose['Boot'+side,'rotation'] = quat((pitch-np.degrees(hip+knee),0,0))

    doc['animations'] = []
    lamp_parts = ('Lantern','Lantern handle','Core')
    body_parts = points.keys()-set(lamp_parts)
    release_time = 1.0
    durations = {'idle':2.8,'walk':1.2,**{key:frames[-1][0] for key,frames in CASTS.items()}}
    for name,duration in durations.items():
        times = np.arange(round(duration*30)+1)/30
        tracks = {}
        dropped_lamp = None
        for t in times:
            phase = 2*pi*t/duration
            pose = {(part,'rotation'):identity for part in joints if part not in props}
            pose.update({(part,'translation'):rests[part] for part in joints})
            pose.update({(part,'scale'):[0,0,0] for part in props})
            swing,flare = 0,0
            def turn(part,x=0,y=0,z=0):
                pose[part,'rotation'] = quat((x,y,z))

            if name=='idle':
                turn('Chest',1.8*sin(phase),2.5*sin(phase))
                turn('Head',-.8*sin(phase),-2*sin(phase),sin(phase))
                turn('ShoulderL',2.2*sin(phase),0,-2*sin(phase))
                swing = 3*sin(phase)
            elif name=='walk':
                feet(pose,.16,0,phase)
                turn('Chest',4,-7*sin(phase),3*cos(phase))
                turn('Head',-3,5*sin(phase),-2*cos(phase))
                turn('ShoulderR',25*cos(phase),0,5)
                turn('ElbowR',-8-8*sin(phase))
                turn('ShoulderL',-10*cos(phase),0,-4)
                turn('ElbowL',7*sin(phase))
                turn('CoattailR',-8*cos(phase),0,2)
                turn('CoattailL',8*cos(phase),0,-2)
                swing = 11*cos(phase-.45)
            else:
                names = ['Chest','Head','ShoulderR','ElbowR','ShoulderL','ElbowL']
                for part,angles in zip(names,sample(t,CASTS[name]),strict=True): turn(part,*angles)
                load = cue(t,(0,0),(duration*.32,1),(duration,0))
                if name=='fall':
                    fall = cue(t,(0,0),(.23,.12),(.61,.79),(.97,1),(duration,1))
                    turn('Pelvis',28*fall,-20*fall,96*fall)
                    slump = cue(t,(.77,0),(1.17,1))
                    pose['Chest','rotation'] = product(pose['Chest','rotation'],quat((0,0,20*slump)))
                    turn('HipR',-32*fall,0,8*fall)
                    turn('KneeR',45*fall)
                    turn('HipL',15*fall,0,-7*fall)
                    turn('CoattailL',12*fall,0,-16*fall)
                else:
                    feet(pose,0,load,phase)
                    turn('CoattailL',3*load,0,-4*load)
                    turn('CoattailR',-4*load,0,5*load)
                swing = 20*sin(t*13)*load

            # Keep the cage hanging from the fist rather than rotating with the wrist.
            _,grip = world('HandL',pose)
            tilt = cue(t,(0,0),(.36,0),(.92,84),(1.3,91)) if name=='fall' else 0
            pose['Lantern','rotation'] = product(inverse(grip),quat((swing,0,swing*.33-tilt)))
            pose['Lantern handle','rotation'] = inverse(pose['Lantern','rotation'])
            if name=='fall':
                low = lowest(points if t <= release_time else body_parts,pose)
                settle = cue(t,(0,0),(.2,.03),(.7,1),(1.3,1))
                pose['Body','translation'] = [0,-low,-.24*settle]
                if t >= release_time:
                    if dropped_lamp is None:
                        dropped_lamp = (*world('Lantern',pose),pose['Lantern handle','rotation'],lowest(lamp_parts,pose))
                    release_p,release_q,handle_q,clearance = dropped_lamp
                    travel = cue(t,(release_time,0),(1.50,1))
                    fall = np.clip((t-release_time)/.34,0,1)**2
                    p = release_p+travel*np.array([-.24,0,.48])
                    q = product(quat((-26*travel,0,-16*travel)),release_q)
                    hand_p,hand_q = world('HandL',pose)
                    hand_inv = inverse(hand_q)
                    # Keep the released lamp's path independent of the settling arm.
                    pose['Lantern','rotation'] = product(hand_inv,q)
                    pose['Lantern','translation'] = orient(hand_inv,p-hand_p)
                    pose['Lantern handle','rotation'] = handle_q
                    lift = (1-fall)*clearance-lowest(lamp_parts,pose)
                    pose['Lantern','translation'] += orient(hand_inv,[0,lift,0])

            if name in ('ember-bolt','close-attack','kindle'):
                kindle = name=='kindle'
                close = name=='close-attack'
                release,impact = (.53,.72) if kindle else (.15,.23) if close else (.20,.39)
                p,q = world('ElbowR',pose)
                fist = p+orient(q,sheet((77,510,1105))-origins['ElbowR'])
                target = np.array([.46,.79,.62] if close else [1.13,.065 if kindle else .73,.58])
                travel = np.clip((t-release)/(impact-release),0,1)
                spark = cue(t,(0,0),(release*.56,.024),(release,.076),(impact,.061),(impact+.10,0))
                light(pose,'Kindle seed' if kindle else 'Bolt',(1-travel)*fist+travel*target+[0,(.05 if close else .15)*sin(pi*travel),0],
                      [spark,spark,1.45*spark])
                flare = min(1,spark/.076)
                for i in range(6 if kindle else 4):
                    born = impact+(.06*i if kindle else 0)
                    h = cue(t,(born,0),(born+(.04 if close else .09),.22 if kindle else .11),(duration,0))
                    drift = max(0,t-born)
                    center = target+([.10*i,0,-.10*i] if kindle else [0,0,0])
                    lift = target[1] if close else .04
                    light(pose,f'Spark {i+1}',center+[cos(i*2.4)*.18*drift,lift+h*.6,sin(i*2.4)*.2*drift],[.40*h,h,.42*h])
            if name=='ashen-ward':
                flare = cue(t,(0,0),(.44,0),(.74,1),(1.35,.85),(duration,0))
                marker = cue(t,(0,0),(.22,1),(1.44,1),(duration,0))
                light(pose,'Ward marker',origins['Ward marker'],[marker]*3)
                light(pose,'Ward seal',[.94,.03+.63*flare,.52],[.4*flare,1,.4*flare])
                for i in range(8):
                    a = i*pi/4+phase
                    light(pose,f'Spark {i+1}',[.94+.32*cos(a)*flare,.16+flare*(.36+.14*sin(a*3)),.52+.32*sin(a)*flare],
                          [.043*flare]*3)
                source,_ = world('Core',pose)
                target = np.array([.94,.60,.52])
                for i in range(4):
                    f = (t*2+i/4)%1
                    strength = .029*flare*sin(pi*f)
                    light(pose,f'Spark {i+9}',source*(1-f)+target*f+[0,.15*sin(pi*f),0],[strength]*3)
            if name=='undying-coal':
                flare = cue(t,(0,0),(.49,.52),(.86,1),(1.53,.34),(duration,0))
                for i in range(3):
                    ignite = .94+.17*i
                    center = origins[f'Coal {i+1}']
                    coal_size = cue(t,(0,0),(.39,.063),(ignite,.075),(ignite+.20,.021),(duration,0))
                    light(pose,f'Coal {i+1}',center,[coal_size,.6*coal_size,coal_size])
                    for j in range(4):
                        angle = j*pi/2+i
                        rise = cue(t,(ignite,0),(ignite+.12,.50),(ignite+.43,.34),(ignite+.59,0))
                        radius = .07+.39*np.clip((t-ignite)/.59,0,1)
                        light(pose,f'Spark {4*i+j+1}',center+[radius*cos(angle),rise,radius*sin(angle)],
                              [.13*rise,.44*rise,.13*rise])
            pose['Core','scale'] = [.98+.055*sin(2*phase)+.50*flare]*3
            for track,value in pose.items(): tracks.setdefault(track,[]).append(value)

        clock = attribute(times[:,None],'SCALAR',True)
        clip = dict(name=name,channels=[],samplers=[])
        for (part,path),values in tracks.items():
            output = attribute(values,'VEC4' if path=='rotation' else 'VEC3')
            clip['channels'].append(dict(sampler=len(clip['samplers']),target=dict(node=joints[part],path=path)))
            clip['samplers'].append(dict(input=clock,output=output,interpolation='LINEAR'))
        doc['animations'].append(clip)
