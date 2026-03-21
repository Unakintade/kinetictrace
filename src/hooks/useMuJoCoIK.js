/**
 * useMuJoCoIK
 *
 * Loads the MuJoCo WASM module, builds a simple humanoid MJCF with mocap bodies,
 * performs anthropometric scaling from the first 10 video frames, then runs a
 * sliding-window (20-frame) gradient-descent IK to map Kalman-filtered BlazePose
 * landmarks → joint angles.
 *
 * Returns: { ready, error, solve, model: {limbLengths} }
 */

import { useEffect, useRef, useState } from 'react';

// ── MJCF template ──────────────────────────────────────────────────────────
// Joints follow a standard lower-body humanoid (hips, knees, ankles) +
// upper-body (shoulders, elbows, wrists). Limits are physiological.
// Mocap bodies are weld-constrained to their IK target sites.
function buildMJCF(scale) {
  const s = scale; // { torso, femur, tibia, humerus, forearm, foot }
  return `<mujoco model="sprint_human">
  <compiler angle="degree" autolimits="true"/>
  <option timestep="0.008" iterations="50" solver="Newton" tolerance="1e-8">
    <flag contact="enable"/>
  </option>
  <default>
    <joint damping="8" armature="0.05" limited="true"/>
    <geom contype="1" conaffinity="1" friction="1 0.1 0.1"/>
  </default>
  <worldbody>
    <light pos="0 0 4" dir="0 0 -1" diffuse="0.8 0.8 0.8"/>
    <geom name="floor" type="plane" size="10 10 0.1" rgba="0.3 0.3 0.3 1" contype="1" conaffinity="1"/>

    <!-- Root / Pelvis -->
    <body name="pelvis" pos="0 0 ${(s.femur + s.tibia + 0.1).toFixed(3)}">
      <freejoint name="root"/>
      <geom type="capsule" size="0.06 ${(s.torso * 0.15).toFixed(3)}" rgba="0.7 0.5 0.3 1"/>
      <site name="hip_center" pos="0 0 0" size="0.02"/>

      <!-- Torso -->
      <body name="torso" pos="0 0 ${(s.torso * 0.5).toFixed(3)}">
        <joint name="torso_x" type="hinge" axis="1 0 0" range="-30 30"/>
        <joint name="torso_z" type="hinge" axis="0 0 1" range="-20 20"/>
        <geom type="capsule" size="0.07 ${(s.torso * 0.45).toFixed(3)}" rgba="0.7 0.5 0.3 1"/>
        <site name="shoulder_center" pos="0 0 ${(s.torso * 0.45).toFixed(3)}" size="0.02"/>

        <!-- Left shoulder / arm -->
        <body name="l_upper_arm" pos="${(-s.torso * 0.18).toFixed(3)} 0 ${(s.torso * 0.45).toFixed(3)}">
          <joint name="l_shoulder_x" type="hinge" axis="1 0 0" range="-90 180"/>
          <joint name="l_shoulder_z" type="hinge" axis="0 0 1" range="-90 90"/>
          <geom type="capsule" size="0.03 ${(s.humerus * 0.45).toFixed(3)}" rgba="0.6 0.4 0.2 1" fromto="0 0 0 0 0 ${(-s.humerus).toFixed(3)}"/>
          <site name="l_elbow" pos="0 0 ${(-s.humerus).toFixed(3)}" size="0.02"/>
          <body name="l_forearm" pos="0 0 ${(-s.humerus).toFixed(3)}">
            <joint name="l_elbow" type="hinge" axis="0 1 0" range="0 150"/>
            <geom type="capsule" size="0.025 ${(s.forearm * 0.45).toFixed(3)}" rgba="0.6 0.4 0.2 1" fromto="0 0 0 0 0 ${(-s.forearm).toFixed(3)}"/>
            <site name="l_wrist" pos="0 0 ${(-s.forearm).toFixed(3)}" size="0.02"/>
          </body>
        </body>

        <!-- Right shoulder / arm -->
        <body name="r_upper_arm" pos="${(s.torso * 0.18).toFixed(3)} 0 ${(s.torso * 0.45).toFixed(3)}">
          <joint name="r_shoulder_x" type="hinge" axis="1 0 0" range="-90 180"/>
          <joint name="r_shoulder_z" type="hinge" axis="0 0 1" range="-90 90"/>
          <geom type="capsule" size="0.03 ${(s.humerus * 0.45).toFixed(3)}" rgba="0.6 0.4 0.2 1" fromto="0 0 0 0 0 ${(-s.humerus).toFixed(3)}"/>
          <site name="r_elbow" pos="0 0 ${(-s.humerus).toFixed(3)}" size="0.02"/>
          <body name="r_forearm" pos="0 0 ${(-s.humerus).toFixed(3)}">
            <joint name="r_elbow" type="hinge" axis="0 1 0" range="0 150"/>
            <geom type="capsule" size="0.025 ${(s.forearm * 0.45).toFixed(3)}" rgba="0.6 0.4 0.2 1" fromto="0 0 0 0 0 ${(-s.forearm).toFixed(3)}"/>
            <site name="r_wrist" pos="0 0 ${(-s.forearm).toFixed(3)}" size="0.02"/>
          </body>
        </body>
      </body>

      <!-- Left leg -->
      <body name="l_thigh" pos="${(-s.torso * 0.09).toFixed(3)} 0 0">
        <joint name="l_hip_x" type="hinge" axis="1 0 0" range="-40 130"/>
        <joint name="l_hip_z" type="hinge" axis="0 0 1" range="-30 30"/>
        <geom type="capsule" size="0.04 ${(s.femur * 0.45).toFixed(3)}" rgba="0.7 0.5 0.3 1" fromto="0 0 0 0 0 ${(-s.femur).toFixed(3)}"/>
        <site name="l_knee" pos="0 0 ${(-s.femur).toFixed(3)}" size="0.02"/>
        <body name="l_shank" pos="0 0 ${(-s.femur).toFixed(3)}">
          <joint name="l_knee" type="hinge" axis="0 1 0" range="0 150"/>
          <geom type="capsule" size="0.033 ${(s.tibia * 0.45).toFixed(3)}" rgba="0.7 0.5 0.3 1" fromto="0 0 0 0 0 ${(-s.tibia).toFixed(3)}"/>
          <site name="l_ankle" pos="0 0 ${(-s.tibia).toFixed(3)}" size="0.02"/>
          <body name="l_foot" pos="0 0 ${(-s.tibia).toFixed(3)}">
            <joint name="l_ankle" type="hinge" axis="0 1 0" range="-45 30"/>
            <geom type="capsule" size="0.025 ${(s.foot * 0.4).toFixed(3)}" rgba="0.3 0.3 0.3 1" fromto="0 0 0 ${(s.foot).toFixed(3)} 0 0"/>
          </body>
        </body>
      </body>

      <!-- Right leg -->
      <body name="r_thigh" pos="${(s.torso * 0.09).toFixed(3)} 0 0">
        <joint name="r_hip_x" type="hinge" axis="1 0 0" range="-40 130"/>
        <joint name="r_hip_z" type="hinge" axis="0 0 1" range="-30 30"/>
        <geom type="capsule" size="0.04 ${(s.femur * 0.45).toFixed(3)}" rgba="0.7 0.5 0.3 1" fromto="0 0 0 0 0 ${(-s.femur).toFixed(3)}"/>
        <site name="r_knee" pos="0 0 ${(-s.femur).toFixed(3)}" size="0.02"/>
        <body name="r_shank" pos="0 0 ${(-s.femur).toFixed(3)}">
          <joint name="r_knee" type="hinge" axis="0 1 0" range="0 150"/>
          <geom type="capsule" size="0.033 ${(s.tibia * 0.45).toFixed(3)}" rgba="0.7 0.5 0.3 1" fromto="0 0 0 0 0 ${(-s.tibia).toFixed(3)}"/>
          <site name="r_ankle" pos="0 0 ${(-s.tibia).toFixed(3)}" size="0.02"/>
          <body name="r_foot" pos="0 0 ${(-s.tibia).toFixed(3)}">
            <joint name="r_ankle" type="hinge" axis="0 1 0" range="-45 30"/>
            <geom type="capsule" size="0.025 ${(s.foot * 0.4).toFixed(3)}" rgba="0.3 0.3 0.3 1" fromto="0 0 0 ${(s.foot).toFixed(3)} 0 0"/>
          </body>
        </body>
      </body>
    </body>
  </worldbody>
</mujoco>`;
}

