import { useEffect, useRef } from 'react';

/**
 * A visible <video> element that stays in sync with a hidden "master" video ref.
 * Used in the GaitLabeler review mode so the user can see the video while
 * the actual videoRef (used for pose detection) stays off-screen and stable.
 */
export default function ReviewVideo({ videoUrl, videoRef, currentTime }) {
  const displayRef = useRef(null);

  // Keep display video in sync with the master video's currentTime
  useEffect(() => {
    const display = displayRef.current;
    if (!display) return;
    // Only seek if meaningfully out of sync to avoid feedback loops
    if (Math.abs(display.currentTime - currentTime) > 0.05) {
      display.currentTime = currentTime;
    }
  }, [currentTime]);

  // Mirror play/pause from master to display
  useEffect(() => {
    const master = videoRef?.current;
    const display = displayRef.current;
    if (!master || !display) return;

    const onPlay  = () => display.play().catch(() => {});
    const onPause = () => display.pause();

    master.addEventListener('play', onPlay);
    master.addEventListener('pause', onPause);
    return () => {
      master.removeEventListener('play', onPlay);
      master.removeEventListener('pause', onPause);
    };
  }, [videoRef]);

  return (
    <video
      ref={displayRef}
      src={videoUrl}
      className="w-full rounded-lg border border-border/50 bg-black"
      style={{ maxHeight: '380px', objectFit: 'contain' }}
      playsInline
      muted
    />
  );
}