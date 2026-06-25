import { Tracker, POSE_CONNECTIONS } from './tracker.js';
import { Renderer } from './renderer.js';
import { Avatar }   from './avatar.js';
import { Smoother } from './smoother.js';
import { Bridge }   from './bridge.js';

// ── Static DOM refs ────────────────────────────────────────────────────────
const videoEl        = document.getElementById('video');
const skelCanvas     = document.getElementById('skelCanvas');
const skelCtx        = skelCanvas?.getContext('2d') ?? null;
const statusEl       = document.getElementById('status');
const fpsEl          = document.getElementById('fps');
const btnFlip        = document.getElementById('btnFlip');
const btnMirr        = document.getElementById('btnMirror');
const modelSelect    = document.getElementById('modelSelect');
const effectSelect   = document.getElementById('effectSelect');
const chkShowCamera  = document.getElementById('chkShowCamera');
const chkShowSkel    = document.getElementById('chkShowSkel');
const chkShowMesh    = document.getElementById('chkShowMesh');
const chkFreezeYaw   = document.getElementById('chkFreezeYaw');
const chkFreezePitch = document.getElementById('chkFreezePitch');
const chkFreezeRoll  = document.getElementById('chkFreezeRoll');
const chkFlipArmRoll = document.getElementById('chkFlipArmRoll');
const chkHeadChest   = document.getElementById('chkHeadChest');

// ── Skeleton overlay ────────────────────────────────────────────────────────
function resizeSkelCanvas() {
  if (!skelCanvas) return;
  const area = document.getElementById('main-area');
  skelCanvas.width  = area.clientWidth;
  skelCanvas.height = area.clientHeight;
}
window.addEventListener('resize', resizeSkelCanvas);
resizeSkelCanvas();

function drawSkeleton(lms) {
  if (!skelCtx) return;
  const w = skelCanvas.width, h = skelCanvas.height;
  skelCtx.clearRect(0, 0, w, h);
  if (!lms || !lms.length) return;

  skelCtx.strokeStyle = 'rgba(80, 220, 255, 0.8)';
  skelCtx.lineWidth   = 2;
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = lms[a], lb = lms[b];
    if (!la || !lb) continue;
    skelCtx.beginPath();
    skelCtx.moveTo(la.x * w, la.y * h);
    skelCtx.lineTo(lb.x * w, lb.y * h);
    skelCtx.stroke();
  }

  skelCtx.fillStyle = 'rgba(255, 240, 60, 0.9)';
  for (const lm of lms) {
    if (!lm) continue;
    skelCtx.beginPath();
    skelCtx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
    skelCtx.fill();
  }
}

// ── Pose state (per-frame flags, sent live with landmarks) ─────────────────
let mirrored = false;
let swapArms = false;
let flipped  = false; // scene setting but stored here for renderer

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
// Controller: viewFps = local render rate.  modelFps = detection rate.
// Scene:      remoteFps is sent to /remote but not used here.
let viewFps   = 60;
let modelFps  = 30;
let _lastDetectMs = 0;
let _rafFrame = 0, _prevRafNow = 0, _rafInterval = 16.67;

// Interpolation state
let _prevLms = null, _currLms = null, _prevT = 0, _currT = 0;
let _pending = [];