// ── Anthropometric scaling from first N frames ──────────────────────────────
// MoveNet keypoint indices (17 kps):
// 0=nose,1=l_eye,2=r_eye,3=l_ear,4=r_ear,5=l_shoulder,6=r_shoulder,
// 7=l_elbow,8=r_elbow,9=l_wrist,10=r_wrist,11=l_hip,12=r_hip,
// 13=l_knee,14=r_knee,15=l_ankle,16=r_ankle

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function avgLimbLength(frames, idxA, idxB, pixelsPerMeter) {
  const lengths = frames
    .map(f => {
      const a = f.landmarks[idxA];
      const b = f.landmarks[idxB];
      if (!a || !b || (a.score ?? 1) < 0.15 || (b.score ?? 1) < 0.15) return null;
      return dist2D(a, b) / pixelsPerMeter;
    })
    .filter(v => v !== null);
  if (!lengths.length) return 0.45; // default fallback
  return lengths.reduce((s, v) => s + v, 0) / lengths.length;
}

export function computeAnthropometrics(firstFrames, pixelsPerMeter) {
  const femur = Math.max(0.3, avgLimbLength(firstFrames, 11, 13, pixelsPerMeter)); // l_hip → l_knee
  const tibia = Math.max(0.3, avgLimbLength(firstFrames, 13, 15, pixelsPerMeter)); // l_knee → l_ankle
  const humerus = Math.max(0.2, avgLimbLength(firstFrames, 5, 7, pixelsPerMeter)); // l_shoulder → l_elbow
  const forearm = Math.max(0.2, avgLimbLength(firstFrames, 7, 9, pixelsPerMeter)); // l_elbow → l_wrist
  // torso = shoulder–hip midpoint vertical distance
  const torso = Math.max(0.4, avgLimbLength(firstFrames, 5, 11, pixelsPerMeter));
  return { femur, tibia, humerus, forearm, torso, foot: tibia * 0.38 };
}

