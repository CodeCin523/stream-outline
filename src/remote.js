import { Renderer } from './renderer.js';
import { Avatar }   from './avatar.js';
import { Bridge }   from './bridge.js';

const bridge = new Bridge();

// ── Pose state (updated per-frame from controller) ─────────────────────────
let _lms         = null;
let _mirrored    = false;
let _swapArms    = false;
let _freezeYaw   = true;
let _freezePitch = true;
let _freezeRoll  = true;
let _headChest   = false;

// ── Scene state (updated when controller sends 'scene') ────────────────────
let remoteFps = 60;

// ── Render scheduling ──────────────────────────────────────────────────────
let _rafFrame = 0, _prevRafNow = 0, _rafInterval = 16.67;

async function init() {
  const renderer = new Renderer(document.getElementById('app'));
  const avatar   = new Avatar(renderer.scene);
  await avatar.load('/mixamo_base.glb');

  // ── Scene settings ───────────────────────────────────────────────────────
  function applyScene(s) {
    if (!s) return;
    if (s.remoteFps !== undefined) remoteFps = s.remoteFps;
    if (s.flipped   !== undefined) renderer.setFlipped(s.flipped);

    if (s.effect !== undefined) {
      renderer.setEffect(s.effect,
        s.bloomStr ?? 0.7,
        s.bloomRad ?? 0.15,
        s.bloomThr ?? 0.5);
    }
    if (s.bloomStr !== undefined || s.bloomRad !== undefined || s.bloomThr !== undefined) {
      renderer.updateBloom(s.bloomStr ?? 0.7, s.bloomRad ?? 0.15, s.bloomThr ?? 0.5);
    }
    if (s.asciiCell !== undefined) renderer.updateAsciiCellSize(s.asciiCell);
    if (s.asciiThr  !== undefined) renderer.updateAsciiThreshold(s.asciiThr);

    if (s.camX !== undefined || s.camZ !== undefined) {
      renderer.camera.position.set(s.camX ?? 0, s.camY ?? 0, s.camZ ?? 2.8);
      renderer.camera.lookAt(0, s.camTY ?? 0, 0);
    }
    // whiteBg intentionally ignored — /remote is always transparent for OBS
  }

  // ── Bridge listeners ──────────────────────────────────────────────────────
  bridge.on('pose', data => {
    _lms         = data.lms;
    _mirrored    = data.mirrored;
    _swapArms    = data.swapArms;
    _freezeYaw   = data.freezeYaw;
    _freezePitch = data.freezePitch;
    _freezeRoll  = data.freezeRoll;
    _headChest   = data.headChest;
  });

  bridge.on('scene', applyScene);

  // Ask the controller for its current scene settings on first connect
  bridge.send('req-state');

  // ── Render loop ────────────────────────────────────────────────────────────
  function loop(now) {
    requestAnimationFrame(loop);

    if (_prevRafNow > 0) _rafInterval += (now - _prevRafNow - _rafInterval) * 0.05;
    _prevRafNow = now;
    _rafFrame++;

    const skipN = remoteFps > 0
      ? Math.max(1, Math.round(1000 / (_rafInterval * remoteFps)))
      : 1;
    if (_rafFrame % skipN !== 0) return;

    if (_lms) {
      avatar.update(_lms, _mirrored, _freezeYaw, _freezePitch, _freezeRoll, _headChest, _swapArms);
      renderer.render();
    }
  }

  requestAnimationFrame(loop);
}

init().catch(console.error);
