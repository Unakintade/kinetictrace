/**
 * Displays knee and hip flexion angles for left and right legs as arc gauges.
 */

function ArcGauge({ label, angle, min = 0, max = 180, color }) {
  const pct = Math.max(0, Math.min(1, (angle - min) / (max - min)));
  const r = 22;
  const cx = 28;
  const cy = 28;
  const circumference = Math.PI * r; // half circle
  const strokeDash = circumference * pct;

  // Draw a semi-circle (top half) as the arc track
  const trackD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={56} height={34} viewBox="0 0 56 34">
        {/* Track */}
        <path d={trackD} fill="none" stroke="hsl(var(--border))" strokeWidth={5} strokeLinecap="round" />
        {/* Fill */}
        <path
          d={trackD}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 0.1s ease' }}
        />
        {/* Value text */}
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={9} fill="white" fontFamily="monospace" fontWeight="bold">
          {angle != null ? Math.round(angle) : '—'}°
        </text>
      </svg>
      <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
    </div>
  );
}

export default function AngleGauges({ angles }) {
  if (!angles) return null;
  const { leftKnee, rightKnee, leftHip, rightHip } = angles;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Joint Angles</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-[10px] text-green-400 font-medium w-8">Left</span>
          <ArcGauge label="Knee" angle={leftKnee}  color="#22c55e" />
          <ArcGauge label="Hip"  angle={leftHip}   color="#4ade80" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
          <span className="text-[10px] text-orange-400 font-medium w-8">Right</span>
          <ArcGauge label="Knee" angle={rightKnee} color="#f97316" />
          <ArcGauge label="Hip"  angle={rightHip}  color="#fb923c" />
        </div>
      </div>
    </div>
  );
}