import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Search, Loader2, AlertTriangle, LogOut, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import OpenCapSessionView from '@/components/opencap/OpenCapSessionView';

const API_BASE = 'https://api.opencap.ai/api/v1/';

async function fetchOpenCap(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) throw new Error(`OpenCap API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function loginOpenCap(username, password) {
  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${API_BASE}login/`, { method: 'POST', body });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.token) throw new Error('No token returned — check your credentials.');
  return data.token;
}

export default function OpenCapAnalysis() {
  const [token, setToken] = useState(() => localStorage.getItem('opencap_token') ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);

  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [trialsData, setTrialsData] = useState([]);

  const isLoggedIn = !!token;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    const t = await loginOpenCap(username, password);
    localStorage.setItem('opencap_token', t);
    setToken(t);
    setPassword('');
    setLoginLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('opencap_token');
    setToken('');
    setSessionData(null);
    setTrialsData([]);
    setError(null);
  };

  const fetchSession = useCallback(async () => {
    if (!token || !sessionId.trim()) return;
    setLoading(true);
    setError(null);
    setSessionData(null);
    setTrialsData([]);
    try {
      const session = await fetchOpenCap(`sessions/${sessionId.trim()}/`, token);
      setSessionData(session);
      const trials = await Promise.all(
        (session.trials ?? []).map(t => fetchOpenCap(`trials/${t.id}/`, token))
      );
      setTrialsData(trials);
    } catch (e) {
      setError(e.message ?? 'Failed to load session');
    }
    setLoading(false);
  }, [token, sessionId]);

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
        {isLoggedIn && (
          <Button variant="ghost" size="sm" className="ml-auto text-xs text-muted-foreground gap-1.5" onClick={handleLogout}>
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </Button>
        )}
      </header>

      {/* Login form */}
      {!isLoggedIn && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm space-y-6 px-6">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-3">
                <LogIn className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-base font-semibold">Sign in to OpenCap</h2>
              <p className="text-xs text-muted-foreground">
                Uses the same credentials as{' '}
                <a href="https://app.opencap.ai" target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                  app.opencap.ai
                </a>
              </p>
            </div>
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Username</label>
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="username"
                  required
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="h-9 text-sm"
                />
              </div>
              {loginError && (
                <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {loginError}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loginLoading || !username || !password}>
                {loginLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                {loginLoading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground/60 text-center">
              Your token is saved locally in your browser. No credentials are stored on any server.
            </p>
          </div>
        </div>
      )}

      {/* Session search bar (shown once logged in) */}
      {isLoggedIn && (
        <div className="border-b border-border/50 px-6 py-4 bg-card/30 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
            <label className="text-xs text-muted-foreground font-medium">Session ID (UUID)</label>
            <Input
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchSession()}
              placeholder="e.g. dd430a55-20a7-464c-8ebb-fc0712f73b09"
              className="h-8 text-xs font-mono"
            />
          </div>
          <Button size="sm" onClick={fetchSession} disabled={loading || !sessionId.trim()} className="h-8">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Search className="w-3.5 h-3.5 mr-1.5" />}
            {loading ? 'Loading…' : 'Load Session'}
          </Button>
          <p className="text-[10px] text-muted-foreground/60 w-full -mt-1">
            Find session IDs in the URL when viewing a session on app.opencap.ai
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {isLoggedIn && !loading && !sessionData && !error && (
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