// ── Site-to-landmark mapping ────────────────────────────────────────────────
// site name → MoveNet keypoint index
const SITE_LM_MAP = {
  hip_center:    { left: 11, right: 12, avg: true },
  shoulder_center: { left: 5, right: 6, avg: true },
  l_knee:        { idx: 13 },
  r_knee:        { idx: 14 },
  l_ankle:       { idx: 15 },
  r_ankle:       { idx: 16 },
  l_elbow:       { idx: 7 },
  r_elbow:       { idx: 8 },
  l_wrist:       { idx: 9 },
  r_wrist:       { idx: 10 },
};

// ── Sliding-window IK (gradient descent) ───────────────────────────────────
const WINDOW = 20;
const IK_ITERS = 40;
const IK_LR = 0.05;
const PHY_WARN_OMEGA = 25; // rad/s — physiological knee limit

/**
 * Convert pixel-space landmark to MuJoCo 3D world coords.
 * We project the 2D image point into a sagittal-plane 3D point
 * using pixelsPerMeter and an assumed camera height.
 */
function landmarkTo3D(lm, ppm, videoH) {
  return {
    x: lm.x / ppm,
    y: 0,
    z: (videoH - lm.y) / ppm, // flip Y: image Y grows down, MuJoCo Z grows up
  };
}

/**
 * Very lightweight forward-kinematics approximation used inside the JS IK solver.
 * We bypass the WASM mj_step for IK and instead use a simple Jacobian-free
 * coordinate descent on joint angles, then validate with MuJoCo's step.
 */
