/**
 * Stride analyser — detects footstrike events per leg using ankle vertical position MINIMA
 * (minimum Y in oscillation period = ankle at lowest point of arc = ground contact / stance phase).
 * Between consecutive same-leg troughs = one full stride.
 */

import { analyzeStrides as analyzeStridesPose } from '@/lib/PoseAnalysis';

const MIN_FRAMES = 5;

const EMPTY = {
  stanceEvents: [],
  strideMetrics: [],
  windowedMetrics: [],
  jointAngles: [],
  leftContactDurations: [],
  rightContactDurations: [],
  velocityData: [],
  asymmetry: {
    strideLength: { pct: 0, left: 0, right: 0 },
    strideFreq: { pct: 0, left: 0, right: 0 },
    contactTime: { pct: 0, left: 0, right: 0 },
  },
};

function emptyWithReason(reason) {
  return {
    ...EMPTY,
    peakSpeed: 0,
    avgSpeed: 0,
    strideDebug: reason,
  };
}

/**
 * Find local minima in a smoothed Y array with prominence filtering.
 * Minimum Y in the oscillation period = ankle at lowest arc point = stance/ground contact.
 */
function findTroughs(values, times, minProminence = 0.01) {
  const troughs = [];
  const n = values.length;
  for (let i = 1; i < n - 1; i++) {
    const v = values[i];
    if (v < values[i - 1] && v < values[i + 1]) {
      const leftMax = values[i - 1];
      const rightMax = values[i + 1];
      const prominence = Math.min(leftMax, rightMax) - v;
      if (prominence >= minProminence) {
        if (troughs.length === 0 || times[i] - troughs[troughs.length - 1].t >= MIN_STRIDE_DT) {
          troughs.push({ t: times[i], idx: i, y: v });
        } else if (v < troughs[troughs.length - 1].y) {
          troughs[troughs.length - 1] = { t: times[i], idx: i, y: v };
        }
      }
    }
  }
  return troughs;
}

