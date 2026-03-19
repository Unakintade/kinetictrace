import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Download, ChevronDown, ChevronUp } from 'lucide-react';

// Parse OpenSim .mot file text → array of {time, ...columns}
function parseMot(text) {
  const lines = text.split('\n');
  // Find header row (contains 'time')
  let headerIdx = lines.findIndex(l => l.trim().startsWith('time'));
  if (headerIdx === -1) return null;
  const headers = lines[headerIdx].trim().split(/\s+/);
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < headers.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = parseFloat(parts[j]); });
    if (!isNaN(row.time)) rows.push(row);
  }
  return { headers, rows };
}

// Key joint angle columns to visualise
const KEY_JOINTS = [
  { key: 'hip_flexion_r',    label: 'R Hip Flex',   color: '#f97316' },
  { key: 'hip_flexion_l',    label: 'L Hip Flex',   color: '#22c55e' },
  { key: 'knee_angle_r',     label: 'R Knee',       color: '#fb923c' },
  { key: 'knee_angle_l',     label: 'L Knee',       color: '#4ade80' },
  { key: 'ankle_angle_r',    label: 'R Ankle',      color: '#fdba74' },
  { key: 'ankle_angle_l',    label: 'L Ankle',      color: '#86efac' },
  { key: 'lumbar_extension', label: 'Lumbar Ext',   color: '#818cf8' },
];

function computeStats(rows, key) {
  const vals = rows.map(r => r[key]).filter(v => !isNaN(v));
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const rom = max - min;
  return { min: min.toFixed(1), max: max.toFixed(1), mean: mean.toFixed(1), rom: rom.toFixed(1) };
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs max-w-xs">
      <p className="text-muted-foreground mb-1">t = {Number(label).toFixed(3)}s</p>
      {payload.slice(0, 4).map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: {Number(p.value).toFixed(2)}°
        </p>
      ))}
    </div>
  );
};

export default function OpenCapTrialCard({ trial }) {
  const [motData, setMotData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [error, setError] = useState(null);

  // Find the IK results .mot file URL
  const motResult = trial.results?.find(r =>
    (r.tag === 'ik_results') || (r.media ?? '').endsWith('.mot')
  );
  const motUrl = motResult?.media ?? motResult?.video;

  const loadMot = async () => {
    if (!motUrl || loading) return;
    setLoading(true);
    setError(null);
    const res = await fetch(motUrl);
    if (!res.ok) { setError('Could not download .mot file'); setLoading(false); return; }
    const text = await res.text();
    const parsed = parseMot(text);
    if (!parsed) { setError('Failed to parse .mot file'); setLoading(false); return; }
    setMotData(parsed);
    setLoading(false);
  };

  // Available joints in this mot file
  const availableJoints = motData
    ? KEY_JOINTS.filter(j => motData.headers.includes(j.key))
    : [];

  // Downsample rows for chart performance
  const chartRows = motData
    ? motData.rows.filter((_, i) => i % Math.max(1, Math.floor(motData.rows.length / 300)) === 0)
    : [];

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
      {/* Trial header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 bg-card/60">
        <div>
          <p className="text-sm font-semibold">{trial.name || trial.id}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {trial.created_at ? new Date(trial.created_at).toLocaleString() : ''}
            {' · '}{trial.results?.length ?? 0} result files
          </p>
        </div>
        <div className="flex items-center gap-2">
          {motUrl && (
            <a
              href={motUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground border border-border/50 rounded px-2 py-1"
            >
              <Download className="w-3 h-3" /> .mot file
            </a>
          )}
          {motUrl && !motData && (
            <button
              onClick={loadMot}
              disabled={loading}
              className="text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-3 py-1 transition-colors"
            >
              {loading ? 'Loading…' : 'Load Kinematics'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="px-5 py-3 text-xs text-destructive">{error}</p>
      )}

      {/* Results list when no mot loaded */}
      {!motData && !loading && (
        <div className="px-5 py-4">
          <p className="text-xs text-muted-foreground font-medium mb-3">Result Files</p>
          <div className="grid grid-cols-2 gap-2">
            {(trial.results ?? []).map((r, i) => (
              <a
                key={i}
                href={r.media ?? r.video ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs border border-border/40 rounded-lg px-3 py-2 hover:border-border transition-colors flex items-center justify-between gap-2 group"
              >
                <span className="text-muted-foreground group-hover:text-foreground truncate">
                  {r.tag || r.media_type || `result_${i + 1}`}
                </span>
                <Download className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              </a>
            ))}
            {(trial.results ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground/60 col-span-2">No results available for this trial.</p>
            )}
          </div>
        </div>
      )}

      {/* Kinematic chart */}
      {motData && (
        <div className="px-5 py-4 space-y-5">
          {/* Summary stats table */}
          <div>
            <button
              onClick={() => setShowStats(s => !s)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2 hover:text-foreground"
            >
              Joint ROM Summary
              {showStats ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showStats && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/40">
                      <th className="text-left py-1.5 pr-4 font-medium">Joint</th>
                      <th className="text-right py-1.5 pr-4 font-medium">Min (°)</th>
                      <th className="text-right py-1.5 pr-4 font-medium">Max (°)</th>
                      <th className="text-right py-1.5 pr-4 font-medium">Mean (°)</th>
                      <th className="text-right py-1.5 font-medium">ROM (°)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableJoints.map(j => {
                      const s = computeStats(motData.rows, j.key);
                      if (!s) return null;
                      return (
                        <tr key={j.key} className="border-b border-border/20 hover:bg-muted/10">
                          <td className="py-1.5 pr-4 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: j.color }} />
                            {j.label}
                          </td>
                          <td className="py-1.5 pr-4 text-right font-mono">{s.min}</td>
                          <td className="py-1.5 pr-4 text-right font-mono">{s.max}</td>
                          <td className="py-1.5 pr-4 text-right font-mono">{s.mean}</td>
                          <td className="py-1.5 text-right font-mono text-primary">{s.rom}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Chart */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-3">Joint Angles Over Time</p>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}s`} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={v => `${v}°`} width={40} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {availableJoints.map(j => (
                    <Line key={j.key} type="monotone" dataKey={j.key} name={j.label} stroke={j.color} strokeWidth={1.5} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}