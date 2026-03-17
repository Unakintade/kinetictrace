/**
 * Stride analyser — detects footstrike events per leg using ankle vertical position minima
 * (the ankle is lowest in image coords = closest to ground = stance).
 *
 * Strategy: find local minima in the ankle Y-position signal (high Y = low on screen = ground contact).
 * Between consecutive same-leg minima = one full stride.
 */

// Minimum time between footstrikes (seconds) — prevents double-counting
const MIN_STRIDE_DT = 0.3;
// Minimum number of pose frames required
const MIN_FRAMES = 15;

/**
 * Find local maxima in Y array (high Y = foot near ground in image coords).
 * Uses a wider window (±3) and stronger prominence to avoid false peaks.
 */
function findPeaks(values, times, minProminence = 0.04) {
  const peaks = [];
  const n = values.length;
  for (let i = 3; i < n - 3; i++) {
    const v = values[i];
    // Must be local max within ±3 neighbours
    if (
      v >= values[i - 1] && v >= values[i + 1] &&
      v >= values[i - 2] && v >= values[i + 2] &&
      v >= values[i - 3] && v >= values[i + 3]
    ) {
      // Prominence = how much this peak stands above surrounding valleys
      const leftMin = Math.min(values[i - 1], values[i - 2], values[i - 3]);
      const rightMin = Math.min(values[i + 1], values[i + 2], values[i + 3]);
      const prominence = v - Math.max(leftMin, rightMin);
      if (prominence >= minProminence) {
        // Enforce minimum time gap from last peak
        if (peaks.length === 0 || times[i] - peaks[peaks.length - 1].t >= MIN_STRIDE_DT) {
          peaks.push({ t: times[i], idx: i, y: v });
        } else if (v > peaks[peaks.length - 1].y) {
          // Replace last peak if this one is higher and within gap
          peaks[peaks.length - 1] = { t: times[i], idx: i, y: v };
        }
      }
    }
  }
  return peaks;
}

export function analyseStrides(poseHistory, pixelsPerMeter, videoDims) {
  if (!poseHistory || poseHistory.length < MIN_FRAMES || !pixelsPerMeter) {
    return { stanceEvents: [], strideMetrics: [], windowedMetrics: [] };
  }

  const frameH = videoDims?.h || 360;

  // Build per-leg ankle time series — require decent confidence to avoid junk keypoints
  const leftFrames = poseHistory.filter(f => f.pose?.leftAnkle?.score > 0.25);
  const rightFrames = poseHistory.filter(f => f.pose?.rightAnkle?.score > 0.25);

  if (leftFrames.length < MIN_FRAMES || rightFrames.length < MIN_FRAMES) {
    return { stanceEvents: [], strideMetrics: [], windowedMetrics: [] };
  }

  const leftTimes = leftFrames.map(f => f.t);
  const rightTimes = rightFrames.map(f => f.t);

  // Normalised Y (0=top, 1=bottom). High value = foot near ground.
  const leftYNorm = leftFrames.map(f => f.pose.leftAnkle.y / frameH);
  const rightYNorm = rightFrames.map(f => f.pose.rightAnkle.y / frameH);

  // Raw X in pixels (for distance calculation)
  const leftX = leftFrames.map(f => f.pose.leftAnkle.x);
  const rightX = rightFrames.map(f => f.pose.rightAnkle.x);
  const leftY = leftFrames.map(f => f.pose.leftAnkle.y);
  const rightY = rightFrames.map(f => f.pose.rightAnkle.y);

  // Smooth Y signal (5-point moving average) to reduce jitter
  const smooth = (arr) => arr.map((v, i) => {
    const slice = arr.slice(Math.max(0, i - 2), Math.min(arr.length, i + 3));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const leftYSmooth = smooth(leftYNorm);
  const rightYSmooth = smooth(rightYNorm);

  // Find footstrike peaks (local maxima of ankle Y = foot at lowest point)
  const leftPeaks = findPeaks(leftYSmooth, leftTimes, 0.02);
  const rightPeaks = findPeaks(rightYSmooth, rightTimes, 0.02);

  // Build stance events with pixel positions at each footstrike
  const stanceEvents = [];

  leftPeaks.forEach(peak => {
    stanceEvents.push({
      t: peak.t,
      leg: 'left',
      x: leftX[peak.idx],
      y: leftY[peak.idx],
    });
  });

  rightPeaks.forEach(peak => {
    stanceEvents.push({
      t: peak.t,
      leg: 'right',
      x: rightX[peak.idx],
      y: rightY[peak.idx],
    });
  });

  stanceEvents.sort((a, b) => a.t - b.t);

  // Compute stride metrics from consecutive same-leg footstrikes
  const computeSameLegStrides = (peaks, xArr, yArr, times) => {
    const metrics = [];
    for (let i = 1; i < peaks.length; i++) {
      const prev = peaks[i - 1];
      const curr = peaks[i];
      const dt = curr.t - prev.t;
      if (dt < MIN_STRIDE_DT || dt > 3) continue;

      const dx = (xArr[curr.idx] - xArr[prev.idx]) / pixelsPerMeter;
      const dy = (yArr[curr.idx] - yArr[prev.idx]) / pixelsPerMeter;
      const strideLength = Math.abs(dx); // horizontal distance is the meaningful stride length
      const strideFreq = 1 / dt;

      metrics.push({
        t: parseFloat(curr.t.toFixed(2)),
        strideLength: parseFloat(strideLength.toFixed(3)),
        strideFreq: parseFloat(strideFreq.toFixed(3)),
      });
    }
    return metrics;
  };

  const leftMetrics = computeSameLegStrides(leftPeaks, leftX, leftY, leftTimes);
  const rightMetrics = computeSameLegStrides(rightPeaks, rightX, rightY, rightTimes);
  const strideMetrics = [...leftMetrics, ...rightMetrics].sort((a, b) => a.t - b.t);

  // 1-second windowed averages
  const windowedMetrics = [];
  if (strideMetrics.length > 0) {
    const tMin = strideMetrics[0].t;
    const tMax = strideMetrics[strideMetrics.length - 1].t;
    for (let tBucket = Math.floor(tMin); tBucket <= Math.ceil(tMax); tBucket++) {
      const inWindow = strideMetrics.filter(m => m.t >= tBucket && m.t < tBucket + 1);
      if (inWindow.length === 0) continue;
      const avgStrideLength = inWindow.reduce((s, m) => s + m.strideLength, 0) / inWindow.length;
      const avgStrideFreq = inWindow.reduce((s, m) => s + m.strideFreq, 0) / inWindow.length;
      windowedMetrics.push({
        t: tBucket,
        avgStrideLength: parseFloat(avgStrideLength.toFixed(3)),
        avgStrideFreq: parseFloat(avgStrideFreq.toFixed(3)),
      });
    }
  }

  return { stanceEvents, strideMetrics, windowedMetrics };
}