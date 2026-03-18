/**
 * Stride analyser — delegates to PoseAnalysis for gait metrics,
 * and adds joint angles + contact time on top.
 */

import { analyzeStrides as analyzeStridesPose } from '@/lib/PoseAnalysis';

const MIN_FRAMES = 5;
const MIN_STRIDE_DT = 0.3; // minimum seconds between same-leg troughs

const EMPTY = {
  stanceEvents: [],
  strideMetrics: [],
  windowedMetrics: [],
  jointAngles: [],
  leftContactDurations: [],
  rightContactDurations: [],
  velocityData: [],
  peakSpeed: 0,
  avgSpeed: 0,
  asymmetry: {
    strideLength: { pct: 0, left: 0, right: 0 },
    strideFreq:   { pct: 0, left: 0, right: 0 },
    contactTime:  { pct: 0, left: 0, right: 0 },
  },
  strideDebug: null,
};

function emptyWithReason(reason) {
  return { ...EMPTY, strideDebug: reason };
}

/** 5-point moving average */
function smooth(arr) {
  return arr.map((v, i) => {
    const slice = arr.slice(Math.max(0, i - 2), Math.min(arr.length, i + 3));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Estimate fps from frame times (median delta). */
function estimateFps(frames) {
  if (frames.length < 2) return 10;
  const deltas = frames
    .slice(1)
    .map((f, i) => f.time - frames[i].time)
    .filter((d) => d > 0);
  if (deltas.length === 0) return 10;
  deltas.sort((a, b) => a - b);
  const medianDt = deltas[Math.floor(deltas.length / 2)];
  return medianDt > 0 ? 1 / medianDt : 10;
}

/** Build stance events from PoseAnalysis result frames. */
function buildStanceEvents(frames) {
  const events = [];
  let prevLeft = false;
  let prevRight = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.leftOnGround && !prevLeft) {
      events.push({ t: f.time, leg: 'left',  x: f.leftAnkleX,  y: f.leftAnkleY });
    }
    if (f.rightOnGround && !prevRight) {
      events.push({ t: f.time, leg: 'right', x: f.rightAnkleX, y: f.rightAnkleY });
    }
    prevLeft  = f.leftOnGround  ?? false;
    prevRight = f.rightOnGround ?? false;
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** Compute angle (degrees) at vertex b given three points a-b-c. */
function computeAngle(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by;
  const v2x = cx - bx, v2y = cy - by;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (mag === 0) return 0;
  return parseFloat((Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)).toFixed(1));
}

/**
 * Build ground-contact durations using the bottom 25% of normalised ankle Y
 * (minimum Y = lowest arc point = stance / ground contact).
 */
function buildContactDurations(yNorm, times) {
  const threshold = 0.25;
  const maxY = Math.max(...yNorm);
  const minY = Math.min(...yNorm);
  const range = Math.max(maxY - minY, 0.01);
  const norm = yNorm.map(v => (v - minY) / range);

  const contactDurations = [];
  let inContact = false;
  let contactStart = null;

  for (let i = 0; i < norm.length; i++) {
    if (!inContact && norm[i] <= threshold) {
      inContact = true;
      contactStart = times[i];
    } else if (inContact && norm[i] > threshold) {
      inContact = false;
      const dur = times[i] - contactStart;
      if (dur > 0.05 && dur < 2) {
        contactDurations.push({
          t: parseFloat(contactStart.toFixed(2)),
          duration: parseFloat((dur * 1000).toFixed(0)),
        });
      }
    }
  }
  return contactDurations;
}

export function analyseStrides(poseHistory, pixelsPerMeter, videoDims) {
  if (!poseHistory || poseHistory.length < MIN_FRAMES) {
    return emptyWithReason(
      !poseHistory ? 'no_pose_history' : `need_${MIN_FRAMES}_frames (have ${poseHistory.length})`
    );
  }
  if (!pixelsPerMeter) {
    return emptyWithReason('no_calibration');
  }

  // Deduplicate frames by timestamp
  const seen = new Set();
  const unique = poseHistory.filter((f) => {
    const key = f.t.toFixed(3);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Convert to PoseAnalysis frame format: { time, pose }
  const frames = unique.map(f => ({ time: f.t, pose: f.pose, ...f }));

  const fps = estimateFps(frames);
  const result = analyzeStridesPose(frames, pixelsPerMeter, fps);

  // ── Stance events ────────────────────────────────────────────────────────
  const stanceEvents = buildStanceEvents(result.frames || []);

  // ── Stride metrics ───────────────────────────────────────────────────────
  const strideMetrics = (result.strideEvents || []).map((se) => ({
    t:            parseFloat(Number(se.time).toFixed(2)),
    strideLength: parseFloat(Number(se.strideLength).toFixed(3)),
    strideFreq:   parseFloat(Number(se.strideFrequency).toFixed(3)),
  })).sort((a, b) => a.t - b.t);

  // Windowed (per-second) averages
  const windowedMetrics = [];
  if (strideMetrics.length > 0) {
    const tMin = strideMetrics[0].t;
    const tMax = strideMetrics[strideMetrics.length - 1].t;
    for (let tBucket = Math.floor(tMin); tBucket <= Math.ceil(tMax); tBucket++) {
      const inWindow = strideMetrics.filter(m => m.t >= tBucket && m.t < tBucket + 1);
      if (inWindow.length === 0) continue;
      windowedMetrics.push({
        t: tBucket,
        avgStrideLength: parseFloat((inWindow.reduce((s, m) => s + m.strideLength, 0) / inWindow.length).toFixed(3)),
        avgStrideFreq:   parseFloat((inWindow.reduce((s, m) => s + m.strideFreq,   0) / inWindow.length).toFixed(3)),
      });
    }
  }

  // ── Joint angles ─────────────────────────────────────────────────────────
  const jointAngles = unique
    .filter(f => {
      const p = f.pose;
      return p?.leftHip && p?.rightHip && p?.leftKnee && p?.rightKnee && p?.leftAnkle && p?.rightAnkle;
    })
    .map(f => {
      const p = f.pose;
      return {
        t:          parseFloat(f.t.toFixed(2)),
        leftKnee:   computeAngle(p.leftHip.x,  p.leftHip.y,      p.leftKnee.x,  p.leftKnee.y,  p.leftAnkle.x,  p.leftAnkle.y),
        rightKnee:  computeAngle(p.rightHip.x, p.rightHip.y,     p.rightKnee.x, p.rightKnee.y, p.rightAnkle.x, p.rightAnkle.y),
        leftHip:    computeAngle(p.leftHip.x,  p.leftHip.y - 100, p.leftHip.x,  p.leftHip.y,  p.leftKnee.x,   p.leftKnee.y),
        rightHip:   computeAngle(p.rightHip.x, p.rightHip.y - 100, p.rightHip.x, p.rightHip.y, p.rightKnee.x,  p.rightKnee.y),
      };
    });

  // ── Ground contact durations ─────────────────────────────────────────────
  const leftFrames  = unique.filter(f => (f.pose?.leftAnkle?.score  ?? 0) > 0.2);
  const rightFrames = unique.filter(f => (f.pose?.rightAnkle?.score ?? 0) > 0.2);

  const leftContactDurations = leftFrames.length >= MIN_FRAMES
    ? buildContactDurations(
        smooth(leftFrames.map(f => f.pose.leftAnkle.y)),
        leftFrames.map(f => f.t)
      )
    : [];
  const rightContactDurations = rightFrames.length >= MIN_FRAMES
    ? buildContactDurations(
        smooth(rightFrames.map(f => f.pose.rightAnkle.y)),
        rightFrames.map(f => f.t)
      )
    : [];

  // ── Velocity & Acceleration ──────────────────────────────────────────────
  const velocityData = (result.frames || []).map((f) => ({
    t:     parseFloat(Number(f.time).toFixed(2)),
    speed: parseFloat(Number(f.velocity    ?? 0).toFixed(3)),
    accel: parseFloat(Number(f.acceleration ?? 0).toFixed(3)),
  }));

  const speeds = velocityData.map(d => d.speed).filter(Boolean);
  const peakSpeed = speeds.length ? Math.max(...speeds) : 0;
  const avgSpeed  = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  // ── Asymmetry ────────────────────────────────────────────────────────────
  const asym = result.asymmetry || {};
  const asymmetry = {
    strideLength: {
      pct:   asym.strideLengthAsymmetry     ?? 0,
      left:  asym.leftAvgStrideLength       ?? 0,
      right: asym.rightAvgStrideLength      ?? 0,
    },
    strideFreq: {
      pct:   asym.strideFrequencyAsymmetry  ?? 0,
      left:  asym.leftAvgStrideFrequency    ?? 0,
      right: asym.rightAvgStrideFrequency   ?? 0,
    },
    contactTime: {
      pct:   asym.contactTimeAsymmetry      ?? 0,
      left:  (asym.leftAvgContactTime       ?? 0) * 1000,
      right: (asym.rightAvgContactTime      ?? 0) * 1000,
    },
  };

  // ── Debug hint ───────────────────────────────────────────────────────────
  const leftStrideCount  = (result.strideEvents || []).filter(s => s.foot === 'left').length;
  const rightStrideCount = (result.strideEvents || []).filter(s => s.foot === 'right').length;
  const strideDebug = strideMetrics.length === 0
    ? `need_2_stance_troughs_per_leg (L:${leftStrideCount} R:${rightStrideCount})`
    : null;

  return {
    stanceEvents,
    strideMetrics,
    windowedMetrics,
    jointAngles,
    leftContactDurations,
    rightContactDurations,
    velocityData,
    peakSpeed: parseFloat(peakSpeed.toFixed(3)),
    avgSpeed:  parseFloat(avgSpeed.toFixed(3)),
    asymmetry,
    strideDebug,
  };
}