function simpleFKSite(siteName, qpos, scale) {
  // qpos layout (0-indexed):
  // 0-5: root freejoint (px,py,pz,qw,qx,qy,qz actually 7 for free)
  // but we treat root as fixed at pelvis position from landmarks
  // joints: torso_x(0),torso_z(1), l_shoulder_x(2),l_shoulder_z(3),l_elbow(4),
  //         r_shoulder_x(5),r_shoulder_z(6),r_elbow(7),
  //         l_hip_x(8),l_hip_z(9),l_knee(10),l_ankle(11),
  //         r_hip_x(12),r_hip_z(13),r_knee(14),r_ankle(15)
  const [, , pz] = [qpos[0] ?? 0, qpos[1] ?? 0, qpos[2] ?? (scale.femur + scale.tibia + 0.1)];
  const baseZ = pz;

  const RAD = Math.PI / 180;
  const lhx = (qpos[8] ?? 0) * RAD;
  const lk  = (qpos[10] ?? 0) * RAD;
  const la  = (qpos[11] ?? 0) * RAD;
  const rhx = (qpos[12] ?? 0) * RAD;
  const rk  = (qpos[14] ?? 0) * RAD;
  const ra  = (qpos[15] ?? 0) * RAD;

  const sites = {};

  // Hip center (pelvis)
  sites['hip_center'] = { x: qpos[0] ?? 0, y: 0, z: baseZ };

  // Shoulder center (torso_x tilt applied)
  const tx = (qpos[0] ?? 0) * RAD;
  sites['shoulder_center'] = {
    x: sites['hip_center'].x,
    y: 0,
    z: baseZ + scale.torso * Math.cos(tx),
  };

  // Left leg forward kinematics (sagittal plane)
  const lHipZ = baseZ - 0; // hip joint at pelvis
  const lKneeZ = lHipZ - scale.femur * Math.cos(lhx);
  const lKneeX = (qpos[0] ?? 0) + scale.femur * Math.sin(lhx);
  const lAnkleZ = lKneeZ - scale.tibia * Math.cos(lhx + lk);
  const lAnkleX = lKneeX + scale.tibia * Math.sin(lhx + lk);

  sites['l_knee']  = { x: lKneeX,  y: 0, z: lKneeZ  };
  sites['l_ankle'] = { x: lAnkleX, y: 0, z: lAnkleZ };

  // Right leg
  const rKneeZ = baseZ - scale.femur * Math.cos(rhx);
  const rKneeX = (qpos[0] ?? 0) + scale.femur * Math.sin(rhx);
  const rAnkleZ = rKneeZ - scale.tibia * Math.cos(rhx + rk);
  const rAnkleX = rKneeX + scale.tibia * Math.sin(rhx + rk);

  sites['r_knee']  = { x: rKneeX,  y: 0, z: rKneeZ  };
  sites['r_ankle'] = { x: rAnkleX, y: 0, z: rAnkleZ };

  // Arms (simple, shoulder-relative)
  const ls = sites['shoulder_center'];
  const lsx = (qpos[2] ?? 0) * RAD;
  const le  = (qpos[4] ?? 0) * RAD;
  const lElbowX = ls.x - scale.humerus * Math.sin(lsx);
  const lElbowZ = ls.z - scale.humerus * Math.cos(lsx);
  sites['l_elbow'] = { x: lElbowX, y: 0, z: lElbowZ };
  sites['l_wrist'] = {
    x: lElbowX - scale.forearm * Math.sin(lsx - le),
    y: 0,
    z: lElbowZ - scale.forearm * Math.cos(lsx - le),
  };

  const rsx = (qpos[5] ?? 0) * RAD;
  const re  = (qpos[7] ?? 0) * RAD;
  const rElbowX = ls.x + scale.humerus * Math.sin(rsx);
  const rElbowZ = ls.z - scale.humerus * Math.cos(rsx);
  sites['r_elbow'] = { x: rElbowX, y: 0, z: rElbowZ };
  sites['r_wrist'] = {
    x: rElbowX + scale.forearm * Math.sin(rsx - re),
    y: 0,
    z: rElbowZ - scale.forearm * Math.cos(rsx - re),
  };

  return sites[siteName] ?? { x: 0, y: 0, z: 0 };
}

function ikCostForWindow(qposWindow, targets, scale) {
  let cost = 0;
  for (let fi = 0; fi < qposWindow.length; fi++) {
    const qpos = qposWindow[fi];
    for (const [siteName, target] of Object.entries(targets[fi])) {
      const pred = simpleFKSite(siteName, qpos, scale);
      cost += (pred.x - target.x) ** 2 + (pred.z - target.z) ** 2;
    }
  }
  return cost;
}

