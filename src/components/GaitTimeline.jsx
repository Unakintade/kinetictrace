/**
 * GaitTimeline — horizontal swimlane timeline showing gait phases per leg.
 *
 * Gait phases derived from stance events (footstrike peaks):
 *   - STANCE: from footstrike(n) to footstrike(n+1) for the same leg, capped at ~60% of stride period
 *   - SWING:  remainder of stride period until next same-leg footstrike
 *
 * Between consecutive SAME-leg footstrikes we split the interval:
 *   stance ≈ 60% of stride time, swing ≈ 40% (typical running approximation)
 */

// For running, stance is ~20-40% of the full gait cycle (same-leg to same-leg).
// We cap stance duration using the next contralateral footstrike to enforce alternation.
const MAX_STANCE_MS = 0.35; // max stance as fraction of same-leg stride period

const GAIT_DEBUG_HINTS = {
  no_pose_history: 'Start tracking to record pose data.',
  no_calibration: 'Set two calibration markers and distance to enable gait analysis.',
  need_5_frames: 'Keep tracking a bit longer to collect enough frames.',
  need_5_confident_ankle_frames: 'Keep ankles visible in frame for reliable detection.',
  need_2_footstrikes_per_leg: 'Walk a few steps so we can detect at least 2 foot strikes per leg.',
};

function gaitDebugHint(debug) {
  if (!debug || typeof debug !== 'string') return null;
  if (debug.startsWith('need_5_frames')) return GAIT_DEBUG_HINTS.need_5_frames;
  if (debug.startsWith('need_5_confident')) return GAIT_DEBUG_HINTS.need_5_confident_ankle_frames;
  if (debug.startsWith('need_2_footstrikes')) return GAIT_DEBUG_HINTS.need_2_footstrikes_per_leg;
  return GAIT_DEBUG_HINTS[debug] || null;
}

const PHASE_COLORS = {
  stance_left:  { fill: 'hsl(145 70% 45%)',  label: 'L Stance' },
  swing_left:   { fill: 'hsl(145 70% 20%)',  label: 'L Swing'  },
  stance_right: { fill: 'hsl(25 90% 55%)',   label: 'R Stance' },
  swing_right:  { fill: 'hsl(25 90% 25%)',   label: 'R Swing'  },
};

/**
 * Build phases for one leg ensuring alternation with the other leg.
 * Stance ends at whichever comes first:
 *   - the next opposite-leg footstrike (enforces no overlap), OR
 *   - MAX_STANCE_MS fraction of the same-leg stride period
 */
function buildPhases(stanceEvents, leg) {
  const thisLeg  = stanceEvents.filter(e => e.leg === leg).sort((a, b) => a.t - b.t);
  const otherLeg = stanceEvents.filter(e => e.leg !== leg).sort((a, b) => a.t - b.t);

  const phases = [];
  for (let i = 0; i < thisLeg.length; i++) {
    const curr     = thisLeg[i];
    const nextSame = thisLeg[i + 1];

    // Find the first contralateral strike AFTER this footstrike
    const nextOther = otherLeg.find(e => e.t > curr.t);

    if (!nextSame) {
      // Last event — short stance stub
      phases.push({ type: `stance_${leg}`, start: curr.t, end: curr.t + 0.12 });
      break;
    }

    const sameLegDt = nextSame.t - curr.t;
    // Stance ends at contralateral strike, but never beyond MAX_STANCE_MS of full stride
    const maxStanceEnd = curr.t + sameLegDt * MAX_STANCE_MS;
    const stanceEnd = nextOther
      ? Math.min(nextOther.t, maxStanceEnd)
      : maxStanceEnd;

    phases.push({ type: `stance_${leg}`, start: curr.t,    end: stanceEnd });
    phases.push({ type: `swing_${leg}`,  start: stanceEnd, end: nextSame.t });
  }
  return phases;
}

import { getPhaseColor, getPhaseLabel } from '@/lib/gaitPhases';

/**
 * Build fine-tuned phases from gait-labeler reference frames.
 * touch_down → stance start, toe_off → stance end / swing start.
 * Falls back to the inferred buildPhases() when no ref frames are present.
 */
function buildPhasesFromLabels(referenceFrames, leg) {
  const phaseKey = `${leg}Phase`;
  // Only use frames that have a label for this leg
  const frames = referenceFrames
    .filter(f => f[phaseKey])
    .sort((a, b) => a.t - b.t);

  if (frames.length < 2) return null; // not enough labeled data

  const phases = [];
  let i = 0;
  while (i < frames.length) {
    const f = frames[i];
    const phase = f[phaseKey];

    // Stance phases: touch_down, mid_stance
    const isStance = phase === 'touch_down' || phase === 'mid_stance';
    // Swing phases: toe_off, early_flight, mid_flight, late_flight
    const isSwing  = phase === 'toe_off' || phase === 'early_flight' || phase === 'mid_flight' || phase === 'late_flight';

    if (isStance) {
      // Find where stance ends (first swing-phase frame after this)
      let j = i + 1;
      while (j < frames.length && (frames[j][phaseKey] === 'touch_down' || frames[j][phaseKey] === 'mid_stance')) j++;
      const stanceEnd = j < frames.length ? frames[j].t : frames[i].t + 0.12;
      phases.push({ type: `stance_${leg}`, start: f.t, end: stanceEnd });
      i = j;
    } else if (isSwing) {
      // Find where swing ends (first stance-phase frame after this)
      let j = i + 1;
      while (j < frames.length && (frames[j][phaseKey] === 'toe_off' || frames[j][phaseKey] === 'early_flight' || frames[j][phaseKey] === 'mid_flight' || frames[j][phaseKey] === 'late_flight')) j++;
      const swingEnd = j < frames.length ? frames[j].t : frames[i].t + 0.25;
      phases.push({ type: `swing_${leg}`, start: f.t, end: swingEnd });
      i = j;
    } else {
      i++;
    }
  }

  return phases.length > 0 ? phases : null;
}

