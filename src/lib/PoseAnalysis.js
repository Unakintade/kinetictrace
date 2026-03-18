/**
 * PoseAnalysis — stride & gait analysis from pose keypoint frames.
 * Converts pose history to flat StrideData, runs ground detection, contact events,
 * stride events, joint angles, velocity/acceleration, and asymmetry.
 */

let sharpenCanvas = null;
let sharpenCtx = null;

/**
 * Apply a 3×3 sharpen convolution kernel to the current video frame.
 * @param {HTMLVideoElement} video
 * @param {number} [strength=1.0]
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
export function sharpenFrame(video, strength = 1.0) {
  const w = video.videoWidth;
  const h = video.videoHeight;

  if (!sharpenCanvas || sharpenCanvas.width !== w || sharpenCanvas.height !== h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      sharpenCanvas = new OffscreenCanvas(w, h);
    } else {
      sharpenCanvas = document.createElement('canvas');
      sharpenCanvas.width = w;
      sharpenCanvas.height = h;
    }
    sharpenCtx = sharpenCanvas.getContext('2d');
  }

  sharpenCanvas.width = w;
  sharpenCanvas.height = h;
  sharpenCtx.drawImage(video, 0, 0, w, h);

  const imageData = sharpenCtx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  const s = strength * 0.5;
  const center = 1 + 4 * s;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const val =
          center * src[idx + c] -
          s * src[((y - 1) * w + x) * 4 + c] -
          s * src[((y + 1) * w + x) * 4 + c] -
          s * src[(y * w + (x - 1)) * 4 + c] -
          s * src[(y * w + (x + 1)) * 4 + c];
        out[idx + c] = val;
      }
      out[idx + 3] = 255;
    }
  }

  sharpenCtx.putImageData(new ImageData(out, w, h), 0, 0);
  return sharpenCanvas;
}

function computeAngle(ax, ay, bx, by, cx, cy) {
  const abx = ax - bx;
  const aby = ay - by;
  const cbx = cx - bx;
  const cby = cy - by;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magCB = Math.sqrt(cbx * cbx + cby * cby);
  if (magAB === 0 || magCB === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

function smoothContactStates(states, maxSegmentFrames) {
  const smoothed = [...states];
  for (let start = 0; start < smoothed.length; ) {
    let end = start;
    while (end + 1 < smoothed.length && smoothed[end + 1] === smoothed[start]) end += 1;
    const segmentLength = end - start + 1;
    const prevState = start > 0 ? smoothed[start - 1] : null;
    const nextState = end < smoothed.length - 1 ? smoothed[end + 1] : null;
    if (
      segmentLength <= maxSegmentFrames &&
      prevState !== null &&
      nextState !== null &&
      prevState === nextState
    ) {
      for (let j = start; j <= end; j++) smoothed[j] = prevState;
    }
    start = end + 1;
  }
  return smoothed;
}

/**
 * Analyze strides from flat StrideData frames (time, ankle/hip/knee positions).
 * @param {Array<{
 *   time: number,
 *   leftAnkleY: number,
 *   rightAnkleY: number,
 *   leftAnkleX: number,
 *   rightAnkleX: number,
 *   leftKneeX: number,
 *   leftKneeY: number,
 *   rightKneeX: number,
 *   rightKneeY: number,
 *   leftHipX: number,
 *   leftHipY: number,
 *   rightHipX: number,
 *   rightHipY: number
 * }>} frames
 * @param {number} pixelsPerMeter
 * @param {number} fps
 * @returns {{
 *   frames: Array,
 *   avgStrideLength: number,
 *   avgStrideFrequency: number,
 *   maxStrideLength: number,
 *   maxStrideFrequency: number,
 *   stancePhasePercent: number,
 *   flightPhasePercent: number,
 *   contactEvents: Array<{ foot: string, startTime: number, endTime: number, duration: number }>,
 *   strideEvents: Array<{ foot: string, strideLength: number, strideFrequency: number, contactTime: number, time: number }>,
 *   asymmetry: Object,
 *   avgGroundContactTime: number,
 *   maxVelocity: number,
 *   avgVelocity: number
 * }}
 */
