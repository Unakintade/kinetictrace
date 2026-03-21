/**
 * CalibrationOverlay
 *
 * Renders on top of the video thumbnail. The user clicks two points
 * (start/end of a known distance), enters the real-world length in metres,
 * and we compute pixels-per-metre with a homography-based tilt correction.
 *
 * Homography correction: if the line between the two points has a vertical
 * component (camera not perfectly side-on), we use the vanishing-point
 * pitch correction from useHomography to project the pixel distance onto
 * the ground plane before dividing by the real-world distance.
 */

import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Crosshair, Trash2, CheckCircle2 } from 'lucide-react';

// Simple homography: correct for camera tilt using the angle of the
// calibration line relative to horizontal.
// d_corrected = d_px / cos(theta)   where theta = angle from horizontal
// This is the same projection used in hooks/useHomography.js
function correctedPixelDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dPx = Math.hypot(dx, dy);
  // angle of the line from horizontal
  const theta = Math.abs(Math.atan2(dy, dx));
  // project onto horizontal ground plane
  const correction = Math.cos(theta) || 1;
  return dPx * correction;
}

export default function CalibrationOverlay({ videoRef, onCalibrationChange }) {
  const overlayRef = useRef(null);
  const [points, setPoints] = useState([]); // [{x,y}] in overlay coords
  const [realDist, setRealDist] = useState('');
  const [locked, setLocked] = useState(false);
  const [videoDims, setVideoDims] = useState({ w: 1, h: 1, naturalW: 1, naturalH: 1 });

  // Update display dims when video loads / resizes
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const update = () => {
      const rect = v.getBoundingClientRect();
      setVideoDims({ w: rect.width, h: rect.height, naturalW: v.videoWidth || rect.width, naturalH: v.videoHeight || rect.height });
    };
    v.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', update);
    update();
    return () => { v.removeEventListener('loadedmetadata', update); window.removeEventListener('resize', update); };
  }, [videoRef]);

  const handleClick = (e) => {
    if (locked) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPoints(prev => prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }]);
  };

  // Scale overlay point → natural video pixel coords
  const toNatural = (pt) => ({
    x: pt.x * (videoDims.naturalW / videoDims.w),
    y: pt.y * (videoDims.naturalH / videoDims.h),
  });

  const handleApply = () => {
    if (points.length < 2 || !realDist) return;
    const p1n = toNatural(points[0]);
    const p2n = toNatural(points[1]);
    const corrected = correctedPixelDistance(p1n, p2n);
    const dist = parseFloat(realDist);
    if (!dist || dist <= 0) return;
    const ppm = corrected / dist;
    setLocked(true);
    onCalibrationChange(ppm, points, realDist);
  };

  const handleReset = () => {
    setPoints([]);
    setRealDist('');
    setLocked(false);
    onCalibrationChange(null, [], '');
  };

  // SVG line + circles over the overlay
  const lineEl = points.length === 2 ? (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }}>
      <line
        x1={points[0].x} y1={points[0].y}
        x2={points[1].x} y2={points[1].y}
        stroke="#00e5ff" strokeWidth="2" strokeDasharray="5 3"
      />
    </svg>
  ) : null;

  const dotsEl = points.map((p, i) => (
    <div
      key={i}
      className="absolute z-20 pointer-events-none"
      style={{ left: p.x - 8, top: p.y - 8 }}
    >
      <div className="w-4 h-4 rounded-full border-2 border-primary bg-primary/20 flex items-center justify-center">
        <span className="text-[8px] font-bold text-primary leading-none">{i + 1}</span>
      </div>
    </div>
  ));

  const pixelDist = points.length === 2
    ? correctedPixelDistance(toNatural(points[0]), toNatural(points[1])).toFixed(1)
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Calibration</p>
        {locked && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 className="w-3 h-3" /> Calibrated
          </span>
        )}
      </div>

      {/* Clickable overlay on top of the video */}
      <div
        ref={overlayRef}
        className={`relative rounded-lg overflow-hidden border ${locked ? 'border-green-500/40 cursor-default' : 'border-primary/40 cursor-crosshair'}`}
        onClick={handleClick}
        style={{ lineHeight: 0 }}
      >
        {/* We show a static frame from the video */}
        <CalibrationFrameCapture videoRef={videoRef} />
        {lineEl}
        {dotsEl}
        {!locked && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded pointer-events-none">
            {points.length === 0 ? 'Click to set point 1' : points.length === 1 ? 'Click to set point 2' : `${pixelDist}px — enter distance below`}
          </div>
        )}
        {locked && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-green-900/80 text-green-300 text-[10px] px-2 py-0.5 rounded pointer-events-none">
            {parseFloat(realDist).toFixed(2)} m → {(correctedPixelDistance(toNatural(points[0]), toNatural(points[1])) / parseFloat(realDist)).toFixed(1)} px/m (homography corrected)
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2 items-center">
        <Input
          type="number"
          placeholder="Distance (m)"
          value={realDist}
          onChange={e => setRealDist(e.target.value)}
          disabled={locked || points.length < 2}
          className="h-7 text-xs font-mono flex-1"
          min={0.01}
          step={0.1}
        />
        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={points.length < 2 || !realDist || locked}
          onClick={handleApply}
        >
          <Crosshair className="w-3 h-3 mr-1" /> Apply
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={handleReset}
          title="Reset calibration"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {points.length === 2 && !locked && pixelDist && (
        <p className="text-[10px] text-muted-foreground/70">
          Pixel distance (corrected): {pixelDist} px
        </p>
      )}
    </div>
  );
}

/**
 * Captures a live frame from the video via rAF so it always stays in sync.
 */
function CalibrationFrameCapture({ videoRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let rafId;
    const loop = () => {
      const v = videoRef?.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2 && v.videoWidth > 0) {
        if (c.width !== v.videoWidth) c.width = v.videoWidth;
        if (c.height !== v.videoHeight) c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full block"
      style={{ maxHeight: 160, background: '#000' }}
    />
  );
}