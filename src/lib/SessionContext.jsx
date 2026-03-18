/**
 * SessionContext — shared state across VeloTrack and GaitLabeler.
 *
 * Holds:
 *   - videoFile / videoUrl / videoSource  — the loaded video, survives page navigation
 *   - videoName                           — display name of the video
 *   - allGaitSessions                     — list of saved GaitLabel records
 *   - activeGaitSession                   — currently selected reference session
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [videoFile, setVideoFile]     = useState(null);
  const [videoUrl, setVideoUrl]       = useState(null);
  const [videoName, setVideoName]     = useState('');
  // videoSource is the object VelocityCanvas expects: { type: 'upload', url } | { type: 'webcam', stream }
  const [videoSource, setVideoSource] = useState(null);

  const [allGaitSessions, setAllGaitSessions]     = useState([]);
  const [activeGaitSession, setActiveGaitSession] = useState(null);

  // Load saved sessions once on mount
  useEffect(() => {
    base44.entities.GaitLabel.list('-updated_date', 20).then(sessions => {
      const list = sessions ?? [];
      setAllGaitSessions(list);
      if (list[0]?.frames?.length) setActiveGaitSession(list[0]);
    }).catch(() => {});
  }, []);

  /** Load a video file — creates a stable object URL and sets all video state. */
  const loadVideo = useCallback((file) => {
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoName(file.name);
    setVideoSource({ type: 'upload', url });
  }, []);

  /** Clear the video (e.g. when user removes it). */
  const clearVideo = useCallback(() => {
    setVideoFile(null);
    setVideoUrl(null);
    setVideoName('');
    setVideoSource(null);
  }, []);

  /** Set a webcam stream as the video source. */
  const loadWebcam = useCallback((stream) => {
    setVideoFile(null);
    setVideoUrl(null);
    setVideoName('Webcam');
    setVideoSource({ type: 'webcam', stream });
  }, []);

  /** Called after saving/updating a session in the labeler. */
  const upsertSession = useCallback((saved) => {
    setAllGaitSessions(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) { const u = [...prev]; u[idx] = saved; return u; }
      return [saved, ...prev];
    });
    setActiveGaitSession(saved);
  }, []);

  /** Remove a session from state. */
  const removeSession = useCallback((id) => {
    setAllGaitSessions(prev => prev.filter(s => s.id !== id));
    setActiveGaitSession(prev => (prev?.id === id ? null : prev));
  }, []);

  return (
    <SessionContext.Provider value={{
      videoFile, videoUrl, videoName, videoSource,
      loadVideo, clearVideo, loadWebcam,
      allGaitSessions, activeGaitSession, setActiveGaitSession,
      upsertSession, removeSession,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}