/** 5-point moving average smoothing */
function smooth(arr) {
  return arr.map((v, i) => {
    const slice = arr.slice(Math.max(0, i - 2), Math.min(arr.length, i + 3));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

const EMPTY = { stanceEvents: [], strideMetrics: [], windowedMetrics: [] };

function emptyWithReason(reason) {
  return { ...EMPTY, strideDebug: reason };
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

  const frameH = videoDims?.h || 360;

  // Deduplicate frames by time (handles video looping re-adding same timestamps)
  const seen = new Set();
  const unique = poseHistory.filter((f) => {
    const key = f.t.toFixed(3);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Build per-leg ankle series — only frames with confident ankle detection
  const leftFrames  = uniqueHistory.filter(f => f.pose?.leftAnkle?.score  > 0.2);
  const rightFrames = uniqueHistory.filter(f => f.pose?.rightAnkle?.score > 0.2);

  if (leftFrames.length < MIN_FRAMES && rightFrames.length < MIN_FRAMES) {
    return emptyWithReason(
      `need_${MIN_FRAMES}_confident_ankle_frames (L:${leftFrames.length} R:${rightFrames.length})`
    );
  }
  return frames;
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

/**
 * Build stance events (foot down with x,y for overlay) from PoseAnalysis result frames.
 */
function buildStanceEvents(frames) {
  const events = [];
  let prevLeft = false;
  let prevRight = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.leftOnGround && !prevLeft) {
      events.push({
        t: f.time,
        leg: 'left',
        x: f.leftAnkleX,
        y: f.leftAnkleY,
      });
    }
    if (f.rightOnGround && !prevRight) {
      events.push({
        t: f.time,
        leg: 'right',
        x: f.rightAnkleX,
        y: f.rightAnkleY,
      });
    }
    prevLeft = f.leftOnGround ?? false;
    prevRight = f.rightOnGround ?? false;
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

export function analyseStrides(poseHistory, pixelsPerMeter, videoDims) {
  if (!poseHistory || poseHistory.length < MIN_FRAMES) {
    return emptyWithReason(
      !poseHistory
        ? 'no_pose_history'
        : `need_${MIN_FRAMES}_frames (have ${poseHistory.length})`
    );
  }
  if (!pixelsPerMeter) {
    return emptyWithReason('no_calibration');
  }

  const leftPeaks  = findTroughs(smooth(leftYNorm),  leftTimes);
  const rightPeaks = findTroughs(smooth(rightYNorm), rightTimes);

  const fps = estimateFps(frames);
  const result = analyzeStridesPose(frames, pixelsPerMeter, fps);

  const stanceEvents = buildStanceEvents(result.frames);

  const strideMetrics = (result.strideEvents || []).map((se) => ({
    t: parseFloat(Number(se.time).toFixed(2)),
    strideLength: parseFloat(Number(se.strideLength).toFixed(3)),
    strideFreq: parseFloat(Number(se.strideFrequency).toFixed(3)),
  })).sort((a, b) => a.t - b.t);

  const windowedMetrics = [];
  if (strideMetrics.length > 0) {
    const tMin = strideMetrics[0].t;
    const tMax = strideMetrics[strideMetrics.length - 1].t;
    for (let tBucket = Math.floor(tMin); tBucket <= Math.ceil(tMax); tBucket++) {
      const inWindow = strideMetrics.filter(
        (m) => m.t >= tBucket && m.t < tBucket + 1
      );
      if (inWindow.length === 0) continue;
      windowedMetrics.push({
        t: tBucket,
        avgStrideLength: parseFloat(
          (
            inWindow.reduce((s, m) => s + m.strideLength, 0) / inWindow.length
          ).toFixed(3)
        ),
        avgStrideFreq: parseFloat(
          (
            inWindow.reduce((s, m) => s + m.strideFreq, 0) / inWindow.length
          ).toFixed(3)
        ),
      });
    }
  }

  // ── Joint angles per frame ──────────────────────────────────────────────
  const jointAngles = uniqueHistory
    .filter(f => {
      const p = f.pose;
      return p?.leftHip && p?.rightHip && p?.leftKnee && p?.rightKnee && p?.leftAnkle && p?.rightAnkle;
    })
    .map(f => {
      const p = f.pose;
      return {
        t: parseFloat(f.t.toFixed(2)),
        leftKnee:  computeAngle(p.leftHip.x,  p.leftHip.y,  p.leftKnee.x,  p.leftKnee.y,  p.leftAnkle.x,  p.leftAnkle.y),
        rightKnee: computeAngle(p.rightHip.x, p.rightHip.y, p.rightKnee.x, p.rightKnee.y, p.rightAnkle.x, p.rightAnkle.y),
        // hip flexion: angle between vertical (above hip) → hip → knee
        leftHip:   computeAngle(p.leftHip.x,  p.leftHip.y  - 100, p.leftHip.x,  p.leftHip.y,  p.leftKnee.x,  p.leftKnee.y),
        rightHip:  computeAngle(p.rightHip.x, p.rightHip.y - 100, p.rightHip.x, p.rightHip.y, p.rightKnee.x, p.rightKnee.y),
      };
    });

  // ── Ground contact time (from ankle Y peaks) ────────────────────────────
  // A contact event spans from the frame where the ankle is first "down" to when it lifts.
  // We use the same peak logic: near-peak frames within ±MIN_STRIDE_DT/2 window.
  const buildContactDurations = (frames, yNorm, times) => {
    const threshold = 0.25; // bottom 25% Y values = minimum ankle Y = stance/ground contact
    const maxY = Math.max(...yNorm);
    const minY = Math.min(...yNorm);
    const range = Math.max(maxY - minY, 0.01);
    const norm = yNorm.map(v => (v - minY) / range); // re-normalise within leg

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
          contactDurations.push({ t: parseFloat(contactStart.toFixed(2)), duration: parseFloat((dur * 1000).toFixed(0)) }); // ms
        }
      }
    }
    return contactDurations;
  };

  const leftContactDurations  = leftFrames.length >= MIN_FRAMES
    ? buildContactDurations(leftFrames,  smooth(leftYNorm),  leftTimes)
    : [];
  const rightContactDurations = rightFrames.length >= MIN_FRAMES
    ? buildContactDurations(rightFrames, smooth(rightYNorm), rightTimes)
    : [];

  // ── Velocity & Acceleration ─────────────────────────────────────────────
  const hipFrames = uniqueHistory.filter(f => f.pose?.leftHip && f.pose?.rightHip);
  let velocityData = [];
  if (hipFrames.length >= 2 && pixelsPerMeter) {
    const rawVel = hipFrames.map((f, i) => {
      if (i === 0) return 0;
      const dt = f.t - hipFrames[i-1].t;
      if (dt <= 0) return 0;
      const hipX1 = (hipFrames[i-1].pose.leftHip.x + hipFrames[i-1].pose.rightHip.x) / 2;
      const hipX2 = (f.pose.leftHip.x + f.pose.rightHip.x) / 2;
      const hipY1 = (hipFrames[i-1].pose.leftHip.y + hipFrames[i-1].pose.rightHip.y) / 2;
      const hipY2 = (f.pose.leftHip.y + f.pose.rightHip.y) / 2;
      return Math.hypot(hipX2 - hipX1, hipY2 - hipY1) / pixelsPerMeter / dt;
    });
    const smoothVel = smoothArr(rawVel, 7);
    const accArr = smoothVel.map((v, i) => {
      if (i === 0) return 0;
      const dt = hipFrames[i].t - hipFrames[i-1].t;
      return dt > 0 ? (v - smoothVel[i-1]) / dt : 0;
    });
    velocityData = hipFrames.map((f, i) => ({
      t:    parseFloat(f.t.toFixed(2)),
      speed: parseFloat(smoothVel[i].toFixed(3)),
      accel: parseFloat(accArr[i].toFixed(3)),
    }));

  const velocityData = (result.frames || []).map((f) => ({
    t: parseFloat(Number(f.time).toFixed(2)),
    speed: parseFloat(Number(f.velocity ?? 0).toFixed(3)),
    accel: parseFloat(Number(f.acceleration ?? 0).toFixed(3)),
  }));

  const asym = result.asymmetry || {};
  const asymmetry = {
    strideLength: {
      pct: asym.strideLengthAsymmetry ?? 0,
      left: asym.leftAvgStrideLength ?? 0,
      right: asym.rightAvgStrideLength ?? 0,
    },
    strideFreq: {
      pct: asym.strideFrequencyAsymmetry ?? 0,
      left: asym.leftAvgStrideFrequency ?? 0,
      right: asym.rightAvgStrideFrequency ?? 0,
    },
    contactTime: {
      pct: asym.contactTimeAsymmetry ?? 0,
      left: (asym.leftAvgContactTime ?? 0) * 1000,
      right: (asym.rightAvgContactTime ?? 0) * 1000,
    },
  };

  const leftStrideCount = (result.strideEvents || []).filter(
    (s) => s.foot === 'left'
  ).length;
  const rightStrideCount = (result.strideEvents || []).filter(
    (s) => s.foot === 'right'
  ).length;
  const strideDebug =
    strideMetrics.length === 0
      ? `need_2_footstrikes_per_leg (L:${leftStrideCount} R:${rightStrideCount})`
      : null;

  const strideDebug =
    strideMetrics.length === 0
      ? `need_2_stance_troughs_per_leg (L:${leftPeaks.length} R:${rightPeaks.length})`
      : null;

  return {
    stanceEvents,
    strideMetrics,
    windowedMetrics,
    jointAngles,
    leftContactDurations,
    rightContactDurations,
    velocityData,
    asymmetry,
    peakSpeed: parseFloat(peakSpeed.toFixed(3)),
    avgSpeed:  parseFloat(avgSpeed.toFixed(3)),
    strideDebug,
  };
}
