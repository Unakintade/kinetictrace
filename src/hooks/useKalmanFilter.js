/**
 * Constant Acceleration (CA) Kalman Filter for 2D landmark smoothing.
 *
 * State vector per landmark: [x, vx, ax, y, vy, ay]
 * Measurement: [x, y]
 *
 * R (measurement noise) is dynamically scaled by (1 - visibility)^2
 * so low-confidence detections contribute less.
 */

const DT = 1 / 60; // default timestep — overridden per frame

function makeF(dt) {
  // 3x3 constant-acceleration transition for one axis
  return [
    [1, dt, 0.5 * dt * dt],
    [0,  1,           dt],
    [0,  0,            1],
  ];
}

function makeQ(dt, sigmaA = 15) {
  // Process noise (Singer model) for one axis
  const s = sigmaA * sigmaA;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt3 * dt;
  return [
    [s * dt4 / 4, s * dt3 / 2, s * dt2 / 2],
    [s * dt3 / 2, s * dt2,     s * dt      ],
    [s * dt2 / 2, s * dt,      s           ],
  ];
}

// 3x3 matrix multiply
function mm3(A, B) {
  const R = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        R[i][j] += A[i][k] * B[k][j];
  return R;
}

// 3x3 transpose
function tr3(A) {
  return [[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]];
}

// 3x3 add
function add3(A, B) {
  return A.map((r, i) => r.map((v, j) => v + B[i][j]));
}

// 3x3 inverse (closed-form)
function inv3(m) {
  const [[a,b,c],[d,e,f],[g,h,k]] = m;
  const det = a*(e*k-f*h) - b*(d*k-f*g) + c*(d*h-e*g);
  if (Math.abs(det) < 1e-12) return m; // fallback
  const inv = 1 / det;
  return [
    [ (e*k-f*h)*inv, -(b*k-c*h)*inv,  (b*f-c*e)*inv],
    [-(d*k-f*g)*inv,  (a*k-c*g)*inv, -(a*f-c*d)*inv],
    [ (d*h-e*g)*inv, -(a*h-b*g)*inv,  (a*e-b*d)*inv],
  ];
}

// H = [1, 0, 0] (we observe position only)
// innovation = z - H*x = z - x[0]
// S = H*P*H^T + R = P[0][0] + R
// K = P*H^T / S  → K is column vector = P[:,0] / S
// x_new = x + K * innovation
// P_new = (I - K*H) * P

function kalmanUpdate1D(x, P, z, R_scalar) {
  const S = P[0][0] + R_scalar;
  const K = [P[0][0]/S, P[1][0]/S, P[2][0]/S];
  const inn = z - x[0];
  const xNew = [x[0]+K[0]*inn, x[1]+K[1]*inn, x[2]+K[2]*inn];
  // P_new = (I - K*H)*P  — H=[1,0,0], so KH row 0 = K, rows 1,2 = 0
  const PNew = [
    [P[0][0]-K[0]*P[0][0], P[0][1]-K[0]*P[0][1], P[0][2]-K[0]*P[0][2]],
    [P[1][0]-K[1]*P[0][0], P[1][1]-K[1]*P[0][1], P[1][2]-K[1]*P[0][2]],
    [P[2][0]-K[2]*P[0][0], P[2][1]-K[2]*P[0][1], P[2][2]-K[2]*P[0][2]],
  ];
  return { x: xNew, P: PNew };
}

function kalmanPredict1D(x, P, dt) {
  const F = makeF(dt);
  const Q = makeQ(dt);
  const xp = [
    F[0][0]*x[0]+F[0][1]*x[1]+F[0][2]*x[2],
    F[1][0]*x[0]+F[1][1]*x[1]+F[1][2]*x[2],
    F[2][0]*x[0]+F[2][1]*x[1]+F[2][2]*x[2],
  ];
  const Pp = add3(mm3(mm3(F, P), tr3(F)), Q);
  return { x: xp, P: Pp };
}

/** Create a fresh per-landmark filter state from an initial measurement */
export function createLandmarkFilter(x0, y0) {
  const I3 = [[1,0,0],[0,1,0],[0,0,1]];
  const P0 = [[500,0,0],[0,100,0],[0,0,50]];
  return {
    x: { x: [x0, 0, 0], P: P0 },
    y: { x: [y0, 0, 0], P: P0 },
  };
}

/**
 * Update filter for a single landmark.
 * @param {object} state   - { x: {x,P}, y: {x,P} }
 * @param {number} zx      - measured x
 * @param {number} zy      - measured y
 * @param {number} vis     - visibility/confidence [0,1]
 * @param {number} dt      - time since last frame
 * @returns {{ state, px, py, vx, vy }} updated state + filtered position & velocity
 */
export function updateLandmarkFilter(state, zx, zy, vis, dt = DT) {
  // Dynamic R: low confidence → high measurement noise
  const R = Math.max(0.5, (1 - vis) * (1 - vis) * 2000 + 1);

  const px = kalmanPredict1D(state.x.x, state.x.P, dt);
  const py = kalmanPredict1D(state.y.x, state.y.P, dt);

  const ux = kalmanUpdate1D(px.x, px.P, zx, R);
  const uy = kalmanUpdate1D(py.x, py.P, zy, R);

  return {
    state: { x: ux, y: uy },
    px: ux.x[0],
    py: uy.x[0],
    vx: ux.x[1],
    vy: uy.x[1],
  };
}

/**
 * Batch-filter an array of raw frames (each frame = array of 33 landmarks).
 * @param {Array} rawFrames  - [{t, landmarks: [{x,y,z,visibility,name},...]}]
 * @returns {Array} filtered frames with same shape + vx/vy per landmark
 */
export function batchKalmanFilter(rawFrames) {
  if (!rawFrames.length) return [];

  // Initialise one filter per landmark (33 for BlazePose/MoveNet)
  const nLm = rawFrames[0].landmarks.length;
  const filters = rawFrames[0].landmarks.map(lm =>
    createLandmarkFilter(lm.x, lm.y)
  );

  const out = [];
  for (let fi = 0; fi < rawFrames.length; fi++) {
    const frame = rawFrames[fi];
    const dt = fi === 0
      ? DT
      : Math.max(0.001, frame.t - rawFrames[fi - 1].t);

    const filteredLandmarks = frame.landmarks.map((lm, li) => {
      const vis = lm.visibility ?? lm.score ?? 0.5;
      const res = updateLandmarkFilter(filters[li], lm.x, lm.y, vis, dt);
      filters[li] = res.state;
      return { ...lm, x: res.px, y: res.py, vx: res.vx, vy: res.vy };
    });

    out.push({ ...frame, landmarks: filteredLandmarks });
  }
  return out;
}