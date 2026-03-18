/**
 * SessionContext — shared state across VeloTrack and GaitLabeler.
 *
 * Holds:
 *   - videoFile / videoUrl  — the loaded video, survives page navigation
 *   - allGaitSessions       — list of saved GaitLabel records
 *   - activeGaitSession     — currently selected reference session
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl]   = useState(null);

  const [allGaitSessions, setAllGaitSessions]     = useState([]);
  const [activeGaitSession, setActiveGaitSession] = useState(null);

  // Load saved sessions once on mount
  useEffect(() => {
    base44.entities.GaitLabel.list('-updated_date', 20).then(sessions => {
      const list = sessions ?? [];
      setAllGaitSessions(list);
      if (!activeGaitSession && list[0]?.frames?.length) {
        setActiveGaitSession(list[0]);
      }
    }).catch(() => {});
  }, []);

  /** Load a video file and create a stable object URL. */
  const loadVideo = useCallback((file) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  }, [videoUrl]);

  /** Called after saving/updating a session in the labeler. */
  const upsertSession = useCallback((saved) => {
    setAllGaitSessions(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) { const u = [...prev]; u[idx] = saved; return u; }
      return [saved, ...prev];
    });
    setActiveGaitSession(saved);
  }, []);

  /** Delete a session from state. */
  const removeSession = useCallback((id) => {
    setAllGaitSessions(prev => prev.filter(s => s.id !== id));
    setActiveGaitSession(prev => (prev?.id === id ? null : prev));
  }, []);

  return (
    <SessionContext.Provider value={{
      videoFile, videoUrl, loadVideo,
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