import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import usePoseDetector from '@/hooks/usePoseDetector';

const VelocityCanvas = forwardRef(function VelocityCanvas(
  { videoSource, trackingMode, markers, trackedPoints, isTracking, onCanvasClick, onAutoTrackPoint },
  ref
) {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastAutoRef = useRef(0);
  const [videoDims, setVideoDims] = useState({ w: 640, h: 360 });
  const { ready: poseReady, detectPerson } = usePoseDetector();

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    getVideo: () => videoRef.current,
  }));

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

  // Play/pause based on tracking state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSource || videoSource.type !== 'upload') return;
    if (trackingMode === 'track' && isTracking) {
      video.play();
    } else {
      video.pause();
    }
  }, [trackingMode, isTracking, videoSource]);

  // Draw loop + auto pose detection
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');

    const draw = async () => {
      canvas.width = videoDims.w;
      canvas.height = videoDims.h;

      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = 'hsl(220 18% 9%)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'hsl(210 15% 35%)';
        ctx.font = '16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for video...', canvas.width / 2, canvas.height / 2);
      }

      // Auto pose detection: sample every ~100ms when tracking
      if (isTracking && trackingMode === 'track' && poseReady && video.readyState >= 2) {
        const now = Date.now();
        if (now - lastAutoRef.current > 100) {
          lastAutoRef.current = now;
          detectPerson(video).then(pt => {
            if (pt) onAutoTrackPoint(pt);
          });
        }
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

      // Draw calibration line
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

      // Draw tracked points
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

      // Pose-ready indicator
      if (trackingMode === 'track') {
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = poseReady ? '#22c55e' : '#f97316';
        ctx.fillText(poseReady ? '● AI Ready' : '● Loading AI...', canvas.width - 10, 20);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [markers, trackedPoints, videoDims, isTracking, trackingMode, poseReady]);

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
        className={`w-full rounded-lg border border-border/50 ${
          trackingMode === 'marker' ? 'canvas-crosshair' : 'canvas-crosshair'
        }`}
        style={{ background: 'hsl(220 18% 9%)' }}
      />
    </div>
  );
});

export default VelocityCanvas;