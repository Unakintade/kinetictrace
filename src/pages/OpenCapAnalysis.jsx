import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Search, Loader2, Sparkles, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import OpenCapSessionView from '@/components/opencap/OpenCapSessionView';

const API_BASE = 'https://api.opencap.ai/api/v1/';

async function fetchOpenCap(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) throw new Error(`OpenCap API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export default function OpenCapAnalysis() {
  const [token, setToken] = useState(() => localStorage.getItem('opencap_token') ?? '');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [trialsData, setTrialsData] = useState([]);

  const saveToken = (t) => {
    setToken(t);
    localStorage.setItem('opencap_token', t);
  };

  const fetchSession = useCallback(async () => {
    if (!token || !sessionId.trim()) return;
    setLoading(true);
    setError(null);
    setSessionData(null);
    setTrialsData([]);

    const session = await fetchOpenCap(`sessions/${sessionId.trim()}/`, token);
    setSessionData(session);

    // Fetch each trial's full data (for results/kinematics)
    const trials = await Promise.all(
      (session.trials ?? []).map(t => fetchOpenCap(`trials/${t.id}/`, token))
    );
    setTrialsData(trials);
    setLoading(false);
  }, [token, sessionId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') fetchSession();
  };

  return (
    <div className="min-h-screen bg-background font-inter flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center gap-3">
        <Link to="/VeloTrack" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Activity className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">OpenCap Kinematic Analysis</h1>
          <p className="text-xs text-muted-foreground">Fetch session data from OpenCap and get AI-powered biomechanical summaries</p>
        </div>
      </header>

      {/* Controls */}
      <div className="border-b border-border/50 px-6 py-4 bg-card/30 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label className="text-xs text-muted-foreground font-medium">OpenCap API Token</label>
          <Input
            type="password"
            value={token}
            onChange={e => saveToken(e.target.value)}
            placeholder="Paste your OpenCap token…"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
          <label className="text-xs text-muted-foreground font-medium">Session ID (UUID)</label>
          <Input
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. dd430a55-20a7-464c-8ebb-fc0712f73b09"
            className="h-8 text-xs font-mono"
          />
        </div>
        <Button
          size="sm"
          onClick={fetchSession}
          disabled={loading || !token || !sessionId.trim()}
          className="h-8"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Search className="w-3.5 h-3.5 mr-1.5" />}
          {loading ? 'Loading…' : 'Load Session'}
        </Button>
        <p className="text-[10px] text-muted-foreground/60 w-full -mt-1">
          Token is saved locally in your browser. Get it from your OpenCap account settings at app.opencap.ai.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !sessionData && !error && (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-3">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center mx-auto">
              <Activity className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground/70">Enter a Session ID to load OpenCap kinematic data</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">
              You can find session IDs in the URL when viewing a session on app.opencap.ai
            </p>
          </div>
        </div>
      )}

      {/* Session view */}
      {sessionData && (
        <OpenCapSessionView session={sessionData} trials={trialsData} />
      )}
    </div>
  );
}