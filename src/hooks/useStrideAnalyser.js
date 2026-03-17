/**
 * Stride analyser — detects stance/flight phases per leg and computes:
 *   - strideEvents: array of { t, leg, type: 'stance'|'flight', ankleX, ankleY }
 *   - strideMetrics: array of { t, strideLength (m), strideFreq (strides/s), stepLength (m) }
 *   - windowedMetrics: array of { t (1s bucket), avgStrideLength, avgStrideFreq }
 *
 * Stance detection heuristic:
 *   The ankle Y coordinate relative to the hip Y tracks the leg's "height".
 *   When ankle Y is close to hip Y (high relative position in image = leg forward/back in stance),
 *   we use ankle velocity. A low vertical ankle velocity indicates ground contact (stance).
 *   A sudden upward velocity peak indicates toe-off (start of flight).
 */

const STANCE_VEL_THRESHOLD = 0.08; // normalised to frame height per frame — below this = stance
const MIN_PHASE_FRAMES = 3; // minimum consecutive frames to confirm a phase change

export function analyseStrides(poseHistory, pixelsPerMeter, videoDims) {
  if (!poseHistory || poseHistory.length < 6 || !pixelsPerMeter) {
    return { strideEvents: [], strideMetrics: [], windowedMetrics: [] };
  }

  const h = videoDims?.h || 360;

  // Extract ankle positions per leg over time
  // poseHistory: [{t, pose: {leftAnkle, rightAnkle, hipCenter, ...}}]
  const leftAnkles = poseHistory
    .filter(f => f.pose?.leftAnkle?.score > 0.35)
    .map(f => ({ t: f.t, x: f.pose.leftAnkle.x, y: f.pose.leftAnkle.y }));

  const rightAnkles = poseHistory
    .filter(f => f.pose?.rightAnkle?.score > 0.35)
    .map(f => ({ t: f.t, x: f.pose.rightAnkle.x, y: f.pose.rightAnkle.y }));

  // Detect stance phases per leg using vertical ankle velocity
  const detectPhases = (ankles) => {
    if (ankles.length < 4) return [];
    const phases = [];
    // Compute smoothed vertical velocity (dy/dt normalised by height)
    const vels = [];
    for (let i = 1; i < ankles.length; i++) {
      const dt = ankles[i].t - ankles[i - 1].t;
      if (dt <= 0) { vels.push(0); continue; }
      const dy = Math.abs(ankles[i].y - ankles[i - 1].y) / h;
      vels.push(dy / dt);
    }

    // Smooth velocities (3-point moving average)
    const smoothVels = vels.map((v, i) => {
      const a = vels[Math.max(0, i - 1)];
      const b = v;
      const c = vels[Math.min(vels.length - 1, i + 1)];
      return (a + b + c) / 3;
    });

    // Classify each frame as stance (low vel) or flight (high vel)
    // Use index i+1 for ankle (velocity index i corresponds to transition i->i+1)
    let currentPhase = null;
    let phaseStart = null;
    let phaseCount = 0;

    for (let i = 0; i < smoothVels.length; i++) {
      const isStance = smoothVels[i] < STANCE_VEL_THRESHOLD;
      const phase = isStance ? 'stance' : 'flight';

      if (phase === currentPhase) {
        phaseCount++;
      } else {
        if (currentPhase !== null && phaseCount >= MIN_PHASE_FRAMES) {
          phases.push({
            type: currentPhase,
            startT: phaseStart,
            endT: ankles[i].t,
            startX: ankles[phases.length === 0 ? 0 : i - phaseCount].x,
            startY: ankles[phases.length === 0 ? 0 : i - phaseCount].y,
            // mid-stance position
            midX: ankles[Math.floor((i - phaseCount / 2))].x,
            midY: ankles[Math.floor((i - phaseCount / 2))].y,
          });
        }
        currentPhase = phase;
        phaseStart = ankles[i + 1]?.t ?? ankles[i].t;
        phaseCount = 1;
      }
    }

    return phases;
  };

  const leftPhases = detectPhases(leftAnkles);
  const rightPhases = detectPhases(rightAnkles);

  // Extract stance events (footstrikes) — midpoint of each stance phase
  const stanceEvents = [];

  leftPhases
    .filter(p => p.type === 'stance')
    .forEach(p => {
      stanceEvents.push({
        t: (p.startT + p.endT) / 2,
        leg: 'left',
        x: p.midX,
        y: p.midY,
        startT: p.startT,
        endT: p.endT,
      });
    });

  rightPhases
    .filter(p => p.type === 'stance')
    .forEach(p => {
      stanceEvents.push({
        t: (p.startT + p.endT) / 2,
        leg: 'right',
        x: p.midX,
        y: p.midY,
        startT: p.startT,
        endT: p.endT,
      });
    });

  // Sort by time
  stanceEvents.sort((a, b) => a.t - b.t);

  // Compute stride metrics: stride = same-leg consecutive stances
  // Step = consecutive stances of alternating legs
  const strideMetrics = [];

  const leftStances = stanceEvents.filter(e => e.leg === 'left');
  const rightStances = stanceEvents.filter(e => e.leg === 'right');

  // For each same-leg pair, compute stride length and frequency
  const computeSameLegStrides = (stances) => {
    const metrics = [];
    for (let i = 1; i < stances.length; i++) {
      const prev = stances[i - 1];
      const curr = stances[i];
      const dt = curr.t - prev.t;
      if (dt <= 0 || dt > 3) continue; // ignore gaps > 3s
      const dx = (curr.x - prev.x) / pixelsPerMeter;
      const dy = (curr.y - prev.y) / pixelsPerMeter;
      const strideLength = Math.hypot(dx, dy);
      const strideFreq = 1 / dt; // strides per second
      metrics.push({
        t: curr.t,
        strideLength: parseFloat(strideLength.toFixed(3)),
        strideFreq: parseFloat(strideFreq.toFixed(3)),
      });
    }
    return metrics;
  };

  const leftMetrics = computeSameLegStrides(leftStances);
  const rightMetrics = computeSameLegStrides(rightStances);
  const allMetrics = [...leftMetrics, ...rightMetrics].sort((a, b) => a.t - b.t);

  // Build 1-second windowed averages
  if (allMetrics.length === 0) {
    return {
      stanceEvents,
      leftPhases,
      rightPhases,
      strideMetrics: allMetrics,
      windowedMetrics: [],
    };
  }

  const tMin = allMetrics[0].t;
  const tMax = allMetrics[allMetrics.length - 1].t;
  const windowedMetrics = [];

  for (let tBucket = Math.floor(tMin); tBucket <= Math.ceil(tMax); tBucket++) {
    const inWindow = allMetrics.filter(m => m.t >= tBucket && m.t < tBucket + 1);
    if (inWindow.length === 0) continue;
    const avgStrideLength = inWindow.reduce((s, m) => s + m.strideLength, 0) / inWindow.length;
    const avgStrideFreq = inWindow.reduce((s, m) => s + m.strideFreq, 0) / inWindow.length;
    windowedMetrics.push({
      t: tBucket,
      avgStrideLength: parseFloat(avgStrideLength.toFixed(3)),
      avgStrideFreq: parseFloat(avgStrideFreq.toFixed(3)),
    });
  }

  return {
    stanceEvents,
    leftPhases,
    rightPhases,
    strideMetrics: allMetrics,
    windowedMetrics,
  };
}