function getLms(now) {
  if (!_currLms) return null;
  if (_pending.length > 1) {
    let best = _pending[0];
    for (const p of _pending) if (p.score > best.score) best = p;
    return best.lms;
  }
  if (_pending.length === 1) return _currLms;
  if (!_prevLms || _currT <= _prevT) return _currLms;
  const t = Math.min((now - _prevT) / (_currT - _prevT), 1.5);
  return _currLms.map((c, i) => {
    const p = _prevLms[i];
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
  const tracker  = new Tracker();
  await tracker.init(modelSelect?.value ?? 'heavy');

  const renderer = new Renderer(document.getElementById('app'));
  const avatar   = new Avatar(renderer.scene);
  const smoother = new Smoother();

  statusEl.textContent = 'Loading avatar…';
  await avatar.load('/mixamo_base.glb');
  statusEl.textContent = 'Ready';

  // Scene background null → Three.js canvas is transparent → camera shows through
  renderer.scene.background = null;

  const bridge = new Bridge();
  let _sceneDirty = true; // flush scene settings to /remote on first render

  // ── CONTROLLER listeners ───────────────────────────────────────────────
  const modelFpsSelect = document.getElementById('modelFpsSelect');
  const viewFpsSelect  = document.getElementById('viewFpsSelect');

  modelFpsSelect?.addEventListener('change', () => {
    modelFps = parseFloat(modelFpsSelect.value);
    _lastDetectMs = 0;
  });
  viewFpsSelect?.addEventListener('change', () => {
    viewFps = parseFloat(viewFpsSelect.value);
  });

  chkShowCamera?.addEventListener('change', () => {
    videoEl.style.visibility = chkShowCamera.checked ? 'visible' : 'hidden';
    localStorage.setItem('so_showCamera', chkShowCamera.checked);
  });

  chkShowSkel?.addEventListener('change', () => {
    if (skelCanvas) skelCanvas.style.visibility = chkShowSkel.checked ? 'visible' : 'hidden';
    if (!chkShowSkel.checked && skelCtx) skelCtx.clearRect(0, 0, skelCanvas.width, skelCanvas.height);
    localStorage.setItem('so_showSkel', chkShowSkel.checked);
  });

  chkShowMesh?.addEventListener('change', () => {
    renderer._gl.domElement.style.visibility = chkShowMesh.checked ? 'visible' : 'hidden';
    localStorage.setItem('so_showMesh', chkShowMesh.checked);
  });

  modelSelect?.addEventListener('change', async () => {
    modelSelect.disabled = true;
    statusEl.textContent = 'Loading model…';
    await tracker.setModel(modelSelect.value);
    statusEl.textContent = 'Ready';
    modelSelect.disabled = false;
  });

  // ── POSE listeners (no _sceneDirty — these go per-frame) ──────────────
  btnMirr?.addEventListener('click', () => {
    mirrored = !mirrored;
    btnMirr.classList.toggle('active', mirrored);
    localStorage.setItem('so_mirrored', mirrored);
  });

  chkFlipArmRoll?.addEventListener('change', () => {
    swapArms = chkFlipArmRoll.checked;
    avatar.resetArmPoles();
  });

  // ── SCENE listeners (mark dirty → flush to /remote) ───────────────────
  const remoteFpsSelect = document.getElementById('remoteFpsSelect');
  const bloomSettings   = document.getElementById('bloomSettings');
  const bloomStr  = document.getElementById('bloomStr');
  const bloomRad  = document.getElementById('bloomRad');
  const bloomThr  = document.getElementById('bloomThr');
  const bloomStrV = document.getElementById('bloomStrV');
  const bloomRadV = document.getElementById('bloomRadV');
  const bloomThrV = document.getElementById('bloomThrV');
  const asciiSettings = document.getElementById('asciiSettings');
  const asciiCellSize = document.getElementById('asciiCellSize');
  const asciiThr  = document.getElementById('asciiThr');
  const asciiThrV = document.getElementById('asciiThrV');
  const camZ = document.getElementById('camZ'), camY = document.getElementById('camY');
  const camX = document.getElementById('camX'), camTY = document.getElementById('camTY');
  const camZV = document.getElementById('camZV'), camYV = document.getElementById('camYV');
  const camXV = document.getElementById('camXV'), camTYV = document.getElementById('camTYV');

  remoteFpsSelect?.addEventListener('change', () => { _sceneDirty = true; });

  btnFlip?.addEventListener('click', () => {
    flipped = !flipped;
    renderer.setFlipped(flipped);
    btnFlip.classList.toggle('active', flipped);
    localStorage.setItem('so_flipped', flipped);
    _sceneDirty = true;
  });

  function applyCamera() {
    const x=parseFloat(camX.value), y=parseFloat(camY.value);
    const z=parseFloat(camZ.value), ty=parseFloat(camTY.value);
    camXV.textContent=x.toFixed(2); camYV.textContent=y.toFixed(2);
    camZV.textContent=z.toFixed(2); camTYV.textContent=ty.toFixed(2);
    renderer.camera.position.set(x, y, z);
    renderer.camera.lookAt(0, ty, 0);
    _sceneDirty = true;
  }
  camZ?.addEventListener('input', applyCamera);
  camY?.addEventListener('input', applyCamera);
  camX?.addEventListener('input', applyCamera);
  camTY?.addEventListener('input', applyCamera);
  document.getElementById('btnResetCam')?.addEventListener('click', () => {
    camZ.value=2.8; camY.value=0; camX.value=0; camTY.value=0;
    applyCamera();
  });

  function applyBloom() {
    const s=parseFloat(bloomStr.value), r=parseFloat(bloomRad.value), t=parseFloat(bloomThr.value);
    bloomStrV.textContent=s.toFixed(2); bloomRadV.textContent=r.toFixed(2); bloomThrV.textContent=t.toFixed(2);
    renderer.updateBloom(s, r, t);
    _sceneDirty = true;
  }
  bloomStr?.addEventListener('input', applyBloom);
  bloomRad?.addEventListener('input', applyBloom);
  bloomThr?.addEventListener('input', applyBloom);

  function applyAsciiThreshold() {
    const t = parseFloat(asciiThr.value);
    asciiThrV.textContent = t.toFixed(2);
    renderer.updateAsciiThreshold(t);
    _sceneDirty = true;
  }
  asciiThr?.addEventListener('input', applyAsciiThreshold);
  asciiCellSize?.addEventListener('change', () => {
    renderer.updateAsciiCellSize(parseFloat(asciiCellSize.value));
    _sceneDirty = true;
  });

  effectSelect?.addEventListener('change', () => {
    const v = effectSelect.value;
    renderer.setEffect(v, parseFloat(bloomStr?.value??0.7), parseFloat(bloomRad?.value??0.15), parseFloat(bloomThr?.value??0.5));
    if (bloomSettings) bloomSettings.style.display = (v==='bloom'||v==='aura') ? 'flex' : 'none';
    if (asciiSettings) asciiSettings.style.display  = v==='ascii' ? 'flex' : 'none';
    if (v==='ascii') applyAsciiThreshold();
    _sceneDirty = true;
  });

  // ── Scene settings snapshot ────────────────────────────────────────────
  function readScene() {
    return {
      remoteFps:  parseFloat(remoteFpsSelect?.value ?? 60),
      flipped,
      effect:     effectSelect?.value      ?? 'none',
      bloomStr:   parseFloat(bloomStr?.value  ?? 0.7),
      bloomRad:   parseFloat(bloomRad?.value  ?? 0.15),
      bloomThr:   parseFloat(bloomThr?.value  ?? 0.5),
      asciiCell:  parseFloat(asciiCellSize?.value ?? 8),
      asciiThr:   parseFloat(asciiThr?.value  ?? 0.05),
      camX:       parseFloat(camX?.value  ?? 0),
      camY:       parseFloat(camY?.value  ?? 0),
      camZ:       parseFloat(camZ?.value  ?? 2.8),
      camTY:      parseFloat(camTY?.value ?? 0),
    };
  }

  bridge.on('req-state', () => bridge.send('scene', readScene()));

  // ── Restore state on reload ────────────────────────────────────────────
  {
    applyCamera();

    swapArms = chkFlipArmRoll?.checked ?? false;
    if (swapArms) avatar.resetArmPoles();

    const eff = effectSelect?.value ?? 'none';
    renderer.setEffect(eff,
      parseFloat(bloomStr?.value??'0.7'),
      parseFloat(bloomRad?.value??'0.15'),
      parseFloat(bloomThr?.value??'0.5'));
    if (bloomSettings) bloomSettings.style.display = (eff==='bloom'||eff==='aura') ? 'flex' : 'none';
    if (asciiSettings) asciiSettings.style.display  = eff==='ascii' ? 'flex' : 'none';
    if (eff==='bloom'||eff==='aura') {
      bloomStrV.textContent=parseFloat(bloomStr.value).toFixed(2);
      bloomRadV.textContent=parseFloat(bloomRad.value).toFixed(2);
      bloomThrV.textContent=parseFloat(bloomThr.value).toFixed(2);
    }
    if (eff==='ascii') {
      if (asciiThr)      applyAsciiThreshold();
      if (asciiCellSize) renderer.updateAsciiCellSize(parseFloat(asciiCellSize.value));
    }

    viewFps  = parseFloat(viewFpsSelect?.value  ?? '60');
    modelFps = parseFloat(modelFpsSelect?.value ?? '30');

    flipped  = localStorage.getItem('so_flipped')  === 'true';
    mirrored = localStorage.getItem('so_mirrored') === 'true';
    renderer.setFlipped(flipped);
    btnFlip?.classList.toggle('active', flipped);
    btnMirr?.classList.toggle('active', mirrored);

    // Restore overlay visibility ('false' means explicitly hidden; default = true)
    const _showCam  = localStorage.getItem('so_showCamera') !== 'false';
    const _showSkel = localStorage.getItem('so_showSkel')   !== 'false';
    const _showMesh = localStorage.getItem('so_showMesh')   !== 'false';
    if (chkShowCamera) chkShowCamera.checked = _showCam;
    if (chkShowSkel)   chkShowSkel.checked   = _showSkel;
    if (chkShowMesh)   chkShowMesh.checked   = _showMesh;
    videoEl.style.visibility = _showCam ? 'visible' : 'hidden';
    if (skelCanvas) skelCanvas.style.visibility = _showSkel ? 'visible' : 'hidden';
    renderer._gl.domElement.style.visibility = _showMesh ? 'visible' : 'hidden';
  }

  // ── Render loop ────────────────────────────────────────────────────────
  function loop(now) {
    requestAnimationFrame(loop);

    // Model step — detect and send pose to /remote
    if (modelFps === 0 || now - _lastDetectMs >= 1000 / modelFps) {
      _lastDetectMs = now;
      tracker.detect(videoEl);
      const raw = tracker.worldLandmarks;
      if (raw) {
        const lms   = smoother.update(raw);
        const score = lms.reduce((s, lm) => s + (lm.visibility ?? 1), 0);
        _pending.push({ lms, score });
        _prevLms = _currLms; _prevT = _currT;
        _currLms = lms;      _currT = now;
        _pushFps(_modelTimes, now);

        // Draw 2D skeleton overlay using normalized landmarks (chkShowSkel gated)
        if (chkShowSkel?.checked) drawSkeleton(tracker.landmarks);

        // POSE group — sent per-frame, ~1 KB
        bridge.send('pose', {
          lms, mirrored, swapArms,
          freezeYaw:   chkFreezeYaw?.checked   ?? true,
          freezePitch: chkFreezePitch?.checked ?? true,
          freezeRoll:  chkFreezeRoll?.checked  ?? true,
          headChest:   chkHeadChest?.checked   ?? false,
        });
      }
    }

    // Render step (controller view FPS)
    if (_prevRafNow > 0) _rafInterval += (now - _prevRafNow - _rafInterval) * 0.05;
    _prevRafNow = now;
    _rafFrame++;
    const skipN = viewFps > 0 ? Math.max(1, Math.round(1000/(_rafInterval*viewFps))) : 1;
    if (_rafFrame % skipN !== 0) return;

    const displayLms = getLms(now);
    _pending = [];

    avatar.update(displayLms, mirrored,
      chkFreezeYaw?.checked??false, chkFreezePitch?.checked??false,
      chkFreezeRoll?.checked??false, chkHeadChest?.checked??false, swapArms);
    renderer.render();

    // Flush scene settings to /remote when anything changed
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
