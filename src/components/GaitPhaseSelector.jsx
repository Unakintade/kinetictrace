/**
 * Phase selector buttons for left and right leg.
 */
import { GAIT_PHASES, PHASE_GROUPS } from '@/lib/gaitPhases';

function PhaseButton({ phase, selected, onClick }) {
  return (
    <button
      onClick={() => onClick(phase.id)}
      className={`px-2 py-1 rounded text-xs font-medium border transition-all ${
        selected
          ? 'text-black border-transparent shadow-md'
          : 'border-border/50 text-muted-foreground hover:text-foreground hover:border-border bg-transparent'
      }`}
      style={selected ? { background: phase.color, borderColor: phase.color } : {}}
    >
      {phase.label}
    </button>
  );
}

export default function GaitPhaseSelector({ leftPhase, rightPhase, onLeftChange, onRightChange }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left leg */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-xs font-medium text-green-400">Left Leg</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GAIT_PHASES.map(p => (
            <PhaseButton key={p.id} phase={p} selected={leftPhase === p.id} onClick={onLeftChange} />
          ))}
        </div>
      </div>

      {/* Right leg */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          <span className="text-xs font-medium text-orange-400">Right Leg</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GAIT_PHASES.map(p => (
            <PhaseButton key={p.id} phase={p} selected={rightPhase === p.id} onClick={onRightChange} />
          ))}
        </div>
      </div>
    </div>
  );
}