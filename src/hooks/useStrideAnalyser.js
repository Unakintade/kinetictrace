/**
 * Stride analyser — detects footstrike events per leg using ankle vertical position maxima
 * (high Y in image coords = ankle near ground = stance phase).
 * Between consecutive same-leg peaks = one full stride.
 */

const MIN_STRIDE_DT = 0.25;  // minimum seconds between same-leg footstrikes
const MIN_FRAMES = 10;        // minimum confident ankle frames per leg

/**
 * Find local maxima in a smoothed Y array with prominence filtering.
 * Window ±2 keeps sensitivity while avoiding noise.
 */
function findPeaks(values, times, minProminence = 0.03) {
  const peaks = [];
  const n = values.length;
  for (let i = 2; i < n - 2; i++) {
    const v = values[i];
    if (
      v > values[i - 1] && v > values[i + 1] &&
      v > values[i - 2] && v > values[i + 2]
    ) {
      const leftMin = Math.min(values[i - 1], values[i - 2]);
      const rightMin = Math.min(values[i + 1], values[i + 2]);
      const prominence = v - Math.max(leftMin, rightMin);
      if (prominence >= minProminence) {
        if (peaks.length === 0 || times[i] - peaks[peaks.length - 1].t >= MIN_STRIDE_DT) {
          peaks.push({ t: times[i], idx: i, y: v });
        } else if (v > peaks[peaks.length - 1].y) {
          peaks[peaks.length - 1] = { t: times[i], idx: i, y: v };
        }
      }
    }
  }
  return peaks;
}

/** 5-point moving average smoothing */
function smooth(arr) {
  return arr.map((v, i) => {
    const slice = arr.slice(Math.max(0, i - 2), Math.min(arr.length, i + 3));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export function analyseStrides(poseHistory, pixelsPerMeter, videoDims) {
  if (!poseHistory || poseHistory.length < MIN_FRAMES || !pixelsPerMeter) {
    return { stanceEvents: [], strideMetrics: [], windowedMetrics: [] };
  }

  const frameH = videoDims?.h || 360;

  // Deduplicate frames by time (handles video looping re-adding same timestamps)
  const seen = new Set();
  const uniqueHistory = poseHistory.filter(f => {
    const key = f.t.toFixed(3);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Build per-leg ankle series — only frames with confident ankle detection
  const leftFrames  = uniqueHistory.filter(f => f.pose?.leftAnkle?.score  > 0.2);
  const rightFrames = uniqueHistory.filter(f => f.pose?.rightAnkle?.score > 0.2);

  if (leftFrames.length < MIN_FRAMES || rightFrames.length < MIN_FRAMES) {
    return { stanceEvents: [], strideMetrics: [], windowedMetrics: [] };
  }

  const leftTimes  = leftFrames.map(f => f.t);
  const rightTimes = rightFrames.map(f => f.t);

  // Normalised Y: 0=top, 1=bottom. High value = foot near ground.
  const leftYNorm  = leftFrames.map(f => f.pose.leftAnkle.y  / frameH);
  const rightYNorm = rightFrames.map(f => f.pose.rightAnkle.y / frameH);

  const leftX  = leftFrames.map(f => f.pose.leftAnkle.x);
  const rightX = rightFrames.map(f => f.pose.rightAnkle.x);
  const leftY  = leftFrames.map(f => f.pose.leftAnkle.y);
  const rightY = rightFrames.map(f => f.pose.rightAnkle.y);

  const leftPeaks  = findPeaks(smooth(leftYNorm),  leftTimes);
  const rightPeaks = findPeaks(smooth(rightYNorm), rightTimes);

  // Build stance events
  const stanceEvents = [];
  leftPeaks.forEach(p  => stanceEvents.push({ t: p.t, leg: 'left',  x: leftX[p.idx],  y: leftY[p.idx]  }));
  rightPeaks.forEach(p => stanceEvents.push({ t: p.t, leg: 'right', x: rightX[p.idx], y: rightY[p.idx] }));
  stanceEvents.sort((a, b) => a.t - b.t);

  // Stride metrics from consecutive same-leg footstrikes
  const computeSameLegStrides = (peaks, xArr) => {
    const metrics = [];
    for (let i = 1; i < peaks.length; i++) {
      const prev = peaks[i - 1];
      const curr = peaks[i];
      const dt = curr.t - prev.t;
      if (dt < MIN_STRIDE_DT || dt > 5) continue;
      const strideLength = Math.abs((xArr[curr.idx] - xArr[prev.idx]) / pixelsPerMeter);
      const strideFreq   = 1 / dt;
      metrics.push({
        t: parseFloat(curr.t.toFixed(2)),
        strideLength: parseFloat(strideLength.toFixed(3)),
        strideFreq:   parseFloat(strideFreq.toFixed(3)),
      });
    }
    return metrics;
  };

  const strideMetrics = [
    ...computeSameLegStrides(leftPeaks,  leftX),
    ...computeSameLegStrides(rightPeaks, rightX),
  ].sort((a, b) => a.t - b.t);

  // 1-second windowed averages
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

  return { stanceEvents, strideMetrics, windowedMetrics };
}