import { useState, useRef, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useSession } from '@/lib/SessionContext';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Save, Trash2, Download, Upload, ChevronLeft, ChevronRight, SkipBack, SkipForward, Cpu, CheckCircle2 } from 'lucide-react';
import GaitPhaseSelector from '@/components/GaitPhaseSelector';
import GaitLabelTimeline from '@/components/GaitLabelTimeline';
import AngleGauges from '@/components/AngleGauges';
import { GAIT_PHASES, getPhaseColor, getPhaseLabel } from '@/lib/gaitPhases';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import usePoseDetector from '@/hooks/usePoseDetector';
import ReviewVideo from '@/components/ReviewVideo';

function computeAngle(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by;
  const v2x = cx - bx, v2y = cy - by;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (mag === 0) return null;
  return parseFloat((Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)).toFixed(1));
}

function anglesFromPose(pose) {
  if (!pose) return null;
  const { leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle } = pose;
  const ok = kp => kp && kp.score > 0.15;
  return {
    leftKnee:  ok(leftHip)  && ok(leftKnee)  && ok(leftAnkle)  ? computeAngle(leftHip.x,  leftHip.y,  leftKnee.x,  leftKnee.y,  leftAnkle.x,  leftAnkle.y)  : null,
    rightKnee: ok(rightHip) && ok(rightKnee) && ok(rightAnkle) ? computeAngle(rightHip.x, rightHip.y, rightKnee.x, rightKnee.y, rightAnkle.x, rightAnkle.y) : null,
    leftHip:   ok(leftHip)  && ok(leftKnee)                    ? computeAngle(leftHip.x,  leftHip.y  - 100, leftHip.x,  leftHip.y,  leftKnee.x,  leftKnee.y)  : null,
    rightHip:  ok(rightHip) && ok(rightKnee)                   ? computeAngle(rightHip.x, rightHip.y - 100, rightHip.x, rightHip.y, rightKnee.x, rightKnee.y) : null,
  };
}

/** Infer gait phase from ankle Y and knee angle — simple heuristic */
function inferPhase(ankleYNorm, kneeAngle) {
  // ankleYNorm: 0 = highest (flight), 1 = lowest (ground contact)
  if (ankleYNorm === null) return null;
  if (ankleYNorm > 0.7) {
    // Ankle is low → stance
    if (kneeAngle !== null && kneeAngle < 155) return 'mid_stance';
    return 'touch_down';
  }
  if (ankleYNorm > 0.45) return 'toe_off';
  if (ankleYNorm > 0.25) return 'early_flight';
  if (ankleYNorm > 0.1)  return 'mid_flight';
  return 'late_flight';
}

const PHASE_KEYS = {
  q: { leg: 'left',  phase: 'touch_down'   },
  w: { leg: 'left',  phase: 'mid_stance'   },
  e: { leg: 'left',  phase: 'toe_off'      },
  r: { leg: 'left',  phase: 'early_flight' },
  t: { leg: 'left',  phase: 'mid_flight'   },
  y: { leg: 'left',  phase: 'late_flight'  },
  a: { leg: 'right', phase: 'touch_down'   },
  s: { leg: 'right', phase: 'mid_stance'   },
  d: { leg: 'right', phase: 'toe_off'      },
  f: { leg: 'right', phase: 'early_flight' },
  g: { leg: 'right', phase: 'mid_flight'   },
  h: { leg: 'right', phase: 'late_flight'  },
};

// How many scan passes before entering review mode
const SCAN_PASSES = 2;
const SCAN_INTERVAL_MS = 80; // ms between sampled frames during scan

