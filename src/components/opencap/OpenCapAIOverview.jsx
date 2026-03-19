import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

function buildPrompt(session, trial) {
  const results = (trial.results ?? []).map(r => r.tag || r.media_type || 'unknown').join(', ');
  const meta = trial.meta ? JSON.stringify(trial.meta, null, 2) : 'N/A';

  return `You are an expert biomechanist and movement scientist. Analyse the following OpenCap motion capture session data and provide a concise clinical summary.

**Session ID:** ${session.id}
**Trial name:** ${trial.name ?? trial.id}
**Trial created:** ${trial.created_at ?? 'unknown'}
**Available result files:** ${results || 'none'}
**Trial metadata:**
${meta}

Based on this information:
1. **Session Overview** — Summarise what type of movement/activity this trial likely captured.
2. **Key Kinematic Observations** — Note what kinematic variables are available and what they tell us.
3. **Clinical Relevance** — Describe potential clinical or performance insights that could be drawn from this data.
4. **Recommendations** — Suggest next analysis steps or follow-up measurements.

Be concise and practical. Use markdown formatting with bold headers. If data is limited, acknowledge the limitations clearly.`;
}

export default function OpenCapAIOverview({ session, trial }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setOpen(true);

    const prompt = buildPrompt(session, trial);
    const res = await base44.integrations.Core.InvokeLLM({ prompt });
    setResult(typeof res === 'string' ? res : res?.response ?? JSON.stringify(res));
    setLoading(false);
  };

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-card/50">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold">AI Kinematic Overview</p>
            <p className="text-xs text-muted-foreground">Clinical summary and biomechanical insights from this trial</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-accent/40 text-accent hover:bg-accent/10 h-8 text-xs px-3"
            disabled={loading}
            onClick={runAnalysis}
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analysing…</>
              : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />{result ? 'Re-analyse' : 'Generate Overview'}</>
            }
          </Button>
          {result && (
            <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground p-1">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-5 py-4 border-t border-border/30">
          {loading && (
            <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span className="text-sm">Generating biomechanical overview…</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm py-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          {result && (
            <div className="prose prose-sm prose-invert max-w-none
              [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-5 [&_h1]:mb-2
              [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border/30 [&_h2]:pb-1
              [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-accent [&_h3]:mt-3 [&_h3]:mb-1
              [&_strong]:text-accent
              [&_ul]:pl-5 [&_ul]:space-y-1
              [&_li]:text-sm [&_li]:text-muted-foreground [&_li]:leading-relaxed
              [&_p]:text-sm [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:my-1.5">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}