/**
 * Exponential moving average filter for MediaPipe world landmarks.
 *
 * alpha – how much each new frame contributes (0 = frozen, 1 = raw).
 *         0.35 gives a good balance between lag and smoothness.
 */
export class Smoother {
  constructor({ alpha = 0.35 } = {}) {
    this._alpha = alpha;
    this._lms   = null;
  }

  /** Returns smoothed copy; returns null when no pose is detected. */
  update(raw) {
    if (!raw) {
      this._lms = null;
      return null;
    }

    if (!this._lms) {
      this._lms = raw.map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
      return this._lms;
    }

    const a  = this._alpha;
    const a1 = 1 - a;

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const s = this._lms[i];
      s.x          = a*r.x          + a1*s.x;
      s.y          = a*r.y          + a1*s.y;
      s.z          = a*r.z          + a1*s.z;
      s.visibility = a*r.visibility + a1*s.visibility;
    }

    return this._lms;
  }

  reset() { this._lms = null; }
}