export default function GaitLabeler() {
  const { videoFile: sharedVideoFile, videoUrl: sharedVideoUrl, loadVideo, upsertSession, removeSession, activeGaitSession, setActiveGaitSession } = useSession();

  const videoRef = useRef(null);
  // Use shared video if available; local state for when user uploads directly here
  const [videoFile, setVideoFile] = useState(sharedVideoFile);
  const [videoUrl, setVideoUrl] = useState(sharedVideoUrl);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrame, setCurrentFrame] = useState({ leftPhase: null, rightPhase: null });
  const [currentAngles, setCurrentAngles] = useState(null);
  const { ready: poseReady, detectPerson } = usePoseDetector();
  const poseDetectRef = useRef(null);
  const [labeledFrames, setLabeledFrames] = useState([]);
  const [videoName, setVideoName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  // Sessions are managed by SessionContext; keep a local alias for selected session
  const savedSessions = useSession().allGaitSessions;
  const [selectedSession, setSelectedSession] = useState(activeGaitSession);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const frameStepRef = useRef(1 / 30);

  // ── Auto-scan state ─────────────────────────────────────────────────────
  // 'idle' | 'waiting' | 'scanning' | 'review'
  const [scanPhase, setScanPhase] = useState('idle');
  const [scanPass, setScanPass] = useState(0);       // 0-based current pass
  const [scanProgress, setScanProgress] = useState(0); // 0–1
  const scanFramesRef = useRef([]);  // accumulated raw frames [{t, pose, angles}]
  const scanTimerRef = useRef(null);
  const scanPassRef = useRef(0);



  // Handle video file upload
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopScan();
    setVideoFile(file);
    setVideoName(file.name);
    loadVideo(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setLabeledFrames([]);
    setCurrentFrame({ leftPhase: null, rightPhase: null });
    setScanPhase('idle');
    scanFramesRef.current = [];
    scanPassRef.current = 0;
  };

  const handleVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    frameStepRef.current = Math.min(1 / 24, v.duration / 500);
    v.currentTime = 0;
    // Kick off scan once AI is ready
    setScanPhase('waiting');
  };

  // Watch for poseReady + waiting → start scan
  useEffect(() => {
    if (poseReady && scanPhase === 'waiting') {
      startScan();
    }
  }, [poseReady, scanPhase]);

  // ── Scan logic ──────────────────────────────────────────────────────────

  const stopScan = useCallback(() => {
    clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
  }, []);

  const startScan = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    scanPassRef.current = 0;
    scanFramesRef.current = [];
    setScanPass(0);
    setScanProgress(0);
    setScanPhase('scanning');

    // Step through video frame by frame via currentTime
    const step = SCAN_INTERVAL_MS / 1000; // seconds per sample
    let t = 0;

    const tick = async () => {
      const video = videoRef.current;
      if (!video) return;
      const dur = video.duration;

      if (t > dur) {
        // Finished one pass
        const nextPass = scanPassRef.current + 1;
        if (nextPass < SCAN_PASSES) {
          scanPassRef.current = nextPass;
          setScanPass(nextPass);
          t = 0;
          video.currentTime = 0;
        } else {
          // All passes done → build auto-labels
          finishScan();
          return;
        }
      }

      video.currentTime = t;
      setScanProgress(((scanPassRef.current + t / dur) / SCAN_PASSES));

      // Wait for seek to settle, then detect
      await new Promise(res => setTimeout(res, 40));
      if (video.readyState >= 2) {
        const pose = await detectPerson(video);
        if (pose) {
          const angles = anglesFromPose(pose);
          scanFramesRef.current.push({ t: parseFloat(t.toFixed(3)), pose, angles });
        }
      }
      t = parseFloat((t + step).toFixed(3));
    };

    scanTimerRef.current = setInterval(async () => {
      clearInterval(scanTimerRef.current); // prevent overlap
      await tick();
      // restart interval for next tick
      scanTimerRef.current = setInterval(arguments.callee, SCAN_INTERVAL_MS);
    }, SCAN_INTERVAL_MS);
  }, [detectPerson]);

  // Cleaner recursive approach (avoids setInterval re-entrant issues)
  useEffect(() => {
    if (scanPhase !== 'scanning') return;
    stopScan();

    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    scanPassRef.current = 0;
    scanFramesRef.current = [];
    setScanPass(0);
    setScanProgress(0);

    const step = SCAN_INTERVAL_MS / 1000;
    let t = 0;
    let cancelled = false;

    const runFrame = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;
      const dur = video.duration || duration;

      if (t > dur + 0.001) {
        const nextPass = scanPassRef.current + 1;
        if (nextPass < SCAN_PASSES) {
          scanPassRef.current = nextPass;
          setScanPass(nextPass);
          t = 0;
        } else {
          finishScan();
          return;
        }
      }

      video.currentTime = t;
      setScanProgress((scanPassRef.current + Math.min(t / Math.max(dur, 0.001), 1)) / SCAN_PASSES);

      // Wait for video frame to settle
      await new Promise(res => setTimeout(res, 60));
      if (cancelled) return;

      if (video.readyState >= 2) {
        try {
          const pose = await detectPerson(video);
          if (pose) {
            const angles = anglesFromPose(pose);
            scanFramesRef.current.push({ t: parseFloat(t.toFixed(3)), pose, angles });
          }
        } catch (_) {}
      }

      t = parseFloat((t + step).toFixed(3));
      if (!cancelled) setTimeout(runFrame, 10);
    };

    runFrame();
    return () => { cancelled = true; };
  }, [scanPhase]); // only re-run when scanPhase transitions to 'scanning'

  const finishScan = useCallback(() => {
    setScanPhase('review');
    setScanProgress(1);

    const raw = scanFramesRef.current;
    if (!raw.length) return;

    // Normalise ankle Y per leg across all frames
    const leftYs  = raw.map(f => f.pose?.leftAnkle?.y  ?? null).filter(y => y !== null);
    const rightYs = raw.map(f => f.pose?.rightAnkle?.y ?? null).filter(y => y !== null);
    const minLY = Math.min(...leftYs),  maxLY = Math.max(...leftYs);
    const minRY = Math.min(...rightYs), maxRY = Math.max(...rightYs);
    const normY = (y, mn, mx) => mx > mn ? (y - mn) / (mx - mn) : null;

    // Build one estimated label per sampled frame, merging better confidence
    const frameMap = new Map(); // t → entry
    for (const f of raw) {
      const t = f.t;
      const la = f.pose?.leftAnkle;
      const ra = f.pose?.rightAnkle;
      const lYN = la ? normY(la.y, minLY, maxLY) : null;
      const rYN = ra ? normY(ra.y, minRY, maxRY) : null;
      const leftPhase  = inferPhase(lYN, f.angles?.leftKnee);
      const rightPhase = inferPhase(rYN, f.angles?.rightKnee);

      const existing = frameMap.get(t);
      const conf = (f.pose?.leftAnkle?.score ?? 0) + (f.pose?.rightAnkle?.score ?? 0);
      if (!existing || conf > existing._conf) {
        frameMap.set(t, {
          t,
          leftPhase,
          rightPhase,
          leftKneeAngle:  f.angles?.leftKnee  ?? null,
          rightKneeAngle: f.angles?.rightKnee ?? null,
          leftHipAngle:   f.angles?.leftHip   ?? null,
          rightHipAngle:  f.angles?.rightHip  ?? null,
          _conf: conf,
          _estimated: true,
        });
      }
    }

    const frames = [...frameMap.values()]
      .filter(f => f.leftPhase || f.rightPhase)
      .sort((a, b) => a.t - b.t)
      .map(({ _conf, ...rest }) => rest);

    setLabeledFrames(frames);

    // Seek back to start
    const v = videoRef.current;
    if (v) { v.currentTime = 0; }
  }, []);

  // ── Manual interaction (review mode) ────────────────────────────────────

  const runPoseDetection = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !poseReady || v.readyState < 2) return;
    const pose = await detectPerson(v);
    if (!pose) return;
    setCurrentAngles(anglesFromPose(pose));
  }, [poseReady, detectPerson]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || scanPhase === 'scanning') return;
    const t = parseFloat(v.currentTime.toFixed(3));
    setCurrentTime(t);
    const existing = labeledFrames.find(f => Math.abs(f.t - t) < 0.02);
    if (existing) setCurrentFrame({ leftPhase: existing.leftPhase, rightPhase: existing.rightPhase });
    clearTimeout(poseDetectRef.current);
    poseDetectRef.current = setTimeout(runPoseDetection, 80);
  };

  const stepFrame = useCallback((direction) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(duration, v.currentTime + direction * frameStepRef.current));
  }, [duration]);

  const seekTo = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(duration, t));
  }, [duration]);

  const labelFrame = useCallback((leg, phase) => {
    const t = parseFloat(videoRef.current?.currentTime?.toFixed(3) ?? '0');
    const angles = currentAngles;
    let autoOtherPhase = null;
    if (phase === 'mid_flight') autoOtherPhase = 'mid_flight';

    setCurrentFrame(prev => ({
      leftPhase:  leg === 'left'  ? phase : (autoOtherPhase ?? prev.leftPhase),
      rightPhase: leg === 'right' ? phase : (autoOtherPhase ?? prev.rightPhase),
    }));

    setLabeledFrames(prev => {
      const idx = prev.findIndex(f => Math.abs(f.t - t) < 0.02);
      const entry = {
        t,
        leftPhase:  leg === 'left'  ? phase : (autoOtherPhase ?? (prev[idx]?.leftPhase ?? null)),
        rightPhase: leg === 'right' ? phase : (autoOtherPhase ?? (prev[idx]?.rightPhase ?? null)),
        leftKneeAngle:  angles?.leftKnee  ?? prev[idx]?.leftKneeAngle  ?? null,
        rightKneeAngle: angles?.rightKnee ?? prev[idx]?.rightKneeAngle ?? null,
        leftHipAngle:   angles?.leftHip   ?? prev[idx]?.leftHipAngle   ?? null,
        rightHipAngle:  angles?.rightHip  ?? prev[idx]?.rightHipAngle  ?? null,
        _estimated: false,
      };
      if (idx >= 0) {
        const updated = [...prev]; updated[idx] = entry; return updated;
      }
      return [...prev, entry].sort((a, b) => a.t - b.t);
    });
  }, [currentAngles]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (scanPhase === 'scanning') return;
      const binding = PHASE_KEYS[e.key.toLowerCase()];
      if (binding) { e.preventDefault(); labelFrame(binding.leg, binding.phase); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); stepFrame(-1); }
      if (e.key === ' ')          { e.preventDefault(); videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const t = parseFloat(videoRef.current?.currentTime?.toFixed(3) ?? '0');
        setLabeledFrames(prev => prev.filter(f => Math.abs(f.t - t) >= 0.02));
        setCurrentFrame({ leftPhase: null, rightPhase: null });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [labelFrame, stepFrame, scanPhase]);

  const handleSave = async () => {
    if (!videoName || labeledFrames.length === 0) return;
    setIsSaving(true);
    try {
      const data = { video_name: videoName, frames: labeledFrames, video_duration: duration, notes: sessionNotes };
      let saved;
      if (selectedSession?.id) {
        saved = await base44.entities.GaitLabel.update(selectedSession.id, data);
      } else {
        saved = await base44.entities.GaitLabel.create(data);
      }
      setSelectedSession(saved);
      upsertSession(saved);
      setActiveGaitSession(saved);
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(null), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const loadSession = (session) => {
    setSelectedSession(session);
    setLabeledFrames(session.frames ?? []);
    setVideoName(session.video_name ?? '');
    setSessionNotes(session.notes ?? '');
    setDuration(session.video_duration ?? 0);
    setScanPhase('review');
  };

  const deleteSession = async (id) => {
    await base44.entities.GaitLabel.delete(id);
    setSavedSessions(prev => prev.filter(s => s.id !== id));
    if (selectedSession?.id === id) { setSelectedSession(null); setLabeledFrames([]); }
  };

  const exportCSV = () => {
    if (!labeledFrames.length) return;
    const header = 'time_s,left_phase,right_phase,left_knee_deg,right_knee_deg,left_hip_deg,right_hip_deg,estimated';
    const rows = labeledFrames.map(f =>
      `${f.t},${f.leftPhase ?? ''},${f.rightPhase ?? ''},${f.leftKneeAngle ?? ''},${f.rightKneeAngle ?? ''},${f.leftHipAngle ?? ''},${f.rightHipAngle ?? ''},${f._estimated ? '1' : '0'}`
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${videoName}_gait_labels.csv`;
    a.click();
  };

  const phaseCounts = GAIT_PHASES.reduce((acc, p) => {
    acc[p.id] = {
      left:  labeledFrames.filter(f => f.leftPhase  === p.id).length,
      right: labeledFrames.filter(f => f.rightPhase === p.id).length,
    };
    return acc;
  }, {});

  const estimatedCount = labeledFrames.filter(f => f._estimated).length;
  const correctedCount = labeledFrames.filter(f => !f._estimated).length;

  return (
    <div className="min-h-screen bg-background font-inter flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-3 flex items-center gap-3">
        <Link to="/VeloTrack" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Activity className="w-3.5 h-3.5 text-accent" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Gait Phase Labeler</h1>
          <p className="text-xs text-muted-foreground">Classify frames to calibrate the gait analyser</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {scanPhase === 'review' && estimatedCount > 0 && (
            <span className="text-xs text-accent border border-accent/30 rounded px-2 py-0.5">
              {estimatedCount} AI estimates · {correctedCount} corrected
            </span>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!labeledFrames.length}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || !labeledFrames.length}>
            <Save className="w-3.5 h-3.5 mr-1" />
            {isSaving ? 'Saving…' : saveMsg ?? 'Save Labels'}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-60 shrink-0 border-r border-border/50 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-border/30">
            <label className="flex flex-col items-center gap-2 border-2 border-dashed border-border/50 rounded-lg p-4 cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground text-center">Upload video to label</span>
              <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
            </label>
            {videoFile && <p className="text-xs text-primary mt-2 truncate">{videoFile.name}</p>}
          </div>

          <div className="p-3 border-b border-border/30">
            <p className="text-xs text-muted-foreground font-medium mb-2">Keyboard Shortcuts</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="font-mono text-green-400">Q–Y</span><span>Left leg phases</span>
              <span className="font-mono text-orange-400">A–H</span><span>Right leg phases</span>
              <span className="font-mono">← →</span><span>Step frame</span>
              <span className="font-mono">Space</span><span>Play/Pause</span>
              <span className="font-mono">Del</span><span>Remove label</span>
            </div>
          </div>

          <div className="flex-1 p-3">
            <p className="text-xs text-muted-foreground font-medium mb-2">Saved Sessions</p>
            {savedSessions.length === 0 && <p className="text-xs text-muted-foreground/60">No saved sessions yet</p>}
            <div className="space-y-1.5">
              {savedSessions.map(s => (
                <div
                  key={s.id}
                  className={`group relative rounded-lg border p-2 cursor-pointer transition-colors ${
                    selectedSession?.id === s.id ? 'border-primary/50 bg-primary/5' : 'border-border/40 hover:border-border'
                  }`}
                  onClick={() => loadSession(s)}
                >
                  <p className="text-xs font-medium truncate pr-5">{s.video_name}</p>
                  <p className="text-[10px] text-muted-foreground">{s.frames?.length ?? 0} frames</p>
                  <button
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    onClick={ev => { ev.stopPropagation(); deleteSession(s.id); }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {!videoUrl ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center mx-auto">
                  <Activity className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <p className="text-sm">Upload a video to start labeling</p>
                <p className="text-xs text-muted-foreground/60">AI will scan the video twice before asking for corrections</p>
              </div>
            </div>
          ) : (
            <>
              {/* ── Single persistent video — always in DOM ── */}
              {/* During scan: off-screen so ref is stable. During review: visible in-place. */}
              <video
                ref={videoRef}
                src={videoUrl}
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={handleTimeUpdate}
                playsInline
                muted
                style={scanPhase === 'review'
                  ? { display: 'none' }  // hidden here, shown below via a second element sync'd
                  : { position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, opacity: 0 }
                }
              />

              {/* Scan overlay */}
              {(scanPhase === 'waiting' || scanPhase === 'scanning') && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                  <div className="w-20 h-20 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <Cpu className="w-9 h-9 text-accent animate-pulse" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-semibold">
                      {scanPhase === 'waiting' ? 'Loading AI model…' : `Scanning video — pass ${scanPass + 1} of ${SCAN_PASSES}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {scanPhase === 'waiting'
                        ? 'AI pose model is initialising'
                        : 'Detecting poses and estimating gait phases automatically'}
                    </p>
                  </div>
                  {scanPhase === 'scanning' && (
                    <div className="w-72 space-y-2">
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-300 rounded-full"
                          style={{ width: `${Math.round(scanProgress * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{Math.round(scanProgress * 100)}%</span>
                        <span>{scanFramesRef.current.length} frames scanned</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Review mode ── */}
              {scanPhase === 'review' && (
                <>
                  {/* Scan complete banner */}
                  <div className="px-4 py-2 bg-accent/10 border-b border-accent/20 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                    <p className="text-xs text-accent font-medium">
                      AI scan complete — {labeledFrames.length} frames auto-labelled. Scrub through to review and correct any mistakes.
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => { stopScan(); setScanPhase('scanning'); }}
                    >
                      Re-scan
                    </Button>
                  </div>

                  {/* Video + controls */}
                  <div className="flex gap-4 p-4 border-b border-border/50">
                    <div className="flex-1 relative">
                      <ReviewVideo videoUrl={videoUrl} videoRef={videoRef} currentTime={currentTime} />
                      <div className="absolute top-2 left-2 flex gap-2">
                        <span className="bg-black/70 text-white text-xs font-mono px-2 py-0.5 rounded">
                          {currentTime.toFixed(3)}s / {duration.toFixed(2)}s
                        </span>
                        {(() => {
                          const cur = labeledFrames.find(f => Math.abs(f.t - currentTime) < 0.02);
                          if (!cur) return null;
                          return (
                            <span className={`text-xs font-mono px-2 py-0.5 rounded ${cur._estimated ? 'bg-accent/70 text-black' : 'bg-primary/80 text-black'}`}>
                              {cur._estimated ? '✦ Estimated' : '✓ Corrected'}
                            </span>
                          );
                        })()}
                      </div>
                      {(currentFrame.leftPhase || currentFrame.rightPhase) && (
                        <div className="absolute bottom-2 left-2 flex gap-2">
                          {currentFrame.leftPhase && (
                            <span className="text-xs px-2 py-0.5 rounded font-medium"
                              style={{ background: getPhaseColor(currentFrame.leftPhase), color: '#000' }}>
                              L: {getPhaseLabel(currentFrame.leftPhase)}
                            </span>
                          )}
                          {currentFrame.rightPhase && (
                            <span className="text-xs px-2 py-0.5 rounded font-medium"
                              style={{ background: getPhaseColor(currentFrame.rightPhase), color: '#000' }}>
                              R: {getPhaseLabel(currentFrame.rightPhase)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="w-80 shrink-0 flex flex-col gap-4">
                      <div className="space-y-1.5">
                        <Input value={videoName} onChange={e => setVideoName(e.target.value)} placeholder="Video name / ID" className="h-7 text-xs" />
                        <Textarea value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} placeholder="Session notes…" className="text-xs h-14 resize-none" />
                      </div>

                      <div className="bg-card/50 border border-border/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground font-medium">Correct Frame Classification</p>
                          <span className={`text-[10px] font-mono ${poseReady ? 'text-green-400' : 'text-yellow-400'}`}>
                            {poseReady ? '● AI Ready' : '● Loading AI…'}
                          </span>
                        </div>
                        <GaitPhaseSelector
                          leftPhase={currentFrame.leftPhase}
                          rightPhase={currentFrame.rightPhase}
                          onLeftChange={p => labelFrame('left', p)}
                          onRightChange={p => labelFrame('right', p)}
                        />
                      </div>

                      <div className="bg-card/50 border border-border/50 rounded-lg p-3">
                        <AngleGauges angles={currentAngles} />
                        {!currentAngles && (
                          <p className="text-[10px] text-muted-foreground/60 text-center py-1">
                            Angles appear when AI detects a person
                          </p>
                        )}
                      </div>

                      <div className="bg-card/30 border border-border/40 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground font-medium mb-2">Label Summary ({labeledFrames.length} frames)</p>
                        <div className="grid grid-cols-3 gap-1">
                          {GAIT_PHASES.map(p => (
                            <div key={p.id} className="text-center">
                              <div className="w-3 h-3 rounded-sm mx-auto mb-0.5" style={{ background: p.color }} />
                              <p className="text-[9px] text-muted-foreground leading-none">{p.label.split(' ')[0]}</p>
                              <p className="text-[10px] font-mono text-foreground">
                                {phaseCounts[p.id].left}L / {phaseCounts[p.id].right}R
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Scrubber */}
                  <div className="px-4 py-2 border-b border-border/30 flex items-center gap-3">
                    <button onClick={() => seekTo(0)} className="text-muted-foreground hover:text-foreground"><SkipBack className="w-4 h-4" /></button>
                    <button onClick={() => stepFrame(-1)} className="text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
                    <input
                      type="range" min={0} max={duration} step={frameStepRef.current} value={currentTime}
                      onChange={e => seekTo(parseFloat(e.target.value))}
                      className="flex-1 accent-primary cursor-pointer"
                    />
                    <button onClick={() => stepFrame(1)} className="text-muted-foreground hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>
                    <button onClick={() => seekTo(duration)} className="text-muted-foreground hover:text-foreground"><SkipForward className="w-4 h-4" /></button>
                    <button
                      onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()}
                      className="text-xs bg-secondary text-foreground px-3 py-1 rounded border border-border/50 hover:bg-secondary/80"
                    >
                      ▶/⏸
                    </button>
                  </div>

                  {/* Timeline */}
                  <div className="px-2 py-3 border-b border-border/30" style={{ minHeight: '80px' }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium px-2 mb-2">Phase Timeline</p>
                    <GaitLabelTimeline frames={labeledFrames} duration={duration} currentTime={currentTime} onSeek={seekTo} />
                  </div>

                  {/* Frames table */}
                  {labeledFrames.length > 0 && (
                    <div className="flex-1 overflow-auto p-4">
                      <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-3">Labeled Frames</p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border/40">
                            <th className="text-left py-1.5 pr-3 font-medium">Time (s)</th>
                            <th className="text-left py-1.5 pr-3 font-medium">Left Phase</th>
                            <th className="text-left py-1.5 pr-3 font-medium">Right Phase</th>
                            <th className="text-right py-1.5 pr-3 font-medium text-green-400/70">L Knee</th>
                            <th className="text-right py-1.5 pr-3 font-medium text-green-400/70">L Hip</th>
                            <th className="text-right py-1.5 pr-3 font-medium text-orange-400/70">R Knee</th>
                            <th className="text-right py-1.5 pr-3 font-medium text-orange-400/70">R Hip</th>
                            <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground/50">Source</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {labeledFrames.map((f, i) => (
                            <tr
                              key={i}
                              className={`border-b border-border/20 cursor-pointer hover:bg-muted/20 ${
                                Math.abs(f.t - currentTime) < 0.02 ? 'bg-primary/5' : ''
                              }`}
                              onClick={() => seekTo(f.t)}
                            >
                              <td className="py-1 pr-3 font-mono">{f.t.toFixed(3)}</td>
                              <td className="py-1 pr-3">
                                {f.leftPhase && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-black"
                                    style={{ background: getPhaseColor(f.leftPhase) }}>
                                    {getPhaseLabel(f.leftPhase)}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 pr-3">
                                {f.rightPhase && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-black"
                                    style={{ background: getPhaseColor(f.rightPhase) }}>
                                    {getPhaseLabel(f.rightPhase)}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 pr-3 text-right font-mono text-green-400/80">{f.leftKneeAngle  != null ? `${f.leftKneeAngle}°`  : '—'}</td>
                              <td className="py-1 pr-3 text-right font-mono text-green-400/60">{f.leftHipAngle   != null ? `${f.leftHipAngle}°`   : '—'}</td>
                              <td className="py-1 pr-3 text-right font-mono text-orange-400/80">{f.rightKneeAngle != null ? `${f.rightKneeAngle}°` : '—'}</td>
                              <td className="py-1 pr-3 text-right font-mono text-orange-400/60">{f.rightHipAngle  != null ? `${f.rightHipAngle}°`  : '—'}</td>
                              <td className="py-1 pr-3">
                                <span className={`text-[9px] px-1 rounded ${f._estimated ? 'text-accent/70 bg-accent/10' : 'text-primary/70 bg-primary/10'}`}>
                                  {f._estimated ? 'AI' : 'Manual'}
                                </span>
                              </td>
                              <td className="py-1">
                                <button
                                  onClick={ev => { ev.stopPropagation(); setLabeledFrames(prev => prev.filter((_, j) => j !== i)); }}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}