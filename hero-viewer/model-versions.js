import * as THREE from 'three';
import { buildRevisedHero } from '../src/hero-render-model.js';
import { HERO_CLIPS, poseHero } from '../src/hero-animation.js';
import { buildOriginalHero } from './original-model.js';

const boxGeo = new THREE.BoxGeometry();
const G = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  oct: new THREE.OctahedronGeometry(1),
  torus: new THREE.TorusGeometry(1, .14, 5, 16),
};
const finish = { m: (color, { basic } = {}) => basic
  ? new THREE.MeshBasicMaterial({ color })
  : new THREE.MeshStandardMaterial({ color, roughness: .68 }) };

export function makeWorkshopRig(hero, version) {
  const arms = [], legs = [], pivots = { arms, legs };
  let target;
  const builder = version === 'v1' ? buildOriginalHero : buildRevisedHero;
  const model = builder(finish, hero === 'aldric', {
    boxGeo, G,
    R_(kind, position, body) {
      target = undefined;
      if (!kind) return;
      const pivot = new THREE.Group();
      pivot.name = kind + pivots[kind].length;
      pivot.position.set(...position);
      body.add(pivot);
      pivots[kind].push(pivot);
      target = new THREE.Group();
      target.position.copy(pivot.position).negate();
      pivot.add(target);
    },
    add(body, geometry, material, x, y, z, scale, rotation) {
      const part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z);
      if (Array.isArray(scale)) part.scale.set(...scale);
      else part.scale.setScalar(scale);
      if (rotation) part.rotation.set(...rotation);
      (target || body).add(part);
      return part;
    },
  });
  const [b] = model.children;
  b.name = 'body';
  return { model, b, arms, legs };
}

export function proceduralWorkshopModel(hero, version) {
  const rig = makeWorkshopRig(hero, version);
  const { model, b, arms, legs } = rig;
  model.scale.setScalar(1.8 / new THREE.Box3().setFromObject(model).max.y);
  const nodes = [b, ...arms, ...legs];
  const animations = Object.entries(HERO_CLIPS[hero]).map(([key, { motion }]) => {
    const frames = Math.ceil(motion * 30);
    const times = Array.from({ length: frames + 1 }, (_, i) => i * motion / frames);
    const rotations = nodes.map(() => []);
    const positions = [];
    for (const time of times) {
      poseHero(rig, hero, key, time);
      positions.push(...b.position.toArray());
      nodes.forEach((node, i) => rotations[i].push(...node.quaternion.toArray()));
    }
    const tracks = nodes.map((node, i) => new THREE.QuaternionKeyframeTrack(node.name + '.quaternion', times, rotations[i]));
    tracks.push(new THREE.VectorKeyframeTrack('body.position', times, positions));
    return new THREE.AnimationClip(key, motion, tracks);
  });
  poseHero(rig, hero, 'idle', 0);
  return { scene: model, animations };
}
