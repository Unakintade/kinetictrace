/**
 * SprintKinematics — Full pipeline page
 *
 * Pipeline:
 *   1. VideoProcessor  → raw landmark frames (MoveNet)
 *   2. Kalman Filter   → smoothed landmark frames
 *   3. Anthropometric scaling → MuJoCo limb scale
 *   4. Sliding-window IK → qpos history
 *   5. KinematicsCanvas → side-by-side video + physics figure
 *   6. KinematicsResults → charts, warnings, CSV export
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Cpu, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import usePoseDetector from '@/hooks/usePoseDetector';
import useMuJoCoIK, { computeAnthropometrics, solveWindowIK, computeAngularVelocities, exportKinematicsCSV } from '@/hooks/useMuJoCoIK';
import { batchKalmanFilter } from '@/hooks/useKalmanFilter';

import VideoProcessor from '@/components/kinematics/VideoProcessor';
import KinematicsCanvas from '@/components/kinematics/KinematicsCanvas';
import KinematicsResults from '@/components/kinematics/KinematicsResults';

const WINDOW = 20;
const DEFAULT_PPM = 200; // pixels per meter default (user can override)

// Pipeline stage labels
const STAGES = ['idle', 'scanning', 'filtering', 'scaling', 'solving', 'done'];

export default function SprintKinematics() {
  const { ready: poseReady, detectPerson } = usePoseDetector();
  const { ready: mjReady, initModel } = useMuJoCoIK();

  // Pipeline state
  const [stage, setStage] = useState('idle'); // idle|scanning|filtering|scaling|solving|done
  const [progress, setProgress] = useState(0);
  const [solveProgress, setSolveProgress] = useState(0);
  const [warnings, setWarnings] = useState([]);

  // User inputs
  const [ppm, setPpm] = useState(DEFAULT_PPM);
  const [fps, setFps] = useState(30);

  // Data
  const [rawFrames, setRawFrames] = useState([]);
  const [filteredFrames, setFilteredFrames] = useState([]);
  const [scale, setScale] = useState(null);
  const [qposHistory, setQposHistory] = useState([]);
  const [angVels, setAngVels] = useState([]);
  const [csvUrl, setCsvUrl] = useState(null);

  // Playback
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playTimerRef = useRef(null);
  const videoRef = useRef(null);

  // Detector ref (raw, for VideoProcessor which uses estimatePoses directly)
  const detectorRef = useRef(null);
  useEffect(() => {
    // Grab the underlying detector by calling detectPerson with a dummy image once ready
    if (poseReady) {
      // Access the shared detector via a re-import trick
      import('@tensorflow-models/pose-detection').then(pd => {
        pd.createDetector(pd.SupportedModels.MoveNet, {
          modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER,
          enableSmoothing: false,
        }).then(d => { detectorRef.current = d; });
      });
    }
  }, [poseReady]);

  // Playback loop
  useEffect(() => {
    clearInterval(playTimerRef.current);
    if (playing && qposHistory.length > 0) {
      playTimerRef.current = setInterval(() => {
        setFrameIdx(i => {
          if (i >= qposHistory.length - 1) { setPlaying(false); return i; }
          return i + 1;
        });
      }, 1000 / fps);
    }
    return () => clearInterval(playTimerRef.current);
  }, [playing, fps, qposHistory.length]);

  const handleFramesReady = useCallback(async (frames, detectedFps, videoDims) => {
    setRawFrames(frames);
    setFps(detectedFps);
    setStage('filtering');
    setProgress(0);

    // 1. Kalman filter
    const filtered = batchKalmanFilter(frames);
    setFilteredFrames(filtered);
    setStage('scaling');

    // 2. Anthropometric scaling from first 10 frames
    const first10 = filtered.slice(0, 10);
    const anthropo = computeAnthropometrics(first10, ppm);
    setScale(anthropo);
    initModel(anthropo);

    // 3. Sliding-window IK
    setStage('solving');
    const totalWindows = Math.ceil(filtered.length / WINDOW);
    const allQpos = [];
    let prevQpos = null;

    for (let w = 0; w < filtered.length; w += WINDOW) {
      const windowResult = solveWindowIK(filtered, ppm, anthropo, w, prevQpos);
      allQpos.push(...windowResult);
      prevQpos = windowResult[windowResult.length - 1];
      setSolveProgress((w / filtered.length));
      // Yield to UI every few windows
      if (w % (WINDOW * 3) === 0) await new Promise(res => setTimeout(res, 0));
    }

    // Trim to exact frame count
    const finalQpos = allQpos.slice(0, filtered.length);
    setQposHistory(finalQpos);

    // 4. Angular velocities + physiological warnings
    const { angVels: av, warnings: warns } = computeAngularVelocities(finalQpos, detectedFps);
    setAngVels(av);
    setWarnings(warns);

    // 5. CSV
    const url = exportKinematicsCSV(filtered, finalQpos, av, [], detectedFps);
    setCsvUrl(url);

    setStage('done');
    setFrameIdx(0);
    setProgress(1);
    setSolveProgress(1);
  }, [ppm, initModel]);

  const handleSeek = (t) => {
    const idx = Math.round(t * fps);
    setFrameIdx(Math.max(0, Math.min(qposHistory.length - 1, idx)));
  };

  const stageLabel = {
    idle: 'Upload a video to begin',
    scanning: 'Scanning video with MoveNet…',
    filtering: 'Applying Kalman filter…',
    scaling: 'Computing anthropometric scale…',
    solving: `Solving sliding-window IK… ${Math.round(solveProgress * 100)}%`,
    done: `Done — ${qposHistory.length} frames solved`,
  }[stage];

  const isProcessing = ['scanning','filtering','scaling','solving'].includes(stage);

  return (
    <div className="min-h-screen bg-background font-inter flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center gap-3">
        <Link to="/VeloTrack" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Cpu className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">Sprint Kinematics</h1>
          <p className="text-xs text-muted-foreground">MoveNet + Kalman Filter + MuJoCo sliding-window IK</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${poseReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
          <span className="text-muted-foreground">{poseReady ? 'MoveNet ready' : 'Loading AI…'}</span>
          <span className="text-border mx-1">|</span>
          <span className={`w-2 h-2 rounded-full ${mjReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
          <span className="text-muted-foreground">{mjReady ? 'MuJoCo ready' : 'Loading WASM…'}</span>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 p-5 flex flex-col gap-5 lg:overflow-y-auto">
          {/* Video upload + scan */}
          <VideoProcessor
            detector={detectorRef.current}
            onFramesReady={handleFramesReady}
            onProgress={setProgress}
            disabled={isProcessing || !poseReady}
          />

          {/* Calibration */}
          <div className="border-t border-border/30 pt-4 space-y-3">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Calibration</p>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Pixels per meter</label>
              <Input
                type="number"
                value={ppm}
                onChange={e => setPpm(Math.max(10, parseFloat(e.target.value) || DEFAULT_PPM))}
                className="h-7 text-xs font-mono"
                min={10}
              />
              <p className="text-[10px] text-muted-foreground/60">
                Measure a known distance in your video to calibrate
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Video FPS</label>
              <Input
                type="number"
                value={fps}
                onChange={e => setFps(Math.max(1, parseInt(e.target.value) || 30))}
                className="h-7 text-xs font-mono"
                min={1} max={240}
              />
            </div>
          </div>

          {/* Anthropometric scale display */}
          {scale && (
            <div className="border-t border-border/30 pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-2">Detected Scale (m)</p>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {Object.entries(scale).map(([k, v]) => (
                  <div key={k} className="flex justify-between bg-card/40 rounded px-2 py-1">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-mono text-foreground">{v.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pipeline status */}
          {stage !== 'idle' && (
            <div className="border-t border-border/30 pt-4 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Pipeline</p>
              {['scanning','filtering','scaling','solving','done'].map((s, i) => {
                const stageIdx = STAGES.indexOf(stage);
                const sIdx = STAGES.indexOf(s);
                const done = sIdx < stageIdx || stage === 'done';
                const active = s === stage && stage !== 'done';
                return (
                  <div key={s} className={`flex items-center gap-2 text-xs ${done ? 'text-green-400' : active ? 'text-primary' : 'text-muted-foreground/40'}`}>
                    {active ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                    {active && stage === 'scanning' && ` ${Math.round(progress * 100)}%`}
                    {active && stage === 'solving' && ` ${Math.round(solveProgress * 100)}%`}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col gap-0 overflow-y-auto p-4 space-y-4">
          {/* Status banner */}
          <div className={`rounded-lg border px-4 py-2 text-xs flex items-center gap-2 ${
            stage === 'done' ? 'border-green-500/30 bg-green-500/5 text-green-400'
            : isProcessing ? 'border-primary/30 bg-primary/5 text-primary'
            : 'border-border/40 text-muted-foreground'
          }`}>
            {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {stageLabel}
          </div>

          {/* Side-by-side canvas */}
          <KinematicsCanvas
            videoRef={videoRef}
            currentFrameIdx={frameIdx}
            filteredFrames={filteredFrames}
            qposHistory={qposHistory}
            scale={scale}
          />

          {/* Playback controls */}
          {qposHistory.length > 0 && (
            <div className="flex items-center gap-3 bg-card/30 rounded-lg border border-border/40 px-4 py-3">
              <Button
                size="sm"
                variant={playing ? 'outline' : 'default'}
                onClick={() => setPlaying(p => !p)}
                className="h-7 text-xs px-3"
              >
                {playing ? '⏸ Pause' : '▶ Play'}
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(0, qposHistory.length - 1)}
                value={frameIdx}
                onChange={e => { setFrameIdx(parseInt(e.target.value)); setPlaying(false); }}
                className="flex-1 accent-primary"
              />
              <span className="text-xs font-mono text-muted-foreground w-24 text-right">
                {(frameIdx / fps).toFixed(2)}s / {(qposHistory.length / fps).toFixed(2)}s
              </span>
            </div>
          )}

          {/* Results */}
          <KinematicsResults
            qposHistory={qposHistory}
            angVels={angVels}
            warnings={warnings}
            fps={fps}
            csvUrl={csvUrl}
            onSeek={handleSeek}
          />
        </main>
      </div>
    </div>
  );
}