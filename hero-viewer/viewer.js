import * as THREE from 'three';
import { loadHeroModel } from '../src/hero-model.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import aldricAsset from './assets/aldric.glb?url';
import corwinAsset from './assets/corwin.glb?url';
import PATCHES from '../src/patches.json';

const motionVersions = {
  v1: ['March', 'Shield Wall', 'The Gate Holds'],
  v2: ['March v2', 'Shield Wall v2', 'The Gate Holds v2'],
};

const refs = import.meta.glob('./assets/*.webp', { eager: true, query: '?url', import: 'default' });
export function mountHeroWorkshop(root, { aldricPrototype = aldricAsset } = {}) {
  let motionVersion = 'v2';
  const heroes = {
    aldric: { name: 'Aldric Vane', title: 'The Last Captain', file: aldricPrototype, height: 669, head: 55, sheetHeight: 780, angles: [0,-26,-90,-180], offsets: [-12,-18,-26,2] },
    corwin: { name: 'Corwin Ashguard', title: 'The Ember Warden', file: corwinAsset, height: 695, head: 52, sheetHeight: 800, angles: [0,-23,-90,-180], offsets: [16,35,46,-8] },
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
  $('asset').hidden = root !== document;
  const refURL = (id, preset) => refs['./assets/'+id+'-'+preset+'.webp'];
  for (const id of Object.keys(heroes)) {
    const portrait = $('portrait-'+id);
    portrait.style.backgroundImage = 'url("'+refURL(id,0)+'")';
    portrait.style.backgroundSize = '93px auto';
    portrait.style.backgroundPosition = id === 'aldric' ? '51% -10px' : '45% -13px';
  }

  const stage = $('stage'), reference = $('reference');
  const viewNames = ['Front', 'Three-quarter', 'Side', 'Back'];
  const cache = new Map();
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xfffcf7, 2.62));
  const key = new THREE.DirectionalLight(0xfff3de,.64);
  key.position.set(-3,5,4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe4ecff,.38);
  fill.position.set(3,2,-4); scene.add(fill);

  const shadowImage = document.createElement('canvas');
  shadowImage.width = shadowImage.height = 128;
  const ctx = shadowImage.getContext('2d'), grad = ctx.createRadialGradient(64,64,0,64,64,64);
  grad.addColorStop(0,'rgba(48,40,34,.24)'); grad.addColorStop(.5,'rgba(48,40,34,.14)'); grad.addColorStop(1,'rgba(48,40,34,0)');
  ctx.fillStyle = grad; ctx.fillRect(0,0,128,128);
  const shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map:new THREE.CanvasTexture(shadowImage), depthWrite:false }));
  shadow.renderOrder=-1; scene.add(shadow);
  const fallenShadow=new THREE.Mesh(new THREE.PlaneGeometry(1.28,2.32),new THREE.MeshBasicMaterial({
    map:shadow.material.map,transparent:true,depthWrite:false,side:THREE.DoubleSide,
  }));
  fallenShadow.position.set(0,.002,-.47);
  fallenShadow.rotation.x=-Math.PI/2;
  fallenShadow.renderOrder=-1;
  fallenShadow.visible=false;
  scene.add(fallenShadow);

  const camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,30);
  let renderer, controls, model, canvasWidth=0, canvasHeight=0;
  let mixer, action, selectedMotion='';
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
  function playMotion() {
    mixer.stopAllAction();
    action=null;
    const name=selectedMotion;
    for(const button of $('motion').children) button.setAttribute('aria-pressed',button.dataset.clip===name);
    if(name){
      action=mixer.clipAction(THREE.AnimationClip.findByName(model.animations,name)).reset();
      if(name!=='Idle' && name!=='March' && name!=='March v2') action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      action.play();
    }
    $('play-motion').disabled=$('replay-motion').disabled=!action;
    $('play-motion').textContent='Pause';
    updateFrame();
    resize();
  }
  $('motion').onclick=e=>{
    const button=e.target.closest('button');
    if(!button) return;
    selectedMotion=button.dataset.clip;
    playMotion();
  };
  function renderMotionVersions() {
    const other = motionVersions[motionVersion === 'v1' ? 'v2' : 'v1'];
    for (const button of $('motion-versions').children) {
      button.setAttribute('aria-pressed', button.dataset.version === motionVersion);
    }
    $('motion').replaceChildren(...['', ...model.animations.map(c=>c.name).filter(name=>!other.includes(name))].map(name=>{
      const b=document.createElement('button');
      b.type='button';b.dataset.clip=name;b.textContent=name||'Reference pose';
      return b;
    }));
  }
  $('motion-versions').onclick=e=>{
    const version=e.target.closest('button')?.dataset.version;
    if (!version || version===motionVersion) return;
    const index=motionVersions[motionVersion].indexOf(selectedMotion);
    if (index!==-1) selectedMotion=motionVersions[version][index];
    motionVersion=version;
    renderMotionVersions();
    playMotion();
  };
  $('replay-motion').onclick=playMotion;
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
    const clipName=action?.getClip().name;
    const actionRoom=['Rally the Line','Normal Attack','Defeated'].includes(clipName) ? 1.30 : 1;
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
    camera.position.copy(controls.target).addScaledVector(look.set(sx,0,cx),4);
    controls.update(); resize();
  }
  async function selectHero(id) {
    hero=id;
    const data=heroes[id];
    $('hero-name').textContent=data.name; $('hero-title').textContent=data.title;
    $('asset').href=data.file; $('asset').download=data.name+'.glb';
    for (const b of root.querySelectorAll('button[data-hero]')) b.setAttribute('aria-pressed',b.dataset.hero===id);
    action=null;
    if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model);mixer=null;}
    $('motion-bar').hidden=true;
    $('motion-versions').hidden=true;
    if (model) scene.remove(model);
    model=null;
    selectPreset(preset);
    if (!renderer) return;
    $('status').textContent='Loading model…';
    try {
      if (!cache.has(id)) cache.set(id,loadHeroModel(data.file));
      const loaded=await cache.get(id);
      if (hero!==id) return;
      model=loaded.scene; scene.add(model);
      if(loaded.animations.length){
        model.animations=loaded.animations;
        mixer=new THREE.AnimationMixer(model);
        mixer.addEventListener('finished',()=>{
          $('play-motion').textContent='Resume';
          updateFrame();
        });
        $('motion-versions').hidden=!motionVersions.v2.every(name=>model.animations.some(c=>c.name===name));
        renderMotionVersions();
        selectedMotion=!matchMedia('(prefers-reduced-motion: reduce)').matches && loaded.animations.some(c=>c.name==='Idle') ? 'Idle' : '';
        $('motion-bar').hidden=false;
        playMotion();
      }
      $('status').textContent=''; selectPreset(preset);
    } catch (err) {
      cache.delete(id);
      if(hero===id) $('status').textContent='Model loading failed. Select the hero to retry.';
      console.error(err);
    }
  }
  function init() {
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"}); }
    catch { $('status').textContent='This viewer needs WebGL. Download the GLB to open the model locally.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    stage.append(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);
    controls.enablePan=true; controls.zoomToCursor=true; controls.enableDamping=false; controls.autoRotateSpeed=1.35;
    controls.minZoom=.55; controls.maxZoom=3.5;
    controls.minPolarAngle=.08; controls.maxPolarAngle=Math.PI-.08;
    controls.addEventListener('change',()=>{
      selectedZoom=camera.zoom;
      camera.updateMatrixWorld();
      resize();
      if(model && !free){
        const expected=THREE.MathUtils.degToRad(heroes[hero].angles[preset]);
        if(Math.abs(Math.sin((controls.getAzimuthalAngle()-expected)/2))>.001 || Math.abs(controls.getPolarAngle()-Math.PI/2)>.001) label(true);
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
      look.copy(camera.position).sub(controls.target).normalize();
      const fallen=action?.getClip().name==='Defeated'
        ? THREE.MathUtils.smoothstep(action.time,.48,.86) : 0;
      shadow.position.set(-look.x*.53,.003,-look.z*.53-.53*fallen);
      shadow.scale.set(1.26+.85*Math.abs(look.x)*fallen,.06,1);
      shadow.material.opacity=1-fallen*Math.min(1,Math.abs(look.y)*4);
      fallenShadow.visible=fallen>0;
      fallenShadow.material.opacity=fallen;
      renderer.render(scene,camera); dirty=false;
  }
  init();
  for(const b of root.querySelectorAll('button[data-hero]')) b.onclick=()=>selectHero(b.dataset.hero);
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
      motionVersion = version === 'v1' ? 'v1' : 'v2';
      renderer?.setAnimationLoop(draw);
      void selectHero(initialHero === 'corwin' ? 'corwin' : 'aldric');
    },
    hide() {
      renderer?.setAnimationLoop(null);
    },
  };
}
