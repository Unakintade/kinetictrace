import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import VideoSource from '../components/VideoSource';
import VelocityCanvas from '../components/VelocityCanvas';
import MarkerSetup from '../components/MarkerSetup';
import TrackingControls from '../components/TrackingControls';
import VelocityGraph from '../components/VelocityGraph';
import StrideGraph from '../components/StrideGraph';
import GaitTimeline from '../components/GaitTimeline';
import AnkleChart from '../components/AnkleChart';
import StatsPanel from '../components/StatsPanel';
import JointAnglesChart from '../components/JointAnglesChart';
import ContactTimeChart from '../components/ContactTimeChart';
import AsymmetryPanel from '../components/AsymmetryPanel';
import VelocityAccelChart from '../components/VelocityAccelChart';
import { warpPoint } from '../hooks/useHomography';
import { analyseStrides } from '../hooks/useStrideAnalyser';
import { Activity } from 'lucide-react';

export default function VeloTrack() {
  const [videoSource, setVideoSource] = useState(null);
  const [markers, setMarkers] = useState([]); // calibration markers [{x,y}]
  const [realWorldDistance, setRealWorldDistance] = useState(1.0); // meters
  const [trackingMode, setTrackingMode] = useState('marker'); // 'marker' | 'track'
  const [isTracking, setIsTracking] = useState(false);
  const [trackedPoints, setTrackedPoints] = useState([]); // [{x, y, t}]
  const [velocityData, setVelocityData] = useState([]);
  const [seekTime, setSeekTime] = useState(null);
  const [poseHistory, setPoseHistory] = useState([]); // [{t, pose}]
  const [videoDims, setVideoDims] = useState({ w: 640, h: 360 });

  const PLAYBACK_RATE = 0.5; // half speed for detailed analysis

  const canvasRef = useRef(null);
  const trackingIntervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const loopTimeOffsetRef = useRef(0); // accumulated duration across video loops
  const lastVideoTimeRef = useRef(0);  // to detect loop resets

  // Compute pixels per meter from calibration markers
  const pixelsPerMeter = markers.length === 2
    ? Math.hypot(markers[1].x - markers[0].x, markers[1].y - markers[0].y) / realWorldDistance
    : null;

  const isCalibrated = markers.length === 2 && pixelsPerMeter > 0;

  // Compute velocity from tracked points, applying homography warp correction
  const computeVelocity = useCallback((points) => {
    if (points.length < 2 || !pixelsPerMeter) return [];
    const geo = canvasRef.current?.getCameraGeo?.();
    const { w, h } = videoDims;
    const raw = [];
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const dt = p2.t - p1.t;
      if (dt < 0.01) continue;

      const w1 = geo
        ? warpPoint(p1.x, p1.y, w, h, geo.tiltAngle, geo.pitchFactor, geo.vanishingPoint)
        : p1;
      const w2 = geo
        ? warpPoint(p2.x, p2.y, w, h, geo.tiltAngle, geo.pitchFactor, geo.vanishingPoint)
        : p2;

      const dx = (w2.x - w1.x) / pixelsPerMeter;
      const dy = (w2.y - w1.y) / pixelsPerMeter;
      const vx = dx / dt;
      const vy = dy / dt;
      const speed = Math.hypot(vx, vy);
      raw.push({
        t: parseFloat(p2.t.toFixed(2)),
        vx: parseFloat(vx.toFixed(4)),
        vy: parseFloat(vy.toFixed(4)),
        speed: parseFloat(speed.toFixed(4)),
      });
    }

    // IQR outlier filter on speed — remove spikes beyond Q3 + 1.5×IQR
    if (raw.length >= 4) {
      const sorted = [...raw.map(d => d.speed)].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const upper = q3 + 1.5 * iqr;
      return raw.filter(d => d.speed <= upper);
    }
    return raw;
  }, [pixelsPerMeter, videoDims]);

  // Compute stride analysis from pose history
  const strideAnalysis = useMemo(() => {
    return analyseStrides(poseHistory, pixelsPerMeter, videoDims);
  }, [poseHistory, pixelsPerMeter, videoDims]);

  const getVideoTime = useCallback(() => {
    const video = canvasRef.current?.getVideo?.();
    if (video && !video.srcObject) {
      const ct = video.currentTime;
      // Detect loop: currentTime jumped backwards significantly → new loop
      if (lastVideoTimeRef.current - ct > 0.5) {
        loopTimeOffsetRef.current += lastVideoTimeRef.current;
      }
      lastVideoTimeRef.current = ct;
      return loopTimeOffsetRef.current + ct;
    }
    // webcam: wall-clock elapsed in seconds
    return (Date.now() - startTimeRef.current) / 1000;
  }, []);

  const handlePoseDetected = useCallback((pose) => {
    const now = getVideoTime();
    setPoseHistory(prev => [...prev, { t: now, pose }]);
  }, [getVideoTime]);

  const addPoint = useCallback(({ x, y }) => {
    const t = getVideoTime();
    setTrackedPoints(prev => {
      const next = [...prev, { x, y, t }];
      setVelocityData(computeVelocity(next));
      return next;
    });
  }, [computeVelocity, getVideoTime]);

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

  const handleSeek = (t) => {
    canvasRef.current?.seekTo?.(t);
    setSeekTime(t);
  };

  const startTracking = () => {
    startTimeRef.current = Date.now();
    loopTimeOffsetRef.current = 0;
    lastVideoTimeRef.current = 0;
    const video = canvasRef.current?.getVideo?.();
    if (video) {
      video.playbackRate = PLAYBACK_RATE;
      video.currentTime = 0;
    }
    setIsTracking(true);
    setTrackedPoints([]);
    setVelocityData([]);
    setPoseHistory([]);
  };

  const stopTracking = () => {
    setIsTracking(false);
    clearInterval(trackingIntervalRef.current);
    const video = canvasRef.current?.getVideo?.();
    if (video) video.playbackRate = 1.0;
  };

  const handleReset = () => {
    stopTracking(); // stopTracking already resets playbackRate to 1.0
    setTrackedPoints([]);
    setVelocityData([]);
    setMarkers([]);
    setPoseHistory([]);
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
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-mono border border-border/60 rounded px-2 py-0.5">
              {PLAYBACK_RATE}× speed
            </span>
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-xs text-destructive font-medium">Recording</span>
          </div>
        )}
      </header>

      <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-65px)]">
        {/* Left sidebar: controls */}
        <aside className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 p-5 flex flex-col gap-6 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
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
        <main className="flex-1 flex flex-col gap-0 overflow-y-auto">
          {/* Video canvas */}
          <div className="p-4 flex items-center justify-center bg-background/50" style={{ minHeight: '400px' }}>
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
                onPoseDetected={handlePoseDetected}
                onVideoDims={setVideoDims}
                stanceEvents={strideAnalysis.stanceEvents}
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

          {/* Row 1: Velocity + Stride + Ankle */}
          <div className="border-t border-border/50 bg-card/30">
            <div className="flex" style={{ height: '14rem' }}>
              {/* Velocity graph */}
              <div className="flex-1 flex flex-col border-r border-border/50">
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Velocity</p>
                  {velocityData.length > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">{velocityData.length} pts</span>
                  )}
                </div>
                <div className="flex-1 min-h-0 px-2 pb-2">
                  <VelocityGraph velocityData={velocityData} onSeek={handleSeek} seekTime={seekTime} />
                </div>
              </div>
              {/* Stride graph */}
              <div className="flex-1 flex flex-col border-r border-border/50">
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Stride Analysis</p>
                  {strideAnalysis.strideMetrics.length > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {strideAnalysis.stanceEvents.length} contacts
                    </span>
                  )}
                </div>
                <div className="flex-1 min-h-0 px-2 pb-2">
                  <StrideGraph
                    windowedMetrics={strideAnalysis.windowedMetrics}
                    strideMetrics={strideAnalysis.strideMetrics}
                    onSeek={handleSeek}
                    seekTime={seekTime}
                    strideDebug={strideAnalysis.strideDebug}
                  />
                </div>
              </div>
              {/* Ankle position chart */}
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Ankle Position</p>
                  {poseHistory.length > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">{poseHistory.length} frames</span>
                  )}
                </div>
                <div className="flex-1 min-h-0 px-2 pb-2">
                  <AnkleChart poseHistory={poseHistory} onSeek={handleSeek} seekTime={seekTime} />
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Gait timeline */}
          <div className="border-t border-border/50 bg-card/30" style={{ height: '12rem' }}>
            <div className="flex items-center justify-between px-4 pt-2 pb-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Gait Cycle</p>
              {strideAnalysis.stanceEvents.length > 0 && (
                <span className="text-xs text-muted-foreground font-mono">stance / swing phases</span>
              )}
            </div>
            <div style={{ height: 'calc(12rem - 2rem)' }}>
              <GaitTimeline
                stanceEvents={strideAnalysis.stanceEvents}
                seekTime={seekTime}
                onSeek={handleSeek}
              />
            </div>
          </div>

          {/* Row 3: Joint Angles + Contact Time + Asymmetry + Velocity/Accel */}
          <div className="flex border-t border-border/50 bg-card/20" style={{ height: '16rem' }}>
            {/* Joint Angles */}
            <div className="flex-1 flex flex-col border-r border-border/50">
              <div className="px-4 pt-2 pb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Joint Angles</p>
              </div>
              <div className="flex-1 min-h-0 px-2 pb-2">
                <JointAnglesChart jointAngles={strideAnalysis.jointAngles} onSeek={handleSeek} seekTime={seekTime} />
              </div>
            </div>
            {/* Ground Contact Time */}
            <div className="flex-1 flex flex-col border-r border-border/50">
              <div className="px-4 pt-2 pb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Contact Time</p>
              </div>
              <div className="flex-1 min-h-0 px-2 pb-2">
                <ContactTimeChart
                  leftContactDurations={strideAnalysis.leftContactDurations}
                  rightContactDurations={strideAnalysis.rightContactDurations}
                  onSeek={handleSeek}
                  seekTime={seekTime}
                />
              </div>
            </div>
            {/* Asymmetry */}
            <div className="flex-1 flex flex-col border-r border-border/50">
              <div className="px-4 pt-2 pb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Asymmetry</p>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <AsymmetryPanel asymmetry={strideAnalysis.asymmetry} />
              </div>
            </div>
            {/* Velocity & Acceleration */}
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-2 pb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Velocity & Accel</p>
              </div>
              <div className="flex-1 min-h-0">
                <VelocityAccelChart
                  velocityData={strideAnalysis.velocityData}
                  peakSpeed={strideAnalysis.peakSpeed}
                  avgSpeed={strideAnalysis.avgSpeed}
                  onSeek={handleSeek}
                  seekTime={seekTime}
                />
              </div>
            </div>
          </div>

          {/* Stats row: show when we have velocity (from points or pose) or stride metrics */}
          {((velocityData.length >= 2 || (strideAnalysis.velocityData?.length ?? 0) >= 2) || strideAnalysis.strideMetrics.length > 0) && (
            <div className="border-t border-border/50 px-4 py-3 bg-card/20">
              <StatsPanel
                velocityData={velocityData.length >= 2 ? velocityData : (strideAnalysis.velocityData ?? [])}
                pixelsPerMeter={pixelsPerMeter}
                strideMetrics={strideAnalysis.strideMetrics}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}