import { useState, useRef, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Save, Trash2, Download, Upload, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';
import GaitPhaseSelector from '@/components/GaitPhaseSelector';
import GaitLabelTimeline from '@/components/GaitLabelTimeline';
import AngleGauges from '@/components/AngleGauges';
import { GAIT_PHASES, getPhaseColor, getPhaseLabel } from '@/lib/gaitPhases';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import usePoseDetector from '@/hooks/usePoseDetector';

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

const PHASE_KEYS = {
  // Left leg keyboard shortcuts
  q: { leg: 'left',  phase: 'touch_down'   },
  w: { leg: 'left',  phase: 'mid_stance'   },
  e: { leg: 'left',  phase: 'toe_off'      },
  r: { leg: 'left',  phase: 'early_flight' },
  t: { leg: 'left',  phase: 'mid_flight'   },
  y: { leg: 'left',  phase: 'late_flight'  },
  // Right leg
  a: { leg: 'right', phase: 'touch_down'   },
  s: { leg: 'right', phase: 'mid_stance'   },
  d: { leg: 'right', phase: 'toe_off'      },
  f: { leg: 'right', phase: 'early_flight' },
  g: { leg: 'right', phase: 'mid_flight'   },
  h: { leg: 'right', phase: 'late_flight'  },
};

export default function GaitLabeler() {
  const videoRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrame, setCurrentFrame] = useState({ leftPhase: null, rightPhase: null });
  const [labeledFrames, setLabeledFrames] = useState([]); // [{t, leftPhase, rightPhase}]
  const [videoName, setVideoName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [savedSessions, setSavedSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const frameStepRef = useRef(1 / 30); // assume 30fps until known

  // Load saved sessions
  useEffect(() => {
    base44.entities.GaitLabel.list('-updated_date', 20)
      .then(setSavedSessions)
      .catch(() => {});
  }, []);

  // Handle video file upload
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoName(file.name);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setLabeledFrames([]);
    setCurrentFrame({ leftPhase: null, rightPhase: null });
  };

  const handleVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    // Estimate frame step from duration (cap at 1/24)
    frameStepRef.current = Math.min(1 / 24, v.duration / 500);
    v.currentTime = 0;
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = parseFloat(v.currentTime.toFixed(3));
    setCurrentTime(t);
    // Show existing label for this time if present
    const existing = labeledFrames.find(f => Math.abs(f.t - t) < 0.02);
    if (existing) {
      setCurrentFrame({ leftPhase: existing.leftPhase, rightPhase: existing.rightPhase });
    }
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

  // Label current frame
  const labelFrame = useCallback((leg, phase) => {
    const t = parseFloat(videoRef.current?.currentTime?.toFixed(3) ?? '0');

    // Auto-set opposite leg to mid_flight when we hit mid_flight on either leg
    let autoOtherPhase = null;
    if (phase === 'mid_flight') autoOtherPhase = 'mid_flight';

    setCurrentFrame(prev => {
      const next = {
        leftPhase:  leg === 'left'  ? phase : (autoOtherPhase ?? prev.leftPhase),
        rightPhase: leg === 'right' ? phase : (autoOtherPhase ?? prev.rightPhase),
      };
      return next;
    });

    setLabeledFrames(prev => {
      const idx = prev.findIndex(f => Math.abs(f.t - t) < 0.02);
      const entry = {
        t,
        leftPhase:  leg === 'left'  ? phase : (autoOtherPhase ?? (prev[idx]?.leftPhase ?? null)),
        rightPhase: leg === 'right' ? phase : (autoOtherPhase ?? (prev[idx]?.rightPhase ?? null)),
      };
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = entry;
        return updated;
      }
      return [...prev, entry].sort((a, b) => a.t - b.t);
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const binding = PHASE_KEYS[e.key.toLowerCase()];
      if (binding) {
        e.preventDefault();
        labelFrame(binding.leg, binding.phase);
        return;
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); stepFrame(-1); }
      if (e.key === ' ')          { e.preventDefault(); videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Remove label at current frame
        const t = parseFloat(videoRef.current?.currentTime?.toFixed(3) ?? '0');
        setLabeledFrames(prev => prev.filter(f => Math.abs(f.t - t) >= 0.02));
        setCurrentFrame({ leftPhase: null, rightPhase: null });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [labelFrame, stepFrame]);

  const handleSave = async () => {
    if (!videoName || labeledFrames.length === 0) return;
    setIsSaving(true);
    try {
      const data = {
        video_name: videoName,
        frames: labeledFrames,
        video_duration: duration,
        notes: sessionNotes,
      };
      let saved;
      if (selectedSession?.id) {
        saved = await base44.entities.GaitLabel.update(selectedSession.id, data);
      } else {
        saved = await base44.entities.GaitLabel.create(data);
      }
      setSelectedSession(saved);
      setSavedSessions(prev => {
        const idx = prev.findIndex(s => s.id === saved.id);
        if (idx >= 0) { const u = [...prev]; u[idx] = saved; return u; }
        return [saved, ...prev];
      });
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
  };

  const deleteSession = async (id) => {
    await base44.entities.GaitLabel.delete(id);
    setSavedSessions(prev => prev.filter(s => s.id !== id));
    if (selectedSession?.id === id) { setSelectedSession(null); setLabeledFrames([]); }
  };

  const exportCSV = () => {
    if (!labeledFrames.length) return;
    const header = 'time_s,left_phase,right_phase';
    const rows = labeledFrames.map(f => `${f.t},${f.leftPhase ?? ''},${f.rightPhase ?? ''}`);
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
        {/* Left sidebar: sessions + upload */}
        <aside className="w-60 shrink-0 border-r border-border/50 flex flex-col overflow-y-auto">
          {/* Upload */}
          <div className="p-4 border-b border-border/30">
            <label className="flex flex-col items-center gap-2 border-2 border-dashed border-border/50 rounded-lg p-4 cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground text-center">Upload video to label</span>
              <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
            </label>
            {videoFile && (
              <p className="text-xs text-primary mt-2 truncate">{videoFile.name}</p>
            )}
          </div>

          {/* Keyboard shortcuts legend */}
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

          {/* Saved sessions */}
          <div className="flex-1 p-3">
            <p className="text-xs text-muted-foreground font-medium mb-2">Saved Sessions</p>
            {savedSessions.length === 0 && (
              <p className="text-xs text-muted-foreground/60">No saved sessions yet</p>
            )}
            <div className="space-y-1.5">
              {savedSessions.map(s => (
                <div
                  key={s.id}
                  className={`group relative rounded-lg border p-2 cursor-pointer transition-colors ${
                    selectedSession?.id === s.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/40 hover:border-border'
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
                <p className="text-xs text-muted-foreground/60">Use keyboard shortcuts for fast frame-by-frame classification</p>
              </div>
            </div>
          ) : (
            <>
              {/* Video + controls */}
              <div className="flex gap-4 p-4 border-b border-border/50">
                {/* Video */}
                <div className="flex-1 relative">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    onLoadedMetadata={handleVideoLoaded}
                    onTimeUpdate={handleTimeUpdate}
                    className="w-full rounded-lg border border-border/50 bg-black"
                    style={{ maxHeight: '380px', objectFit: 'contain' }}
                    playsInline
                    muted
                  />
                  {/* Current time / label overlay */}
                  <div className="absolute top-2 left-2 flex gap-2">
                    <span className="bg-black/70 text-white text-xs font-mono px-2 py-0.5 rounded">
                      {currentTime.toFixed(3)}s / {duration.toFixed(2)}s
                    </span>
                    {labeledFrames.find(f => Math.abs(f.t - currentTime) < 0.02) && (
                      <span className="bg-primary/80 text-black text-xs font-mono px-2 py-0.5 rounded">
                        ✓ Labeled
                      </span>
                    )}
                  </div>

                  {/* Phase indicator overlays */}
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

                {/* Right: phase selector + stats */}
                <div className="w-80 shrink-0 flex flex-col gap-4">
                  {/* Video name + notes */}
                  <div className="space-y-1.5">
                    <Input
                      value={videoName}
                      onChange={e => setVideoName(e.target.value)}
                      placeholder="Video name / ID"
                      className="h-7 text-xs"
                    />
                    <Textarea
                      value={sessionNotes}
                      onChange={e => setSessionNotes(e.target.value)}
                      placeholder="Session notes…"
                      className="text-xs h-14 resize-none"
                    />
                  </div>

                  {/* Phase selector */}
                  <div className="bg-card/50 border border-border/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Current Frame Classification</p>
                    <GaitPhaseSelector
                      leftPhase={currentFrame.leftPhase}
                      rightPhase={currentFrame.rightPhase}
                      onLeftChange={p => labelFrame('left', p)}
                      onRightChange={p => labelFrame('right', p)}
                    />
                  </div>

                  {/* Stats */}
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

              {/* Scrubber + frame controls */}
              <div className="px-4 py-2 border-b border-border/30 flex items-center gap-3">
                <button onClick={() => seekTo(0)} className="text-muted-foreground hover:text-foreground">
                  <SkipBack className="w-4 h-4" />
                </button>
                <button onClick={() => stepFrame(-1)} className="text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min={0} max={duration} step={frameStepRef.current}
                  value={currentTime}
                  onChange={e => seekTo(parseFloat(e.target.value))}
                  className="flex-1 accent-primary cursor-pointer"
                />
                <button onClick={() => stepFrame(1)} className="text-muted-foreground hover:text-foreground">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button onClick={() => seekTo(duration)} className="text-muted-foreground hover:text-foreground">
                  <SkipForward className="w-4 h-4" />
                </button>
                <button
                  onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()}
                  className="text-xs bg-secondary text-foreground px-3 py-1 rounded border border-border/50 hover:bg-secondary/80"
                >
                  {videoRef.current?.paused !== false ? '▶ Play' : '⏸ Pause'}
                </button>
              </div>

              {/* Label timeline */}
              <div className="px-2 py-3 border-b border-border/30" style={{ minHeight: '80px' }}>
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium px-2 mb-2">Phase Timeline</p>
                <GaitLabelTimeline
                  frames={labeledFrames}
                  duration={duration}
                  currentTime={currentTime}
                  onSeek={seekTo}
                />
              </div>

              {/* Labeled frames table */}
              {labeledFrames.length > 0 && (
                <div className="flex-1 overflow-auto p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-3">Labeled Frames</p>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/40">
                        <th className="text-left py-1.5 pr-4 font-medium">Time (s)</th>
                        <th className="text-left py-1.5 pr-4 font-medium">Left Phase</th>
                        <th className="text-left py-1.5 pr-4 font-medium">Right Phase</th>
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
                          <td className="py-1 pr-4 font-mono">{f.t.toFixed(3)}</td>
                          <td className="py-1 pr-4">
                            {f.leftPhase && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-black"
                                style={{ background: getPhaseColor(f.leftPhase) }}>
                                {getPhaseLabel(f.leftPhase)}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-4">
                            {f.rightPhase && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-black"
                                style={{ background: getPhaseColor(f.rightPhase) }}>
                                {getPhaseLabel(f.rightPhase)}
                              </span>
                            )}
                          </td>
                          <td className="py-1">
                            <button
                              onClick={ev => {
                                ev.stopPropagation();
                                setLabeledFrames(prev => prev.filter((_, j) => j !== i));
                              }}
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
        </main>
      </div>
    </div>
  );
}