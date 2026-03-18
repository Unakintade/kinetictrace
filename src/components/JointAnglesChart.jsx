import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">t = {label}s</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {p.value?.toFixed(1)}°
        </p>
      ))}
    </div>
  );
};

export default function JointAnglesChart({ jointAngles, onSeek, seekTime }) {
  if (!jointAngles || jointAngles.length < 3) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-1">
          <div className="text-2xl">📐</div>
          <p>Start tracking to see joint angles</p>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={jointAngles}
        margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        onClick={e => e?.activePayload?.length && onSeek?.(e.activePayload[0].payload.t)}
        style={{ cursor: onSeek ? 'pointer' : 'default' }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}s`} />
        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={v => `${v}°`} width={40} domain={[0, 180]} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={v => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{v}</span>} />
        {seekTime != null && <ReferenceLine x={seekTime} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" />}
        <Line type="monotone" dataKey="leftKnee"    name="L Knee"      stroke="hsl(var(--chart-1))" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="rightKnee"   name="R Knee"      stroke="hsl(var(--chart-2))" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
        <Line type="monotone" dataKey="leftHip"     name="L Hip"       stroke="hsl(var(--chart-3))" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="rightHip"    name="R Hip"       stroke="hsl(var(--chart-4))" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
        {/* Reference angles from labeled session */}
        <Line type="monotone" dataKey="refLeftKnee"  name="Ref L Knee"  stroke="hsl(var(--chart-1))" strokeWidth={1} dot={false} strokeDasharray="2 4" opacity={0.45} />
        <Line type="monotone" dataKey="refRightKnee" name="Ref R Knee"  stroke="hsl(var(--chart-2))" strokeWidth={1} dot={false} strokeDasharray="2 4" opacity={0.45} />
        <Line type="monotone" dataKey="refLeftHip"   name="Ref L Hip"   stroke="hsl(var(--chart-3))" strokeWidth={1} dot={false} strokeDasharray="2 4" opacity={0.45} />
        <Line type="monotone" dataKey="refRightHip"  name="Ref R Hip"   stroke="hsl(var(--chart-4))" strokeWidth={1} dot={false} strokeDasharray="2 4" opacity={0.45} />
      </LineChart>
    </ResponsiveContainer>
  );
}