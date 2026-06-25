import * as THREE from 'three';
import { POSE_CONNECTIONS } from './tracker.js';

const JOINT_RADIUS = 0.018;
const BONE_RADIUS  = 0.010;
const MIN_VISIBILITY = 0.4;

// Pre-allocate to avoid GC pressure in the render loop
const _a   = new THREE.Vector3();
const _b   = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);

// Single shared materials — all meshes are the same colour;
// the outline shader owns the final look.
const MAT_JOINT = new THREE.MeshBasicMaterial({ color: 0xffffff });
const MAT_BONE  = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Shared geometry (instances reuse the same buffer)
const GEO_JOINT = new THREE.SphereGeometry(JOINT_RADIUS, 8, 6);
const GEO_BONE  = new THREE.CylinderGeometry(BONE_RADIUS, BONE_RADIUS, 1, 6);

export class Skeleton {
  constructor(scene) {
    this.group = new THREE.Group();
    this._joints = [];
    this._bones  = [];

    for (let i = 0; i < 33; i++) {
      const m = new THREE.Mesh(GEO_JOINT, MAT_JOINT);
      m.visible = false;
      this._joints.push(m);
      this.group.add(m);
    }

    for (const [ai, bi] of POSE_CONNECTIONS) {
      const m = new THREE.Mesh(GEO_BONE, MAT_BONE);
      m.visible = false;
      this._bones.push({ mesh: m, ai, bi });
      this.group.add(m);
    }

    scene.add(this.group);
  }

  /**
   * Update skeleton from MediaPipe world landmarks.
   * @param {Array|null} lms  - worldLandmarks[0] array (33 entries)
   * @param {boolean} mirror  - flip x axis for selfie-mode cameras
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
      const ok = lm && lm.visibility >= MIN_VISIBILITY;
      this._joints[i].visible = ok;
      if (ok) this._joints[i].position.set(flip * lm.x, -lm.y, -lm.z);
    }

    for (const { mesh, ai, bi } of this._bones) {
      const la = lms[ai];
      const lb = lms[bi];
      const ok =
        la && lb &&
        la.visibility >= MIN_VISIBILITY &&
        lb.visibility >= MIN_VISIBILITY;

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
