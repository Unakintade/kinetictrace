import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Brain, ChevronDown, ChevronUp, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

export default function SprintAnalysis({ strideAnalysis, velocityData, poseHistory }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const hasData =
    (strideAnalysis?.strideMetrics?.length ?? 0) > 0 ||
    (velocityData?.length ?? 0) >= 2;

  const runAnalysis = async () => {
    setLoading(true);
    setReport(null);

    // Summarise raw data for the prompt
    const metrics = strideAnalysis ?? {};
    const strides = metrics.strideMetrics ?? [];
    const asym = metrics.asymmetry ?? {};
    const vData = velocityData ?? [];
    const contactL = metrics.leftContactDurations ?? [];
    const contactR = metrics.rightContactDurations ?? [];

    const avgStrideLength = strides.length
      ? (strides.reduce((s, m) => s + m.strideLength, 0) / strides.length).toFixed(3)
      : null;
    const avgStrideFreq = strides.length
      ? (strides.reduce((s, m) => s + m.strideFreq, 0) / strides.length).toFixed(3)
      : null;
    const peakSpeed = metrics.peakSpeed ?? null;
    const avgSpeed = metrics.avgSpeed ?? null;

    const avgContactL = contactL.length
      ? (contactL.reduce((s, c) => s + c.duration, 0) / contactL.length).toFixed(0)
      : null;
    const avgContactR = contactR.length
      ? (contactR.reduce((s, c) => s + c.duration, 0) / contactR.length).toFixed(0)
      : null;

    // Sample joint angles (every 5th frame to keep prompt short)
    const anglesSample = (metrics.jointAngles ?? [])
      .filter((_, i) => i % 5 === 0)
      .slice(0, 30)
      .map(a => ({
        t: a.t,
        lKnee: a.leftKnee,
        rKnee: a.rightKnee,
        lHip: a.leftHip,
        rHip: a.rightHip,
      }));

    const prompt = `
You are an elite sprint biomechanics coach and data scientist.

Below is raw gait analysis data captured via computer vision from a sprinting video.
Your tasks:
1. **Clean & standardise** the data — identify and explain any implausible values (e.g. stride lengths > 3 m, contact times < 50 ms or > 400 ms, speeds > 12 m/s for non-elite, extreme asymmetry %) and state what you'd correct them to.
2. **Analyse** the cleaned data against world-class sprinting benchmarks (Usain Bolt reference: ~10.44 m/s peak, ~2.44 m stride length, ~4.49 Hz stride frequency, ~80 ms contact time).
3. **Identify the top issues** preventing this athlete from reaching world-class level.
4. **Provide specific, actionable recommendations** for each issue.

### Raw Data
- Peak speed: ${peakSpeed ?? 'N/A'} m/s
- Average speed: ${avgSpeed ?? 'N/A'} m/s
- Average stride length: ${avgStrideLength ?? 'N/A'} m
- Average stride frequency: ${avgStrideFreq ?? 'N/A'} Hz
- Left avg ground contact: ${avgContactL ?? 'N/A'} ms
- Right avg ground contact: ${avgContactR ?? 'N/A'} ms
- Stride length asymmetry: ${asym.strideLength?.pct?.toFixed(1) ?? 'N/A'}% (L: ${asym.strideLength?.left?.toFixed(2) ?? 'N/A'} m, R: ${asym.strideLength?.right?.toFixed(2) ?? 'N/A'} m)
- Stride frequency asymmetry: ${asym.strideFreq?.pct?.toFixed(1) ?? 'N/A'}% (L: ${asym.strideFreq?.left?.toFixed(2) ?? 'N/A'} Hz, R: ${asym.strideFreq?.right?.toFixed(2) ?? 'N/A'} Hz)
- Contact time asymmetry: ${asym.contactTime?.pct?.toFixed(1) ?? 'N/A'}% (L: ${asym.contactTime?.left?.toFixed(0) ?? 'N/A'} ms, R: ${asym.contactTime?.right?.toFixed(0) ?? 'N/A'} ms)
- Stride count: ${strides.length}
- Stance events: ${metrics.stanceEvents?.length ?? 0}

### Joint Angle Sample (time, leftKnee°, rightKnee°, leftHip°, rightHip°)
${anglesSample.map(a => `t=${a.t}s lK=${a.lKnee}° rK=${a.rKnee}° lH=${a.lHip}° rH=${a.rHip}°`).join('\n') || 'No joint angle data'}

Format your response in clear markdown with sections:
## Data Quality & Cleaning
## Performance vs World-Class Benchmarks
## Key Issues Identified
## Recommendations
`;

    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        model: 'gemini_3_pro',
      });
      setReport(result);
      setExpanded(true);
    } catch (err) {
      setReport(`**Error:** ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-border/50 bg-card/20">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Brain className="w-3.5 h-3.5 text-primary" />
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex-1">
          AI Sprint Analysis
        </p>
        <Button
          size="sm"
          onClick={runAnalysis}
          disabled={loading || !hasData}
          className="h-7 text-xs gap-1.5"
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing…</>
          ) : (
            <><Zap className="w-3.5 h-3.5" /> {report ? 'Re-analyse' : 'Analyse'}</>
          )}
        </Button>
        {report && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Report */}
      {report && expanded && (
        <div className="px-6 pb-6 pt-1">
          <div className="prose prose-sm prose-invert max-w-none text-sm
            [&_h2]:text-primary [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2
            [&_h3]:text-foreground/90 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1
            [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:my-1
            [&_ul]:text-muted-foreground [&_ul]:pl-4 [&_li]:my-0.5
            [&_strong]:text-foreground
          ">
            <ReactMarkdown>{report}</ReactMarkdown>
          </div>
        </div>
      )}

      {!hasData && (
        <p className="px-4 pb-3 text-xs text-muted-foreground/60">
          Record some data first — start tracking with calibration markers placed.
        </p>
      )}
    </div>
  );
}