export default function GaitTimeline({ stanceEvents, seekTime, onSeek, strideDebug, referenceFrames }) {
  if (!stanceEvents || stanceEvents.length < 2) {
    const hint = gaitDebugHint(strideDebug);
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center mx-auto">
            <span className="text-xl">🏃</span>
          </div>
          <p>No gait events detected yet</p>
          <p className="text-xs text-muted-foreground/60">Requires ankle tracking with ≥ 2 footstrikes per leg</p>
          {hint && <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{hint}</p>}
        </div>
      </div>
    );
  }

  const labeledLeftPhases  = referenceFrames?.length ? buildPhasesFromLabels(referenceFrames, 'left')  : null;
  const labeledRightPhases = referenceFrames?.length ? buildPhasesFromLabels(referenceFrames, 'right') : null;

  const leftPhases  = labeledLeftPhases  ?? buildPhases(stanceEvents, 'left');
  const rightPhases = labeledRightPhases ?? buildPhases(stanceEvents, 'right');

  const tMin = stanceEvents[0].t;
  const tMax = stanceEvents[stanceEvents.length - 1].t + 0.3;
  const tSpan = tMax - tMin;

  const toPercent = (t) => ((t - tMin) / tSpan) * 100;

  // Build tick marks every ~0.5s
  const tickStep = tSpan > 10 ? 2 : tSpan > 4 ? 1 : 0.5;
  const ticks = [];
  for (let t = Math.ceil(tMin / tickStep) * tickStep; t <= tMax; t += tickStep) {
    ticks.push(parseFloat(t.toFixed(2)));
  }

  const handleClick = (e) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(parseFloat((tMin + frac * tSpan).toFixed(2)));
  };

  const lanes = [
    { label: 'Left',  phases: leftPhases  },
    { label: 'Right', phases: rightPhases },
  ];

  return (
    <div className="flex flex-col h-full select-none px-3 pb-2 pt-1 gap-1">
      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {Object.entries(PHASE_COLORS).map(([key, { fill, label }]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: fill }} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Timeline lanes */}
      <div
        className="flex-1 flex flex-col gap-1.5 relative cursor-pointer"
        onClick={handleClick}
      >
        {lanes.map(({ label, phases }) => {
          const legKey = label.toLowerCase();
          const refPhaseKey = `${legKey}Phase`;
          return (
            <div key={label} className="flex items-center gap-2 flex-1">
              <span className="text-xs text-muted-foreground w-8 shrink-0 text-right">{label}</span>
              <div className="relative flex-1 h-full rounded overflow-hidden bg-muted/30 border border-border/40">
                {/* Live gait phases */}
                {phases.map((ph, i) => {
                  const left  = toPercent(ph.start);
                  const width = toPercent(ph.end) - left;
                  const { fill } = PHASE_COLORS[ph.type] || {};
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 rounded-sm"
                      style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%`, background: fill, opacity: 0.85 }}
                      title={`${PHASE_COLORS[ph.type]?.label} ${ph.start.toFixed(2)}s–${ph.end.toFixed(2)}s`}
                    />
                  );
                })}
                {/* Reference frame phase dots (bottom strip) */}
                {referenceFrames?.map((rf, i) => {
                  const phase = rf[refPhaseKey];
                  if (!phase) return null;
                  const pct = toPercent(rf.t);
                  if (pct < 0 || pct > 100) return null;
                  return (
                    <div
                      key={i}
                      className="absolute bottom-0 w-1 rounded-t-sm z-10"
                      style={{ left: `${pct}%`, height: '35%', background: getPhaseColor(phase), opacity: 0.9 }}
                      title={`Ref: ${getPhaseLabel(phase)} @ ${rf.t.toFixed(2)}s`}
                    />
                  );
                })}
                {/* Seek cursor */}
                {seekTime != null && seekTime >= tMin && seekTime <= tMax && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary z-10"
                    style={{ left: `${toPercent(seekTime)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Time axis ticks */}
        <div className="relative h-4 ml-10">
          {ticks.map(t => (
            <div
              key={t}
              className="absolute flex flex-col items-center"
              style={{ left: `${toPercent(t)}%`, transform: 'translateX(-50%)' }}
            >
              <div className="w-px h-1.5 bg-border" />
              <span className="text-[10px] text-muted-foreground/60 font-mono">{t}s</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}