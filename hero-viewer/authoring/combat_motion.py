"""Frame cues for Aldric's three standalone combat previews."""
import json
from pathlib import Path
import subprocess
import numpy as np

GAME_SLASH_BEATS = (0, .13, .19, .36)
WORKSHOP_SLASH_BEATS = (0, .23, .43, .72)

def sample_game_slash(times):
    """Sample the animation shared by the battle renderer and Almanac."""
    module = (Path(__file__).resolve().parents[2]/'src/hero-animation.js').as_uri()
    script = """
import { poseHero } from MODULE;
const times = JSON.parse(process.argv[1]);
const axes = () => ({ rotation: {x:0,y:0,z:0}, position: {} });
const b = axes(), arms = [axes(), axes()], legs = [axes(), axes()];
b.position.set = (x,y,z) => { b.position.y=y; b.position.z=z; };
b.rotation.set = (x,y,z) => { b.rotation.x=x; b.rotation.y=y; };
console.log(JSON.stringify(times.map(time => {
  poseHero({b, arms, legs}, 'aldric', 'slash', time);
  return [b.rotation.x,b.rotation.y,b.position.y,b.position.z,
    arms[0].rotation.x,arms[1].rotation.x,legs[0].rotation.x,legs[1].rotation.x];
})));
""".replace('MODULE',json.dumps(module))
    game_times = np.interp(times, WORKSHOP_SLASH_BEATS, GAME_SLASH_BEATS)
    result = subprocess.check_output(['node','--input-type=module','-e',script,json.dumps(game_times.tolist())],text=True)
    return json.loads(result)

def slash_pose(sample,pose,rotate):
    pitch,turn,lift,forward,sword,shield,step_right,step_left=sample
    # The game rotates the whole body at the floor. Translate the workshop's
    # higher pelvis pivot to preserve that same lean and forward shift.
    pose['Pelvis','translation']=[0,.81*np.cos(pitch)+lift,.81*np.sin(pitch)+forward]
    pitch,turn,sword,shield,step_right,step_left=np.degrees([pitch,turn,sword,shield,step_right,step_left])
    rotate('Pelvis',pitch,turn)
    rotate('ShoulderR',sword*.22,0,-6)
    rotate('ElbowR',sword*.78)
    rotate('ShoulderL',shield*.32)
    rotate('ElbowL',shield*.68)
    rotate('HipR',step_right)
    rotate('HipL',step_left)
    rotate('DrawnSword',90)
    pose['DrawnSword','scale']=[1,1,1]
    pose['SheathedHilt','scale']=[0,0,0]


COMBAT_CLIPS = [('Normal Attack', WORKSHOP_SLASH_BEATS[-1]), ('Taking Damage', 20/30), ('Defeated', .9)]

def combat_pose(name, frame, pose, rotate, origin, planted_leg):
    def cue(*keys):
        frames, values = zip(*keys)
        return np.interp(frame, frames, values)

    def shift(joint, x=0, y=0, z=0):
        pose[joint,'translation'] = (origin[joint] + [x,y,z]).tolist()

    def legs(pelvis, left, right):
        for side, target in [('L',left),('R',right)]:
            for joint, q in zip(('Hip','Knee','Ankle'), planted_leg(side,pelvis,target)):
                pose[joint+side,'rotation'] = q

    recoil=cue((0,0),(3,1),(7,.64),(12,.27),(20,0))
    if name == 'Taking Damage':
        pelvis=np.array([.032*recoil,-.047*recoil,-.070*recoil])
        shift('Pelvis',*pelvis)
        legs(pelvis,(0,0,0),(0,0,0))
        rotate('Chest',-8*recoil,19*recoil,-5*recoil)
        rotate('Head',17*cue((0,0),(3,1),(8,.85),(15,0)),-12*recoil)
        rotate('ShoulderR',20*recoil)
        rotate('ElbowR',-13*recoil)
        shield=cue((0,0),(2,0),(6,1),(11,.57),(20,0))
        rotate('ShoulderL',-12*shield,0,-13*shield)
        rotate('ElbowL',13*shield,11*shield)
        rotate('Cape',cue((0,0),(4,0),(8,-12),(15,4),(20,0)))
        return

    # Rear boot checks the recoil, then the hips and upper back land in order.
    drop=cue((0,0),(4,.06),(9,.39),(14,1),(27,1))
    fall=cue((0,0),(4,.06),(9,.21),(14,.61),(19,1),(27,1))
    shift('Pelvis',.014*fall,-.49*drop,-.43*fall)
    rotate('Pelvis',-88*fall+cue((0,0),(19,0),(27,4)),
           cue((0,0),(14,-7),(27,0)),0)
    rotate('HipR',cue((0,0),(4,14),(9,21),(14,73),(19,-4),(23,-7),(27,-7)),0,-6*fall)
    rotate('KneeR',cue((0,0),(4,5),(9,33),(14,41),(19,25),(24,21),(27,18)))
    rotate('AnkleR',-17*fall)
    rotate('HipL',cue((0,0),(4,-5),(9,-11),(14,39),(19,-13),(23,-16),(27,-16)),0,7*fall)
    rotate('KneeL',cue((0,0),(9,20),(14,33),(19,22),(23,10),(27,9)))
    rotate('AnkleL',5*fall)
    rotate('Chest',cue((0,0),(4,-6),(9,8),(14,24),(19,-1),(27,0)),0,3*fall)
    rotate('Head',cue((0,0),(4,12),(9,18),(14,20),(19,16),(23,12),(27,9)),6*fall)
    rotate('ShoulderL',cue((0,0),(7,11),(14,-28),(20,-13),(27,13)),0,
           cue((0,0),(7,8),(14,22),(21,50),(27,48)))
    rotate('ElbowL',cue((0,0),(19,-10),(27,-8)))
    rotate('ShoulderR',cue((0,0),(4,13),(10,23),(14,43),(20,-13),(27,-18)),0,-34*fall)
    rotate('ElbowR',cue((0,0),(14,7),(21,-12),(27,-9)))
    rotate('Cape',cue((0,0),(7,8),(14,15),(20,0),(27,0)))
    shift('Chest',z=-.075*cue((0,0),(20,0),(27,1)))
