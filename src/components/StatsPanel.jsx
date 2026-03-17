export default function StatsPanel({ velocityData, pixelsPerMeter }) {
  if (!velocityData || velocityData.length < 2) return null;

  const speeds = velocityData.map(d => d.speed).filter(Boolean);
  const maxSpeed = Math.max(...speeds).toFixed(3);
  const avgSpeed = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(3);
  const lastVx = velocityData[velocityData.length - 1]?.vx?.toFixed(3) ?? '—';
  const lastVy = velocityData[velocityData.length - 1]?.vy?.toFixed(3) ?? '—';
  const lastSpeed = velocityData[velocityData.length - 1]?.speed?.toFixed(3) ?? '—';

  const stats = [
    { label: 'Current Speed', value: `${lastSpeed} m/s`, color: 'text-chart-1' },
    { label: 'Max Speed', value: `${maxSpeed} m/s`, color: 'text-primary' },
    { label: 'Avg Speed', value: `${avgSpeed} m/s`, color: 'text-muted-foreground' },
    { label: 'Vx (current)', value: `${lastVx} m/s`, color: 'text-chart-2' },
    { label: 'Vy (current)', value: `${lastVy} m/s`, color: 'text-chart-3' },
    { label: 'Scale', value: pixelsPerMeter ? `${pixelsPerMeter.toFixed(1)} px/m` : '—', color: 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map(s => (
        <div key={s.label} className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
          <p className="text-xs text-muted-foreground truncate">{s.label}</p>
          <p className={`text-sm font-mono font-semibold mt-0.5 ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}