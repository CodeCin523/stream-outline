import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BODY = new THREE.MeshBasicMaterial({ color: 0xffffff });

// ── Scratch objects ─────────────────────────────────────────────────────────
const _va  = new THREE.Vector3();
const _vb  = new THREE.Vector3();
const _vc  = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _dq  = new THREE.Quaternion();
const _wq  = new THREE.Quaternion();
const _pq  = new THREE.Quaternion();
const _tmp = new THREE.Quaternion();

// Torso frame scratch
const _tUp  = new THREE.Vector3();
const _tRt  = new THREE.Vector3();
const _tFwd = new THREE.Vector3();
const _rFwd = new THREE.Vector3();
const _tMat = new THREE.Matrix4();
const _rMat = new THREE.Matrix4();
const _tQ   = new THREE.Quaternion();
const _rQ   = new THREE.Quaternion();

const _Y_AXIS = new THREE.Vector3(0, 1, 0);
const _euler  = new THREE.Euler();

// Swaps left↔right MediaPipe arm landmark indices.
// Used together with x-negation to reflect landmarks into the
// correct world-space hemisphere for the opposite arm bone.
const ARM_LM_SWAP = {11:12, 12:11, 13:14, 14:13, 15:16, 16:15};

// Arm frame scratch
const _aAxis = new THREE.Vector3();
const _aPole = new THREE.Vector3();
const _aNorm = new THREE.Vector3();
const _aMat  = new THREE.Matrix4();
const _aQ    = new THREE.Quaternion();
const _arQ   = new THREE.Quaternion();

// ── Bone config ─────────────────────────────────────────────────────────────
// type -1 : full torso frame — optional p0 = blend weight (default 1.0)
//           drives world Q toward the target, blended between restWorldQ and
//           full target.  Use weights 0.33 / 0.66 / 1.0 across spine bones
//           so rotation distributes gradually up the chain.
// type -2 : neck (shoulder-mid → nose)
// type -3 : arm frame — landmark indices: joint-A, joint-B, reference-C
const BONE_MAP = [
  ['mixamorigSpine',  -1, 0.33],
  ['mixamorigSpine1', -1, 0.66],
  ['mixamorigSpine2', -1, 1.00],
  ['mixamorigNeck',   -2],
  ['mixamorigLeftArm',      -3, 11, 13, 15],
  ['mixamorigLeftForeArm',  -3, 13, 15, 11],
  ['mixamorigRightArm',     -3, 12, 14, 16],
  ['mixamorigRightForeArm', -3, 14, 16, 12],
];

const ALIAS = {
  mixamorigHips:         ['Hips',        'mixamorig:Hips'],
  mixamorigSpine:        ['Spine',       'mixamorig:Spine'],
  mixamorigSpine1:       ['Spine1',      'mixamorig:Spine1'],
  mixamorigSpine2:       ['Spine2',      'mixamorig:Spine2'],
  mixamorigNeck:         ['Neck',        'mixamorig:Neck'],
  mixamorigLeftArm:      ['LeftArm',     'mixamorig:LeftArm'],
  mixamorigLeftForeArm:  ['LeftForeArm', 'mixamorig:LeftForeArm'],
  mixamorigRightArm:     ['RightArm',    'mixamorig:RightArm'],
  mixamorigRightForeArm: ['RightForeArm','mixamorig:RightForeArm'],
};

// Build a quaternion frame from three world-space positions.
// Axis = pA→pB.  Pole = component of (pC−pA) perpendicular to axis.
// prevQ: the bone's quaternion from the previous frame.  We compute both pole
// hemispheres and pick the one whose quaternion is closer to prevQ.  This is
// more robust than tracking the pole direction separately: it cannot deadlock
// when the arm passes through a fully-extended (singular) position, because we
// never store a stale pole that gets wrongly reused after the singularity.
// Returns false when the three points are too collinear to define a plane.
function buildArmFrame(pA, pB, pC, outQ, prevQ = null) {
  _aAxis.subVectors(pB, pA).normalize();
  _aPole.subVectors(pC, pA);
  _aPole.addScaledVector(_aAxis, -_aPole.dot(_aAxis));
  if (_aPole.lengthSq() < 1e-4) return false;
  _aPole.normalize();
  _aNorm.crossVectors(_aAxis, _aPole).normalize();
  _aMat.makeBasis(_aAxis, _aPole, _aNorm);
  outQ.setFromRotationMatrix(_aMat);
  if (prevQ && prevQ.dot(outQ) < 0) {
    // Flipped pole gives a closer rotation — recompute with negated pole.
    _aPole.x *= -1; _aPole.y *= -1; _aPole.z *= -1;
    _aNorm.crossVectors(_aAxis, _aPole).normalize();
    _aMat.makeBasis(_aAxis, _aPole, _aNorm);
    outQ.setFromRotationMatrix(_aMat);
  }
  return true;
}

