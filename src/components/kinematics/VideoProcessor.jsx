/**
 * VideoProcessor — handles video upload, frame scanning, and passes
 * raw landmark frames upward via onFramesReady.
 */
import { useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Play, Square, Loader2 } from 'lucide-react';

const SCAN_INTERVAL_S = 1 / 30; // 30 fps scan
const MIN_CONFIDENCE = 0.1;

export default function VideoProcessor({ detector, onFramesReady, onProgress, disabled, videoRef: externalVideoRef }) {
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [fps, setFps] = useState(30);
  const [scanning, setScanning] = useState(false);
  const internalRef = useRef(null);
  const videoRef = externalVideoRef ?? internalRef;
  const cancelRef = useRef(false);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
  };

  const handleVideoMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    // Try to infer fps from duration; default 30
    setFps(30);
  };

  const runScan = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !detector) return;
    cancelRef.current = false;
    setScanning(true);
    onProgress(0);

    v.pause();
    v.currentTime = 0;
    const dur = v.duration;
    const videoH = v.videoHeight;
    const videoW = v.videoWidth;
    const step = SCAN_INTERVAL_S;
    const rawFrames = [];
    let t = 0;

    while (t <= dur) {
      if (cancelRef.current) break;
      v.currentTime = t;
      await new Promise(res => setTimeout(res, 50));
      if (v.readyState >= 2) {
        try {
          const poses = await detector.estimatePoses(v);
          if (poses?.length) {
            const kp = poses[0].keypoints;
            rawFrames.push({
              t,
              videoH,
              videoW,
              landmarks: kp.map(k => ({
                name: k.name,
                x: k.x,
                y: k.y,
                z: k.z ?? 0,
                score: k.score ?? 0,
                visibility: k.score ?? 0,
              })),
            });
          }
        } catch (_) {}
      }
      onProgress(Math.min(t / dur, 0.99));
      t = parseFloat((t + step).toFixed(3));
    }

    setScanning(false);
    onProgress(1);
    if (!cancelRef.current && rawFrames.length > 5) {
      onFramesReady(rawFrames, fps, { videoH, videoW });
    }
  }, [detector, fps, onFramesReady, onProgress]);

  return (
    <div className="space-y-3">
      <label className="flex flex-col items-center gap-2 border-2 border-dashed border-border/50 rounded-lg p-4 cursor-pointer hover:border-primary/40 transition-colors">
        <Upload className="w-5 h-5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground text-center">
          Upload sprint video (MP4/MOV)
        </span>
        <input type="file" accept="video/*" className="hidden" onChange={handleFile} />
      </label>

      {/* Always in DOM so videoRef is always populated */}
      <video
        ref={videoRef}
        src={videoUrl || undefined}
        onLoadedMetadata={handleVideoMeta}
        className="w-full rounded-lg border border-border/40 max-h-48 object-contain bg-black"
        style={{ display: videoUrl ? 'block' : 'none' }}
        playsInline
        muted
        controls
      />

      {videoUrl && (
        <>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={scanning || disabled || !detector}
              onClick={runScan}
            >
              {scanning
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Scanning…</>
                : <><Play className="w-3.5 h-3.5 mr-1.5" />Extract Landmarks</>
              }
            </Button>
            {scanning && (
              <Button size="sm" variant="outline" onClick={() => { cancelRef.current = true; setScanning(false); }}>
                <Square className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/60">{videoName}</p>
        </>
      )}
    </div>
  );
}