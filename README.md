# Stream Outline

A browser-based effect renderer for OBS. Pose detection drives a 3D figure through a post-processing pipeline and outputs it as a transparent Browser Source you can layer over any scene.

**Effects:** none, bloom, Sobel outline, ASCII outline, aura (body cutout with glow halo)

---

## How it works

Two browser pages talk to each other through a WebSocket relay built into the dev server:

- **`/`** is the controller. It opens your webcam, runs pose detection, renders a preview, and exposes all settings via a sidebar.
- **`/remote`** is the OBS Browser Source. It receives pose landmarks from the controller and renders independently on a fully transparent background.

Pose landmarks (~1 KB/frame) are relayed instead of video frames, so bandwidth is negligible even at high frame rates.

---

## Requirements

- **Node.js** 18 or later
- A webcam
- OBS Studio (optional, only needed for the Browser Source output)
- A Mixamo account (free) to download your character

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get a Mixamo character

Mixamo assets cannot be redistributed, so you need to bring your own:

1. Go to [mixamo.com](https://www.mixamo.com) and sign in (free Adobe account)
2. Pick any character. The default **Y Bot** works well and is low-poly
3. Click **Download** and choose format **FBX for Unity** (gives a clean T-pose with no baked animation)
4. Convert the FBX to GLB by dragging it into [gltf.report](https://gltf.report/) and exporting, or use Blender (File > Export > glTF 2.0)
5. Rename the file to `mixamo_base.glb` and place it in the `public/` folder

The rig must use Mixamo bone naming (`mixamorigSpine`, `mixamorigLeftArm`, etc.). Any Mixamo character will work out of the box.

### 3. Start the dev server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. Allow camera access when prompted.

---

## Using the controller (`/`)

The sidebar is divided into three sections:

### Controller
Local settings that only affect what you see here.

| Setting | What it does |
|---|---|
| Model quality | Lite = fastest, Heavy = most accurate pose |
| Detect rate | How often MediaPipe runs (CPU cost) |
| Preview rate | How fast this tab renders |
| Show camera | Toggle the webcam feed overlay |
| Show skeleton | Toggle the 2D pose skeleton overlay |
| Show mesh | Toggle the 3D figure |

### Pose
Per-frame flags sent alongside every pose update.

| Setting | What it does |
|---|---|
| Mirror Pose | Flip left/right so the figure moves like a mirror |
| Swap arm sides | Route right arm data to the left arm bone and vice versa |
| Freeze yaw/pitch/roll | Lock chest rotation axes to reduce jitter |
| Head to chest yaw | Use head facing direction for chest yaw instead of shoulders |

### OBS Output
Everything here is synced to `/remote` in real time.

| Setting | What it does |
|---|---|
| Render rate | Target FPS for the OBS Browser Source |
| Flip Image | Mirror the figure horizontally in OBS |
| Effect | Post-processing effect applied in OBS |
| Bloom settings | Strength, radius, threshold (bloom and aura effects) |
| ASCII cell size | Character grid size for the ASCII effect |
| Edge density | Edge detection threshold for the ASCII effect |
| Camera sliders | Distance, height, horizontal offset, look-at height |

---

## OBS setup

1. In OBS, add a **Browser Source**
2. Set the URL to `http://localhost:5173/remote`
3. Match the width/height to your canvas (e.g. 1920x1080)
4. Enable **"Shutdown source when not visible"** if you want detection to pause off-stream
5. Make sure **"Use custom frame rate"** is unchecked. Frame rate is controlled by the Render rate setting

The Vite dev server must be running while you stream. The `/remote` page auto-reconnects if the connection drops, so brief network hiccups are handled gracefully.

---

## Limitations

- Extended arms (wrist in line with shoulder and elbow) hit a geometric singularity where arm roll cannot be determined. The figure will track direction but not twist in these positions.
- Near-camera hands produce noisy depth from MediaPipe, which the 3D figure cannot fully compensate for.
- Requires a running Vite dev server. This is not a deployable production build.

---

## Tech stack

- [MediaPipe PoseLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) for pose detection
- [Three.js](https://threejs.org) with EffectComposer for 3D rendering and post-processing
- [Vite](https://vitejs.dev) for the dev server and WebSocket relay
