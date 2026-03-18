/**
 * Stride analyser — uses PoseAnalysis (ground detection, contact events, stride events)
 * from pose history. Converts poseHistory to flat frames and maps results to the
 * format expected by StrideGraph, GaitTimeline, StatsPanel, etc.
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
 * Convert poseHistory [{ t, pose: { leftAnkle, rightAnkle, leftKnee, rightKnee, leftHip, rightHip } }]
 * to flat StrideData frames for PoseAnalysis. Only includes frames with all 6 keypoints and ankle score > 0.2.
 */
function poseHistoryToStrideFrames(poseHistory) {
  const seen = new Set();
  const unique = poseHistory.filter((f) => {
    const key = f.t.toFixed(3);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const frames = [];
  for (const f of unique) {
    const p = f.pose;
    if (
      !p?.leftAnkle || p.leftAnkle.x == null || p.leftAnkle.y == null ||
      !p?.rightAnkle || p.rightAnkle.x == null || p.rightAnkle.y == null ||
      !p?.leftKnee || p.leftKnee.x == null || p.leftKnee.y == null ||
      !p?.rightKnee || p.rightKnee.x == null || p.rightKnee.y == null ||
      !p?.leftHip || p.leftHip.x == null || p.leftHip.y == null ||
      !p?.rightHip || p.rightHip.x == null || p.rightHip.y == null
    )
      continue;
    if ((p.leftAnkle?.score ?? 0) < 0.2 && (p.rightAnkle?.score ?? 0) < 0.2)
      continue;
    frames.push({
      time: f.t,
      leftAnkleX: p.leftAnkle.x,
      leftAnkleY: p.leftAnkle.y,
      rightAnkleX: p.rightAnkle.x,
      rightAnkleY: p.rightAnkle.y,
      leftKneeX: p.leftKnee.x,
      leftKneeY: p.leftKnee.y,
      rightKneeX: p.rightKnee.x,
      rightKneeY: p.rightKnee.y,
      leftHipX: p.leftHip.x,
      leftHipY: p.leftHip.y,
      rightHipX: p.rightHip.x,
      rightHipY: p.rightHip.y,
    });
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

  const frames = poseHistoryToStrideFrames(poseHistory);
  if (frames.length < MIN_FRAMES) {
    return emptyWithReason(
      `need_${MIN_FRAMES}_confident_ankle_frames (have ${frames.length})`
    );
  }

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

  const jointAngles = (result.frames || []).map((f) => ({
    t: parseFloat(Number(f.time).toFixed(2)),
    leftKnee: f.leftKneeAngle ?? 0,
    rightKnee: f.rightKneeAngle ?? 0,
    leftHip: f.leftHipAngle ?? 0,
    rightHip: f.rightHipAngle ?? 0,
  }));

  const contactEvents = result.contactEvents || [];
  const leftContactDurations = contactEvents
    .filter((c) => c.foot === 'left')
    .map((c) => ({
      t: parseFloat(Number(c.startTime).toFixed(2)),
      duration: parseFloat((c.duration * 1000).toFixed(0)),
    }));
  const rightContactDurations = contactEvents
    .filter((c) => c.foot === 'right')
    .map((c) => ({
      t: parseFloat(Number(c.startTime).toFixed(2)),
      duration: parseFloat((c.duration * 1000).toFixed(0)),
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

  return {
    stanceEvents,
    strideMetrics,
    windowedMetrics,
    jointAngles,
    leftContactDurations,
    rightContactDurations,
    velocityData,
    asymmetry,
    peakSpeed: parseFloat(Number(result.maxVelocity ?? 0).toFixed(3)),
    avgSpeed: parseFloat(Number(result.avgVelocity ?? 0).toFixed(3)),
    strideDebug,
  };
}
