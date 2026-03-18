/**
 * Gait phase definitions and utilities shared between the labeler and analyser.
 */

export const GAIT_PHASES = [
  { id: 'touch_down',   label: 'Touch Down',  color: '#22c55e', group: 'stance' },
  { id: 'mid_stance',   label: 'Mid Stance',  color: '#16a34a', group: 'stance' },
  { id: 'toe_off',      label: 'Toe Off',     color: '#84cc16', group: 'stance' },
  { id: 'early_flight', label: 'Early Flight',color: '#f97316', group: 'flight' },
  { id: 'mid_flight',   label: 'Mid Flight',  color: '#f59e0b', group: 'flight' },
  { id: 'late_flight',  label: 'Late Flight', color: '#fb923c', group: 'flight' },
];

export const PHASE_GROUPS = {
  stance: ['touch_down', 'mid_stance', 'toe_off'],
  flight: ['early_flight', 'mid_flight', 'late_flight'],
};

export function isStancePhase(phaseId) {
  return PHASE_GROUPS.stance.includes(phaseId);
}

export function isFlightPhase(phaseId) {
  return PHASE_GROUPS.flight.includes(phaseId);
}

export function getPhaseColor(phaseId) {
  return GAIT_PHASES.find(p => p.id === phaseId)?.color ?? '#6b7280';
}

export function getPhaseLabel(phaseId) {
  return GAIT_PHASES.find(p => p.id === phaseId)?.label ?? phaseId;
}

/**
 * Given labeled frames, derive ground-contact thresholds to calibrate the analyser.
 * Returns { leftContactThreshold, rightContactThreshold } as fractions of normalised ankle-Y range [0,1].
 */
export function deriveThresholdsFromLabels(labeledFrames, poseHistory) {
  if (!labeledFrames?.length || !poseHistory?.length) return null;

  // Match labeled timestamps to nearest poseHistory frames
  const matched = labeledFrames.map(lf => {
    const nearest = poseHistory.reduce((best, ph) =>
      Math.abs(ph.t - lf.t) < Math.abs(best.t - lf.t) ? ph : best
    );
    return { ...lf, pose: nearest.pose };
  }).filter(m => m.pose);

  if (matched.length < 3) return null;

  // Collect ankle-Y values for each phase group
  const leftStanceY  = matched.filter(m => isStancePhase(m.leftPhase)  && m.pose?.leftAnkle?.score  > 0.2).map(m => m.pose.leftAnkle.y);
  const leftFlightY  = matched.filter(m => isFlightPhase(m.leftPhase)  && m.pose?.leftAnkle?.score  > 0.2).map(m => m.pose.leftAnkle.y);
  const rightStanceY = matched.filter(m => isStancePhase(m.rightPhase) && m.pose?.rightAnkle?.score > 0.2).map(m => m.pose.rightAnkle.y);
  const rightFlightY = matched.filter(m => isFlightPhase(m.rightPhase) && m.pose?.rightAnkle?.score > 0.2).map(m => m.pose.rightAnkle.y);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const leftAvgStance  = avg(leftStanceY);
  const leftAvgFlight  = avg(leftFlightY);
  const rightAvgStance = avg(rightStanceY);
  const rightAvgFlight = avg(rightFlightY);

  // Threshold = midpoint between stance-avg and flight-avg, expressed as 0-1 fraction
  const allLeftY  = [...leftStanceY,  ...leftFlightY];
  const allRightY = [...rightStanceY, ...rightFlightY];

  const computeFraction = (stanceAvg, flightAvg, allY) => {
    if (stanceAvg == null || flightAvg == null || allY.length < 2) return null;
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const range = maxY - minY;
    if (range < 1) return null;
    const midpoint = (stanceAvg + flightAvg) / 2;
    return (midpoint - minY) / range; // higher Y = lower on screen = ground contact
  };

  return {
    leftContactThreshold:  computeFraction(leftAvgStance,  leftAvgFlight,  allLeftY),
    rightContactThreshold: computeFraction(rightAvgStance, rightAvgFlight, allRightY),
    sampleCount: matched.length,
  };
}