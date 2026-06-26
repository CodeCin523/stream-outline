import * as THREE from 'three';
import { POSE_CONNECTIONS } from './tracker.js';

const JOINT_RADIUS = 0.018;
const BONE_RADIUS  = 0.010;

// Pre-allocate to avoid GC pressure in the render loop
const _a   = new THREE.Vector3();
const _b   = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);

// Geometry is shared — all instances use the same buffer
const GEO_JOINT = new THREE.SphereGeometry(JOINT_RADIUS, 8, 6);
const GEO_BONE  = new THREE.CylinderGeometry(BONE_RADIUS, BONE_RADIUS, 1, 6);

export class Skeleton {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   * @param {number} opts.minVisibility  landmark confidence cutoff (0 = show all)
   * @param {number} opts.color          hex color for joints and bones
   */
  constructor(scene, { minVisibility = 0.4, color = 0xffffff } = {}) {
    this._minVis = minVisibility;

    // Per-instance materials so two skeletons can have different colours
    const matJoint = new THREE.MeshBasicMaterial({ color });
    const matBone  = new THREE.MeshBasicMaterial({ color });

    this.group = new THREE.Group();
    this._joints = [];
    this._bones  = [];

    for (let i = 0; i < 33; i++) {
      const m = new THREE.Mesh(GEO_JOINT, matJoint);
      m.visible = false;
      this._joints.push(m);
      this.group.add(m);
    }

    for (const [ai, bi] of POSE_CONNECTIONS) {
      const m = new THREE.Mesh(GEO_BONE, matBone);
      m.visible = false;
      this._bones.push({ mesh: m, ai, bi });
      this.group.add(m);
    }

    scene.add(this.group);
  }

  /**
   * Update from MediaPipe world landmarks.
   * @param {Array|null} lms  - worldLandmarks[0] (33 entries), or null to hide
   * @param {boolean}    mirror
   */
  update(lms, mirror = false) {
    if (!lms) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const flip = mirror ? -1 : 1;

    // MediaPipe world: x→right, y↓, z→camera
    // Three.js:        x→right, y↑, z→viewer
    for (let i = 0; i < 33; i++) {
      const lm = lms[i];
      const ok = lm && lm.visibility >= this._minVis;
      this._joints[i].visible = ok;
      if (ok) this._joints[i].position.set(flip * lm.x, -lm.y, -lm.z);
    }

    for (const { mesh, ai, bi } of this._bones) {
      const la = lms[ai];
      const lb = lms[bi];
      const ok = la && lb && la.visibility >= this._minVis && lb.visibility >= this._minVis;

      mesh.visible = ok;
      if (!ok) continue;

      _a.set(flip * la.x, -la.y, -la.z);
      _b.set(flip * lb.x, -lb.y, -lb.z);
      _dir.subVectors(_b, _a);
      const len = _dir.length();
      if (len < 0.001) { mesh.visible = false; continue; }

      _mid.addVectors(_a, _b).multiplyScalar(0.5);
      mesh.position.copy(_mid);
      mesh.scale.set(1, len, 1);
      mesh.quaternion.setFromUnitVectors(_up, _dir.normalize());
    }
  }

  /** All meshes in the group — passed to OutlinePass each frame. */
  get meshes() {
    return this.group.children;
  }
}
