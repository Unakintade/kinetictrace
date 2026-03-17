/**
 * Stride analyser — detects footstrike events per leg using ankle vertical position maxima
 * (high Y in image coords = ankle near ground = stance phase).
 * Between consecutive same-leg peaks = one full stride.
 */

const MIN_STRIDE_DT = 0.2;   // minimum seconds between same-leg footstrikes
const MIN_FRAMES = 5;         // minimum confident ankle frames per leg

// --- helpers ---
function computeAngle(ax, ay, bx, by, cx, cy) {
  const abx = ax - bx, aby = ay - by;
  const cbx = cx - bx, cby = cy - by;
  const dot = abx * cbx + aby * cby;
  const mag = Math.sqrt((abx*abx+aby*aby)*(cbx*cbx+cby*cby));
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function smoothArr(arr, w = 5) {
  return arr.map((_, i) => {
    const sl = arr.slice(Math.max(0, i - Math.floor(w/2)), Math.min(arr.length, i + Math.ceil(w/2)));
    return sl.reduce((a, b) => a + b, 0) / sl.length;
  });
}

/**
 * Find local maxima in a smoothed Y array with prominence filtering.
 * Window ±2 keeps sensitivity while avoiding noise.
 */
function findPeaks(values, times, minProminence = 0.01) {
  const peaks = [];
  const n = values.length;
  for (let i = 1; i < n - 1; i++) {
    const v = values[i];
    if (v > values[i - 1] && v > values[i + 1]) {
      const leftMin = values[i - 1];
      const rightMin = values[i + 1];
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

  if (leftFrames.length < MIN_FRAMES && rightFrames.length < MIN_FRAMES) {
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
    const threshold = 0.75; // top 25% Y values = foot near ground
    const maxY = Math.max(...yNorm);
    const minY = Math.min(...yNorm);
    const range = Math.max(maxY - minY, 0.01);
    const norm = yNorm.map(v => (v - minY) / range); // re-normalise within leg

    const contactDurations = [];
    let inContact = false;
    let contactStart = null;

    for (let i = 0; i < norm.length; i++) {
      if (!inContact && norm[i] >= threshold) {
        inContact = true;
        contactStart = times[i];
      } else if (inContact && norm[i] < threshold) {
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
  }

  // ── Asymmetry ───────────────────────────────────────────────────────────
  const leftStrides  = computeSameLegStrides(leftPeaks,  leftX);
  const rightStrides = computeSameLegStrides(rightPeaks, rightX);
  const avgArr = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const asymPct = (a, b) => { const m = (a + b) / 2; return m === 0 ? 0 : Math.abs(a - b) / m * 100; };

  const leftAvgSL  = avgArr(leftStrides.map(m => m.strideLength));
  const rightAvgSL = avgArr(rightStrides.map(m => m.strideLength));
  const leftAvgSF  = avgArr(leftStrides.map(m => m.strideFreq));
  const rightAvgSF = avgArr(rightStrides.map(m => m.strideFreq));
  const leftAvgCT  = avgArr(leftContactDurations.map(c => c.duration));
  const rightAvgCT = avgArr(rightContactDurations.map(c => c.duration));

  const asymmetry = {
    strideLength:   { pct: asymPct(leftAvgSL, rightAvgSL),  left: leftAvgSL,  right: rightAvgSL  },
    strideFreq:     { pct: asymPct(leftAvgSF, rightAvgSF),  left: leftAvgSF,  right: rightAvgSF  },
    contactTime:    { pct: asymPct(leftAvgCT, rightAvgCT),  left: leftAvgCT,  right: rightAvgCT  },
  };

  const peakSpeed = velocityData.length ? Math.max(...velocityData.map(d => d.speed)) : 0;
  const avgSpeed  = velocityData.length ? avgArr(velocityData.map(d => d.speed)) : 0;

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
  };
}