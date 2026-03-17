import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">t = {Number(label).toFixed(2)}s</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {p.value?.toFixed(1)}px
        </p>
      ))}
    </div>
  );
};

export default function AnkleChart({ poseHistory, onSeek, seekTime }) {
  // Build chart data from pose history — one point per frame
  const data = poseHistory
    .filter(f => f.pose?.leftAnkle || f.pose?.rightAnkle)
    .map(f => ({
      t: parseFloat(f.t.toFixed(2)),
      leftY:  f.pose?.leftAnkle?.score  > 0.2 ? parseFloat(f.pose.leftAnkle.y.toFixed(1))  : null,
      rightY: f.pose?.rightAnkle?.score > 0.2 ? parseFloat(f.pose.rightAnkle.y.toFixed(1)) : null,
    }));

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center mx-auto">
            <span className="text-xl">🦶</span>
          </div>
          <p>Start tracking to see ankle positions</p>
          <p className="text-xs text-muted-foreground/60">Left & right ankle Y-position over time</p>
        </div>
      </div>
    );
  }

  const handleClick = (e) => {
    if (!onSeek || !e?.activePayload?.length) return;
    const t = e.activePayload[0]?.payload?.t;
    if (t != null) onSeek(t);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
        onClick={handleClick}
        style={{ cursor: onSeek ? 'pointer' : 'default' }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis
          dataKey="t"
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={v => `${v}s`}
          label={{ value: 'Time (s)', position: 'insideBottom', offset: -3, fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
        />
        <YAxis
          reversed
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={v => `${v}`}
          label={{ value: 'Y (px)', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          width={45}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
        />
        {seekTime != null && (
          <ReferenceLine x={seekTime} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" />
        )}
        <Line
          type="monotone"
          dataKey="leftY"
          name="Left Ankle"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="rightY"
          name="Right Ankle"
          stroke="#f97316"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}