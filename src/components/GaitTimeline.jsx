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

const STANCE_RATIO = 0.62; // fraction of stride that is stance phase

const PHASE_COLORS = {
  stance_left:  { fill: 'hsl(145 70% 45%)',  label: 'L Stance' },
  swing_left:   { fill: 'hsl(145 70% 20%)',  label: 'L Swing'  },
  stance_right: { fill: 'hsl(25 90% 55%)',   label: 'R Stance' },
  swing_right:  { fill: 'hsl(25 90% 25%)',   label: 'R Swing'  },
};

function buildPhases(stanceEvents, leg) {
  const events = stanceEvents.filter(e => e.leg === leg).sort((a, b) => a.t - b.t);
  const phases = [];
  for (let i = 0; i < events.length; i++) {
    const curr = events[i];
    const next = events[i + 1];
    if (!next) {
      // Last event — show a short stance marker only
      phases.push({ type: `stance_${leg}`, start: curr.t, end: curr.t + 0.15 });
      break;
    }
    const strideDt = next.t - curr.t;
    const stanceEnd = curr.t + strideDt * STANCE_RATIO;
    phases.push({ type: `stance_${leg}`, start: curr.t,    end: stanceEnd });
    phases.push({ type: `swing_${leg}`,  start: stanceEnd, end: next.t    });
  }
  return phases;
}

export default function GaitTimeline({ stanceEvents, seekTime, onSeek }) {
  if (!stanceEvents || stanceEvents.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center mx-auto">
            <span className="text-xl">🏃</span>
          </div>
          <p>No gait events detected yet</p>
          <p className="text-xs text-muted-foreground/60">Requires ankle tracking with ≥ 2 footstrikes per leg</p>
        </div>
      </div>
    );
  }

  const leftPhases  = buildPhases(stanceEvents, 'left');
  const rightPhases = buildPhases(stanceEvents, 'right');

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
        {lanes.map(({ label, phases }) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <span className="text-xs text-muted-foreground w-8 shrink-0 text-right">{label}</span>
            <div className="relative flex-1 h-full rounded overflow-hidden bg-muted/30 border border-border/40">
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
              {/* Seek cursor */}
              {seekTime != null && seekTime >= tMin && seekTime <= tMax && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary z-10"
                  style={{ left: `${toPercent(seekTime)}%` }}
                />
              )}
            </div>
          </div>
        ))}

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