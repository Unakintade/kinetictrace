import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Sparkles, ChevronDown, ChevronUp, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

function cleanStrides(strideMetrics) {
  if (!strideMetrics?.length) return [];
  const lengths = strideMetrics.map(m => m.strideLength).filter(Boolean);
  const freqs   = strideMetrics.map(m => m.strideFreq).filter(Boolean);
  if (!lengths.length) return strideMetrics;

  const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const medLen  = median(lengths);
  const medFreq = median(freqs);

  return strideMetrics.filter(m =>
    m.strideLength > medLen * 0.4 && m.strideLength < medLen * 2.5 &&
    m.strideFreq   > medFreq * 0.4 && m.strideFreq   < medFreq * 2.5
  );
}

function summariseData({ strideMetrics, velocityData, asymmetry, leftContactDurations, rightContactDurations, jointAngles }) {
  const clean = cleanStrides(strideMetrics);

  const avg = (arr, key) => arr.length ? (arr.reduce((s, v) => s + (key ? v[key] : v), 0) / arr.length) : null;
  const max = (arr, key) => arr.length ? Math.max(...arr.map(v => key ? v[key] : v)) : null;

  const avgLen  = avg(clean, 'strideLength');
  const avgFreq = avg(clean, 'strideFreq');
  const peakSpd = max(velocityData, 'speed');
  const avgSpd  = avg(velocityData, 'speed');

  const avgLCT = avg(leftContactDurations,  'duration');
  const avgRCT = avg(rightContactDurations, 'duration');

  const kneeAngles = jointAngles.filter(f => f.leftKnee && f.rightKnee);
  const avgLKnee = avg(kneeAngles, 'leftKnee');
  const avgRKnee = avg(kneeAngles, 'rightKnee');
  const avgLHip  = avg(kneeAngles, 'leftHip');
  const avgRHip  = avg(kneeAngles, 'rightHip');

  return {
    strideCount: clean.length,
    avgStrideLength_m:     avgLen   ? +avgLen.toFixed(3)   : null,
    avgStrideFrequency_Hz: avgFreq  ? +avgFreq.toFixed(3)  : null,
    peakSpeed_ms:          peakSpd  ? +peakSpd.toFixed(3)  : null,
    avgSpeed_ms:           avgSpd   ? +avgSpd.toFixed(3)   : null,
    leftContactTime_ms:    avgLCT   ? +avgLCT.toFixed(0)   : null,
    rightContactTime_ms:   avgRCT   ? +avgRCT.toFixed(0)   : null,
    asymmetry: {
      strideLength_pct: asymmetry?.strideLength?.pct ?? null,
      strideFreq_pct:   asymmetry?.strideFreq?.pct   ?? null,
      contactTime_pct:  asymmetry?.contactTime?.pct  ?? null,
    },
    avgJointAngles: {
      leftKnee_deg:  avgLKnee ? +avgLKnee.toFixed(1) : null,
      rightKnee_deg: avgRKnee ? +avgRKnee.toFixed(1) : null,
      leftHip_deg:   avgLHip  ? +avgLHip.toFixed(1)  : null,
      rightHip_deg:  avgRHip  ? +avgRHip.toFixed(1)  : null,
    },
  };
}

export default function AIAnalysisPanel({ strideMetrics, velocityData, asymmetry, leftContactDurations, rightContactDurations, jointAngles }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);

  const hasData = strideMetrics?.length > 0 || velocityData?.length > 0;

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setOpen(true);

    const summary = summariseData({ strideMetrics, velocityData, asymmetry, leftContactDurations, rightContactDurations, jointAngles });

    const prompt = `You are an elite sprint biomechanics coach analyzing computer-vision–derived gait data.

Here is a summary of the athlete's running metrics (already cleaned of obvious outliers):
${JSON.stringify(summary, null, 2)}

Reference benchmarks for world-class sprinters (100m):
- Peak speed: 10–12 m/s
- Stride length: 2.0–2.6 m
- Stride frequency: 4.0–5.0 Hz
- Ground contact time: 80–120 ms
- Left/right asymmetry: <5% for all metrics
- Knee flexion at mid-stance: ~90–120°
- Hip extension angle: ~160–175°

Tasks:
1. **Data Quality** (1–2 sentences): Note any values that seem implausible given the context and what was assumed about them.
2. **Key Findings** (bullet list): Compare each metric to world-class benchmarks. Flag deficits.
3. **Limiting Factors**: Identify the 2–3 most significant biomechanical factors preventing world-class sprint performance.
4. **Recommendations**: For each limiting factor, give 1–2 specific, actionable training or technique cues.

Be direct and specific. Format using markdown with bold headers.`;

    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        model: 'claude_sonnet_4_6',
      });
      setResult(typeof res === 'string' ? res : res?.response ?? JSON.stringify(res));
    } catch (e) {
      setError(e.message ?? 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-border/50 bg-card/20">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">AI Sprint Analysis</p>
        </div>
        <div className="flex items-center gap-2">
          {!hasData && (
            <span className="text-xs text-muted-foreground/60">Collect tracking data first</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="border-accent/40 text-accent hover:bg-accent/10 h-7 text-xs"
            disabled={!hasData || loading}
            onClick={runAnalysis}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            {loading ? 'Analysing…' : 'Analyse Performance'}
          </Button>
          {result && (
            <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4">
          {loading && (
            <div className="flex items-center gap-3 py-6 justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span className="text-sm">Analysing biomechanics against world-class benchmarks…</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm py-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {result && (
            <div className="prose prose-sm prose-invert max-w-none text-foreground/90
              [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1
              [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-3 [&_h2]:mb-1
              [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-accent [&_h3]:mt-2 [&_h3]:mb-0.5
              [&_strong]:text-accent [&_ul]:pl-4 [&_li]:text-xs [&_li]:my-0.5 [&_p]:text-xs [&_p]:my-1">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}