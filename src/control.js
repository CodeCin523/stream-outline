import { Bridge } from './bridge.js';

const bridge = new Bridge();

// ── Element refs (same IDs as index.html) ────────────────────────────────────
const previewEl     = document.getElementById('preview');
const placeholderEl = document.getElementById('preview-placeholder');
const statusEl      = document.getElementById('ctrl-status');

const modelSelect      = document.getElementById('modelSelect');
const renderFpsSelect  = document.getElementById('renderFpsSelect');
const modelFpsSelect   = document.getElementById('modelFpsSelect');
const previewFpsSelect = document.getElementById('previewFpsSelect');
const effectSelect     = document.getElementById('effectSelect');
const bloomSettings    = document.getElementById('bloomSettings');
const bloomStr   = document.getElementById('bloomStr');
const bloomRad   = document.getElementById('bloomRad');
const bloomThr   = document.getElementById('bloomThr');
const bloomStrV  = document.getElementById('bloomStrV');
const bloomRadV  = document.getElementById('bloomRadV');
const bloomThrV  = document.getElementById('bloomThrV');
const asciiSettings  = document.getElementById('asciiSettings');
const asciiCellSize  = document.getElementById('asciiCellSize');
const asciiThr   = document.getElementById('asciiThr');
const asciiThrV  = document.getElementById('asciiThrV');
const camX   = document.getElementById('camX');
const camY   = document.getElementById('camY');
const camZ   = document.getElementById('camZ');
const camTY  = document.getElementById('camTY');
const camXV  = document.getElementById('camXV');
const camYV  = document.getElementById('camYV');
const camZV  = document.getElementById('camZV');
const camTYV = document.getElementById('camTYV');
const chkFreezeYaw   = document.getElementById('chkFreezeYaw');
const chkFreezePitch = document.getElementById('chkFreezePitch');
const chkFreezeRoll  = document.getElementById('chkFreezeRoll');
const chkHeadChest   = document.getElementById('chkHeadChest');
const chkFlipArmRoll = document.getElementById('chkFlipArmRoll');
const btnBg    = document.getElementById('btnBg');
const btnFlip  = document.getElementById('btnFlip');
const btnMirror = document.getElementById('btnMirror');

// Local toggle state (mirrors what OBS has)
let mirrored = false;
let flipped  = false;
let whiteBg  = false;

// ── Read current control panel state into a settings object ─────────────────
function readControls() {
  return {
    modelKey:    modelSelect?.value       ?? 'heavy',
    renderFps:   parseFloat(renderFpsSelect?.value  ?? 0),
    modelFps:    parseFloat(modelFpsSelect?.value   ?? 30),
    previewFps:  parseFloat(previewFpsSelect?.value ?? 20),
    effect:      effectSelect?.value      ?? 'none',
    bloomStr:    parseFloat(bloomStr?.value  ?? 0.7),
    bloomRad:    parseFloat(bloomRad?.value  ?? 0.15),
    bloomThr:    parseFloat(bloomThr?.value  ?? 0.5),
    asciiCell:   parseFloat(asciiCellSize?.value ?? 8),
    asciiThr:    parseFloat(asciiThr?.value  ?? 0.05),
    camX:        parseFloat(camX?.value  ?? 0),
    camY:        parseFloat(camY?.value  ?? 0),
    camZ:        parseFloat(camZ?.value  ?? 2.8),
    camTY:       parseFloat(camTY?.value ?? 0),
    freezeYaw:   chkFreezeYaw?.checked   ?? true,
    freezePitch: chkFreezePitch?.checked ?? true,
    freezeRoll:  chkFreezeRoll?.checked  ?? true,
    headChest:   chkHeadChest?.checked   ?? false,
    swapArms:    chkFlipArmRoll?.checked ?? false,
    mirrored, flipped, whiteBg,
  };
}

function sendSettings() { bridge.send('settings', readControls()); }

// ── Display helpers ──────────────────────────────────────────────────────────
function updateBloomDisplay() {
  if (bloomStrV) bloomStrV.textContent = parseFloat(bloomStr.value).toFixed(2);
  if (bloomRadV) bloomRadV.textContent = parseFloat(bloomRad.value).toFixed(2);
  if (bloomThrV) bloomThrV.textContent = parseFloat(bloomThr.value).toFixed(2);
}
function updateAsciiDisplay() {
  if (asciiThrV) asciiThrV.textContent = parseFloat(asciiThr.value).toFixed(2);
}
function updateCamDisplay() {
  if (camXV)  camXV.textContent  = parseFloat(camX.value).toFixed(2);
  if (camYV)  camYV.textContent  = parseFloat(camY.value).toFixed(2);
  if (camZV)  camZV.textContent  = parseFloat(camZ.value).toFixed(2);
  if (camTYV) camTYV.textContent = parseFloat(camTY.value).toFixed(2);
}
function updateEffectVisibility(v) {
  if (bloomSettings) bloomSettings.style.display = (v === 'bloom' || v === 'aura') ? 'flex' : 'none';
  if (asciiSettings) asciiSettings.style.display  = v === 'ascii' ? 'flex' : 'none';
}

