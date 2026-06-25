import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

export const POSE_MODELS = {
  lite:  { label: 'Lite — fast',      url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
  full:  { label: 'Full — balanced',  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task' },
  heavy: { label: 'Heavy — accurate', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task' },
};

// All 30 meaningful body connections (skip most face micro-landmarks)
export const POSE_CONNECTIONS = [
  // Shoulders
  [11, 12],
  // Left arm
  [11, 13], [13, 15],
  // Left hand
  [15, 17], [15, 19], [17, 19], [15, 21],
  // Right arm
  [12, 14], [14, 16],
  // Right hand
  [16, 18], [16, 20], [18, 20], [16, 22],
  // Torso
  [11, 23], [12, 24], [23, 24],
  // Left leg
  [23, 25], [25, 27],
  // Left foot
  [27, 29], [27, 31], [29, 31],
  // Right leg
  [24, 26], [26, 28],
  // Right foot
  [28, 30], [28, 32], [30, 32],
  // Neck (approximate — MediaPipe has no explicit neck landmark)
  [0, 11], [0, 12],
];

export class Tracker {
  constructor() {
    this._landmarker = null;
    this._lastTs     = -1;
    this._result     = null;
  }

  async init(modelKey = 'heavy') {
    await this._create(modelKey);
  }

  async setModel(modelKey) {
    this._landmarker?.close();
    this._landmarker = null;
    this._lastTs     = -1;
    this._result     = null;
    await this._create(modelKey);
  }

  async _create(modelKey) {
    const model  = POSE_MODELS[modelKey] ?? POSE_MODELS.heavy;
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    this._landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model.url, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  }

  detect(videoEl) {
    if (!this._landmarker || videoEl.readyState < 2) return;
    const ts = performance.now();
    // MediaPipe requires strictly increasing timestamps
    if (ts <= this._lastTs) return;
    this._lastTs = ts;
    this._result = this._landmarker.detectForVideo(videoEl, ts);
  }

  /** 3-D world landmarks (meters, hip-centered). Null if no pose detected. */
  get worldLandmarks() {
    return this._result?.worldLandmarks?.[0] ?? null;
  }

  /** 2-D normalised landmarks (0-1 screen space). Used for mirroring check. */
  get landmarks() {
    return this._result?.landmarks?.[0] ?? null;
  }
}
