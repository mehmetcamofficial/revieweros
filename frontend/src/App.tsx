import { useState } from "react";
import "./App.css";

type ReviewResult = {
  job_id: string;
  file_name: string;
  report_path: string;
  result: {
    scientific_review: any;
    commercial_review: any;
    risk_review: any;
    chair_decision: any;
  };
};

const API_URL = "http://127.0.0.1:8000";

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

    const response = await fetch(`${API_URL}/analyze`, {
      method: "POST",
      body: formData,
    });

    const json = await response.json();
    setData(json);
    setLoading(false);
  }

  const chair = data?.result?.chair_decision;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/90 px-8 py-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">ReviewerOS</h1>
            <p className="mt-1 text-sm text-slate-400">
              Autonomous AI reviewer panel for grants, accelerators, and startup applications.
            </p>
          </div>

          <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            Gemini Multi-Agent Backend Connected
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
                onChange={(e) => setFile(e.target.files?.[0] || null)}
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
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl lg:col-span-2">
            <h2 className="text-xl font-semibold">Final Decision</h2>

            {!data && !loading && (
              <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center text-slate-400">
                Upload an application to generate a structured AI reviewer report.
              </div>
            )}

            {loading && (
              <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-white" />
                <p className="text-slate-300">Scientific, Commercial, Risk, and Chair agents are reviewing...</p>
              </div>
            )}

            {data && (
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <MetricCard title="Final Score" value={chair?.final_score ?? "-"} />
                <MetricCard title="Recommendation" value={chair?.recommendation ?? "-"} />
                <MetricCard title="Confidence" value={chair?.confidence ?? "-"} />
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
          <section className="mt-8 grid gap-6 lg:grid-cols-3">
            <ReviewerCard title="Scientific Reviewer" review={data.result.scientific_review} />
            <ReviewerCard title="Commercial Reviewer" review={data.result.commercial_review} />
            <ReviewerCard title="Risk Reviewer" review={data.result.risk_review} />
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

function ReviewerCard({ title, review }: { title: string; review: any }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <h3 className="text-lg font-semibold">{title}</h3>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 p-4">
        <span className="text-sm text-slate-400">Score</span>
        <span className="text-xl font-bold">{review?.score ?? review?.risk_level ?? "-"}</span>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 p-4">
        <span className="text-sm text-slate-400">Confidence</span>
        <span className="text-xl font-bold">{review?.confidence ?? "-"}</span>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">
        {review?.justification}
      </p>
    </div>
  );
}

export default App;