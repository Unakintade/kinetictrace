/**
 * KinematicsResults — joint angle chart, warnings panel, CSV export
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Download, AlertTriangle, CheckCircle2 } from 'lucide-react';

const JOINT_NAMES = [
  'torso_x','torso_z',
  'l_shoulder_x','l_shoulder_z','l_elbow',
  'r_shoulder_x','r_shoulder_z','r_elbow',
  'l_hip_x','l_hip_z','l_knee','l_ankle',
  'r_hip_x','r_hip_z','r_knee','r_ankle',
];

const KEY_JOINTS = ['l_hip_x','r_hip_x','l_knee','r_knee','l_ankle','r_ankle'];
const KEY_COLORS = { l_hip_x:'#22c55e', r_hip_x:'#f97316', l_knee:'#00e5ff', r_knee:'#a855f7', l_ankle:'#f472b6', r_ankle:'#facc15' };

export default function KinematicsResults({ qposHistory, angVels, warnings, fps, csvUrl, onSeek }) {
  if (!qposHistory?.length) return null;

  // Build chart data (downsample to 200 pts max)
  const stride = Math.max(1, Math.floor(qposHistory.length / 200));
  const chartData = qposHistory
    .filter((_, i) => i % stride === 0)
    .map((qpos, i) => {
      const t = (i * stride / fps).toFixed(2);
      const row = { t };
      KEY_JOINTS.forEach((jname, ji) => {
        const idx = JOINT_NAMES.indexOf(jname);
        row[jname] = parseFloat(qpos[idx]?.toFixed(1) ?? '0');
      });
      return row;
    });

  return (
    <div className="space-y-4">
      {/* Warnings */}
      <div className={`rounded-lg border px-4 py-3 ${warnings?.length ? 'border-amber-500/40 bg-amber-500/5' : 'border-green-500/30 bg-green-500/5'}`}>
        <div className="flex items-center gap-2 mb-1">
          {warnings?.length
            ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          }
          <p className="text-xs font-semibold">
            {warnings?.length ? `${warnings.length} Physiological Warning(s)` : 'All joint velocities within physiological limits'}
          </p>
        </div>
        {warnings?.slice(0, 5).map((w, i) => (
          <p key={i} className="text-[11px] text-amber-300/80 font-mono pl-6">{w}</p>
        ))}
        {(warnings?.length ?? 0) > 5 && (
          <p className="text-[11px] text-muted-foreground pl-6">…and {warnings.length - 5} more</p>
        )}
      </div>

      {/* Chart */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Key Joint Angles (°)</p>
          {csvUrl && (
            <a href={csvUrl} download="sprint_kinematics.csv">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-primary/30 text-primary">
                <Download className="w-3 h-3" /> Export CSV
              </Button>
            </a>
          )}
        </div>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} onClick={d => d?.activeLabel && onSeek?.(parseFloat(d.activeLabel))}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 16%)" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(210 15% 55%)' }} label={{ value: 'time (s)', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: 'hsl(210 15% 55%)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(210 15% 55%)' }} label={{ value: 'angle (°)', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'hsl(210 15% 55%)' }} />
              <Tooltip contentStyle={{ background: 'hsl(220 18% 9%)', border: '1px solid hsl(220 15% 16%)', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {KEY_JOINTS.map(jn => (
                <Line key={jn} type="monotone" dataKey={jn} stroke={KEY_COLORS[jn]} dot={false} strokeWidth={1.5} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Frames solved" value={qposHistory.length} />
        <Stat label="Duration" value={`${(qposHistory.length / fps).toFixed(1)} s`} />
        <Stat label="Warnings" value={warnings?.length ?? 0} highlight={warnings?.length > 0} />
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className="bg-card/50 border border-border/40 rounded-lg px-3 py-2 text-center">
      <p className={`text-base font-mono font-semibold ${highlight ? 'text-amber-400' : 'text-foreground'}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}