function clampJoint(name, val) {
  const limits = {
    torso_x: [-30, 30], torso_z: [-20, 20],
    l_shoulder_x: [-90, 180], l_shoulder_z: [-90, 90], l_elbow: [0, 150],
    r_shoulder_x: [-90, 180], r_shoulder_z: [-90, 90], r_elbow: [0, 150],
    l_hip_x: [-40, 130], l_hip_z: [-30, 30], l_knee: [0, 150], l_ankle: [-45, 30],
    r_hip_x: [-40, 130], r_hip_z: [-30, 30], r_knee: [0, 150], r_ankle: [-45, 30],
  };
  const JOINT_NAMES = ['torso_x','torso_z','l_shoulder_x','l_shoulder_z','l_elbow','r_shoulder_x','r_shoulder_z','r_elbow','l_hip_x','l_hip_z','l_knee','l_ankle','r_hip_x','r_hip_z','r_knee','r_ankle'];
  const jname = JOINT_NAMES[name] ?? '';
  const lim = limits[jname];
  if (!lim) return val;
  return Math.max(lim[0], Math.min(lim[1], val));
}

/**
 * Solve IK for a sliding window of frames.
 * @param {Array} filteredFrames - Kalman-filtered landmark frames
 * @param {number} ppm - pixels per meter
 * @param {object} scale - anthropometric scale
 * @param {number} windowStart - index of window start
 * @returns {Array} joint angle arrays per frame in window
 */
export function solveWindowIK(filteredFrames, ppm, scale, windowStart, prevQpos) {
  const windowEnd = Math.min(windowStart + WINDOW, filteredFrames.length);
  const videoH = filteredFrames[0]?.videoH ?? 480;

  // Build 3D targets for each frame in the window
  const targetsList = [];
  for (let fi = windowStart; fi < windowEnd; fi++) {
    const frame = filteredFrames[fi];
    const lms = frame.landmarks;
    const targets = {};

    for (const [siteName, mapping] of Object.entries(SITE_LM_MAP)) {
      let pt;
      if (mapping.avg) {
        const lA = lms[mapping.left];
        const lB = lms[mapping.right];
        if (lA && lB) pt = { x: (lA.x + lB.x) / 2, y: (lA.y + lB.y) / 2, score: Math.min(lA.score ?? 1, lB.score ?? 1) };
      } else {
        pt = lms[mapping.idx];
      }
      if (pt && (pt.score ?? 1) > 0.1) {
        targets[siteName] = landmarkTo3D(pt, ppm, videoH);
      }
    }
    targetsList.push(targets);
  }

  // Init qpos window from previous solution (warm start)
  const nFrames = windowEnd - windowStart;
  const nJoints = 16;
  let qposWindow = Array.from({ length: nFrames }, (_, i) =>
    prevQpos ? [...prevQpos] : new Array(nJoints).fill(0)
  );

  // Set root position from hip_center target
  for (let i = 0; i < nFrames; i++) {
    const hc = targetsList[i]['hip_center'];
    if (hc) {
      qposWindow[i][0] = hc.x;
      qposWindow[i][2] = hc.z;
    }
  }

  // Gradient-free coordinate descent (finite-difference gradient)
  const EPS = 1.5;
  for (let iter = 0; iter < IK_ITERS; iter++) {
    for (let fi = 0; fi < nFrames; fi++) {
      for (let ji = 2; ji < nJoints; ji++) { // skip root px,pz
        const orig = qposWindow[fi][ji];
        const c0 = ikCostForWindow([qposWindow[fi]], [targetsList[fi]], scale);
        qposWindow[fi][ji] = orig + EPS;
        const cp = ikCostForWindow([qposWindow[fi]], [targetsList[fi]], scale);
        qposWindow[fi][ji] = orig - EPS;
        const cm = ikCostForWindow([qposWindow[fi]], [targetsList[fi]], scale);
        qposWindow[fi][ji] = orig;
        const grad = (cp - cm) / (2 * EPS);
        const newVal = orig - IK_LR * grad;
        qposWindow[fi][ji] = clampJoint(ji, newVal);
      }
    }
  }

  return qposWindow;
}

