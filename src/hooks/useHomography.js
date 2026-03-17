/**
 * Estimates camera angle from horizontal lines in a video frame using
 * a simple Hough-inspired line detection on the canvas image data.
 *
 * Returns:
 *   - lines: detected dominant line segments [{x1,y1,x2,y2}]
 *   - vanishingPoint: {x, y} | null  (intersection of dominant line families)
 *   - tiltAngle: degrees (rotation of camera around Z)
 *   - pitchFactor: estimated foreshortening factor in Y (1 = no pitch)
 *   - warpPoint(x, y): function that maps a warped canvas point to a flat ground-plane point
 */

// ---- Canny-lite: Sobel edge + simple thresholding ----
function sobelEdges(data, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const edges = new Float32Array(w * h);
  const angles = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
        - 2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)]
        - gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
        + gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      edges[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      angles[y * w + x] = Math.atan2(gy, gx);
    }
  }
  return { edges, angles };
}

// Probabilistic Hough line transform (simplified)
function houghLines(edges, w, h, threshold = 80) {
  const diag = Math.sqrt(w * w + h * h);
  const rhoMax = Math.ceil(diag);
  const thetaSteps = 180;
  const acc = new Int32Array(rhoMax * 2 * thetaSteps);
  const edgePoints = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x] > threshold) {
        edgePoints.push([x, y]);
      }
    }
  }

  const thetas = Array.from({ length: thetaSteps }, (_, i) => (i * Math.PI) / thetaSteps);

  for (const [x, y] of edgePoints) {
    for (let ti = 0; ti < thetaSteps; ti++) {
      const rho = x * Math.cos(thetas[ti]) + y * Math.sin(thetas[ti]);
      const ri = Math.round(rho + rhoMax);
      if (ri >= 0 && ri < rhoMax * 2) {
        acc[ri * thetaSteps + ti]++;
      }
    }
  }

  // Find peaks
  const lines = [];
  const minVotes = Math.max(30, edgePoints.length * 0.01);
  for (let ri = 0; ri < rhoMax * 2; ri++) {
    for (let ti = 0; ti < thetaSteps; ti++) {
      if (acc[ri * thetaSteps + ti] >= minVotes) {
        const rho = ri - rhoMax;
        const theta = thetas[ti];
        lines.push({ rho, theta, votes: acc[ri * thetaSteps + ti] });
      }
    }
  }

  return lines.sort((a, b) => b.votes - a.votes).slice(0, 20);
}

function lineToSegment(rho, theta, w, h) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let pts = [];
  if (Math.abs(sin) > 0.001) {
    pts.push([0, rho / sin]);
    pts.push([w, (rho - w * cos) / sin]);
  }
  if (Math.abs(cos) > 0.001) {
    pts.push([rho / cos, 0]);
    pts.push([(rho - h * sin) / cos, h]);
  }
  pts = pts.filter(([x, y]) => x >= 0 && x <= w && y >= 0 && y <= h);
  if (pts.length < 2) return null;
  return { x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1] };
}

function intersect(l1, l2) {
  const d = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2);
  if (Math.abs(d) < 1e-6) return null;
  const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / d;
  return {
    x: l1.x1 + t * (l1.x2 - l1.x1),
    y: l1.y1 + t * (l1.y2 - l1.y1),
  };
}

/**
 * Analyse a single video frame (ImageData) and return camera geometry.
 */
export function analyseFrame(imageData, w, h) {
  const { edges } = sobelEdges(imageData.data, w, h);
  const rawLines = houghLines(edges, w, h);

  // Separate near-horizontal lines (theta close to PI/2) and near-converging lines
  const horizontalLines = rawLines.filter(l => {
    const deg = (l.theta * 180) / Math.PI;
    return deg > 70 && deg < 110;
  });

  const segments = rawLines
    .map(l => lineToSegment(l.rho, l.theta, w, h))
    .filter(Boolean);

  // Dominant tilt: average angle of horizontal lines
  let tiltAngle = 0;
  if (horizontalLines.length > 0) {
    const avgTheta = horizontalLines.reduce((s, l) => s + l.theta, 0) / horizontalLines.length;
    tiltAngle = ((avgTheta * 180) / Math.PI) - 90; // deviation from true horizontal
  }

  // Find vanishing point from non-horizontal lines (perspective lines)
  const perspLines = rawLines
    .filter(l => {
      const deg = (l.theta * 180) / Math.PI;
      return deg < 60 || deg > 120;
    })
    .map(l => lineToSegment(l.rho, l.theta, w, h))
    .filter(Boolean)
    .slice(0, 6);

  let vanishingPoint = null;
  if (perspLines.length >= 2) {
    const pts = [];
    for (let i = 0; i < perspLines.length; i++) {
      for (let j = i + 1; j < perspLines.length; j++) {
        const pt = intersect(perspLines[i], perspLines[j]);
        if (pt) pts.push(pt);
      }
    }
    if (pts.length > 0) {
      const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      // Only use if vanishing point is outside the frame (real perspective)
      if (my < h * 0.6) vanishingPoint = { x: mx, y: my };
    }
  }

  // Estimate pitch foreshortening: if VP is at y=vpY, objects at bottom (y=h) are
  // foreshortened vs objects near horizon (y=vpY). Factor = (h - vpY) / h
  let pitchFactor = 1;
  if (vanishingPoint) {
    const vpY = Math.min(Math.max(vanishingPoint.y, 0), h);
    pitchFactor = Math.max(0.1, (h - vpY) / h);
  }

  return { segments, vanishingPoint, tiltAngle, pitchFactor };
}

/**
 * Given a point (px, py) in image coordinates and the camera geometry,
 * returns the estimated "ground-plane" position compensating for tilt + pitch.
 */
export function warpPoint(px, py, w, h, tiltAngle, pitchFactor, vanishingPoint) {
  // 1. Un-rotate tilt
  const cx = w / 2;
  const cy = h / 2;
  const rad = (-tiltAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = cos * (px - cx) - sin * (py - cy) + cx;
  const ry = sin * (px - cx) + cos * (py - cy) + cy;

  // 2. Compensate pitch foreshortening in Y
  if (!vanishingPoint || pitchFactor >= 0.99) return { x: rx, y: ry };

  const vpY = vanishingPoint.y;
  // Map: vpY -> 0 (horizon), h -> h (bottom). Stretch Y proportionally.
  const normalizedY = (ry - vpY) / (h - vpY); // 0 at horizon, 1 at bottom
  const correctedY = normalizedY > 0
    ? vpY + (normalizedY / pitchFactor) * (h - vpY)
    : ry;

  return { x: rx, y: correctedY };
}