import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">t = {label}s</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {p.value} ms
        </p>
      ))}
    </div>
  );
};

export default function ContactTimeChart({ leftContactDurations, rightContactDurations, onSeek, seekTime }) {
  const hasData = (leftContactDurations?.length || 0) + (rightContactDurations?.length || 0) > 0;

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-1">
          <div className="text-2xl">⏱️</div>
          <p>Start tracking to see contact time</p>
        </div>
      </div>
    );
  }

  // Merge into a unified timeline keyed by time
  const map = {};
  (leftContactDurations || []).forEach(d => {
    map[d.t] = { ...map[d.t], t: d.t, left: d.duration };
  });
  (rightContactDurations || []).forEach(d => {
    map[d.t] = { ...map[d.t], t: d.t, right: d.duration };
  });
  const data = Object.values(map).sort((a, b) => a.t - b.t);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        onClick={e => e?.activePayload?.length && onSeek?.(e.activePayload[0].payload.t)}
        style={{ cursor: onSeek ? 'pointer' : 'default' }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}s`} />
        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}`} width={44}
          label={{ value: 'ms', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={v => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{v}</span>} />
        {seekTime != null && <ReferenceLine x={seekTime} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" />}
        <Bar dataKey="left"  name="Left"  fill="hsl(var(--chart-3))" opacity={0.8} radius={[3,3,0,0]} />
        <Bar dataKey="right" name="Right" fill="hsl(var(--chart-4))" opacity={0.8} radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}