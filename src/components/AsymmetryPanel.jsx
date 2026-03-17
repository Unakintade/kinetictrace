function severity(pct) {
  if (pct < 8)  return { color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  label: 'Good' };
  if (pct < 15) return { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: 'Mild' };
  return          { color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    label: 'High' };
}

function AsymRow({ label, data, unit }) {
  if (!data) return null;
  const pct = data.pct || 0;
  const { color, bg, border, label: sev } = severity(pct);
  const barWidth = Math.min(100, pct * 3);

  return (
    <div className={`rounded-lg border ${border} ${bg} p-3 space-y-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className={`text-xs font-semibold ${color}`}>{sev} · {pct.toFixed(1)}%</span>
      </div>
      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} style={{ width: `${barWidth}%` }} />
      </div>
      <div className="flex justify-between text-xs font-mono text-muted-foreground">
        <span>L: {data.left?.toFixed(unit === 'ms' ? 0 : 2)}{unit}</span>
        <span>R: {data.right?.toFixed(unit === 'ms' ? 0 : 2)}{unit}</span>
      </div>
    </div>
  );
}

export default function AsymmetryPanel({ asymmetry }) {
  if (!asymmetry) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-1">
          <div className="text-2xl">⚖️</div>
          <p>Start tracking to see asymmetry</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      <AsymRow label="Stride Length" data={asymmetry.strideLength} unit="m" />
      <AsymRow label="Stride Frequency" data={asymmetry.strideFreq} unit=" str/s" />
      <AsymRow label="Contact Time" data={asymmetry.contactTime} unit="ms" />
      <div className="mt-1 text-xs text-muted-foreground/60 text-center">
        <span className="text-green-400">●</span> &lt;8% · <span className="text-yellow-400">●</span> 8–15% · <span className="text-red-400">●</span> &gt;15%
      </div>
    </div>
  );
}