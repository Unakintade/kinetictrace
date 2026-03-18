/**
 * Horizontal timeline showing labeled frames for both legs.
 * Click to seek.
 */
import { getPhaseColor, getPhaseLabel, GAIT_PHASES } from '@/lib/gaitPhases';

export default function GaitLabelTimeline({ frames, duration, currentTime, onSeek }) {
  if (!frames?.length || !duration) return null;

  const toPercent = t => (t / duration) * 100;

  return (
    <div className="flex flex-col gap-1.5 px-2 select-none">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-1">
        {GAIT_PHASES.map(p => (
          <div key={p.id} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-[10px] text-muted-foreground">{p.label}</span>
          </div>
        ))}
      </div>

      {['left', 'right'].map(leg => (
        <div key={leg} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-10 shrink-0 text-right capitalize">{leg}</span>
          <div
            className="relative flex-1 h-5 rounded bg-muted/30 border border-border/40 cursor-pointer overflow-hidden"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek?.((e.clientX - rect.left) / rect.width * duration);
            }}
          >
            {frames.map((f, i) => {
              const phase = leg === 'left' ? f.leftPhase : f.rightPhase;
              if (!phase) return null;
              const left = toPercent(f.t);
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-1 rounded-sm opacity-90"
                  style={{ left: `${left}%`, background: getPhaseColor(phase) }}
                  title={`${getPhaseLabel(phase)} @ ${f.t.toFixed(2)}s`}
                />
              );
            })}
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-primary z-10 pointer-events-none"
              style={{ left: `${toPercent(currentTime)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}