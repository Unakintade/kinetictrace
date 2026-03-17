import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">t = {label}s</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {p.value?.toFixed(3)} m/s
        </p>
      ))}
    </div>
  );
};

export default function VelocityGraph({ velocityData, onSeek, seekTime }) {
  if (!velocityData || velocityData.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center mx-auto">
            <span className="text-xl">📈</span>
          </div>
          <p>Start tracking to see velocity graph</p>
          <p className="text-xs text-muted-foreground/60">Calibrate markers, then track object motion</p>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={velocityData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis
          dataKey="t"
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={v => `${v}s`}
          label={{ value: 'Time (s)', position: 'insideBottom', offset: -3, fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={v => `${v}`}
          label={{ value: 'm/s', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          width={45}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
        />
        <ReferenceLine y={0} stroke="hsl(var(--border))" />
        <Line
          type="monotone"
          dataKey="speed"
          name="Speed"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="vx"
          name="Vx"
          stroke="hsl(var(--chart-2))"
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="4 2"
          activeDot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="vy"
          name="Vy"
          stroke="hsl(var(--chart-3))"
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="4 2"
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}