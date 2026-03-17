import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">t = {label}s</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {p.value?.toFixed(3)}{p.name === 'Speed' ? ' m/s' : ' m/s²'}
        </p>
      ))}
    </div>
  );
};

export default function VelocityAccelChart({ velocityData, peakSpeed, avgSpeed, onSeek, seekTime }) {
  if (!velocityData || velocityData.length < 3) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-1">
          <div className="text-2xl">⚡</div>
          <p>Start tracking to see velocity & acceleration</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {(peakSpeed > 0 || avgSpeed > 0) && (
        <div className="flex gap-4 px-4 pt-1 pb-0">
          <span className="text-xs font-mono text-chart-1">Peak: {peakSpeed} m/s</span>
          <span className="text-xs font-mono text-muted-foreground">Avg: {avgSpeed} m/s</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={velocityData}
            margin={{ top: 8, right: 20, left: 0, bottom: 5 }}
            onClick={e => e?.activePayload?.length && onSeek?.(e.activePayload[0].payload.t)}
            style={{ cursor: onSeek ? 'pointer' : 'default' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}s`} />
            <YAxis yAxisId="v" stroke="hsl(var(--chart-1))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}`} width={40}
              label={{ value: 'm/s', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
            <YAxis yAxisId="a" orientation="right" stroke="hsl(var(--chart-2))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}`} width={40} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={v => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{v}</span>} />
            <ReferenceLine yAxisId="v" y={0} stroke="hsl(var(--border))" />
            {seekTime != null && <ReferenceLine yAxisId="v" x={seekTime} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" />}
            <Line yAxisId="v" type="monotone" dataKey="speed" name="Speed" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
            <Line yAxisId="a" type="monotone" dataKey="accel" name="Accel" stroke="hsl(var(--chart-2))" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}