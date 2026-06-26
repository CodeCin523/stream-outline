import { Tracker } from './tracker.js';
import { Renderer } from './renderer.js';
import { Avatar }   from './avatar.js';
import { Skeleton } from './skeleton.js';
import { Smoother } from './smoother.js';
import { Bridge }   from './bridge.js';

// ── Persistence helpers ────────────────────────────────────────────────────
const save     = (k, v)   => localStorage.setItem('so_' + k, String(v));
const load     = (k, def) => { const v = localStorage.getItem('so_' + k); return v !== null ? v : String(def); };
const loadBool = (k, def) => { const v = localStorage.getItem('so_' + k); return v !== null ? v === 'true' : def; };

// ── Static DOM refs ────────────────────────────────────────────────────────
const videoEl           = document.getElementById('video');
const statusEl          = document.getElementById('status');
const fpsEl             = document.getElementById('fps');
const btnFlip           = document.getElementById('btnFlip');
const btnMirr           = document.getElementById('btnMirror');
const modelSelect       = document.getElementById('modelSelect');
const modelFpsSelect    = document.getElementById('modelFpsSelect');
const viewFpsSelect     = document.getElementById('viewFpsSelect');
const remoteFpsSelect   = document.getElementById('remoteFpsSelect');
const effectSelect      = document.getElementById('effectSelect');
const chkShowCamera     = document.getElementById('chkShowCamera');
const chkShowSkel3d     = document.getElementById('chkShowSkel3d');
const chkShowSkelSmooth = document.getElementById('chkShowSkelSmooth');
const chkShowSkelInterp = document.getElementById('chkShowSkelInterp');
const chkShowMesh       = document.getElementById('chkShowMesh');
const chkFreezeYaw      = document.getElementById('chkFreezeYaw');
const chkFreezePitch    = document.getElementById('chkFreezePitch');
const chkFreezeRoll     = document.getElementById('chkFreezeRoll');
const chkFlipArmRoll    = document.getElementById('chkFlipArmRoll');
const chkHeadChest      = document.getElementById('chkHeadChest');
const minVisSlider      = document.getElementById('minVis');
const minVisV           = document.getElementById('minVisV');
const smoothAlphaSlider = document.getElementById('smoothAlpha');
const smoothAlphaV      = document.getElementById('smoothAlphaV');
const skelYSlider       = document.getElementById('skelY');
const skelYV            = document.getElementById('skelYV');

// ── Pose state ─────────────────────────────────────────────────────────────
let mirrored = false;
let swapArms = false;
let flipped  = false;

// ── FPS counters ───────────────────────────────────────────────────────────
let _renderTimes = [], _modelTimes = [];

function _pushFps(ring, now) {
  ring.push(now);
  while (ring.length > 1 && now - ring[0] > 1000) ring.shift();
}
function updateFpsDisplay(now) {
  _pushFps(_renderTimes, now);
  fpsEl.textContent = `${Math.max(0,_renderTimes.length-1)}r ${Math.max(0,_modelTimes.length-1)}m fps`;
}

// ── Scheduling ─────────────────────────────────────────────────────────────
let viewFps   = 60;
let modelFps  = 30;
let _lastDetectMs = 0;
let _rafFrame = 0, _prevRafNow = 0, _rafInterval = 16.67;

let _prevLms = null, _currLms = null, _prevT = 0, _currT = 0;
let _pending = [];

