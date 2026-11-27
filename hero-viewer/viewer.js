import * as THREE from 'three';
import { loadHeroModel } from '../src/hero-model.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import aldricAsset from './assets/aldric.glb?url';
import corwinAsset from './assets/corwin.glb?url';
import { ALDRIC_V2_CLIPS, HERO_CLIPS } from '../src/hero-animation.js';
import { proceduralWorkshopModel } from './model-versions.js';
import PATCHES from '../src/patches.json';

const clipLabels = { slash: 'Attack', hurt: 'Hit', fall: 'Defeated' };
const looping = new Set(['idle', 'walk']);

const refs = import.meta.glob('./assets/*.webp', { eager: true, query: '?url', import: 'default' });
export function mountHeroWorkshop(root, { back } = {}) {
  let modelVersion = 'v2';
  const heroes = {
    aldric: { name: 'Aldric Vane', title: 'The Last Captain', height: 669, head: 55, sheetHeight: 780, angles: [0,-26,-90,-180], offsets: [-12,-18,-26,2] },
    corwin: { name: 'Corwin Ashguard', title: 'The Ember Warden', height: 695, head: 52, sheetHeight: 800, angles: [0,-23,-90,-180], offsets: [16,35,46,-8] },
  };
  const paths = {
    cube: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10"/>',
    sheet: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="m5 16 5-5 3 2 3-4 4 7"/><circle cx="8" cy="9" r="1"/>',
    rotate: '<path d="M8 8c-4 1-6 3-6 5 0 3 5 5 10 5s10-2 10-5c0-2-2-4-6-5M8 5v6l-4-2"/>',
    spin: '<path d="M4 9c1-5 9-7 14-3l3 3m0-5v5h-5M20 15c-1 5-9 7-14 3l-3-3m0 5v-5h5"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14m-7-7v14"/>',
    reset: '<path d="M4 5v5h5M4 10a8 8 0 1 1 0 5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  };
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+paths[el.dataset.icon]+'</svg>';
  }
  const $ = (id) => root.getElementById(id);
  $('workshop-version').textContent = 'v' + PATCHES[0].v;
  $('workshop-back').hidden = !back;
  if (back) {
    $('workshop-back').onclick = back;
    $('workshop-back').focus();
  }
  const refURL = (id, preset) => refs['./assets/'+id+'-'+preset+'.webp'];

  const stage = $('stage'), reference = $('reference');
  const viewNames = ['Front', 'Three-quarter', 'Side', 'Back'];
  const cache = new Map();
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xfffcf7, 2.62));
  const key = new THREE.DirectionalLight(0xfff3de,.64);
  key.position.set(-3,5,4); scene.add(key);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.normalBias = .015;
  const fill = new THREE.DirectionalLight(0xe4ecff,.38);
  fill.position.set(3,2,-4); scene.add(fill);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(6, .10, 6),
    new THREE.MeshStandardMaterial({ color: 0x74675a, roughness: 1 }));
  floor.position.y = -.05;
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(6, 12, 0x4e4439, 0x4e4439);
  grid.position.y = .002;
  grid.material.transparent = true;
  grid.material.opacity = .26;
  scene.add(floor, grid);

  const camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,30);
  let renderer, controls, model, canvasWidth=0, canvasHeight=0;
  let mixer, action, clips, selectedMotion='idle', request = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const frameRate=30;
  const frameSlider=$('motion-frame');
  function updateFrame(){
    const duration=action?.getClip().duration ?? 0;
    const last=Math.ceil(duration*frameRate-1e-4);
    const time=action?.time ?? 0;
    const frame=time>=duration ? last : Math.round(time*frameRate);
    frameSlider.max=last;
    frameSlider.value=frame;
    frameSlider.disabled=!action;
    $('previous-frame').disabled=!action || frame===0;
    $('next-frame').disabled=!action || frame>=last;
    $('frame-label').textContent=action ? `Frame ${frame} / ${last} · ${time.toFixed(2)} s` : 'Frame —';
  }
  function seekFrame(frame){
    if(!action) return;
    action.paused=true;
    action.time=frame>=Number(frameSlider.max) ? action.getClip().duration : Math.max(frame,0)/frameRate;
    mixer.update(0);
    $('play-motion').textContent='Resume';
    updateFrame();
    dirty=true;
  }
  frameSlider.oninput=()=>seekFrame(Number(frameSlider.value));
  $('previous-frame').onclick=()=>seekFrame(Number(frameSlider.value)-1);
  $('next-frame').onclick=()=>seekFrame(Number(frameSlider.value)+1);
  function playMotion(paused = false) {
    mixer.stopAllAction();
    action=null;
    const name=selectedMotion;
    for(const button of $('motion').children) button.setAttribute('aria-pressed',button.dataset.clip===name);
    if (clips.has(name)) {
      action = mixer.clipAction(clips.get(name)).reset();
      if (!looping.has(name)) action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = paused;
      mixer.update(0);
    }
    $('play-motion').disabled=$('replay-motion').disabled=!action;
    $('play-motion').textContent = paused ? 'Play' : 'Pause';
    updateFrame();
    resize();
  }
  $('motion').onclick=e=>{
    const button=e.target.closest('button');
    if(!button) return;
    selectedMotion=button.dataset.clip;
    playMotion();
  };
  function renderClips() {
    const basics = ['idle', 'walk', 'slash', 'ember-bolt', 'close-attack', 'hurt', 'fall'];
    const ordered = [...basics, ...Object.keys(HERO_CLIPS[hero]).filter(key => !basics.includes(key))];
    $('motion').replaceChildren(...ordered.filter(key => clips.has(key)).map(key => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.clip = key;
      button.textContent = clipLabels[key] ?? HERO_CLIPS[hero][key].name;
      return button;
    }));
  }
  $('replay-motion').onclick=()=>playMotion();
  $('play-motion').onclick=()=>{
    if(!action) return;
    if(action.paused && action.time>=action.getClip().duration){
      playMotion();
      return;
    }
    action.paused=!action.paused;
    $('play-motion').textContent=action.paused?'Resume':'Pause';
  };
  let dirty=true;
  let hero = 'aldric', preset = 0, free = false, selectedZoom = 1, spin = false;
  const look = new THREE.Vector3(), frameCenter = new THREE.Vector3();
  const elevation = Math.PI / 15;
  function setSpin(on) {
    spin = on;
    if (controls) controls.autoRotate = on;
    $('spin').setAttribute('aria-pressed',on);
  }
  function label(isFree) {
    free = isFree;
    for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed',!free && +b.dataset.view===preset);
    $('camera-label').textContent = free ? 'Free orbit' : viewNames[preset]+' camera';
  }
  function resize() {
    dirty=true;
    if (!renderer) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    if(stage.clientWidth!==canvasWidth || stage.clientHeight!==canvasHeight){
      renderer.setSize(w,h,false); canvasWidth=w; canvasHeight=h;
    }
    const actionRoom = ['rally-the-line', 'slash', 'fall'].includes(selectedMotion) ? 1.30
      : hero === 'corwin' && modelVersion === 'v2' && !looping.has(selectedMotion) ? 1.24 : 1;
    const span = actionRoom*Math.max(1.8/.82, 1.38*h/w);
    camera.top=span/2; camera.bottom=-span/2;
    camera.right=span*w/h/2; camera.left=-camera.right;
    camera.updateProjectionMatrix();
    const data=heroes[hero], px = h/span * 1.8/data.height * camera.zoom;
    const refWidth=$('reference-stage').clientWidth;
    reference.style.width=(454*px)+'px';
    reference.style.height=(data.sheetHeight*px)+'px';
    const center = frameCenter.clone().project(camera);
    reference.style.left=((1+center.x)*refWidth/2-227*px)+'px';
    reference.style.top=((1-center.y)*h/2-(data.head+data.height/2)*px)+'px';
    $('zoom-level').value=Math.round(camera.zoom*100)+'%';
    $('minus').disabled=camera.zoom<=.551;
    $('plus').disabled=camera.zoom>=3.49;
  }
  function setZoom(value) {
    selectedZoom=THREE.MathUtils.clamp(value,.55,3.5);
    camera.zoom=selectedZoom; resize();
  }
  function selectPreset(i) {
    preset=i; setSpin(false); label(false);
    reference.src=refURL(hero,preset);
    reference.alt=heroes[hero].name+', '+viewNames[i].toLowerCase()+' reference view';
    $('sheet-note').textContent=viewNames[i]+' view';
    if (!controls) return;
    const data=heroes[hero];
    const angle=THREE.MathUtils.degToRad(data.angles[i]), cx=Math.cos(angle), sx=Math.sin(angle);
    const offset=data.offsets[i]*1.8/data.height;
    frameCenter.set(cx*offset,.9,-sx*offset);
    controls.target.copy(frameCenter);
    camera.position.copy(controls.target).addScaledVector(
      look.set(sx * Math.cos(elevation), Math.sin(elevation), cx * Math.cos(elevation)), 4);
    controls.update(); resize();
  }
  async function selectModel(id, version, resetCamera = false) {
    const currentRequest = ++request;
    const sameHero = hero === id;
    hero = id;
    modelVersion = version;
    const data = heroes[id];
    const file = version === 'v2' ? (id === 'aldric' ? aldricAsset : corwinAsset) : null;
    const key = id + ':' + version;
    const wanted = sameHero ? selectedMotion : 'idle';
    const paused = action?.paused ?? reducedMotion.matches;
    $('hero-select').value = id;
    $('motion-heading').textContent = 'Animations for ' + version;
    $('asset').hidden = !file || !!back;
    if (file) { $('asset').href = file; $('asset').download = data.name + ' ' + version + '.glb'; }
    for (const button of root.querySelectorAll('[data-version]')) {
      button.setAttribute('aria-pressed', button.dataset.version === version);
    }
    action = null;
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); mixer = null; }
    $('motion-bar').hidden = true;
    if (model) scene.remove(model);
    model = null;
    if (resetCamera || !sameHero) selectPreset(preset);
    if (!renderer) return;
    $('status').textContent = 'Loading model…';
    try {
      if (!cache.has(key)) cache.set(key, file
        ? loadHeroModel(file)
        : Promise.resolve(proceduralWorkshopModel(id, version)));
      const loaded = await cache.get(key);
      if (request !== currentRequest) return;
      model = loaded.scene;
      model.traverse(part => {
        if (part.isMesh) part.castShadow = !part.material.transparent;
      });
      scene.add(model);
      clips = new Map(loaded.animations.map(clip => [clip.name, clip]));
      if (file && id === 'aldric') {
        clips = new Map(Object.entries(ALDRIC_V2_CLIPS).map(([action, name]) => [action, clips.get(name)]).filter(([, clip]) => clip));
      }
      mixer = new THREE.AnimationMixer(model);
      mixer.addEventListener('finished', () => {
        $('play-motion').textContent = 'Play';
        updateFrame();
      });
      selectedMotion = clips.has(wanted) ? wanted : 'idle';
      renderClips();
      $('motion-bar').hidden = clips.size === 0;
      playMotion(paused);
      $('status').textContent = '';
      resize();
    } catch (err) {
      cache.delete(key);
      if (request === currentRequest) $('status').textContent = 'Model loading failed. Select the version to retry.';
      console.error(err);
    }
  }
  function init() {
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"}); }
    catch { $('status').textContent='This viewer needs WebGL. Download a GLB to open a model locally.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.append(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);
    controls.enablePan=true; controls.zoomToCursor=true; controls.enableDamping=false; controls.autoRotateSpeed=1.35;
    controls.minZoom=.55; controls.maxZoom=3.5;
    controls.minPolarAngle=.08; controls.maxPolarAngle=Math.PI/2-.04;
    controls.addEventListener('change',()=>{
      selectedZoom=camera.zoom;
      camera.updateMatrixWorld();
      resize();
      if(model && !free){
        const expected=THREE.MathUtils.degToRad(heroes[hero].angles[preset]);
        if(Math.abs(Math.sin((controls.getAzimuthalAngle()-expected)/2))>.001 || Math.abs(controls.getPolarAngle()-(Math.PI/2-elevation))>.001) label(true);
      }
    });
    controls.addEventListener('start',()=>setSpin(false));
    new ResizeObserver(resize).observe(stage);
  }
  const clock=new THREE.Clock();
  function draw() {
      const dt=Math.min(clock.getDelta(),.1);
      if(action && !action.paused){mixer.update(dt);updateFrame();dirty=true;}
      if (!dirty && !spin) return;
      if(spin) controls.update(dt);
      renderer.render(scene,camera); dirty=false;
  }
  init();
  $('hero-select').onchange = e => void selectModel(e.target.value, modelVersion);
  for (const button of root.querySelectorAll('[data-version]')) {
    button.onclick = () => {
      if (button.dataset.version !== modelVersion || !model) void selectModel(hero, button.dataset.version);
    };
  }
  for(const b of root.querySelectorAll('[data-view]')) b.onclick=()=>selectPreset(+b.dataset.view);
  $('plus').onclick=()=>setZoom(camera.zoom*1.2);
  $('minus').onclick=()=>setZoom(camera.zoom/1.2);
  $('reset').onclick=()=>{setZoom(1);selectPreset(preset);};
  $('spin').onclick=()=>{if(controls)setSpin(!spin);};
  stage.onkeydown=e=>{
    if (!controls) return;
    if (e.key==='+'||e.key==='=') setZoom(camera.zoom*1.2);
    else if(e.key==='-') setZoom(camera.zoom/1.2);
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
      const orbit=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      orbit.theta+=e.key==='ArrowLeft'?-.15:e.key==='ArrowRight'?.15:0;
      orbit.phi+=e.key==='ArrowUp'?-.12:e.key==='ArrowDown'?.12:0;
      orbit.makeSafe(); setSpin(false);
      camera.position.setFromSpherical(orbit).add(controls.target); controls.update();
    } else return;
    e.preventDefault();
  };
  return {
    show(initialHero, version) {
      renderer?.setAnimationLoop(draw);
      void selectModel(initialHero === 'corwin' ? 'corwin' : 'aldric', version === 'v1' ? 'v1' : 'v2', !model);
    },
    hide() {
      renderer?.setAnimationLoop(null);
    },
  };
}
