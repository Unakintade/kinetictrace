export default function StatsPanel({ velocityData, pixelsPerMeter, strideMetrics }) {
  const hasVelocity = velocityData && velocityData.length >= 2;
  const hasStride = strideMetrics && strideMetrics.length > 0;

  const speeds = hasVelocity ? velocityData.map(d => d.speed).filter(Boolean) : [];
  const maxSpeed = speeds.length ? Math.max(...speeds).toFixed(3) : '—';
  const avgSpeed = speeds.length ? (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(3) : '—';
  const lastSpeed = hasVelocity ? (velocityData[velocityData.length - 1]?.speed?.toFixed(3) ?? '—') : '—';

  const strideLengths = hasStride ? strideMetrics.map(m => m.strideLength) : [];
  const strideFreqs = hasStride ? strideMetrics.map(m => m.strideFreq).filter(v => v != null) : [];
  const avgStrideLength = strideLengths.length ? (strideLengths.reduce((a, b) => a + b, 0) / strideLengths.length).toFixed(2) : '—';
  const avgStrideFreqVal = strideFreqs.length ? strideFreqs.reduce((a, b) => a + b, 0) / strideFreqs.length : null;
  const avgStrideFreq = avgStrideFreqVal !== null ? avgStrideFreqVal.toFixed(2) : '—';
  const lastStrideLength = strideLengths.length ? strideLengths[strideLengths.length - 1].toFixed(2) : '—';
  // Cadence (steps/min) = avg stride freq (strides/s per leg) × 2 legs × 60s
  const cadence = avgStrideFreqVal !== null ? (avgStrideFreqVal * 2 * 60).toFixed(0) : '—';

  const stats = [
    { label: 'Current Speed', value: `${lastSpeed} m/s`, color: 'text-chart-1' },
    { label: 'Max Speed', value: `${maxSpeed} m/s`, color: 'text-primary' },
    { label: 'Avg Speed', value: `${avgSpeed} m/s`, color: 'text-muted-foreground' },
    { label: 'Stride Length', value: `${lastStrideLength} m`, color: 'text-chart-4' },
    { label: 'Avg Stride', value: `${avgStrideLength} m`, color: 'text-chart-4' },
    { label: 'Cadence', value: cadence !== '—' ? `${cadence} spm` : '—', color: 'text-chart-2' },
    { label: 'Stride Freq', value: avgStrideFreq !== '—' ? `${avgStrideFreq} str/s` : '—', color: 'text-chart-2' },
    { label: 'Scale', value: pixelsPerMeter ? `${pixelsPerMeter.toFixed(1)} px/m` : '—', color: 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map(s => (
        <div key={s.label} className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
          <p className="text-xs text-muted-foreground truncate">{s.label}</p>
          <p className={`text-sm font-mono font-semibold mt-0.5 ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}