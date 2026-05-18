import { useMemo, useState } from "react";
import "./App.css";

type ReviewResult = {
  job_id: string;
  file_name: string;
  report_path: string;
  result: {
    scientific_review: any;
    commercial_review: any;
    risk_review: any;
    integrity_review?: any;
    chair_decision: any;
  };
};

const API_URL = "https://revieweros-api-933794864277.europe-west1.run.app";

const steps = [
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

  async function analyzeFile() {
    if (!file) return;

    setLoading(true);
    setData(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        body: formData,
      });

      const json = await response.json();

      if (json.error) {
        alert(json.error);
        setData(null);
        return;
      }

      if (!json.result) {
        alert("Analysis completed but no result was returned.");
        setData(null);
        return;
      }

      setData(json);
    } catch (error) {
      console.error(error);
      alert("Analysis failed. Make sure the cloud backend is running.");
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
          result: data.result,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate PDF.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${data.job_id}-executive-report.pdf`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("PDF export failed.");
    }
  }

  const chair = data?.result?.chair_decision;
  const risk = data?.result?.risk_review;
  const integrity = data?.result?.integrity_review;

  const agreement = useMemo(() => {
    if (!data) return null;

    const scores = [
      Number(data.result.scientific_review?.score || 0),
      Number(data.result.commercial_review?.score || 0),
      Number(data.result.risk_review?.score || 0),
    ].filter(Boolean);

    if (scores.length < 2) return "Unknown";

    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const spread = max - min;

    if (spread <= 1) return "High";
    if (spread <= 3) return "Medium";
    return "Low";
  }, [data]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/90 px-8 py-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">ReviewerOS</h1>
            <p className="mt-1 text-sm text-slate-400">
              Autonomous AI reviewer panel for grants, accelerators, and startup applications.
            </p>
          </div>

          <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            Cloud Run Backend Connected
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-8 py-10">
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl lg:col-span-1">
            <h2 className="text-xl font-semibold">Upload Application</h2>
            <p className="mt-2 text-sm text-slate-400">
              Upload a TXT, PDF, or DOCX application file and let ReviewerOS simulate an evaluator panel.
            </p>

            <div className="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-6">
              <input
                type="file"
                accept=".txt,.pdf,.docx"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-900"
              />

              {file && (
                <p className="mt-4 text-sm text-slate-400">
                  Selected: <span className="text-white">{file.name}</span>
                </p>
              )}
            </div>

            <button
              onClick={analyzeFile}
              disabled={!file || loading}
              className="mt-6 w-full rounded-2xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Analyzing..." : "Analyze with ReviewerOS"}
            </button>

            {(loading || data) && (
              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-5">
                <h3 className="text-sm font-semibold text-slate-200">Agent Activity Timeline</h3>
                <div className="mt-4 space-y-3">
                  {steps.map((step, index) => (
                    <div key={step} className="flex items-center gap-3 text-sm">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                          data
                            ? "bg-emerald-500 text-slate-950"
                            : loading && index < 4
                              ? "bg-blue-500 text-white"
                              : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {data ? "✓" : index + 1}
                      </span>
                      <span className={data ? "text-slate-200" : "text-slate-400"}>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl lg:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Final Decision</h2>

              {data && (
                <button
                  onClick={downloadReport}
                  className="rounded-xl border border-blue-500/50 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-300 hover:bg-blue-500/20"
                >
                  Download PDF Report
                </button>
              )}
            </div>

            {!data && !loading && (
              <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center text-slate-400">
                Upload an application to generate a structured AI reviewer report.
              </div>
            )}

            {loading && (
              <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-white" />
                <p className="text-slate-300">
                  Scientific, Commercial, Risk, Integrity, and Chair agents are reviewing...
                </p>
              </div>
            )}

            {data && (
              <div className="mt-6 grid gap-4 md:grid-cols-4">
                <MetricCard title="Final Score" value={chair?.final_score ?? "-"} />
                <MetricCard title="Recommendation" value={chair?.recommendation ?? "-"} />
                <MetricCard title="Confidence" value={chair?.confidence ?? "-"} />
                <MetricCard title="Agreement" value={agreement ?? "-"} />
              </div>
            )}

            {data && (
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <BadgePanel
                  title="Risk Severity"
                  value={risk?.risk_level ?? risk?.score ?? "Unknown"}
                  variant={riskVariant(risk?.risk_level, risk?.score)}
                />
                <BadgePanel
                  title="AI-Generated Likelihood"
                  value={integrity?.ai_generated_likelihood ?? "Unknown"}
                  variant={aiLikelihoodVariant(integrity?.ai_generated_likelihood)}
                />
                <BadgePanel
                  title="Integrity Score"
                  value={integrity?.integrity_score ?? "-"}
                  variant="blue"
                />
              </div>
            )}

            {data && (
              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <h3 className="font-semibold text-slate-100">Executive Summary</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {chair?.summary}
                </p>
              </div>
            )}
          </div>
        </section>

        {data && (
          <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-xl font-semibold">Reviewer Agreement Analysis</h2>
            <p className="mt-2 text-sm text-slate-400">
              ReviewerOS compares reviewer scores to estimate alignment across scientific, commercial, and risk perspectives.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-4">
              <ScoreMini title="Scientific" value={data.result.scientific_review?.score} />
              <ScoreMini title="Commercial" value={data.result.commercial_review?.score} />
              <ScoreMini title="Risk" value={data.result.risk_review?.score} />
              <ScoreMini title="Alignment" value={agreement} />
            </div>
          </section>
        )}

        {data && (
          <section className="mt-8 grid gap-6 lg:grid-cols-4">
            <ReviewerCard title="Scientific Reviewer" review={data.result.scientific_review} />
            <ReviewerCard title="Commercial Reviewer" review={data.result.commercial_review} />
            <ReviewerCard title="Risk Reviewer" review={data.result.risk_review} />
            <IntegrityCard review={data.result.integrity_review} />
          </section>
        )}

        {data && (
          <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-xl font-semibold">Final Feedback</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {chair?.final_feedback}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: any }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-bold text-white">{String(value)}</p>
    </div>
  );
}

function BadgePanel({
  title,
  value,
  variant,
}: {
  title: string;
  value: any;
  variant: "green" | "yellow" | "red" | "blue";
}) {
  const styles = {
    green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    yellow: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
    red: "border-red-500/40 bg-red-500/10 text-red-300",
    blue: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  };

  return (
    <div className={`rounded-2xl border p-5 ${styles[variant]}`}>
      <p className="text-sm opacity-80">{title}</p>
      <p className="mt-2 text-xl font-bold">{String(value)}</p>
    </div>
  );
}

function ScoreMini({ title, value }: { title: string; value: any }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-bold text-white">{String(value ?? "-")}</p>
    </div>
  );
}

function ReviewerCard({ title, review }: { title: string; review: any }) {
  const confidence = Number(review?.confidence || 0);
  const confidencePercent = confidence <= 1 ? confidence * 100 : confidence * 10;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <h3 className="text-lg font-semibold">{title}</h3>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 p-4">
        <span className="text-sm text-slate-400">Score</span>
        <span className="text-xl font-bold">{review?.score ?? review?.risk_level ?? "-"}</span>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-950 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Confidence</span>
          <span className="text-xl font-bold">{review?.confidence ?? "-"}</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-slate-800">
          <div
            className="h-2 rounded-full bg-blue-400"
            style={{ width: `${Math.min(confidencePercent, 100)}%` }}
          />
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">
        {review?.justification}
      </p>
    </div>
  );
}

function IntegrityCard({ review }: { review: any }) {
  if (!review) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Integrity Reviewer</h3>
        <p className="mt-4 text-sm text-slate-400">No integrity review available.</p>
      </div>
    );
  }

  const confidence = Number(review?.confidence || 0);
  const confidencePercent = confidence <= 1 ? confidence * 100 : confidence * 10;

  return (
    <div className="rounded-3xl border border-purple-500/30 bg-slate-900 p-6 shadow-xl">
      <h3 className="text-lg font-semibold text-purple-200">Integrity Reviewer</h3>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 p-4">
        <span className="text-sm text-slate-400">Integrity Score</span>
        <span className="text-xl font-bold">{review?.integrity_score ?? "-"}</span>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 p-4">
        <span className="text-sm text-slate-400">AI Likelihood</span>
        <span className="text-xl font-bold">{review?.ai_generated_likelihood ?? "-"}</span>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-950 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Confidence</span>
          <span className="text-xl font-bold">{review?.confidence ?? "-"}</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-slate-800">
          <div
            className="h-2 rounded-full bg-purple-400"
            style={{ width: `${Math.min(confidencePercent, 100)}%` }}
          />
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">
        {review?.justification}
      </p>
    </div>
  );
}

function riskVariant(level?: string, score?: number): "green" | "yellow" | "red" | "blue" {
  const normalized = String(level || "").toLowerCase();

  if (normalized.includes("critical") || normalized.includes("high")) return "red";
  if (normalized.includes("medium")) return "yellow";
  if (normalized.includes("low")) return "green";

  if (typeof score === "number") {
    if (score >= 7) return "red";
    if (score >= 4) return "yellow";
    return "green";
  }

  return "blue";
}

function aiLikelihoodVariant(value?: string): "green" | "yellow" | "red" | "blue" {
  const normalized = String(value || "").toLowerCase();

  if (normalized.includes("high")) return "red";
  if (normalized.includes("medium")) return "yellow";
  if (normalized.includes("low")) return "green";

  return "blue";
}

export default App;