function getLms(now) {
  if (!_currLms) return null;
  if (_pending.length > 1) {
    // Detect faster than render — pick the highest-confidence sample
    let best = _pending[0];
    for (const p of _pending) if (p.score > best.score) best = p;
    return best.lms;
  }
  // Detect slower than render — slide from _prevLms toward _currLms in the
  // interval that follows the detection. This gives smooth motion at the cost
  // of exactly one detect-period of display lag (e.g. 200 ms at 5 fps).
  if (!_prevLms || _currT <= _prevT) return _currLms;
  const interval = _currT - _prevT;
  const t = Math.max(0, Math.min((now - _currT) / interval, 1.5));
  return _prevLms.map((p, i) => {
    const c = _currLms[i];
    return { x: p.x+(c.x-p.x)*t, y: p.y+(c.y-p.y)*t, z: p.z+(c.z-p.z)*t, visibility: c.visibility };
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  statusEl.textContent = 'Opening camera…';

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user', frameRate:{ideal:30} },
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise(r => { videoEl.onloadedmetadata = r; });
  await videoEl.play();

  statusEl.textContent = 'Loading model…';
  const tracker = new Tracker();
  await tracker.init(load('model', 'heavy'));

  const renderer = new Renderer(document.getElementById('app'));
  const avatar   = new Avatar(renderer.scene);
  const smoother = new Smoother();

  statusEl.textContent = 'Loading avatar…';
  await avatar.load('/mixamo_base.glb');
  statusEl.textContent = 'Ready';

  const skeleton3d     = new Skeleton(renderer.scene, { minVisibility: 0, color: 0xff5500 });
  const skeletonSmooth = new Skeleton(renderer.scene, { minVisibility: 0, color: 0x00aaff });
  const skeletonInterp = new Skeleton(renderer.scene, { minVisibility: 0, color: 0x00ff88 });
  skeleton3d.group.visible     = false;
  skeletonSmooth.group.visible = false;
  skeletonInterp.group.visible = false;

  renderer.scene.background = null;

  const bridge = new Bridge();
  let _sceneDirty = true;

  // ── Scene-scoped DOM refs ─────────────────────────────────────────────────
  const bloomSettings = document.getElementById('bloomSettings');
  const bloomStr      = document.getElementById('bloomStr');
  const bloomRad      = document.getElementById('bloomRad');
  const bloomThr      = document.getElementById('bloomThr');
  const bloomStrV     = document.getElementById('bloomStrV');
  const bloomRadV     = document.getElementById('bloomRadV');
  const bloomThrV     = document.getElementById('bloomThrV');
  const asciiSettings = document.getElementById('asciiSettings');
  const asciiCellSize = document.getElementById('asciiCellSize');
  const asciiThr      = document.getElementById('asciiThr');
  const asciiThrV     = document.getElementById('asciiThrV');
  const camZ  = document.getElementById('camZ'),  camY  = document.getElementById('camY');
  const camX  = document.getElementById('camX'),  camTY = document.getElementById('camTY');
  const camZV = document.getElementById('camZV'), camYV = document.getElementById('camYV');
  const camXV = document.getElementById('camXV'), camTYV = document.getElementById('camTYV');

  // ── Apply functions ───────────────────────────────────────────────────────
  function applySkelY() {
    const y = parseFloat(skelYSlider?.value ?? 0.9);
    if (skelYV) skelYV.textContent = y.toFixed(2);
    skeleton3d.group.position.y     = y;
    skeletonSmooth.group.position.y = y;
    skeletonInterp.group.position.y = y;
    save('skelY', y);
  }

  function applyCamera() {
    const x=parseFloat(camX.value), y=parseFloat(camY.value);
    const z=parseFloat(camZ.value), ty=parseFloat(camTY.value);
    camXV.textContent=x.toFixed(2); camYV.textContent=y.toFixed(2);
    camZV.textContent=z.toFixed(2); camTYV.textContent=ty.toFixed(2);
    renderer.camera.position.set(x, y, z);
    renderer.camera.lookAt(0, ty, 0);
    save('camX', x); save('camY', y); save('camZ', z); save('camTY', ty);
    _sceneDirty = true;
  }

  function applyBloom() {
    const s=parseFloat(bloomStr.value), r=parseFloat(bloomRad.value), t=parseFloat(bloomThr.value);
    bloomStrV.textContent=s.toFixed(2); bloomRadV.textContent=r.toFixed(2); bloomThrV.textContent=t.toFixed(2);
    renderer.updateBloom(s, r, t);
    save('bloomStr', s); save('bloomRad', r); save('bloomThr', t);
    _sceneDirty = true;
  }

  function applyAsciiThreshold() {
    const t = parseFloat(asciiThr.value);
    asciiThrV.textContent = t.toFixed(2);
    renderer.updateAsciiThreshold(t);
    save('asciiThr', t);
    _sceneDirty = true;
  }

  function applyEffect(v) {
    renderer.setEffect(v, parseFloat(bloomStr?.value??0.7), parseFloat(bloomRad?.value??0.15), parseFloat(bloomThr?.value??0.5));
    if (bloomSettings) bloomSettings.style.display = (v==='bloom'||v==='aura') ? 'flex' : 'none';
    if (asciiSettings) asciiSettings.style.display  = v==='ascii' ? 'flex' : 'none';
    if (v==='ascii') applyAsciiThreshold();
  }

  // ── Controller listeners ──────────────────────────────────────────────────
  chkShowCamera?.addEventListener('change', () => {
    videoEl.style.visibility = chkShowCamera.checked ? 'visible' : 'hidden';
    save('showCamera', chkShowCamera.checked);
  });

  skelYSlider?.addEventListener('input', applySkelY);

  chkShowSkel3d?.addEventListener('change', () => {
    if (!chkShowSkel3d.checked) skeleton3d.group.visible = false;
    save('showSkel3d', chkShowSkel3d.checked);
  });

  chkShowSkelSmooth?.addEventListener('change', () => {
    if (!chkShowSkelSmooth.checked) skeletonSmooth.group.visible = false;
    save('showSkelSmooth', chkShowSkelSmooth.checked);
  });

  chkShowSkelInterp?.addEventListener('change', () => {
    if (!chkShowSkelInterp.checked) skeletonInterp.group.visible = false;
    save('showSkelInterp', chkShowSkelInterp.checked);
  });

  chkShowMesh?.addEventListener('change', () => {
    save('showMesh', chkShowMesh.checked);
  });

  // ── Detect / preview rate selects ─────────────────────────────────────────
  modelSelect?.addEventListener('change', async () => {
    modelSelect.disabled = true;
    statusEl.textContent = 'Loading model…';
    await tracker.setModel(modelSelect.value);
    statusEl.textContent = 'Ready';
    modelSelect.disabled = false;
    save('model', modelSelect.value);
  });

  modelFpsSelect?.addEventListener('change', () => {
    modelFps = parseFloat(modelFpsSelect.value);
    _lastDetectMs = 0;
    save('modelFps', modelFpsSelect.value);
  });

  viewFpsSelect?.addEventListener('change', () => {
    viewFps = parseFloat(viewFpsSelect.value);
    save('viewFps', viewFpsSelect.value);
  });

  // ── Pose listeners ────────────────────────────────────────────────────────
  btnMirr?.addEventListener('click', () => {
    mirrored = !mirrored;
    btnMirr.classList.toggle('active', mirrored);
    save('mirrored', mirrored);
  });

  chkFlipArmRoll?.addEventListener('change', () => {
    swapArms = chkFlipArmRoll.checked;
    avatar.resetArmPoles();
    save('flipArmRoll', chkFlipArmRoll.checked);
  });

  chkFreezeYaw?.addEventListener('change',   () => save('freezeYaw',   chkFreezeYaw.checked));
  chkFreezePitch?.addEventListener('change', () => save('freezePitch', chkFreezePitch.checked));
  chkFreezeRoll?.addEventListener('change',  () => save('freezeRoll',  chkFreezeRoll.checked));
  chkHeadChest?.addEventListener('change',   () => save('headChest',   chkHeadChest.checked));

  minVisSlider?.addEventListener('input', () => {
    const v = parseFloat(minVisSlider.value);
    avatar.minVisibility = v;
    minVisV.textContent  = v.toFixed(2);
    save('minVis', v);
  });

  smoothAlphaSlider?.addEventListener('input', () => {
    const v = parseFloat(smoothAlphaSlider.value);
    smoother._alpha      = v;
    smoothAlphaV.textContent = v.toFixed(2);
    save('smoothAlpha', v);
  });

  // ── Scene listeners ───────────────────────────────────────────────────────
  btnFlip?.addEventListener('click', () => {
    flipped = !flipped;
    renderer.setFlipped(flipped);
    btnFlip.classList.toggle('active', flipped);
    save('flipped', flipped);
    _sceneDirty = true;
  });

  remoteFpsSelect?.addEventListener('change', () => {
    save('remoteFps', remoteFpsSelect.value);
    _sceneDirty = true;
  });

  effectSelect?.addEventListener('change', () => {
    const v = effectSelect.value;
    applyEffect(v);
    save('effect', v);
    _sceneDirty = true;
  });

  asciiCellSize?.addEventListener('change', () => {
    renderer.updateAsciiCellSize(parseFloat(asciiCellSize.value));
    save('asciiCell', asciiCellSize.value);
    _sceneDirty = true;
  });

  camZ?.addEventListener('input', applyCamera);
  camY?.addEventListener('input', applyCamera);
  camX?.addEventListener('input', applyCamera);
  camTY?.addEventListener('input', applyCamera);
  document.getElementById('btnResetCam')?.addEventListener('click', () => {
    camZ.value=2.8; camY.value=0; camX.value=0; camTY.value=0;
    applyCamera();
  });

  bloomStr?.addEventListener('input', applyBloom);
  bloomRad?.addEventListener('input', applyBloom);
  bloomThr?.addEventListener('input', applyBloom);

  asciiThr?.addEventListener('input', applyAsciiThreshold);

  // ── Scene snapshot ────────────────────────────────────────────────────────
  function readScene() {
    return {
      remoteFps: parseFloat(remoteFpsSelect?.value ?? '60'),
      flipped,
      effect:    effectSelect?.value ?? 'none',
      bloomStr:  parseFloat(bloomStr?.value  ?? 0.7),
      bloomRad:  parseFloat(bloomRad?.value  ?? 0.15),
      bloomThr:  parseFloat(bloomThr?.value  ?? 0.5),
      asciiCell: parseFloat(asciiCellSize?.value ?? '8'),
      asciiThr:  parseFloat(asciiThr?.value  ?? 0.05),
      camX:      parseFloat(camX?.value  ?? 0),
      camY:      parseFloat(camY?.value  ?? 0),
      camZ:      parseFloat(camZ?.value  ?? 2.8),
      camTY:     parseFloat(camTY?.value ?? 0),
    };
  }

  bridge.on('req-state', () => bridge.send('scene', readScene()));

  // ── Restore all settings ──────────────────────────────────────────────────
  {
    const restoreChk = (el, key, defaultOn) => {
      if (!el) return;
      const v = localStorage.getItem('so_' + key);
      el.checked = v !== null ? v === 'true' : defaultOn;
    };

    // Selects
    if (modelSelect)    modelSelect.value    = load('model',     'heavy');
    if (modelFpsSelect) modelFpsSelect.value = load('modelFps',  '30');
    if (viewFpsSelect)  viewFpsSelect.value  = load('viewFps',   '60');
    if (remoteFpsSelect) remoteFpsSelect.value = load('remoteFps','60');
    if (asciiCellSize)  asciiCellSize.value  = load('asciiCell', '8');
    const savedEffect = load('effect', 'none');
    if (effectSelect)   effectSelect.value   = savedEffect;

    // Sliders
    if (bloomStr)     bloomStr.value     = load('bloomStr',  0.7);
    if (bloomRad)     bloomRad.value     = load('bloomRad',  0.15);
    if (bloomThr)     bloomThr.value     = load('bloomThr',  0.5);
    if (asciiThr)     asciiThr.value     = load('asciiThr',  0.05);
    if (camZ)         camZ.value         = load('camZ',      2.8);
    if (camY)         camY.value         = load('camY',      0);
    if (camX)         camX.value         = load('camX',      0);
    if (camTY)        camTY.value        = load('camTY',     0);
    if (minVisSlider)      minVisSlider.value      = load('minVis',      0.4);
    if (smoothAlphaSlider) smoothAlphaSlider.value = load('smoothAlpha', 0.35);
    if (skelYSlider)       skelYSlider.value        = load('skelY',       0.9);

    // Checkboxes
    restoreChk(chkFreezeYaw,   'freezeYaw',   true);
    restoreChk(chkFreezePitch, 'freezePitch', true);
    restoreChk(chkFreezeRoll,  'freezeRoll',  true);
    restoreChk(chkFlipArmRoll, 'flipArmRoll', false);
    restoreChk(chkHeadChest,   'headChest',   false);

    // Apply
    applyCamera();
    applySkelY();

    if (minVisSlider) {
      avatar.minVisibility = parseFloat(minVisSlider.value);
      minVisV.textContent  = parseFloat(minVisSlider.value).toFixed(2);
    }
    if (smoothAlphaSlider) {
      smoother._alpha          = parseFloat(smoothAlphaSlider.value);
      smoothAlphaV.textContent = parseFloat(smoothAlphaSlider.value).toFixed(2);
    }

    swapArms = chkFlipArmRoll?.checked ?? false;
    if (swapArms) avatar.resetArmPoles();

    applyEffect(savedEffect);
    if (savedEffect==='bloom'||savedEffect==='aura') applyBloom();
    if (savedEffect==='ascii') renderer.updateAsciiCellSize(parseFloat(asciiCellSize?.value ?? '8'));

    viewFps  = parseFloat(viewFpsSelect?.value  ?? '60');
    modelFps = parseFloat(modelFpsSelect?.value ?? '30');

    flipped  = loadBool('flipped',  false);
    mirrored = loadBool('mirrored', false);
    renderer.setFlipped(flipped);
    btnFlip?.classList.toggle('active', flipped);
    btnMirr?.classList.toggle('active', mirrored);

    restoreChk(chkShowCamera,     'showCamera',     true);
    restoreChk(chkShowSkel3d,     'showSkel3d',     false);
    restoreChk(chkShowSkelSmooth, 'showSkelSmooth', false);
    restoreChk(chkShowSkelInterp, 'showSkelInterp', false);
    restoreChk(chkShowMesh,       'showMesh',       true);
    videoEl.style.visibility = chkShowCamera?.checked ? 'visible' : 'hidden';
  }

  // ── Render loop ────────────────────────────────────────────────────────────
  function loop(now) {
    requestAnimationFrame(loop);

    if (modelFps === 0 || now - _lastDetectMs >= 1000 / modelFps) {
      _lastDetectMs = now;
      tracker.detect(videoEl);
      const raw = tracker.worldLandmarks;
      if (raw) {
        const smoothed = smoother.update(raw);
        // Snapshot the smoother's mutable buffer — without this, _prevLms and
        // _currLms share the same array and interpolation produces zero delta.
        const lms = smoothed.map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
        const score = lms.reduce((s, lm) => s + (lm.visibility ?? 1), 0);
        _pending.push({ lms, score });
        _prevLms = _currLms; _prevT = _currT;
        _currLms = lms;      _currT = now;
        _pushFps(_modelTimes, now);

        if (chkShowSkelSmooth?.checked) skeletonSmooth.update(smoothed, mirrored);
        else skeletonSmooth.group.visible = false;
      }

      if (chkShowSkel3d?.checked) skeleton3d.update(tracker.worldLandmarks, mirrored);
      else skeleton3d.group.visible = false;
    }

    if (_prevRafNow > 0) _rafInterval += (now - _prevRafNow - _rafInterval) * 0.05;
    _prevRafNow = now;
    _rafFrame++;
    const skipN = viewFps > 0 ? Math.max(1, Math.round(1000/(_rafInterval*viewFps))) : 1;
    if (_rafFrame % skipN !== 0) return;

    const displayLms = getLms(now);
    _pending = [];

    if (chkShowSkelInterp?.checked) skeletonInterp.update(displayLms, mirrored);
    else skeletonInterp.group.visible = false;

    avatar.update(displayLms, mirrored,
      chkFreezeYaw?.checked??false, chkFreezePitch?.checked??false,
      chkFreezeRoll?.checked??false, chkHeadChest?.checked??false, swapArms);

    // Extract bones while avatar considers itself visible, then override local
    // visibility — the remote always receives bones regardless of this toggle.
    const boneData = avatar.getBoneQuaternions();
    if (boneData) bridge.send('bones', boneData);
    if (avatar._model) avatar._model.visible = chkShowMesh?.checked ?? true;

    renderer.render();

    if (_sceneDirty) {
      bridge.send('scene', readScene());
      _sceneDirty = false;
    }

    updateFpsDisplay(now);
  }

  requestAnimationFrame(loop);
}

main().catch(err => {
  console.error(err);
  statusEl.textContent = 'Error: ' + err.message;
});
