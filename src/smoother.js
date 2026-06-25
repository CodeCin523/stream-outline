/**
 * Exponential moving average filter for MediaPipe world landmarks.
 *
 * alpha     – how much each new frame contributes (0 = frozen, 1 = raw).
 *             0.35 gives a good balance between lag and smoothness.
 * maxJump   – world-space distance (metres) beyond which a single-frame
 *             change is treated as a detection glitch and ignored.
 *             0.25 m catches most CV spikes without blocking real fast moves.
 */
export class Smoother {
  constructor({ alpha = 0.35, maxJump = 0.25 } = {}) {
    this._alpha   = alpha;
    this._maxJump = maxJump;
    this._lms     = null;  // smoothed landmark array
  }

  /** Returns smoothed copy; returns null when no pose is detected. */
  update(raw) {
    if (!raw) {
      this._lms = null;
      return null;
    }

    // First detection — seed the filter
    if (!this._lms) {
      this._lms = raw.map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
      return this._lms;
    }

    const a  = this._alpha;
    const a1 = 1 - a;
    const mj2 = this._maxJump * this._maxJump;

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const s = this._lms[i];

      // Outlier gate — skip landmarks that jumped implausibly far in one frame
      const dx = r.x - s.x, dy = r.y - s.y, dz = r.z - s.z;
      if (dx*dx + dy*dy + dz*dz > mj2) continue;

      s.x          = a*r.x          + a1*s.x;
      s.y          = a*r.y          + a1*s.y;
      s.z          = a*r.z          + a1*s.z;
      s.visibility = a*r.visibility + a1*s.visibility;
    }

    return this._lms;
  }

  reset() { this._lms = null; }
}
