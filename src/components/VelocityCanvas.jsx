import { useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import usePoseDetector from '@/hooks/usePoseDetector';
import { analyseFrame, warpPoint } from '@/hooks/useHomography';

const VelocityCanvas = forwardRef(function VelocityCanvas(
  { videoSource, trackingMode, markers, trackedPoints, isTracking, onCanvasClick, onAutoTrackPoint, onPoseDetected, stanceEvents },
  ref
) {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastAutoRef = useRef(0);
  const [videoDims, setVideoDims] = useState({ w: 640, h: 360 });
  const [cameraGeo, setCameraGeo] = useState(null); // { vanishingPoint, tiltAngle, pitchFactor, segments }
  const { ready: poseReady, detectPerson } = usePoseDetector();

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    getVideo: () => videoRef.current,
    getCameraGeo: () => cameraGeo,
    seekTo: (videoTime) => {
      const video = videoRef.current;
      if (!video || video.srcObject) return; // no seeking for webcam
      video.pause();
      video.currentTime = videoTime;
    },
  }));

  // Analyse camera geometry once when video is ready (or on demand)
  const analyseCamera = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.readyState < 2) return;
    const w = videoDims.w;
    const h = videoDims.h;
    // Draw current frame to a temp canvas for pixel access
    const tmp = document.createElement('canvas');
    tmp.width = Math.min(w, 320); // downscale for speed
    tmp.height = Math.round(Math.min(w, 320) * h / w);
    const tctx = tmp.getContext('2d');
    tctx.drawImage(video, 0, 0, tmp.width, tmp.height);
    const imageData = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const geo = analyseFrame(imageData, tmp.width, tmp.height);
    // Scale vanishing point back to original resolution
    const scale = w / tmp.width;
    if (geo.vanishingPoint) {
      geo.vanishingPoint.x *= scale;
      geo.vanishingPoint.y *= scale;
    }
    geo.segments = geo.segments.map(s => ({
      x1: s.x1 * scale, y1: s.y1 * scale,
      x2: s.x2 * scale, y2: s.y2 * scale,
    }));
    setCameraGeo(geo);
  }, [videoDims]);

  // Setup video element
  useEffect(() => {
    if (!videoSource) return;
    const video = videoRef.current;
    if (!video) return;

    if (videoSource.type === 'upload') {
      video.src = videoSource.url;
      video.loop = true;
      video.onloadedmetadata = () => {
        setVideoDims({ w: video.videoWidth, h: video.videoHeight });
      };
      video.onseeked = () => analyseCamera();
      video.load();
    } else if (videoSource.type === 'webcam') {
      video.srcObject = videoSource.stream;
      video.controls = false;
      video.onloadedmetadata = () => {
        setVideoDims({ w: video.videoWidth, h: video.videoHeight });
        video.play();
      };
    }

    return () => {
      if (video.srcObject) video.srcObject = null;
    };
  }, [videoSource]);

  // Analyse once dims are known
  useEffect(() => {
    if (videoDims.w > 0) {
      setTimeout(analyseCamera, 500);
    }
  }, [videoDims]);

  // Play/pause based on tracking state (only when not in seek mode)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSource || videoSource.type !== 'upload') return;
    if (trackingMode === 'track' && isTracking) {
      video.play().catch(() => {});
    } else if (!isTracking) {
      video.pause();
    }
  }, [trackingMode, isTracking, videoSource]);

  // Draw loop + auto pose detection
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    const { w, h } = videoDims;

    const draw = async () => {
      canvas.width = w;
      canvas.height = h;

      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, w, h);
      } else {
        ctx.fillStyle = 'hsl(220 18% 9%)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'hsl(210 15% 35%)';
        ctx.font = '16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for video...', w / 2, h / 2);
      }

      // Auto pose detection every ~100ms when tracking
      if (isTracking && trackingMode === 'track' && poseReady && video.readyState >= 2) {
        const now = Date.now();
        if (now - lastAutoRef.current > 100) {
          lastAutoRef.current = now;
          detectPerson(video).then(pose => {
            if (pose) {
              onAutoTrackPoint(pose.hipCenter);
              if (onPoseDetected) onPoseDetected(pose);
            }
          });
        }
      }

      // Draw detected lines overlay (subtle)
      if (cameraGeo?.segments?.length) {
        ctx.strokeStyle = 'rgba(255, 220, 0, 0.15)';
        ctx.lineWidth = 1;
        cameraGeo.segments.slice(0, 10).forEach(s => {
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        });
      }

      // Draw vanishing point
      if (cameraGeo?.vanishingPoint) {
        const vp = cameraGeo.vanishingPoint;
        ctx.beginPath();
        ctx.arc(vp.x, vp.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 220, 0, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(vp.x - 14, vp.y); ctx.lineTo(vp.x + 14, vp.y);
        ctx.moveTo(vp.x, vp.y - 14); ctx.lineTo(vp.x, vp.y + 14);
        ctx.strokeStyle = 'rgba(255, 220, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255, 220, 0, 0.9)';
        ctx.textAlign = 'left';
        ctx.fillText('VP', vp.x + 10, vp.y - 5);
      }

      // Draw calibration markers
      markers.forEach((m, i) => {
        const color = i === 0 ? '#22c55e' : '#f97316';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = color + '55';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(m.x - 12, m.y); ctx.lineTo(m.x + 12, m.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(m.x, m.y - 12); ctx.lineTo(m.x, m.y + 12); ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`M${i + 1}`, m.x + 10, m.y - 8);
      });

      if (markers.length === 2) {
        ctx.beginPath();
        ctx.moveTo(markers[0].x, markers[0].y);
        ctx.lineTo(markers[1].x, markers[1].y);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw stance events (foot contacts)
      if (stanceEvents?.length) {
        stanceEvents.slice(-6).forEach(e => {
          const color = e.leg === 'left' ? '#22c55e' : '#f97316';
          ctx.beginPath();
          ctx.arc(e.x, e.y, 9, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = color + '33';
          ctx.fill();
          ctx.font = 'bold 9px Inter, sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(e.leg === 'left' ? 'L' : 'R', e.x, e.y + 3);
        });
      }

      // Draw tracked path
      if (trackedPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(trackedPoints[0].x, trackedPoints[0].y);
        for (let i = 1; i < trackedPoints.length; i++) {
          ctx.lineTo(trackedPoints[i].x, trackedPoints[i].y);
        }
        ctx.strokeStyle = 'hsl(195 100% 50% / 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      trackedPoints.forEach((p, i) => {
        const isLast = i === trackedPoints.length - 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, isLast ? 6 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isLast ? 'hsl(195 100% 50%)' : 'hsl(195 100% 50% / 0.4)';
        ctx.fill();
        if (isLast) {
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });

      // Status overlay
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = poseReady ? '#22c55e' : '#f97316';
      if (trackingMode === 'track') {
        ctx.fillText(poseReady ? '● AI Ready' : '● Loading AI...', w - 10, 20);
      }
      if (cameraGeo) {
        ctx.fillStyle = 'rgba(255,220,0,0.8)';
        ctx.fillText(
          `tilt ${cameraGeo.tiltAngle.toFixed(1)}° | pitch ×${cameraGeo.pitchFactor.toFixed(2)}`,
          w - 10, 36
        );
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [markers, trackedPoints, videoDims, isTracking, trackingMode, poseReady, cameraGeo]);

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    onCanvasClick({ x, y });
  };

  return (
    <div className="relative w-full">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="w-full rounded-lg border border-border/50 canvas-crosshair"
        style={{ background: 'hsl(220 18% 9%)' }}
      />
      {cameraGeo && (
        <button
          onClick={analyseCamera}
          className="absolute top-2 left-2 text-xs bg-black/60 hover:bg-black/80 text-yellow-300 border border-yellow-500/40 rounded px-2 py-1"
          title="Re-analyse camera angle"
        >
          ↺ Re-analyse
        </button>
      )}
    </div>
  );
});

export default VelocityCanvas;