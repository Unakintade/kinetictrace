import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">t = {label}s</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {p.value?.toFixed(3)}{p.name.includes('Freq') ? ' str/s' : ' m'}
        </p>
      ))}
    </div>
  );
};

const STRIDE_DEBUG_MESSAGES = {
  no_pose_history: 'No pose data yet.',
  no_calibration: 'Set two calibration markers and distance to enable stride length.',
  need_5_frames: 'Need a few more frames—keep tracking.',
  need_5_confident_ankle_frames: 'Ankles need to be visible; try a clearer camera angle.',
  need_2_footstrikes_per_leg: 'Walk a few steps so we can detect at least 2 foot strikes per leg.',
};

function strideDebugHint(debug) {
  if (!debug || typeof debug !== 'string') return null;
  if (debug.startsWith('need_5_frames')) return STRIDE_DEBUG_MESSAGES.need_5_frames;
  if (debug.startsWith('need_5_confident')) return STRIDE_DEBUG_MESSAGES.need_5_confident_ankle_frames;
  if (debug.startsWith('need_2_footstrikes')) return STRIDE_DEBUG_MESSAGES.need_2_footstrikes_per_leg;
  return STRIDE_DEBUG_MESSAGES[debug] || null;
}

export default function StrideGraph({ windowedMetrics, strideMetrics, onSeek, seekTime, strideDebug }) {
  if (!windowedMetrics || windowedMetrics.length === 0) {
    const hint = strideDebugHint(strideDebug);
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center mx-auto">
            <span className="text-xl">🦶</span>
          </div>
          <p>Start tracking to see stride analysis</p>
          <p className="text-xs text-muted-foreground/60">Stride length & frequency averaged per second</p>
          {hint && <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{hint}</p>}
        </div>
      </div>
    );
  }

  const handleClick = (e) => {
    if (!onSeek || !e?.activePayload?.length) return;
    const t = e.activePayload[0]?.payload?.t;
    if (t != null) onSeek(t);
  };

  // Merge windowed and per-stride data by time bucket for display
  const displayData = windowedMetrics.map(w => ({
    t: w.t,
    avgStrideLength: w.avgStrideLength,
    avgStrideFreq: w.avgStrideFreq,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={displayData}
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
        {/* Left Y: stride length */}
        <YAxis
          yAxisId="length"
          stroke="hsl(var(--chart-4))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={v => `${v}m`}
          width={42}
        />
        {/* Right Y: stride frequency */}
        <YAxis
          yAxisId="freq"
          orientation="right"
          stroke="hsl(var(--chart-2))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickFormatter={v => `${v}`}
          width={38}
          label={{ value: 'str/s', angle: 90, position: 'insideRight', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
        />
        <Tooltip content={(props) => <CustomTooltip {...props} />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
        />
        {seekTime != null && (
          <ReferenceLine
            yAxisId="length"
            x={Math.floor(seekTime)}
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
        )}
        <Bar
          yAxisId="length"
          dataKey="avgStrideLength"
          name="Avg Stride Length"
          fill="hsl(var(--chart-4) / 0.4)"
          stroke="hsl(var(--chart-4))"
          strokeWidth={1}
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="freq"
          type="monotone"
          dataKey="avgStrideFreq"
          name="Avg Stride Freq"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}