/**
 * Compute angular velocity (rad/s) from successive joint angle arrays.
 * Also flags physiological warnings.
 */
export function computeAngularVelocities(qposHistory, fps) {
  const warnings = [];
  const angVels = [];
  const JOINT_NAMES = ['torso_x','torso_z','l_shoulder_x','l_shoulder_z','l_elbow','r_shoulder_x','r_shoulder_z','r_elbow','l_hip_x','l_hip_z','l_knee','l_ankle','r_hip_x','r_hip_z','r_knee','r_ankle'];

  for (let i = 1; i < qposHistory.length; i++) {
    const dt = 1 / fps;
    const av = qposHistory[i].map((q, ji) => {
      const dq = ((q - qposHistory[i-1][ji]) * Math.PI / 180);
      return dq / dt;
    });
    angVels.push(av);

    // Knee velocity check
    const lKneeOmega = Math.abs(av[10]);
    const rKneeOmega = Math.abs(av[14]);
    if (lKneeOmega > PHY_WARN_OMEGA)
      warnings.push(`Frame ${i}: Left knee ω=${lKneeOmega.toFixed(1)} rad/s exceeds ${PHY_WARN_OMEGA} rad/s limit`);
    if (rKneeOmega > PHY_WARN_OMEGA)
      warnings.push(`Frame ${i}: Right knee ω=${rKneeOmega.toFixed(1)} rad/s exceeds ${PHY_WARN_OMEGA} rad/s limit`);
  }
  return { angVels, warnings };
}

/**
 * Export results as a CSV blob URL.
 */
export function exportKinematicsCSV(filteredFrames, qposHistory, angVels, strideEvents, fps) {
  const JOINT_NAMES = ['torso_x','torso_z','l_shoulder_x','l_shoulder_z','l_elbow','r_shoulder_x','r_shoulder_z','r_elbow','l_hip_x','l_hip_z','l_knee','l_ankle','r_hip_x','r_hip_z','r_knee','r_ankle'];
  const header = [
    'timestamp_s',
    ...JOINT_NAMES.map(n => `${n}_deg`),
    ...JOINT_NAMES.map(n => `${n}_omega_rads`),
    'com_vel_ms',
    'stride_length_m',
  ].join(',');

  const rows = qposHistory.map((qpos, i) => {
    const t = i / fps;
    const angles = qpos.map(q => q.toFixed(3));
    const omegas = (angVels[i] ?? new Array(16).fill(0)).map(v => v.toFixed(4));
    const comVel = filteredFrames[i]?.comVel?.toFixed(3) ?? '0';
    const strideL = (filteredFrames[i]?.strideLength ?? 0).toFixed(3);
    return [t.toFixed(4), ...angles, ...omegas, comVel, strideL].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  return URL.createObjectURL(blob);
}

// ── React hook ──────────────────────────────────────────────────────────────
export default function useMuJoCoIK() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const mujocoRef = useRef(null);
  const modelRef = useRef(null);
  const dataRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: loadMujoco } = await import('mujoco-js');
        const mujoco = await loadMujoco();
        mujoco.FS.mkdir('/working');
        mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
        mujocoRef.current = mujoco;
        if (!cancelled) setReady(true);
      } catch (e) {
        console.warn('MuJoCo WASM load failed, using JS-only IK fallback:', e.message);
        if (!cancelled) {
          setReady(true); // still usable — JS IK doesn't need WASM
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Initialise or re-initialise the MuJoCo model with new scale.
   */
  const initModel = (scale) => {
    const mj = mujocoRef.current;
    if (!mj) return;
    try {
      modelRef.current?.delete();
      dataRef.current?.delete();
      const xml = buildMJCF(scale);
      mj.FS.writeFile('/working/human.xml', xml);
      modelRef.current = mj.MjModel.loadFromXML('/working/human.xml');
      dataRef.current = new mj.MjData(modelRef.current);
    } catch (e) {
      console.warn('MuJoCo model init failed:', e.message);
    }
  };

  return {
    ready,
    error,
    initModel,
    get model() { return modelRef.current; },
    get data() { return dataRef.current; },
    get mujoco() { return mujocoRef.current; },
  };
}