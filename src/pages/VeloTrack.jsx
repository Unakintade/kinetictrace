import { useState, useRef, useCallback, useEffect } from 'react';
import VideoSource from '../components/VideoSource';
import VelocityCanvas from '../components/VelocityCanvas';
import MarkerSetup from '../components/MarkerSetup';
import TrackingControls from '../components/TrackingControls';
import VelocityGraph from '../components/VelocityGraph';
import StatsPanel from '../components/StatsPanel';
import { Activity } from 'lucide-react';

export default function VeloTrack() {
  const [videoSource, setVideoSource] = useState(null);
  const [markers, setMarkers] = useState([]); // calibration markers [{x,y}]
  const [realWorldDistance, setRealWorldDistance] = useState(1.0); // meters
  const [trackingMode, setTrackingMode] = useState('marker'); // 'marker' | 'track'
  const [isTracking, setIsTracking] = useState(false);
  const [trackedPoints, setTrackedPoints] = useState([]); // [{x, y, t}]
  const [velocityData, setVelocityData] = useState([]);

  const canvasRef = useRef(null);
  const trackingIntervalRef = useRef(null);
  const startTimeRef = useRef(null);

  // Compute pixels per meter from calibration markers
  const pixelsPerMeter = markers.length === 2
    ? Math.hypot(markers[1].x - markers[0].x, markers[1].y - markers[0].y) / realWorldDistance
    : null;

  const isCalibrated = markers.length === 2 && pixelsPerMeter > 0;

  // Compute velocity from tracked points
  const computeVelocity = useCallback((points) => {
    if (points.length < 2 || !pixelsPerMeter) return [];
    const data = [];
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const dt = p2.t - p1.t;
      if (dt <= 0) continue;
      const dx = (p2.x - p1.x) / pixelsPerMeter;
      const dy = (p2.y - p1.y) / pixelsPerMeter;
      const vx = dx / dt;
      const vy = dy / dt;
      const speed = Math.hypot(vx, vy);
      data.push({
        t: parseFloat(p2.t.toFixed(2)),
        vx: parseFloat(vx.toFixed(4)),
        vy: parseFloat(vy.toFixed(4)),
        speed: parseFloat(speed.toFixed(4)),
      });
    }
    return data;
  }, [pixelsPerMeter]);

  const addPoint = useCallback(({ x, y }) => {
    const now = (Date.now() - startTimeRef.current) / 1000;
    setTrackedPoints(prev => {
      const next = [...prev, { x, y, t: now }];
      setVelocityData(computeVelocity(next));
      return next;
    });
  }, [computeVelocity]);

  const handleCanvasClick = useCallback(({ x, y }) => {
    if (trackingMode === 'marker') {
      setMarkers(prev => {
        if (prev.length >= 2) return [{ x, y }];
        return [...prev, { x, y }];
      });
    } else if (trackingMode === 'track' && isTracking) {
      // Manual fallback click
      addPoint({ x, y });
    }
  }, [trackingMode, isTracking, addPoint]);

  const handleAutoTrackPoint = useCallback(({ x, y }) => {
    if (isTracking && trackingMode === 'track') {
      addPoint({ x, y });
    }
  }, [isTracking, trackingMode, addPoint]);

  const startTracking = () => {
    startTimeRef.current = Date.now();
    setIsTracking(true);
    setTrackedPoints([]);
    setVelocityData([]);
  };

  const stopTracking = () => {
    setIsTracking(false);
    clearInterval(trackingIntervalRef.current);
  };

  const handleReset = () => {
    stopTracking();
    setTrackedPoints([]);
    setVelocityData([]);
    setMarkers([]);
    setTrackingMode('marker');
  };

  const handleClearMarkers = () => {
    setMarkers([]);
  };

  return (
    <div className="min-h-screen bg-background font-inter">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Activity className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">VeloTrack CV</h1>
          <p className="text-xs text-muted-foreground">Object velocity analysis via computer vision</p>
        </div>
        {isTracking && (
          <div className="ml-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-xs text-destructive font-medium">Recording</span>
          </div>
        )}
      </header>

      <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-65px)]">
        {/* Left sidebar: controls */}
        <aside className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 p-5 flex flex-col gap-6 overflow-y-auto">
          <VideoSource onVideoReady={setVideoSource} />

          <div className="border-t border-border/30" />

          <MarkerSetup
            markers={markers}
            realWorldDistance={realWorldDistance}
            onRealWorldDistanceChange={setRealWorldDistance}
            onClearMarkers={handleClearMarkers}
          />

          <div className="border-t border-border/30" />

          <TrackingControls
            isTracking={isTracking}
            isCalibrated={isCalibrated}
            trackingMode={trackingMode}
            onSetTrackingMode={setTrackingMode}
            onStartTracking={startTracking}
            onStopTracking={stopTracking}
            onReset={handleReset}
            dataPoints={trackedPoints.length}
          />
        </aside>

        {/* Main area */}
        <main className="flex-1 flex flex-col gap-0 min-h-0 overflow-hidden">
          {/* Video canvas */}
          <div className="flex-1 min-h-0 p-4 flex items-center justify-center bg-background/50">
            {videoSource ? (
              <VelocityCanvas
                ref={canvasRef}
                videoSource={videoSource}
                trackingMode={trackingMode}
                markers={markers}
                trackedPoints={trackedPoints}
                isTracking={isTracking}
                onCanvasClick={handleCanvasClick}
                onAutoTrackPoint={handleAutoTrackPoint}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 text-center max-w-sm">
                <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center">
                  <Activity className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/70">No video loaded</p>
                  <p className="text-xs text-muted-foreground mt-1">Upload a video or start your webcam from the sidebar</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom: graph + stats */}
          <div className="h-64 border-t border-border/50 flex flex-col bg-card/30">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Velocity Graph</p>
              {velocityData.length > 0 && (
                <span className="text-xs text-muted-foreground font-mono">{velocityData.length} samples</span>
              )}
            </div>
            <div className="flex-1 min-h-0 px-2 pb-2">
              <VelocityGraph velocityData={velocityData} />
            </div>
          </div>

          {/* Stats row */}
          {velocityData.length >= 2 && (
            <div className="border-t border-border/50 px-4 py-3 bg-card/20">
              <StatsPanel velocityData={velocityData} pixelsPerMeter={pixelsPerMeter} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}