export function analyzeStrides(frames, pixelsPerMeter, fps) {
  const emptyAsymmetry = {
    strideLengthAsymmetry: 0,
    strideFrequencyAsymmetry: 0,
    contactTimeAsymmetry: 0,
    leftAvgStrideLength: 0,
    rightAvgStrideLength: 0,
    leftAvgContactTime: 0,
    rightAvgContactTime: 0,
    leftAvgStrideFrequency: 0,
    rightAvgStrideFrequency: 0,
  };

  if (frames.length === 0) {
    return {
      frames: [],
      avgStrideLength: 0,
      avgStrideFrequency: 0,
      maxStrideLength: 0,
      maxStrideFrequency: 0,
      stancePhasePercent: 0,
      flightPhasePercent: 0,
      contactEvents: [],
      strideEvents: [],
      asymmetry: emptyAsymmetry,
      avgGroundContactTime: 0,
      maxVelocity: 0,
      avgVelocity: 0,
    };
  }

  // Joint angles per frame
  for (const f of frames) {
    f.leftKneeAngle = computeAngle(
      f.leftHipX, f.leftHipY,
      f.leftKneeX, f.leftKneeY,
      f.leftAnkleX, f.leftAnkleY
    );
    f.rightKneeAngle = computeAngle(
      f.rightHipX, f.rightHipY,
      f.rightKneeX, f.rightKneeY,
      f.rightAnkleX, f.rightAnkleY
    );
    f.leftHipAngle = computeAngle(
      f.leftHipX, f.leftHipY - 100,
      f.leftHipX, f.leftHipY,
      f.leftKneeX, f.leftKneeY
    );
    f.rightHipAngle = computeAngle(
      f.rightHipX, f.rightHipY - 100,
      f.rightHipX, f.rightHipY,
      f.rightKneeX, f.rightKneeY
    );
  }

  // Velocity & acceleration (midpoint of hips)
  for (let i = 0; i < frames.length; i++) {
    if (i === 0) {
      frames[i].velocity = 0;
      frames[i].acceleration = 0;
      continue;
    }
    const dt = frames[i].time - frames[i - 1].time;
    if (dt <= 0) {
      frames[i].velocity = frames[i - 1].velocity ?? 0;
      frames[i].acceleration = 0;
      continue;
    }
    const hipX = (frames[i].leftHipX + frames[i].rightHipX) / 2;
    const prevHipX = (frames[i - 1].leftHipX + frames[i - 1].rightHipX) / 2;
    const dxMeters = Math.abs(hipX - prevHipX) / pixelsPerMeter;
    const vel = dxMeters / dt;
    frames[i].velocity = vel;
    const prevVel = frames[i - 1].velocity ?? 0;
    frames[i].acceleration = (vel - prevVel) / dt;
  }

  const rawVelocities = frames.map((f) => f.velocity ?? 0);
  const windowSize = Math.min(5, frames.length);
  for (let i = 0; i < frames.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(frames.length, i + Math.ceil(windowSize / 2));
    let sum = 0;
    for (let j = start; j < end; j++) sum += rawVelocities[j];
    frames[i].velocity = sum / (end - start);
  }
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].time - frames[i - 1].time;
    if (dt <= 0) {
      frames[i].acceleration = 0;
      continue;
    }
    frames[i].acceleration =
      ((frames[i].velocity ?? 0) - (frames[i - 1].velocity ?? 0)) / dt;
  }

  // Ground detection from per-foot ankle Y (90th percentile as ground reference)
  const leftAnkleYs = frames.map((f) => f.leftAnkleY).sort((a, b) => a - b);
  const rightAnkleYs = frames.map((f) => f.rightAnkleY).sort((a, b) => a - b);
  const percentile = (arr, p) =>
    arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const leftGroundRef = percentile(leftAnkleYs, 0.9);
  const rightGroundRef = percentile(rightAnkleYs, 0.9);
  const leftMin = leftAnkleYs[0];
  const rightMin = rightAnkleYs[0];
  const leftRange = Math.max(leftGroundRef - leftMin, 1);
  const rightRange = Math.max(rightGroundRef - rightMin, 1);
  const leftThreshold = leftGroundRef - leftRange * 0.2;
  const rightThreshold = rightGroundRef - rightRange * 0.2;

  const frameDiffs = frames
    .slice(1)
    .map((frame, index) =>
      Math.max(frame.time - frames[index].time, 1 / fps / 2)
    )
    .sort((a, b) => a - b);
  const typicalFrameDelta =
    frameDiffs.length ? frameDiffs[Math.floor(frameDiffs.length / 2)] : 1 / fps;
  const smoothingFrames = Math.max(
    1,
    Math.round(0.06 / typicalFrameDelta)
  );

  const leftGroundStates = smoothContactStates(
    frames.map((f) => f.leftAnkleY >= leftThreshold),
    smoothingFrames
  );
  const rightGroundStates = smoothContactStates(
    frames.map((f) => f.rightAnkleY >= rightThreshold),
    smoothingFrames
  );

  const strideLengths = [];
  const strideFrequencies = [];
  const strideEvents = [];
  const contactEvents = [];
  let stanceCount = 0;
  let flightCount = 0;

  let lastLeftContact = null;
  let lastRightContact = null;
  let prevLeftOnGround = false;
  let prevRightOnGround = false;
  let leftContactStart = null;
  let rightContactStart = null;

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const leftOnGround = leftGroundStates[index];
    const rightOnGround = rightGroundStates[index];
    const eitherOnGround = leftOnGround || rightOnGround;

    frame.phase = eitherOnGround ? 'stance' : 'flight';
    frame.leftOnGround = leftOnGround;
    frame.rightOnGround = rightOnGround;

    if (eitherOnGround) stanceCount += 1;
    else flightCount += 1;

    if (leftOnGround && !prevLeftOnGround) {
      leftContactStart = frame.time;
    } else if (!leftOnGround && prevLeftOnGround && leftContactStart !== null) {
      contactEvents.push({
        foot: 'left',
        startTime: leftContactStart,
        endTime: frame.time,
        duration: frame.time - leftContactStart,
      });
      leftContactStart = null;
    }

    if (rightOnGround && !prevRightOnGround) {
      rightContactStart = frame.time;
    } else if (!rightOnGround && prevRightOnGround && rightContactStart !== null) {
      contactEvents.push({
        foot: 'right',
        startTime: rightContactStart,
        endTime: frame.time,
        duration: frame.time - rightContactStart,
      });
      rightContactStart = null;
    }

    if (leftOnGround && !prevLeftOnGround) {
      if (lastLeftContact !== null) {
        const pixelDist = Math.abs(frame.leftAnkleX - lastLeftContact.x);
        const meters = pixelDist / pixelsPerMeter;
        const timeDiff = frame.time - lastLeftContact.time;
        if (meters > 0.05 && timeDiff > 0.1 && timeDiff < 3) {
          strideLengths.push(meters);
          strideFrequencies.push(1 / timeDiff);
          frame.strideLength = meters;
          frame.strideFrequency = 1 / timeDiff;
          strideEvents.push({
            foot: 'left',
            strideLength: meters,
            strideFrequency: 1 / timeDiff,
            contactTime: 0,
            time: frame.time,
          });
        }
      }
      lastLeftContact = { x: frame.leftAnkleX, time: frame.time };
    }

    if (rightOnGround && !prevRightOnGround) {
      if (lastRightContact !== null) {
        const pixelDist = Math.abs(frame.rightAnkleX - lastRightContact.x);
        const meters = pixelDist / pixelsPerMeter;
        const timeDiff = frame.time - lastRightContact.time;
        if (meters > 0.05 && timeDiff > 0.1 && timeDiff < 3) {
          strideLengths.push(meters);
          strideFrequencies.push(1 / timeDiff);
          if (frame.strideLength === undefined) {
            frame.strideLength = meters;
            frame.strideFrequency = 1 / timeDiff;
          }
          strideEvents.push({
            foot: 'right',
            strideLength: meters,
            strideFrequency: 1 / timeDiff,
            contactTime: 0,
            time: frame.time,
          });
        }
      }
      lastRightContact = { x: frame.rightAnkleX, time: frame.time };
    }

    prevLeftOnGround = leftOnGround;
    prevRightOnGround = rightOnGround;
  }

  if (leftContactStart !== null) {
    contactEvents.push({
      foot: 'left',
      startTime: leftContactStart,
      endTime: frames[frames.length - 1].time,
      duration: frames[frames.length - 1].time - leftContactStart,
    });
  }
  if (rightContactStart !== null) {
    contactEvents.push({
      foot: 'right',
      startTime: rightContactStart,
      endTime: frames[frames.length - 1].time,
      duration: frames[frames.length - 1].time - rightContactStart,
    });
  }

  for (const se of strideEvents) {
    const matchingContact = contactEvents.find(
      (ce) => ce.foot === se.foot && Math.abs(ce.startTime - se.time) < 0.15
    );
    if (matchingContact) se.contactTime = matchingContact.duration;
  }

  const leftStrides = strideEvents.filter((s) => s.foot === 'left');
  const rightStrides = strideEvents.filter((s) => s.foot === 'right');
  const leftContacts = contactEvents.filter((c) => c.foot === 'left');
  const rightContacts = contactEvents.filter((c) => c.foot === 'right');

  const avg = (arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const asymPercent = (a, b) => {
    const mean = (a + b) / 2;
    return mean === 0 ? 0 : (Math.abs(a - b) / mean) * 100;
  };

  const leftAvgSL = avg(leftStrides.map((s) => s.strideLength));
  const rightAvgSL = avg(rightStrides.map((s) => s.strideLength));
  const leftAvgSF = avg(leftStrides.map((s) => s.strideFrequency));
  const rightAvgSF = avg(rightStrides.map((s) => s.strideFrequency));
  const leftAvgCT = avg(leftContacts.map((c) => c.duration));
  const rightAvgCT = avg(rightContacts.map((c) => c.duration));

  const asymmetry = {
    strideLengthAsymmetry: asymPercent(leftAvgSL, rightAvgSL),
    strideFrequencyAsymmetry: asymPercent(leftAvgSF, rightAvgSF),
    contactTimeAsymmetry: asymPercent(leftAvgCT, rightAvgCT),
    leftAvgStrideLength: leftAvgSL,
    rightAvgStrideLength: rightAvgSL,
    leftAvgContactTime: leftAvgCT,
    rightAvgContactTime: rightAvgCT,
    leftAvgStrideFrequency: leftAvgSF,
    rightAvgStrideFrequency: rightAvgSF,
  };

  const total = stanceCount + flightCount;
  const allContactDurations = contactEvents.map((c) => c.duration);
  const velocities = frames.map((f) => f.velocity ?? 0);

  return {
    frames,
    avgStrideLength: avg(strideLengths),
    avgStrideFrequency: avg(strideFrequencies),
    maxStrideLength: strideLengths.length ? Math.max(...strideLengths) : 0,
    maxStrideFrequency: strideFrequencies.length
      ? Math.max(...strideFrequencies)
      : 0,
    stancePhasePercent: total ? (stanceCount / total) * 100 : 0,
    flightPhasePercent: total ? (flightCount / total) * 100 : 0,
    contactEvents,
    strideEvents,
    asymmetry,
    avgGroundContactTime: avg(allContactDurations),
    maxVelocity: velocities.length ? Math.max(...velocities) : 0,
    avgVelocity: avg(velocities),
  };
}