// ── Init all controls from an OBS state snapshot ────────────────────────────
function initFromState(s) {
  if (s.modelKey && modelSelect) modelSelect.value = s.modelKey;
  if (s.renderFps  !== undefined && renderFpsSelect)  renderFpsSelect.value  = String(s.renderFps);
  if (s.modelFps   !== undefined && modelFpsSelect)   modelFpsSelect.value   = String(s.modelFps);
  if (s.previewFps !== undefined && previewFpsSelect) previewFpsSelect.value = String(s.previewFps);

  if (s.effect && effectSelect) { effectSelect.value = s.effect; updateEffectVisibility(s.effect); }

  if (s.bloomStr !== undefined && bloomStr) bloomStr.value = String(s.bloomStr);
  if (s.bloomRad !== undefined && bloomRad) bloomRad.value = String(s.bloomRad);
  if (s.bloomThr !== undefined && bloomThr) bloomThr.value = String(s.bloomThr);
  updateBloomDisplay();

  if (s.asciiCell !== undefined && asciiCellSize) asciiCellSize.value = String(s.asciiCell);
  if (s.asciiThr  !== undefined && asciiThr)      asciiThr.value      = String(s.asciiThr);
  updateAsciiDisplay();

  if (s.camX  !== undefined && camX)  camX.value  = String(s.camX);
  if (s.camY  !== undefined && camY)  camY.value  = String(s.camY);
  if (s.camZ  !== undefined && camZ)  camZ.value  = String(s.camZ);
  if (s.camTY !== undefined && camTY) camTY.value = String(s.camTY);
  updateCamDisplay();

  if (s.freezeYaw   !== undefined && chkFreezeYaw)   chkFreezeYaw.checked   = s.freezeYaw;
  if (s.freezePitch !== undefined && chkFreezePitch)  chkFreezePitch.checked = s.freezePitch;
  if (s.freezeRoll  !== undefined && chkFreezeRoll)   chkFreezeRoll.checked  = s.freezeRoll;
  if (s.headChest   !== undefined && chkHeadChest)    chkHeadChest.checked   = s.headChest;
  if (s.swapArms    !== undefined && chkFlipArmRoll)  chkFlipArmRoll.checked = s.swapArms;

  mirrored = s.mirrored ?? false;
  flipped  = s.flipped  ?? false;
  whiteBg  = s.whiteBg  ?? false;

  btnMirror?.classList.toggle('active', mirrored);
  btnFlip?.classList.toggle('active', flipped);
  btnBg?.classList.toggle('active', whiteBg);
  if (btnBg) btnBg.textContent = whiteBg ? 'White BG' : 'Black BG';

  statusEl.textContent = 'Connected';
  statusEl.classList.add('ok');
}

// ── Event listeners ──────────────────────────────────────────────────────────
modelSelect?.addEventListener('change', sendSettings);
renderFpsSelect?.addEventListener('change', sendSettings);
modelFpsSelect?.addEventListener('change', sendSettings);
previewFpsSelect?.addEventListener('change', sendSettings);

effectSelect?.addEventListener('change', () => {
  updateEffectVisibility(effectSelect.value);
  sendSettings();
});

bloomStr?.addEventListener('input', () => { updateBloomDisplay(); sendSettings(); });
bloomRad?.addEventListener('input', () => { updateBloomDisplay(); sendSettings(); });
bloomThr?.addEventListener('input', () => { updateBloomDisplay(); sendSettings(); });

asciiCellSize?.addEventListener('change', sendSettings);
asciiThr?.addEventListener('input', () => { updateAsciiDisplay(); sendSettings(); });

camX?.addEventListener('input',  () => { updateCamDisplay(); sendSettings(); });
camY?.addEventListener('input',  () => { updateCamDisplay(); sendSettings(); });
camZ?.addEventListener('input',  () => { updateCamDisplay(); sendSettings(); });
camTY?.addEventListener('input', () => { updateCamDisplay(); sendSettings(); });

document.getElementById('btnResetCam')?.addEventListener('click', () => {
  if (camX) camX.value = '0'; if (camY) camY.value = '0';
  if (camZ) camZ.value = '2.8'; if (camTY) camTY.value = '0';
  updateCamDisplay();
  sendSettings();
});

chkFreezeYaw?.addEventListener('change', sendSettings);
chkFreezePitch?.addEventListener('change', sendSettings);
chkFreezeRoll?.addEventListener('change', sendSettings);
chkHeadChest?.addEventListener('change', sendSettings);
chkFlipArmRoll?.addEventListener('change', sendSettings);

btnBg?.addEventListener('click', () => {
  whiteBg = !whiteBg;
  btnBg.textContent = whiteBg ? 'White BG' : 'Black BG';
  btnBg.classList.toggle('active', whiteBg);
  sendSettings();
});
btnFlip?.addEventListener('click', () => {
  flipped = !flipped;
  btnFlip.classList.toggle('active', flipped);
  sendSettings();
});
btnMirror?.addEventListener('click', () => {
  mirrored = !mirrored;
  btnMirror.classList.toggle('active', mirrored);
  sendSettings();
});

// ── Bridge listeners ─────────────────────────────────────────────────────────
bridge.on('state', initFromState);

bridge.on('frame', buf => {
  const blob = new Blob([buf], { type: 'image/jpeg' });
  const url  = URL.createObjectURL(blob);
  if (previewEl._prevUrl) URL.revokeObjectURL(previewEl._prevUrl);
  previewEl._prevUrl = url;
  previewEl.src = url;
  previewEl.style.display = 'block';
  if (placeholderEl) placeholderEl.style.display = 'none';
});

// Request current state from OBS as soon as this page loads
bridge.send('req-state');
