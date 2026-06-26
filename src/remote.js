import { Renderer } from './renderer.js';
import { Avatar }   from './avatar.js';
import { Bridge }   from './bridge.js';

const bridge = new Bridge();

let _bones    = null;
let remoteFps = 60;

let _rafFrame = 0, _prevRafNow = 0, _rafInterval = 16.67;

async function init() {
  const renderer = new Renderer(document.getElementById('app'));
  const avatar   = new Avatar(renderer.scene);
  await avatar.load('/mixamo_base.glb');

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
  }

  bridge.on('bones', data => { _bones = data; });
  bridge.on('scene', applyScene);

  bridge.send('req-state');

  function loop(now) {
    requestAnimationFrame(loop);

    if (_prevRafNow > 0) _rafInterval += (now - _prevRafNow - _rafInterval) * 0.05;
    _prevRafNow = now;
    _rafFrame++;

    const skipN = remoteFps > 0
      ? Math.max(1, Math.round(1000 / (_rafInterval * remoteFps)))
      : 1;
    if (_rafFrame % skipN !== 0) return;

    if (_bones) {
      avatar.applyBoneQuaternions(_bones);
      renderer.render();
    }
  }

  requestAnimationFrame(loop);
}

init().catch(console.error);