export class Avatar {
  constructor(scene) {
    this._scene         = scene;
    this.ready          = false;
    this._model         = null;
    this._bones         = {};
    this._restWorldQ    = {};
    this._restDir       = {};
    this._restArmFrameQ = {};
    this._prevWQ        = {};
    this._restBodyRt    = new THREE.Vector3();
    this._centerY       = 0;
    this.meshes         = [];
    this.minVisibility  = 0.4;
  }

  async load(url) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.load(url, res, null, rej));

    this._model = gltf.scene;
    this._scene.add(this._model);

    this._model.traverse(obj => {
      if (obj.isBone) this._bones[obj.name] = obj;
      if (obj.isSkinnedMesh) {
        obj.material = BODY;
        this.meshes.push(obj);
        obj.skeleton?.bones.forEach(b => { this._bones[b.name] = b; });
      }
    });

    for (const [canonical, alts] of Object.entries(ALIAS)) {
      if (!this._bones[canonical]) {
        for (const alt of alts) {
          if (this._bones[alt]) { this._bones[canonical] = this._bones[alt]; break; }
        }
      }
    }

    this._model.updateMatrixWorld(true);

    // ── Auto-detect and correct model facing direction ──────────────────────
    {
      const la = this._bones['mixamorigLeftArm'];
      const ra = this._bones['mixamorigRightArm'];
      const hi = this._bones['mixamorigHips'];
      const sp = this._bones['mixamorigSpine'];
      if (!la || !ra || !hi || !sp) {
        console.warn('[Avatar] facing check skipped — missing bones:', { la: !!la, ra: !!ra, hi: !!hi, sp: !!sp });
      }
      if (la && ra && hi && sp) {
        const lp = new THREE.Vector3(), rp = new THREE.Vector3();
        const hp = new THREE.Vector3(), spp = new THREE.Vector3();
        la.getWorldPosition(lp); ra.getWorldPosition(rp);
        hi.getWorldPosition(hp); sp.getWorldPosition(spp);
        const fwd = new THREE.Vector3()
          .crossVectors(new THREE.Vector3().subVectors(rp, lp), new THREE.Vector3().subVectors(spp, hp));
        console.log('[Avatar] facing check — fwd.z:', fwd.z.toFixed(3), '| flip applied:', fwd.z < -0.1);
        if (fwd.z < -0.1) {
          this._model.rotation.y = Math.PI;
          this._model.updateMatrixWorld(true);
        }
      }
    }

    // ── Cache rest-pose world quaternion and along-bone direction ───────────
    for (const [boneName] of BONE_MAP) {
      const bone = this._bones[boneName];
      if (!bone) continue;

      const rq = new THREE.Quaternion();
      bone.getWorldQuaternion(rq);
      this._restWorldQ[boneName] = rq;

      const boneWP    = new THREE.Vector3();
      const childBone = bone.children.find(c => c.isBone);
      bone.getWorldPosition(boneWP);

      if (childBone) {
        const childWP = new THREE.Vector3();
        childBone.getWorldPosition(childWP);
        this._restDir[boneName] = childWP.sub(boneWP).normalize();
      } else {
        this._restDir[boneName] = new THREE.Vector3(0, 1, 0).applyQuaternion(rq);
      }

      // Seed continuity tracker with rest orientation so first frame is stable
      this._prevWQ[boneName] = rq.clone();
    }

    // ── Rest-pose shoulder-width vector (spine yaw reference) ───────────────
    {
      const la = this._bones['mixamorigLeftArm'];
      const ra = this._bones['mixamorigRightArm'];
      if (la && ra) {
        const lp = new THREE.Vector3(), rp = new THREE.Vector3();
        la.getWorldPosition(lp); ra.getWorldPosition(rp);
        this._restBodyRt.subVectors(rp, lp).normalize();
      }
    }

    // ── Cache arm frame rest quaternions from restWorldQ ────────────────────
    // Project the bone's local Z perpendicular to the arm axis to get the rest
    // pole.  This reads the orientation that the rig already baked in, so no
    // guessing required and no T-pose degeneracy.
    for (const [boneName, type] of BONE_MAP) {
      if (type !== -3) continue;
      const restWQ   = this._restWorldQ[boneName];
      const restAxis = this._restDir[boneName];
      if (!restWQ || !restAxis) continue;

      _aPole.set(0, 0, 1).applyQuaternion(restWQ);
      _aPole.addScaledVector(restAxis, -_aPole.dot(restAxis));
      if (_aPole.lengthSq() < 1e-4) {
        _aPole.set(1, 0, 0).applyQuaternion(restWQ);
        _aPole.addScaledVector(restAxis, -_aPole.dot(restAxis));
      }
      _aPole.normalize();
      _aNorm.crossVectors(restAxis, _aPole).normalize();
      _aMat.makeBasis(restAxis, _aPole, _aNorm);
      const q = new THREE.Quaternion().setFromRotationMatrix(_aMat);
      this._restArmFrameQ[boneName] = q;
    }

    // ── Center model on chest ────────────────────────────────────────────────
    {
      const la = this._bones['mixamorigLeftArm'];
      const ra = this._bones['mixamorigRightArm'];
      if (la && ra) {
        const lp = new THREE.Vector3(), rp = new THREE.Vector3();
        la.getWorldPosition(lp); ra.getWorldPosition(rp);
        this._centerY = -(lp.y + rp.y) * 0.5;
      } else {
        const hi = this._bones['mixamorigHips'];
        if (hi) { const p = new THREE.Vector3(); hi.getWorldPosition(p); this._centerY = -p.y; }
      }
    }

    this._model.position.set(0, this._centerY, 0);
    this._model.updateMatrixWorld(true);

    this.ready = true;
  }

  update(lms, mirror = false, freezeYaw = false, freezePitch = false, freezeRoll = false,
         headDrivesChest = false, swapArms = false) {
    if (!this._model) return;
    if (!this.ready || !lms) { this._model.visible = false; return; }
    this._model.visible = true;

    const flip = mirror ? -1 : 1;
    const lh   = lms[23], rh = lms[24];
    const ls   = lms[11], rs = lms[12];
    const nose = lms[0];

    for (const [boneName, type, p0, p1, p2] of BONE_MAP) {
      const bone    = this._bones[boneName];
      const restDir = this._restDir[boneName];
      const restWQ  = this._restWorldQ[boneName];
      if (!bone || !restDir || !restWQ) continue;

      if (type === -1) {
        // ── Torso: yaw from shoulders in XZ, pitch+roll from torso-up ───
        if (!(lh?.visibility >= this.minVisibility && rh?.visibility >= this.minVisibility &&
              ls?.visibility >= this.minVisibility && rs?.visibility >= this.minVisibility)) continue;

        const hmx = flip*(lh.x+rh.x)*.5, hmy = -(lh.y+rh.y)*.5, hmz = -(lh.z+rh.z)*.5;
        const smx = flip*(ls.x+rs.x)*.5, smy = -(ls.y+rs.y)*.5, smz = -(ls.z+rs.z)*.5;

        // Yaw: signed angle between rest and current span, projected onto XZ.
        // When headDrivesChest: use ear span (head facing direction) instead of
        // shoulder span; falls back to shoulders if ears aren't visible.
        _tQ.identity();
        if (!freezeYaw) {
          const rX = this._restBodyRt.x, rZ = this._restBodyRt.z;
          const rLen = Math.hypot(rX, rZ);
          let yawSet = false;

          if (headDrivesChest) {
            const lEar = lms[7], rEar = lms[8];
            if (lEar?.visibility >= this.minVisibility && rEar?.visibility >= this.minVisibility) {
              const hX = flip*(lEar.x - rEar.x), hZ = -(lEar.z - rEar.z);
              const hLen = Math.hypot(hX, hZ);
              if (hLen > 0.001 && rLen > 0.001) {
                const hnX = hX/hLen, hnZ = hZ/hLen;
                const rnX = rX/rLen, rnZ = rZ/rLen;
                _tQ.setFromAxisAngle(_Y_AXIS, Math.atan2(rnX*hnZ - rnZ*hnX, rnX*hnX + rnZ*hnZ));
                yawSet = true;
              }
            }
          }

          if (!yawSet) {
            const shX = flip*(ls.x - rs.x), shZ = -(ls.z - rs.z);
            const shLen = Math.hypot(shX, shZ);
            if (shLen > 0.001 && rLen > 0.001) {
              const snX = shX/shLen, snZ = shZ/shLen;
              const rnX = rX/rLen,   rnZ = rZ/rLen;
              _tQ.setFromAxisAngle(_Y_AXIS, Math.atan2(rnX*snZ - rnZ*snX, rnX*snX + rnZ*snZ));
            }
          }
        }

        // Pitch + Roll: compare live torso-up with rest-up in yaw-corrected frame.
        _tUp.set(smx-hmx, smy-hmy, smz-hmz).normalize();
        _rQ.identity();
        if (!freezePitch || !freezeRoll) {
          _aQ.copy(_tQ).invert();
          _va.copy(_tUp).applyQuaternion(_aQ); // live-up in yaw-corrected frame
          _vb.copy(restDir);
          _rQ.setFromUnitVectors(_vb, _va);

          if (freezePitch || freezeRoll) {
            _euler.setFromQuaternion(_rQ, 'XZY');
            if (freezePitch) _euler.x = 0;
            if (freezeRoll)  _euler.z = 0;
            _rQ.setFromEuler(_euler);
          }
        }

        // Full delta = yaw * pitchRoll, applied on top of rest orientation.
        _dq.multiplyQuaternions(_tQ, _rQ);
        _wq.multiplyQuaternions(_dq, restWQ);

        // Distribute rotation up the spine chain (Spine=33%, Spine1=66%, Spine2=100%).
        const weight = p0 ?? 1.0;
        if (weight < 1.0) {
          _tmp.copy(_wq);
          _wq.slerpQuaternions(restWQ, _tmp, weight);
        }

      } else if (type === -2) {
        // ── Neck: shoulder-midpoint → nose ───────────────────────────────
        if (!(ls?.visibility >= this.minVisibility && rs?.visibility >= this.minVisibility &&
              nose?.visibility >= this.minVisibility)) continue;
        _va.set(flip*(ls.x+rs.x)*.5, -(ls.y+rs.y)*.5, -(ls.z+rs.z)*.5);
        _vb.set(flip*nose.x, -nose.y, -nose.z);
        _tgt.subVectors(_vb, _va).normalize();
        if (_tgt.lengthSq() < 1e-6) continue;
        _dq.setFromUnitVectors(restDir, _tgt);
        // When headDrivesChest the spine already carries head yaw; strip neck yaw
        // so the neck only contributes pitch (up/down) and roll.
        if (headDrivesChest) {
          _euler.setFromQuaternion(_dq, 'YXZ');
          _euler.y = 0;
          _dq.setFromEuler(_euler);
        }
        _wq.multiplyQuaternions(_dq, restWQ);

      } else if (type === -3) {
        // ── Arm frame: full orientation from 3 landmarks ─────────────────
        // Optionally swap left↔right landmark indices and reflect x so the
        // reflected landmark lands in the correct world-space hemisphere for the
        // opposite arm bone.  This maps right-arm MediaPipe data to the left arm
        // bone (and vice-versa) without changing the model's displayed orientation.
        const liA = swapArms ? (ARM_LM_SWAP[p0] ?? p0) : p0;
        const liB = swapArms ? (ARM_LM_SWAP[p1] ?? p1) : p1;
        const liC = swapArms ? (ARM_LM_SWAP[p2] ?? p2) : p2;
        const la = lms[liA], lb = lms[liB], lc = lms[liC];
        // Skip entirely if the primary joints (shoulder/elbow) aren't visible.
        // If only the reference (wrist) is missing, fall back to axis-only so
        // the arm direction still tracks without the roll component.
        if (!la || !lb || la.visibility < this.minVisibility || lb.visibility < this.minVisibility) continue;

        const ax = swapArms ? -flip : flip; // reflect x when swapped
        _va.set(ax * la.x, -la.y, -la.z);
        _vb.set(ax * lb.x, -lb.y, -lb.z);

        const restArmQ = this._restArmFrameQ[boneName];
        if (!restArmQ) continue;

        const cVis = lc && lc.visibility >= this.minVisibility;
        let frameBuilt = false;
        if (cVis) {
          _vc.set(ax * lc.x, -lc.y, -lc.z);
          frameBuilt = buildArmFrame(_va, _vb, _vc, _aQ, this._prevWQ[boneName]);
        }

        if (frameBuilt) {
          _arQ.copy(restArmQ).invert();
          _dq.multiplyQuaternions(_aQ, _arQ);
          _wq.multiplyQuaternions(_dq, restWQ);
        } else {
          // Axis-only: direction tracked, roll stays at rest
          _tgt.subVectors(_vb, _va).normalize();
          _dq.setFromUnitVectors(restDir, _tgt);
          _wq.multiplyQuaternions(_dq, restWQ);
        }
      }

      // ── Quaternion continuity ────────────────────────────────────────────
      // q and -q represent the same rotation.  When the computed _wq is on the
      // opposite hemisphere from the previous frame (dot < 0), negate it so we
      // always take the short arc.  This prevents the 180° arm flips that occur
      // when the pole vector crosses zero and emerges with the opposite sign.
      const prev = this._prevWQ[boneName];
      if (prev.dot(_wq) < 0) { _wq.x *= -1; _wq.y *= -1; _wq.z *= -1; _wq.w *= -1; }
      prev.copy(_wq);

      // Convert world quaternion → bone-local quaternion
      if (bone.parent) {
        bone.parent.getWorldQuaternion(_pq);
        _pq.invert();
        bone.quaternion.multiplyQuaternions(_pq, _wq);
      } else {
        bone.quaternion.copy(_wq);
      }

      bone.updateMatrix();
      bone.updateMatrixWorld(true);
    }
  }

  get centerY() { return this._centerY; }

  // Re-seed prevWQ for arm bones to rest pose after an arm-swap toggle.
  // Without this, the first frame after a swap would compare the new
  // arm's quaternion against the old arm's last quaternion, potentially
  // choosing the wrong hemisphere on that frame.
  resetArmPoles() {
    for (const [boneName, type] of BONE_MAP) {
      if (type !== -3) continue;
      const rq = this._restWorldQ[boneName];
      if (rq && this._prevWQ[boneName]) this._prevWQ[boneName].copy(rq);
    }
  }

  // Returns the local bone quaternions for all BONE_MAP bones, or null when
  // the avatar is not visible (no pose detected this frame).
  getBoneQuaternions() {
    if (!this.ready || !this._model?.visible) return null;
    const out = {};
    for (const [boneName] of BONE_MAP) {
      const bone = this._bones[boneName];
      if (!bone) continue;
      const q = bone.quaternion;
      out[boneName] = { x: q.x, y: q.y, z: q.z, w: q.w };
    }
    return out;
  }

  // Applies pre-solved bone quaternions from the controller.
  // Bones must be set in BONE_MAP order (parent → child) so that
  // updateMatrixWorld(true) cascades correctly down the hierarchy.
  applyBoneQuaternions(data) {
    if (!this._model) return;
    if (!data) { this._model.visible = false; return; }
    this._model.visible = true;
    for (const [boneName] of BONE_MAP) {
      const bone = this._bones[boneName];
      const q    = data[boneName];
      if (!bone || !q) continue;
      bone.quaternion.set(q.x, q.y, q.z, q.w);
      bone.updateMatrix();
      bone.updateMatrixWorld(true);
    }
  }
}
