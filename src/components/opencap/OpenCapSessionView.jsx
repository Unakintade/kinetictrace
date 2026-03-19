import { useState } from 'react';
import OpenCapTrialCard from './OpenCapTrialCard';
import OpenCapAIOverview from './OpenCapAIOverview';

export default function OpenCapSessionView({ session, trials }) {
  const [selectedTrial, setSelectedTrial] = useState(trials[0] ?? null);

  const motTrials = trials.filter(t =>
    t.results?.some(r => r.tag === 'ik_results' || r.media_type === 'video/mot' || (r.media ?? '').endsWith('.mot'))
  );

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      {/* Sidebar: session meta + trial list */}
      <aside className="w-64 shrink-0 border-r border-border/50 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-border/30">
          <p className="text-xs text-muted-foreground font-medium mb-1">Session</p>
          <p className="text-sm font-semibold text-foreground truncate">{session.id}</p>
          {session.created_at && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(session.created_at).toLocaleDateString()}
            </p>
          )}
          {session.subject && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Subject: {session.subject}
            </p>
          )}
        </div>

        <div className="p-3">
          <p className="text-xs text-muted-foreground font-medium mb-2">
            Trials ({trials.length})
          </p>
          <div className="space-y-1">
            {trials.map(trial => (
              <button
                key={trial.id}
                onClick={() => setSelectedTrial(trial)}
                className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-colors border ${
                  selectedTrial?.id === trial.id
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border/30 hover:border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <p className="font-medium truncate">{trial.name || trial.id}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {trial.results?.length ?? 0} results
                </p>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main: trial detail + AI overview */}
      <main className="flex-1 overflow-y-auto p-5 space-y-5">
        {selectedTrial ? (
          <>
            <OpenCapTrialCard trial={selectedTrial} />
            <OpenCapAIOverview trial={selectedTrial} session={session} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Select a trial to view kinematics.</p>
        )}
      </main>
    </div>
  );
}