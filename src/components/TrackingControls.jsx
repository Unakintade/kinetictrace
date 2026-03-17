import { Play, Square, RotateCcw, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function TrackingControls({
  isTracking,
  isCalibrated,
  trackingMode,
  onSetTrackingMode,
  onStartTracking,
  onStopTracking,
  onReset,
  dataPoints,
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Tracking</p>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={trackingMode === 'marker' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 gap-1.5 text-xs"
          onClick={() => onSetTrackingMode('marker')}
        >
          <Crosshair className="w-3 h-3" />
          Calibrate
        </Button>
        <Button
          variant={trackingMode === 'track' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 gap-1.5 text-xs"
          disabled={!isCalibrated}
          onClick={() => onSetTrackingMode('track')}
        >
          Track Object
        </Button>
      </div>

      {/* Start/Stop */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className={`flex-1 gap-2 ${isTracking ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'} text-primary-foreground`}
          disabled={trackingMode !== 'track' || !isCalibrated}
          onClick={isTracking ? onStopTracking : onStartTracking}
        >
          {isTracking ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {isTracking ? 'Stop' : 'Start'}
        </Button>
        <Button variant="outline" size="sm" onClick={onReset} title="Reset all">
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Stats */}
      {dataPoints > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-md border border-border/50">
          <span className="text-xs text-muted-foreground">Data points</span>
          <Badge variant="secondary" className="text-xs font-mono">{dataPoints}</Badge>
        </div>
      )}

      {!isCalibrated && (
        <p className="text-xs text-muted-foreground/70 text-center italic">
          Place 2 calibration markers first
        </p>
      )}
    </div>
  );
}