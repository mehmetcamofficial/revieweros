import { useMemo, useState } from "react";
import "./App.css";

type ReviewResult = {
  job_id: string;
  file_name: string;
  report_path?: string;
  result: NormalizedResult;
};

type NormalizedResult = {
  scientific_review: any;
  commercial_review: any;
  risk_review: any;
  integrity_review: any;
  chair_decision: any;
  telemetry?: any;
};

type StreamEvent = {
  type: string;
  job_id?: string;
  file_name?: string;
  agent_key?: string;
  agent_label?: string;
  message?: string;
  duration_seconds?: number;
  tokens?: number;
  result?: any;
  telemetry?: any;
  error?: string;
};

const API_URL = "https://revieweros-api-933794864277.europe-west1.run.app";
const WS_URL = "wss://revieweros-api-933794864277.europe-west1.run.app/ws/analyze";

const reviewerSteps = [
  "Scientific Reviewer",
  "Commercial Reviewer",
  "Risk Reviewer",
  "Integrity Reviewer",
  "Chair Agent",
];

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [telemetry, setTelemetry] = useState<any>(null);

  async function analyzeFile() {
    if (!file) return;

    setLoading(true);
    setData(null);
    setEvents([]);
    setTelemetry(null);

    if (file.name.toLowerCase().endsWith(".txt")) {
      await analyzeWithWebSocket(file);
    } else {
      await analyzeWithRest(file);
    }
  }

  async function analyzeWithWebSocket(selectedFile: File) {
    const applicationText = await selectedFile.text();
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          job_id: crypto.randomUUID(),
          file_name: selectedFile.name,
          application_text: applicationText,
        })
      );
    };

    socket.onmessage = (message) => {
      const event: StreamEvent = JSON.parse(message.data);

      setEvents((previousEvents) => [...previousEvents, event]);

      if (event.telemetry) {
        setTelemetry(event.telemetry);
      }

      if (event.type === "session_completed") {
        const rawResult = event.result || {};
        const normalized = normalizeResult(rawResult);

        setData({
          job_id: rawResult.job_id || event.job_id || crypto.randomUUID(),
          file_name: rawResult.file_name || event.file_name || selectedFile.name,
          result: normalized,
        });

        setTelemetry(normalized.telemetry || event.telemetry || null);
        setLoading(false);
        socket.close();
      }

      if (event.type === "error") {
        alert(event.message || "Streaming analysis failed.");
        setLoading(false);
        socket.close();
      }
    };

    socket.onerror = () => {
      alert("WebSocket connection failed.");
      setLoading(false);
    };
  }

  async function analyzeWithRest(selectedFile: File) {
    const formData = new FormData();
    formData.append("file", selectedFile);

    setEvents([
      {
        type: "session_started",
        agent_label: "ReviewerOS",
        message: "ReviewerOS standard document analysis initialized.",
      },
      {
        type: "agent_started",
        agent_label: "Scientific Reviewer",
        message: "Scientific Reviewer analyzing extracted document text.",
      },
      {
        type: "agent_started",
        agent_label: "Commercial Reviewer",
        message: "Commercial Reviewer evaluating market and commercialization readiness.",
      },
      {
        type: "agent_started",
        agent_label: "Risk Reviewer",
        message: "Risk Reviewer validating operational, compliance, and execution risks.",
      },
      {
        type: "agent_started",
        agent_label: "Integrity Reviewer",
        message: "Integrity Reviewer scanning ethical, evidence, and AI-likelihood signals.",
      },
      {
        type: "chair_started",
        agent_label: "Chair Agent",
        message: "Chair Agent preparing synthesis.",
      },
    ]);

    try {
      const startTime = performance.now();

      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        body: formData,
      });

      const json = await response.json();

      const endTime = performance.now();
      const latencySeconds = Number(((endTime - startTime) / 1000).toFixed(2));

      if (json.error) {
        alert(json.error);
        setData(null);
        setEvents([
          {
            type: "error",
            agent_label: "ReviewerOS",
            message: json.error,
          },
        ]);
        return;
      }

      const normalized = normalizeResult(json.result || {});

      const estimatedTokens = estimateTokensFromResult(normalized);
      const estimatedCost = estimateGeminiFlashLiteCost(estimatedTokens);

      const fallbackTelemetry = {
        model: normalized.telemetry?.model || "gemini-2.5-flash-lite",
        tokens: normalized.telemetry?.tokens || estimatedTokens,
        cost_usd: normalized.telemetry?.cost_usd || estimatedCost,
        latency_seconds: normalized.telemetry?.latency_seconds || latencySeconds,
      };

      const normalizedWithTelemetry = {
        ...normalized,
        telemetry: normalized.telemetry || fallbackTelemetry,
      };

      setData({
        job_id: json.job_id || crypto.randomUUID(),
        file_name: json.file_name || selectedFile.name,
        report_path: json.report_path,
        result: normalizedWithTelemetry,
      });

      setTelemetry(normalized.telemetry || fallbackTelemetry);

      setEvents([
        {
          type: "session_started",
          agent_label: "ReviewerOS",
          message: "ReviewerOS standard document analysis initialized.",
        },
        {
          type: "agent_completed",
          agent_label: "Scientific Reviewer",
          message: "Scientific Reviewer completed document analysis.",
        },
        {
          type: "agent_completed",
          agent_label: "Commercial Reviewer",
          message: "Commercial Reviewer completed commercialization review.",
        },
        {
          type: "agent_completed",
          agent_label: "Risk Reviewer",
          message: "Risk Reviewer completed risk assessment.",
        },
        {
          type: "agent_completed",
          agent_label: "Integrity Reviewer",
          message: "Integrity Reviewer completed integrity review.",
        },
        {
          type: "chair_completed",
          agent_label: "Chair Agent",
          message: "Chair Agent finalized reviewer consensus.",
        },
        {
          type: "session_completed",
          agent_label: "ReviewerOS",
          message: "ReviewerOS standard document analysis completed.",
          telemetry: fallbackTelemetry,
        },
      ]);
    } catch (error) {
      console.error(error);
      alert("Analysis failed.");

      setEvents([
        {
          type: "error",
          agent_label: "ReviewerOS",
          message: "Analysis failed.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function downloadReport() {
    if (!data) return;

    try {
      const response = await fetch(`${API_URL}/report/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_id: data.job_id,
          file_name: data.file_name,
          result: data.result,
        }),
      });

      if (!response.ok) {
        throw new Error("PDF export failed.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${data.job_id}-revieweros-report.pdf`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("PDF export failed.");
    }
  }

  const result = data?.result || null;

  const scientific = result?.scientific_review || {};
  const commercial = result?.commercial_review || {};
  const risk = result?.risk_review || {};
  const integrity = result?.integrity_review || {};
  const chair = result?.chair_decision || {};
  const effectiveTelemetry = telemetry || result?.telemetry || null;

  const agreement = useMemo(() => {
    if (!result) return "-";

    const scores = [
      Number(result.scientific_review?.score),
      Number(result.commercial_review?.score),
      Number(result.risk_review?.score),
    ].filter((score) => !Number.isNaN(score));

    if (scores.length < 2) return "Limited";

    const spread = Math.max(...scores) - Math.min(...scores);

    if (spread <= 1) return "High";
    if (spread <= 3) return "Medium";
    return "Low";
  }, [result]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
      <header className="border-b border-slate-800/80 bg-slate-950/95 px-6 py-6 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight">ReviewerOS</h1>
            <p className="mt-2 max-w-3xl text-slate-400">
              Autonomous AI reviewer panel for grants, accelerators, and startup applications.
            </p>
          </div>

          <div className="w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-300">
            Cloud Run Streaming Backend Connected
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 md:px-8 md:py-10">
        <TelemetryBar telemetry={effectiveTelemetry} loading={loading} events={events} />

        <section className="mt-8 grid gap-6 xl:grid-cols-[380px_1fr]">
          <aside className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl">
            <h2 className="text-2xl font-bold">Upload Application</h2>

            <p className="mt-3 leading-7 text-slate-400">
              TXT files use live WebSocket streaming. PDF and DOCX use standard cloud analysis.
            </p>

            <div className="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-6">
              <input
                id="file-upload"
                type="file"
                accept=".txt,.pdf,.docx,.md"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="hidden"
              />

              <label
                htmlFor="file-upload"
                className="inline-flex w-fit cursor-pointer rounded-xl bg-white px-4 py-2 font-semibold text-slate-900 transition hover:bg-slate-200"
              >
                Dosya Seç
              </label>

              <p className="mt-4 text-slate-400">
                {file ? (
                  <>
                    Selected:{" "}
                    <span className="font-semibold text-white">
                      {shortFileName(file.name)}
                    </span>
                  </>
                ) : (
                  "Henüz dosya seçilmedi"
                )}
              </p>
            </div>

            <button
              onClick={analyzeFile}
              disabled={!file || loading}
              className="mt-6 w-full rounded-2xl bg-white px-5 py-3 text-lg font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Analyzing with ReviewerOS..." : "Analyze with ReviewerOS"}
            </button>

            {(loading || data || events.length > 0) && <AgentTimeline events={events} />}
          </aside>

          <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <h2 className="text-2xl font-bold">Final Decision</h2>

              {data && (
                <button
                  onClick={downloadReport}
                  className="w-fit rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2 font-semibold text-blue-300 transition hover:bg-blue-500/20"
                >
                  Download PDF Report
                </button>
              )}
            </div>

            {!data && !loading && (
              <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-10 text-center text-slate-500">
                Upload an application to generate a structured AI reviewer report.
              </div>
            )}

            {loading && <LiveEventPanel events={events} />}

            {data && (
              <>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard title="Final Score" value={chair?.final_score ?? "-"} />
                  <MetricCard title="Recommendation" value={chair?.recommendation ?? "-"} />
                  <MetricCard title="Confidence" value={chair?.confidence ?? "-"} />
                  <MetricCard title="Agreement" value={agreement} />
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <BadgePanel
                    title="Risk Severity"
                    value={risk?.risk_level || risk?.score || "Unknown"}
                    color={riskColor(risk)}
                  />

                  <BadgePanel
                    title="AI-Generated Likelihood"
                    value={integrity?.ai_generated_likelihood ?? "Unknown"}
                    color={aiLikelihoodColor(integrity?.ai_generated_likelihood)}
                  />

                  <BadgePanel
                    title="Integrity Score"
                    value={integrity?.integrity_score ?? "-"}
                    color="blue"
                  />
                </div>

                <TextPanel title="Executive Summary" text={chair?.summary} />

                <ReviewerInsights
                  scientific={scientific}
                  commercial={commercial}
                  risk={risk}
                  integrity={integrity}
                />

                <ReviewerAgreement
                  scientific={scientific}
                  commercial={commercial}
                  risk={risk}
                  agreement={agreement}
                  chair={chair}
                />

                <TextPanel title="Final Feedback" text={chair?.final_feedback} />
              </>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function TextPanel({ title, text }: { title: string; text?: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-3 max-w-5xl whitespace-pre-wrap text-sm leading-7 text-slate-300">
        {text || "No content available."}
      </p>
    </div>
  );
}

function ReviewerInsights({
  scientific,
  commercial,
  risk,
  integrity,
}: {
  scientific: any;
  commercial: any;
  risk: any;
  integrity: any;
}) {
  return (
    <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-950 p-5">
      <div>
        <h3 className="text-xl font-black tracking-tight">Reviewer Insights</h3>
        <p className="mt-2 text-sm text-slate-400">
          Detailed analysis from each specialized reviewer.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5">
        <ReviewerInsightCard
          title="Scientific Reviewer"
          subtitle="Evaluates scientific merit, methodology, validation, and technical feasibility."
          icon="⚗"
          review={scientific}
          accent="blue"
        />

        <ReviewerInsightCard
          title="Commercial Reviewer"
          subtitle="Assesses market potential, business model, go-to-market, and commercial viability."
          icon="↗"
          review={commercial}
          accent="emerald"
        />

        <ReviewerInsightCard
          title="Risk Reviewer"
          subtitle="Identifies operational, regulatory, ethical, and execution risks."
          icon="🛡"
          review={risk}
          accent="red"
        />

        <ReviewerInsightCard
          title="Integrity Reviewer"
          subtitle="Analyzes AI-likelihood, unsupported claims, ethics, and data governance."
          icon="◉"
          review={integrity}
          accent="purple"
          integrity
        />
      </div>
    </section>
  );
}

function ReviewerInsightCard({
  title,
  subtitle,
  icon,
  review,
  accent,
  integrity = false,
}: {
  title: string;
  subtitle: string;
  icon: string;
  review: any;
  accent: "blue" | "emerald" | "red" | "purple";
  integrity?: boolean;
}) {
  const score = integrity
    ? review?.integrity_score
    : review?.score ?? review?.risk_level ?? "-";

  const secondMetricTitle = integrity ? "AI Likelihood" : "Confidence";
  const secondMetricValue = integrity
    ? review?.ai_generated_likelihood ?? "-"
    : review?.confidence ?? "-";

  const confidence = Number(review?.confidence || 0);
  const confidencePercent = confidence <= 1 ? confidence * 100 : confidence * 10;
  const styles = reviewerAccentStyles(accent);

  return (
    <article
      className={`premium-card-enter grid min-w-0 gap-5 rounded-3xl border bg-slate-900/70 p-5 shadow-xl transition hover:-translate-y-1 hover:shadow-2xl xl:grid-cols-[260px_1fr] ${styles.border} ${styles.glow}`}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-xl ${styles.icon}`}
          >
            {icon}
          </div>

          <div className="min-w-0">
            <h4 className="text-xl font-black leading-tight text-white">{title}</h4>
            <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
          </div>
        </div>

        {review?.error && (
          <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm leading-6 text-yellow-200">
            Fallback mode active. Reviewer output was recovered after an agent error.
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3">
          <ReviewerMetricBlock
            label={integrity ? "Integrity Score" : "Score"}
            value={score ?? "-"}
            accent={accent}
          />

          <ReviewerMetricBlock
            label={secondMetricTitle}
            value={secondMetricValue}
            accent={accent}
            progress={!integrity ? confidencePercent : undefined}
          />

          {integrity && (
            <ReviewerMetricBlock
              label="Confidence"
              value={review?.confidence ?? "-"}
              accent={accent}
              progress={confidencePercent}
            />
          )}
        </div>
      </div>

      <div className="min-h-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Reviewer Rationale
        </p>

        <div className="reviewer-scroll max-h-[210px] overflow-y-auto pr-2">
          <p className="text-sm leading-6 text-slate-300">
            {review?.justification || "No justification available."}
          </p>
        </div>
      </div>
    </article>
  );
}

function ReviewerMetricBlock({
  label,
  value,
  accent,
  progress,
}: {
  label: string;
  value: any;
  accent: "blue" | "emerald" | "red" | "purple";
  progress?: number;
}) {
  const styles = reviewerAccentStyles(accent);

  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className={`whitespace-nowrap text-sm font-semibold ${styles.text}`}>
          {label}
        </p>

        <p className="shrink-0 text-right text-2xl font-black text-white">
          {String(value)}
        </p>
      </div>

      {typeof progress === "number" && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-2 rounded-full ${styles.bar}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ReviewerAgreement({
  scientific,
  commercial,
  risk,
  agreement,
  chair,
}: {
  scientific: any;
  commercial: any;
  risk: any;
  agreement: string;
  chair: any;
}) {
  return (
    <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-950 p-5">
      <h3 className="text-xl font-black tracking-tight">Reviewer Agreement Analysis</h3>

      <p className="mt-2 text-sm text-slate-400">Alignment across reviewer perspectives.</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Scientific" value={scientific?.score ?? "-"} />
        <MetricCard title="Commercial" value={commercial?.score ?? "-"} />
        <MetricCard title="Risk" value={risk?.score ?? "-"} />
        <MetricCard title="Overall Alignment" value={agreement} />
      </div>

      <p className="mt-5 max-w-5xl text-sm leading-7 text-slate-300">
        {chair?.summary ||
          "ReviewerOS compares reviewer scores to estimate alignment across scientific, commercial, and risk perspectives."}
      </p>
    </section>
  );
}

function MetricCard({ title, value }: { title: string; value: any }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-3 break-words text-2xl font-black">{String(value)}</p>
    </div>
  );
}

function BadgePanel({
  title,
  value,
  color,
}: {
  title: string;
  value: any;
  color: "red" | "green" | "blue" | "yellow";
}) {
  const styles = {
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    yellow: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  };

  return (
    <div className={`min-w-0 rounded-2xl border p-5 ${styles[color]}`}>
      <p className="text-sm opacity-80">{title}</p>
      <p className="mt-3 break-words text-3xl font-black">{String(value)}</p>
    </div>
  );
}

function normalizeResult(raw: any): NormalizedResult {
  return {
    scientific_review: normalizeReviewer(raw?.scientific_review || raw?.scientific || {}, "Scientific Reviewer"),
    commercial_review: normalizeReviewer(raw?.commercial_review || raw?.commercial || {}, "Commercial Reviewer"),
    risk_review: normalizeRiskReviewer(raw?.risk_review || raw?.risk || {}),
    integrity_review: normalizeIntegrityReviewer(raw?.integrity_review || raw?.integrity || {}),
    chair_decision: normalizeChair(raw?.chair_decision || raw?.chair || {}),
    telemetry: raw?.telemetry || null,
  };
}

function normalizeReviewer(review: any, agentName: string) {
  const hasError = Boolean(review?.error || review?.parse_error);

  return {
    agent: review?.agent || agentName,
    score: review?.score ?? (hasError ? 4 : "-"),
    strengths: Array.isArray(review?.strengths) ? review.strengths : [],
    weaknesses: Array.isArray(review?.weaknesses) ? review.weaknesses : [],
    risks: Array.isArray(review?.risks) ? review.risks : [],
    confidence: review?.confidence ?? (hasError ? 0.35 : "-"),
    justification:
      review?.justification ||
      review?.summary ||
      (hasError ? `Reviewer failed: ${review?.error || "Unknown error"}` : "No justification available."),
    error: review?.error || null,
  };
}

function normalizeRiskReviewer(review: any) {
  const hasError = Boolean(review?.error || review?.parse_error);

  return {
    agent: review?.agent || "Risk Reviewer",
    risk_level: review?.risk_level || (hasError ? "High" : "Unknown"),
    score: review?.score ?? (hasError ? 8 : "-"),
    major_risks: Array.isArray(review?.major_risks) ? review.major_risks : [],
    inconsistencies: Array.isArray(review?.inconsistencies) ? review.inconsistencies : [],
    ethics_flags: Array.isArray(review?.ethics_flags) ? review.ethics_flags : [],
    confidence: review?.confidence ?? (hasError ? 0.35 : "-"),
    justification:
      review?.justification ||
      (hasError ? `Risk Reviewer failed: ${review?.error || "Unknown error"}` : "No justification available."),
    error: review?.error || null,
  };
}

function normalizeIntegrityReviewer(review: any) {
  const hasError = Boolean(review?.error || review?.parse_error);

  return {
    agent: review?.agent || "Integrity Reviewer",
    integrity_score: review?.integrity_score ?? (hasError ? 4 : "-"),
    ai_generated_likelihood: review?.ai_generated_likelihood || (hasError ? "Unknown" : "-"),
    unsupported_claims: Array.isArray(review?.unsupported_claims) ? review.unsupported_claims : [],
    red_flags: Array.isArray(review?.red_flags) ? review.red_flags : [],
    contradictions: Array.isArray(review?.contradictions) ? review.contradictions : [],
    confidence: review?.confidence ?? (hasError ? 0.35 : "-"),
    justification:
      review?.justification ||
      (hasError ? `Integrity Reviewer failed: ${review?.error || "Unknown error"}` : "No justification available."),
    error: review?.error || null,
  };
}

function normalizeChair(chair: any) {
  return {
    agent: chair?.agent || "Chair Agent",
    final_score: chair?.final_score ?? "-",
    recommendation: chair?.recommendation || "Review Required",
    summary: chair?.summary || "No executive summary available.",
    top_strengths: Array.isArray(chair?.top_strengths) ? chair.top_strengths : [],
    top_weaknesses: Array.isArray(chair?.top_weaknesses) ? chair.top_weaknesses : [],
    top_risks: Array.isArray(chair?.top_risks) ? chair.top_risks : [],
    integrity_notes: Array.isArray(chair?.integrity_notes) ? chair.integrity_notes : [],
    final_feedback: chair?.final_feedback || "No final feedback available.",
    confidence: chair?.confidence ?? "-",
    synthesis_mode: chair?.synthesis_mode || "ai_synthesis",
    chair_error: chair?.chair_error || null,
  };
}

function TelemetryBar({ telemetry, loading, events }: { telemetry: any; loading: boolean; events: StreamEvent[] }) {
  const completedAgents = getCompletedAgents(events);
  const totalAgents = 5;
  const activeAgents = loading ? Math.max(0, totalAgents - completedAgents) : 0;

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard title="Model" value={telemetry?.model || "gemini-2.5-flash-lite"} />
      <MetricCard title="Tokens" value={formatTelemetryValue(telemetry?.tokens)} />
      <MetricCard title="Estimated Cost" value={formatCost(telemetry?.cost_usd)} />
      <MetricCard
        title="Latency"
        value={
          telemetry?.latency_seconds
            ? `${telemetry.latency_seconds}s`
            : loading
              ? "Analyzing..."
              : "-"
        }
      />
      <MetricCard
        title="Agent Status"
        value={
          loading
            ? `${activeAgents} active`
            : completedAgents > 0
              ? `${completedAgents}/${totalAgents} completed`
              : "-"
        }
      />
    </section>
  );
}

function AgentTimeline({ events }: { events: StreamEvent[] }) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <h3 className="text-lg font-semibold">Agent Activity Timeline</h3>

      <div className="mt-5 space-y-4">
        {reviewerSteps.map((step) => {
          const completed = isAgentCompleted(events, step);
          const failed = isAgentFailed(events, step);
          const active = isAgentActive(events, step);

          return (
            <div key={step} className="flex items-center gap-3">
              <div
                className={`h-5 w-5 shrink-0 rounded-full ${
                  completed
                    ? "bg-emerald-400"
                    : failed
                      ? "bg-yellow-400"
                      : active
                        ? "animate-pulse bg-cyan-400"
                        : "bg-slate-700"
                }`}
              />
              <span
                className={
                  completed
                    ? "text-white"
                    : failed
                      ? "text-yellow-200"
                      : active
                        ? "text-cyan-200"
                        : "text-slate-400"
                }
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveEventPanel({ events }: { events: StreamEvent[] }) {
  const completedCount = getCompletedAgents(events);
  const progress = Math.min(100, Math.round((completedCount / 5) * 100));

  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-black p-6">
      <div className="flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-cyan-400" />
      </div>

      <h3 className="mt-4 text-center text-3xl font-bold">Live Reviewer Stream</h3>

      <div className="mx-auto mt-6 max-w-xl">
        <div className="mb-2 flex items-center justify-between text-sm text-slate-400">
          <span>Reviewer Progress</span>
          <span>{progress}%</span>
        </div>

        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-3 rounded-full bg-cyan-400 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-cyan-300">ReviewerOS Orchestration Console</p>
            <p className="text-xs text-slate-500">Real-time multi-agent execution trace</p>
          </div>

          <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            STREAM LIVE
          </div>
        </div>

        <div className="reviewer-scroll max-h-[420px] space-y-3 overflow-y-auto font-mono text-sm">
          {events.map((event, index) => (
            <div key={`${event.type}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    event.type.includes("failed") || event.type === "error"
                      ? "bg-yellow-400"
                      : event.type.includes("completed")
                        ? "bg-emerald-400"
                        : "animate-pulse bg-cyan-400"
                  }`}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-slate-500">[{new Date().toLocaleTimeString()}]</span>
                    <span className="text-xs uppercase tracking-widest text-cyan-300">
                      {event.type.replaceAll("_", " ")}
                    </span>
                  </div>

                  <p className="mt-2 leading-6 text-slate-200">{humanizeEvent(event)}</p>

                  {(event.duration_seconds || event.tokens) && (
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                      {event.duration_seconds && <span>Duration: {event.duration_seconds}s</span>}
                      {event.tokens && <span>Tokens: {event.tokens.toLocaleString()}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {events.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-slate-500">
              Connecting to orchestration engine...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getCompletedAgents(events: StreamEvent[]) {
  const completed = new Set<string>();

  events.forEach((event) => {
    if (
      (event.type === "agent_completed" ||
        event.type === "agent_failed" ||
        event.type === "chair_completed") &&
      event.agent_label
    ) {
      completed.add(event.agent_label);
    }
  });

  return completed.size;
}

function isAgentCompleted(events: StreamEvent[], agentLabel: string) {
  return events.some(
    (event) =>
      event.agent_label === agentLabel &&
      (event.type === "agent_completed" ||
        event.type === "agent_failed" ||
        event.type === "chair_completed")
  );
}

function isAgentFailed(events: StreamEvent[], agentLabel: string) {
  return events.some(
    (event) =>
      event.agent_label === agentLabel &&
      (event.type === "agent_failed" || event.type === "error")
  );
}

function isAgentActive(events: StreamEvent[], agentLabel: string) {
  const started = events.some(
    (event) =>
      event.agent_label === agentLabel &&
      (event.type === "agent_started" || event.type === "chair_started")
  );

  const completed = isAgentCompleted(events, agentLabel);

  return started && !completed;
}

function humanizeEvent(event: StreamEvent) {
  if (event.message) return event.message;

  if (event.type === "session_started") return "ReviewerOS orchestration session initialized.";
  if (event.type === "chair_started") return "Chair Agent synthesizing reviewer consensus.";
  if (event.type === "agent_completed") return `${event.agent_label} completed review successfully.`;
  if (event.type === "agent_failed") return `${event.agent_label} failed, but ReviewerOS generated a safe fallback output and continued orchestration.`;
  if (event.type === "chair_completed") return "Chair Agent finalized executive recommendation.";
  if (event.type === "session_completed") return "ReviewerOS orchestration completed.";
  if (event.type === "error") return event.error || "Analysis failed.";

  if (event.type === "agent_started") {
    switch (event.agent_label) {
      case "Scientific Reviewer":
        return "Scientific Reviewer analyzing methodology and novelty.";
      case "Commercial Reviewer":
        return "Commercial Reviewer evaluating commercialization readiness.";
      case "Risk Reviewer":
        return "Risk Reviewer validating operational and compliance risks.";
      case "Integrity Reviewer":
        return "Integrity Reviewer scanning ethical and AI-generated patterns.";
    }
  }

  return "Processing.";
}

function riskColor(risk: any): "red" | "green" | "blue" | "yellow" {
  const level = String(risk?.risk_level || "").toLowerCase();
  const score = Number(risk?.score || 0);

  if (level.includes("high") || score >= 7) return "red";
  if (level.includes("medium") || score >= 4) return "yellow";
  if (level.includes("low")) return "green";
  return "blue";
}

function aiLikelihoodColor(value: any): "red" | "green" | "blue" | "yellow" {
  const normalized = String(value || "").toLowerCase();

  if (normalized.includes("high")) return "red";
  if (normalized.includes("medium")) return "yellow";
  if (normalized.includes("low")) return "green";
  return "blue";
}

function reviewerAccentStyles(accent: "blue" | "emerald" | "red" | "purple") {
  const styles = {
    blue: {
      border: "border-blue-500/40",
      glow: "hover:shadow-blue-500/10",
      icon: "border-blue-500/40 bg-blue-500/10 text-blue-300",
      text: "text-blue-300",
      bar: "bg-blue-400",
    },
    emerald: {
      border: "border-emerald-500/40",
      glow: "hover:shadow-emerald-500/10",
      icon: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      text: "text-emerald-300",
      bar: "bg-emerald-400",
    },
    red: {
      border: "border-red-500/40",
      glow: "hover:shadow-red-500/10",
      icon: "border-red-500/40 bg-red-500/10 text-red-300",
      text: "text-red-300",
      bar: "bg-red-400",
    },
    purple: {
      border: "border-purple-500/40",
      glow: "hover:shadow-purple-500/10",
      icon: "border-purple-500/40 bg-purple-500/10 text-purple-300",
      text: "text-purple-300",
      bar: "bg-purple-400",
    },
  };

  return styles[accent];
}

function shortFileName(fileName: string, maxLength = 72) {
  if (fileName.length <= maxLength) return fileName;

  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex !== -1 ? fileName.slice(dotIndex) : "";
  const baseName = dotIndex !== -1 ? fileName.slice(0, dotIndex) : fileName;

  const trimmedBase = baseName.slice(0, Math.max(12, maxLength - extension.length - 3));

  return `${trimmedBase}...${extension}`;
}

function formatTelemetryValue(value: any) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function formatCost(value: any) {
  if (value === undefined || value === null || value === "") return "-";
  if (value === "-") return "-";

  const numeric = Number(value);

  if (Number.isNaN(numeric)) return String(value);

  return `$${numeric.toFixed(6)}`;
}

function estimateTokensFromResult(result: any) {
  const text = JSON.stringify(result || "");
  const estimated = Math.ceil(text.length / 4);

  return Math.max(estimated, 1000);
}

function estimateGeminiFlashLiteCost(tokens: number) {
  const estimatedUsd = (tokens / 1_000_000) * 0.35;

  return Number(estimatedUsd.toFixed(6));
}

export default App;