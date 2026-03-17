import { Trash2, Plus, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function MarkerSetup({ markers, realWorldDistance, onRealWorldDistanceChange, onClearMarkers }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Calibration Markers</p>
        {markers.length > 0 && (
          <button
            onClick={onClearMarkers}
            className="text-xs text-destructive/70 hover:text-destructive flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 bg-muted/40 rounded-lg border border-border/50">
        <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Click <strong className="text-foreground/70">2 points</strong> on the video canvas to define a known distance. Then enter the real-world distance below.
        </p>
      </div>

      {/* Marker list */}
      <div className="space-y-1.5">
        {markers.length === 0 && (
          <p className="text-xs text-muted-foreground italic text-center py-2">No markers placed yet</p>
        )}
        {markers.map((m, i) => (
          <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-secondary/50 rounded-md">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: i === 0 ? 'hsl(var(--chart-3))' : 'hsl(var(--chart-4))' }}
            />
            <span className="text-xs font-mono text-muted-foreground">
              M{i + 1}: ({Math.round(m.x)}, {Math.round(m.y)})
            </span>
          </div>
        ))}
        {markers.length === 2 && (
          <div className="text-xs text-primary/80 text-center pt-1">
            ✓ Calibration line set — {Math.round(Math.hypot(markers[1].x - markers[0].x, markers[1].y - markers[0].y))}px
          </div>
        )}
      </div>

      {/* Real-world distance input */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Real-world distance (meters)</label>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={realWorldDistance}
          onChange={e => onRealWorldDistanceChange(parseFloat(e.target.value) || 1)}
          className="h-8 text-sm bg-input border-border"
          placeholder="e.g. 1.0"
        />
      </div>
    </div>
  );
}