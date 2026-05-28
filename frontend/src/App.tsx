import { useEffect, useMemo, useRef, useState } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./App.css";

type AuthSession = {
  userId: string;
  accessCode: string;
  mode?: "demo" | "admin";
};

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

type RecentAnalysis = {
  job_id: string;
  user_id?: string | null;
  file_name?: string;
  created_at?: string;
  final_score?: number | string | null;
  recommendation?: string | null;
  confidence?: number | string | null;
  risk_level?: string | null;
  integrity_score?: number | string | null;
  ai_generated_likelihood?: string | null;
  model?: string | null;
  tokens?: number | string | null;
  latency_seconds?: number | string | null;
};

const API_URL = "https://revieweros-api-933794864277.europe-west1.run.app";
const WS_URL = "wss://revieweros-api-933794864277.europe-west1.run.app/ws/analyze";
const AUTH_STORAGE_KEY = "revieweros_auth_session_v2";
const WORKSPACE_MONTHLY_QUOTA = 25;
const REQUEST_ACCESS_ENDPOINT = `${API_URL}/request-access`;

const ADMIN_API_QUOTA_ENDPOINT = `${API_URL}/admin/quota`;

const ADMIN_WORKSPACES_ENDPOINT = `${API_URL}/admin/workspaces`;
const ADMIN_WORKSPACE_STATUS_ENDPOINT = `${API_URL}/admin/workspace-status`;
const ADMIN_DEMO_CONTROL_ENDPOINT = `${API_URL}/admin/demo-control`;

const ADMIN_USERS_ENDPOINT = `${API_URL}/admin/users`;
const ADMIN_USERS_CREATE_ENDPOINT = `${API_URL}/admin/users/create`;
const ADMIN_USERS_DISABLE_ENDPOINT = `${API_URL}/admin/users/disable`;
const ADMIN_USERS_ACCESS_CODE_ENDPOINT = `${API_URL}/admin/users/access-code`;






const SAMPLE_REPORT_URL =
  `${API_URL}/analyses/4e5fdf73-5a90-4f88-a265-3b3fab78ebad/report`;

const reviewerSteps = [
  "Scientific Reviewer",
  "Commercial Reviewer",
  "Risk Reviewer",
  "Integrity Reviewer",
  "Chair Agent",
];

function App() {

  useEffect(() => {
    const styleId = "evalora-shared-brand-animations";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      @keyframes evaloraOrbitSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes evaloraOrbitSpinReverse {
        from { transform: rotate(360deg); }
        to { transform: rotate(0deg); }
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existing = document.getElementById(styleId);
      if (existing) existing.remove();
    };
  }, []);


  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    window.localStorage.removeItem("revieweros_auth_session");
    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);

      if (!parsed?.userId || !parsed?.accessCode) {
        return null;
      }

      return {
        userId: String(parsed.userId),
        accessCode: String(parsed.accessCode),
      };
    } catch {
      return null;
    }
  });

  const [authChecking, setAuthChecking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [data, setData] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [recentAnalyses, setRecentAnalyses] = useState<RecentAnalysis[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showPublicLanding, setShowPublicLanding] = useState(() => {
    return window.location.hash !== "#login";
  });
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestEmail, setRequestEmail] = useState("");
  const [requestOrganization, setRequestOrganization] = useState("");
  const [requestUseCase, setRequestUseCase] = useState("Grant proposal review demo");
  const [requestExpectedVolume, setRequestExpectedVolume] = useState("10");

  const finalDecisionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!authSession) return;
    if ((authSession as any)?.mode === "admin") return;
    if ((authSession as any).mode === "admin") return;
    if ((authSession as any).mode === "admin") return;

    loadRecentAnalyses();
    if ((authSession as any)?.mode !== "admin") {
      bootSharedReport();
    }

    const handleRouteChange = () => {
      bootSharedReport(true);
    };

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);

    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
    };
  }, [authSession?.userId, authSession?.accessCode]);

  function getAuthHeaders(): Record<string, string> {
    if (!authSession) {
      return {};
    }

    return {
      "X-ReviewerOS-User-Id": authSession.userId,
      "X-ReviewerOS-Access-Code": authSession.accessCode,
    };
  }

  function showToast(message: string) {
    setToast(message);

    window.setTimeout(() => {
      setToast(null);
    }, 2200);
  }

  async function handleRequestAccessSubmit() {
    const email = requestEmail.trim();
    const organization = requestOrganization.trim();
    const useCase = requestUseCase.trim();
    const expectedVolume = requestExpectedVolume.trim();

    if (!email || !email.includes("@")) {
      alert("Please enter a valid email address.");
      return;
    }

    if (!organization) {
      alert("Please enter your organization or workspace name.");
      return;
    }

    if (!useCase) {
      alert("Please describe your use case.");
      return;
    }

    try {
      setRequestSubmitting(true);

      const response = await fetch(REQUEST_ACCESS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          organization,
          use_case: useCase,
          expected_volume: expectedVolume,
          source: "evalora-web",
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Request access failed.");
      }

      setRequestModalOpen(false);
      setRequestEmail("");
      setRequestOrganization("");
      setRequestUseCase("Grant proposal review demo");
      setRequestExpectedVolume("10");
      showToast("Access request received ✓");
    } catch (error: any) {
      alert(error?.message || "Request access failed.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  async function handleLogin(
    userId: string,
    accessCode: string,
    mode: "demo" | "admin" = "demo",
  ) {
    const cleanedUserId = userId.trim();
    const cleanedAccessCode = accessCode.trim();

    if (!cleanedUserId || !cleanedAccessCode) {
      setAuthError("Please enter both User ID and Access Code.");
      return;
    }

    setAuthChecking(true);
    setAuthError(null);

    try {
      const response =
        mode === "admin"
          ? await fetch(`${API_URL}/admin/check`, {
              headers: {
                "X-ReviewerOS-Access-Code": cleanedAccessCode,
              },
            })
          : await fetch(`${API_URL}/auth/check`, {
              headers: {
                "X-ReviewerOS-User-Id": cleanedUserId,
                "X-ReviewerOS-Access-Code": cleanedAccessCode,
              },
            });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || json.error || "Invalid access code.");
      }

      const nextSession = {
        userId: json.user_id || cleanedUserId,
        accessCode: cleanedAccessCode.trim(),
        mode,
      };

      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
      setAuthSession(nextSession);
      setAuthError(null);
      showToast("Signed in ✓");
    } catch (error: any) {
      setAuthError(error?.message || "Login failed.");
      setAuthSession(null);
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } finally {
      setAuthChecking(false);
    }
  }

  function resetWorkspaceForNewAnalysis() {
    setFile(null);
    setData(null);
    setEvents([]);
    setTelemetry(null);
    setSelectedHistoryJobId(null);

    if (
      window.location.pathname.startsWith("/report/") ||
      window.location.search.includes("report=") ||
      window.location.hash.includes("report=")
    ) {
      window.history.pushState({}, "", "/");
    }

    showToast("Ready for a new analysis ✓");
  }

  function clearRecentAnalysesView() {
    const confirmed = window.confirm(
      "Clear the recent analyses list from this view? Saved reports will remain in Firestore."
    );

    if (!confirmed) return;

    setRecentAnalyses([]);
    setSelectedHistoryJobId(null);
    showToast("Recent analyses cleared from view ✓");
  }

  function handleLogout() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthSession(null);
    setFile(null);
    setData(null);
    setEvents([]);
    setTelemetry(null);
    setRecentAnalyses([]);
    setSelectedHistoryJobId(null);

    if (
      window.location.pathname.startsWith("/report/") ||
      window.location.search.includes("report=") ||
      window.location.hash.includes("report=")
    ) {
      window.history.pushState({}, "", "/");
    }
  }

  async function loadRecentAnalyses() {
    if ((authSession as any)?.mode === "admin") return;
    if ((authSession as any)?.mode === "admin") return;
    if (!authSession) return;

    try {
      setHistoryLoading(true);

      const response = await fetch(`${API_URL}/analyses?limit=10`, {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        handleLogout();
        return;
      }

      const json = await response.json();

      setRecentAnalyses(Array.isArray(json.items) ? json.items : []);
    } catch (error) {
      console.error("Failed to load recent analyses:", error);
      setRecentAnalyses([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function bootSharedReport(scroll = false) {
    if (!authSession) return;

    const jobId = getReportJobIdFromPath();

    if (!jobId) return;

    setLoading(true);
    setData(null);
    setTelemetry(null);
    setSelectedHistoryJobId(jobId);

    try {
      await loadSavedAnalysis(jobId, {
        pushUrl: false,
        scroll,
        toast: "Shareable report loaded ✓",
      });
    } finally {
      setLoading(false);
    }
  }

  async function analyzeFile() {
    if (!file || !authSession) return;

    setLoading(true);
    setData(null);
    setEvents([]);
    setTelemetry(null);
    setSelectedHistoryJobId(null);

    if (
      window.location.pathname.startsWith("/report/") ||
      window.location.search.includes("report=") ||
      window.location.hash.includes("report=")
    ) {
      window.history.pushState({}, "", "/");
    }

    if (file.name.toLowerCase().endsWith(".txt")) {
      await analyzeWithWebSocket(file);
    } else {
      await analyzeWithRest(file);
    }
  }

  async function analyzeWithWebSocket(selectedFile: File) {
    if (!authSession) return;

    const applicationText = await selectedFile.text();
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          job_id: crypto.randomUUID(),
          file_name: selectedFile.name,
          application_text: applicationText,
          user_id: authSession.userId,
          access_code: authSession.accessCode,
        })
      );
    };

    socket.onmessage = async (message) => {
      const event: StreamEvent = JSON.parse(message.data);

      setEvents((previousEvents) => [...previousEvents, event]);

      if (event.telemetry) {
        setTelemetry(event.telemetry);
      }

      if (event.type === "session_completed") {
        const rawResult = event.result || {};
        const normalized = normalizeResult(rawResult);

        const completedData = {
          job_id: rawResult.job_id || event.job_id || crypto.randomUUID(),
          file_name: rawResult.file_name || event.file_name || selectedFile.name,
          result: normalized,
        };

        setData(completedData);
        setTelemetry(normalized.telemetry || event.telemetry || null);
        setLoading(false);
        socket.close();

        await saveAnalysisToHistory(completedData);
        if (authSession?.mode !== "admin") {
        await loadRecentAnalyses();
      }

        showToast("Analysis completed and saved ✓");

        window.setTimeout(() => {
          finalDecisionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
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
    if (!authSession) return;

    const formData = new FormData();
    formData.append("file", selectedFile);

    setEvents([
      {
        type: "session_started",
        agent_label: "ReviewerOS",
        message: "Evalora orchestration initialized. Preparing specialist reviewer agents.",
      },
      {
        type: "agent_started",
        agent_label: "Scientific Reviewer",
        message: "Scientific Reviewer analyzing methodology, novelty, validation, and technical feasibility.",
      },
      {
        type: "agent_started",
        agent_label: "Commercial Reviewer",
        message: "Commercial Reviewer evaluating market potential, business model, GTM readiness, and scalability.",
      },
      {
        type: "agent_started",
        agent_label: "Risk Reviewer",
        message: "Risk Reviewer assessing operational, regulatory, ethical, and execution risks.",
      },
      {
        type: "agent_started",
        agent_label: "Integrity Reviewer",
        message: "Integrity Reviewer checking unsupported claims, evidence quality, and AI-generated likelihood.",
      },
      {
        type: "chair_started",
        agent_label: "Chair Agent",
        message: "Chair Agent synthesizing reviewer consensus and final recommendation.",
      },
    ]);

    try {
      const startTime = performance.now();

      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      const json = await response.json();

      const endTime = performance.now();
      const latencySeconds = Number(((endTime - startTime) / 1000).toFixed(2));

      if (response.status === 401) {
        alert("Invalid or expired access code. Please sign in again.");
        handleLogout();
        return;
      }

      if (!response.ok || json.error) {
        alert(json.error || json.detail || "Analysis failed.");
        setData(null);
        setEvents([
          {
            type: "error",
            agent_label: "ReviewerOS",
            message: json.error || json.detail || "Analysis failed.",
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

      const completedData = {
        job_id: json.job_id || crypto.randomUUID(),
        file_name: json.file_name || selectedFile.name,
        report_path: json.report_path,
        result: normalizedWithTelemetry,
      };

      setData(completedData);
      setTelemetry(normalized.telemetry || fallbackTelemetry);
      setSelectedHistoryJobId(completedData.job_id);

      setEvents([
        {
          type: "session_started",
          agent_label: "ReviewerOS",
          message: "Evalora orchestration initialized. Preparing specialist reviewer agents.",
        },
        {
          type: "agent_completed",
          agent_label: "Scientific Reviewer",
          message: "Scientific Reviewer completed methodology and feasibility assessment.",
        },
        {
          type: "agent_completed",
          agent_label: "Commercial Reviewer",
          message: "Commercial Reviewer completed GTM and commercial viability assessment.",
        },
        {
          type: "agent_completed",
          agent_label: "Risk Reviewer",
          message: "Risk Reviewer completed operational and compliance risk assessment.",
        },
        {
          type: "agent_completed",
          agent_label: "Integrity Reviewer",
          message: "Integrity Reviewer completed evidence and integrity assessment.",
        },
        {
          type: "chair_completed",
          agent_label: "Chair Agent",
          message: "Chair Agent finalized consensus, score, and recommendation.",
        },
        {
          type: "session_completed",
          agent_label: "ReviewerOS",
          message: "Evalora multi-agent review completed.",
          telemetry: fallbackTelemetry,
        },
      ]);

      if (authSession?.mode !== "admin") {
        await loadRecentAnalyses();
      }

      showToast("Analysis completed and saved ✓");

      window.setTimeout(() => {
        finalDecisionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
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

  async function saveAnalysisToHistory(analysis: ReviewResult) {
    if (!authSession) return;

    try {
      await fetch(`${API_URL}/analyses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          job_id: analysis.job_id,
          file_name: analysis.file_name,
          result: analysis.result,
          report_path: analysis.report_path,
        }),
      });
    } catch (error) {
      console.error("Failed to save analysis history:", error);
    }
  }

  async function downloadReport() {
    if (!data || !authSession) return;

    try {
      const response = await fetch(`${API_URL}/report/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
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

      await downloadBlobResponse(response, `${data.job_id}-revieweros-report.pdf`);
      if (authSession?.mode !== "admin") {
        await loadRecentAnalyses();
      }

      showToast("PDF report downloaded ✓");
    } catch (error) {
      console.error(error);
      alert("PDF export failed.");
    }
  }

  async function downloadSavedReport(jobId: string) {
    try {
      const response = await fetch(`${API_URL}/analyses/${jobId}/report`);

      if (!response.ok) {
        throw new Error("Saved PDF export failed.");
      }

      await downloadBlobResponse(response, `${jobId}-revieweros-report.pdf`);

      setSelectedHistoryJobId(jobId);
      showToast("Saved PDF downloaded ✓");
    } catch (error) {
      console.error(error);
      alert("Saved PDF export failed.");
    }
  }

  async function loadSavedAnalysis(
    jobId: string,
    options: {
      pushUrl?: boolean;
      scroll?: boolean;
      toast?: string;
    } = {}
  ) {
    if (!authSession) return;

    const { pushUrl = true, scroll = true, toast = "Loaded from history ✓" } = options;

    try {
      const response = await fetch(`${API_URL}/analyses/${jobId}`, {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        alert("Invalid or expired access code. Please sign in again.");
        handleLogout();
        return;
      }

      const json = await response.json();

      if (!response.ok || json.error || !json.result) {
        alert(json.error || json.detail || `Saved analysis could not be loaded for report ID: ${jobId}`);
        setData(null);
        setTelemetry(null);
        setSelectedHistoryJobId(null);
        return;
      }

      const normalized = normalizeResult(json.result);

      setData({
        job_id: json.job_id || jobId,
        file_name: json.file_name || "Saved analysis",
        report_path: json.report_path,
        result: normalized,
      });

      setTelemetry(normalized.telemetry || null);
      setSelectedHistoryJobId(jobId);

      setEvents([
        {
          type: "session_started",
          agent_label: "ReviewerOS",
          message: "Saved Evalora analysis loaded from workspace history.",
        },
        {
          type: "agent_completed",
          agent_label: "Scientific Reviewer",
          message: "Scientific Reviewer result loaded.",
        },
        {
          type: "agent_completed",
          agent_label: "Commercial Reviewer",
          message: "Commercial Reviewer result loaded.",
        },
        {
          type: "agent_completed",
          agent_label: "Risk Reviewer",
          message: "Risk Reviewer result loaded.",
        },
        {
          type: "agent_completed",
          agent_label: "Integrity Reviewer",
          message: "Integrity Reviewer result loaded.",
        },
        {
          type: "chair_completed",
          agent_label: "Chair Agent",
          message: "Chair consensus synthesis loaded.",
        },
      ]);

      if (pushUrl) {
        window.history.pushState({}, "", `/#report=${encodeURIComponent(jobId)}`);
      }

      showToast(toast);

      if (scroll) {
        window.setTimeout(() => {
          finalDecisionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to load saved analysis.");
    }
  }

  async function shareReport(jobId?: string | null) {
    if (!jobId) {
      alert("No report is available to share yet.");
      return;
    }

    const shareUrl = `${API_URL}/analyses/${encodeURIComponent(jobId)}/report`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("PDF report link copied ✓");
    } catch (error) {
      console.error(error);
      window.prompt("Copy this PDF report link:", shareUrl);
    }
  }

  const result = data?.result || null;

  const scientific = result?.scientific_review || {};
  const commercial = result?.commercial_review || {};
  const risk = result?.risk_review || {};
  const integrity = result?.integrity_review || {};
  const chair = result?.chair_decision || {};
  const effectiveTelemetry = telemetry || result?.telemetry || null;

  const filePreviewUrl = useMemo(() => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      return null;
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

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

  if (!authSession) {
    if (showPublicLanding) {
      return (
        <>
          <RequestAccessModal
            open={requestModalOpen}
            email={requestEmail}
            organization={requestOrganization}
            useCase={requestUseCase}
            expectedVolume={requestExpectedVolume}
            submitting={requestSubmitting}
            onEmailChange={setRequestEmail}
            onOrganizationChange={setRequestOrganization}
            onUseCaseChange={setRequestUseCase}
            onExpectedVolumeChange={setRequestExpectedVolume}
            onClose={() => setRequestModalOpen(false)}
            onSubmit={handleRequestAccessSubmit}
          />

          <PublicLandingPage
            onEnter={() => {
              window.location.hash = "login";
              setShowPublicLanding(false);
            }}
            onRequestAccess={() => {
              setRequestEmail("");
              setRequestOrganization("");
              setRequestUseCase("Grant proposal review demo");
              setRequestExpectedVolume("10");
              setRequestModalOpen(true);
            }}
          />
        </>
      );
    }

    return (
      <>
        <button
          type="button"
          onClick={() => {
            window.location.hash = "";
            setShowPublicLanding(true);
          }}
          className="mb-6 inline-flex rounded-full border border-slate-700 bg-slate-950/90 px-4 py-2 text-sm font-bold text-slate-200 shadow-xl backdrop-blur transition hover:bg-slate-900"
        >
          ← Back to landing
        </button>

        <LandingLogin
          onLogin={handleLogin}
          loading={authChecking}
          error={authError}
        />
      </>
    );
  }

  if (authSession?.mode === "admin") {
    return (
      <div className="min-h-screen overflow-x-hidden bg-slate-950 px-6 py-8 text-white md:px-8">
        {toast && (
          <div className="fixed right-5 top-5 z-50 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-5 py-3 text-sm font-semibold text-emerald-200 shadow-2xl backdrop-blur">
            {toast}
          </div>
        )}

        <div className="mx-auto max-w-[1400px]">
          <header className="mb-8 flex flex-col gap-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl md:flex-row md:items-center md:justify-between">
            <div>
              <SharedBrandLogo compact />
              <p className="mt-3 text-slate-400">
                Admin Console · Workspace quota and usage controls
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Logout
            </button>
          </header>

          <AdminControlPanel authSession={authSession} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
      {toast && (
        <div className="fixed right-5 top-5 z-50 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-5 py-3 text-sm font-semibold text-emerald-200 shadow-2xl backdrop-blur">
          {toast}
        </div>
      )}

      <RequestAccessModal
        open={requestModalOpen}
        email={requestEmail}
        organization={requestOrganization}
        useCase={requestUseCase}
        expectedVolume={requestExpectedVolume}
        submitting={requestSubmitting}
        onEmailChange={setRequestEmail}
        onOrganizationChange={setRequestOrganization}
        onUseCaseChange={setRequestUseCase}
        onExpectedVolumeChange={setRequestExpectedVolume}
        onClose={() => setRequestModalOpen(false)}
        onSubmit={handleRequestAccessSubmit}
      />

      <header className="border-b border-slate-800/80 bg-slate-950/95 px-6 py-6 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-5 overflow-hidden md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <SharedBrandLogo compact />
            <p className="mt-2 max-w-3xl text-slate-400">
              AI-powered multi-agent proposal review workspace for grants, accelerators, and innovation funding.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="max-w-full shrink-0 truncate rounded-full border border-emerald-500/30 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-300">
              Evalora Backend Connected
            </div>

            <div className="rounded-full border border-blue-500/30 bg-blue-500/10 px-5 py-2 text-sm font-semibold text-blue-200">
              Workspace: {authSession.userId}
            </div>

            <button
              onClick={resetWorkspaceForNewAnalysis}
              className="rounded-full border border-blue-500/40 bg-blue-500/10 px-5 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20"
            >
              New Analysis
            </button>

            <button
              onClick={clearRecentAnalysesView}
              className="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Clear Recent
            </button>

            <button
              onClick={handleLogout}
              className="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] px-6 py-8 md:px-8 md:py-10">

        


        <TelemetryBar telemetry={effectiveTelemetry} loading={loading} events={events} />

        <section className="mt-8 grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">

          <aside className="relative z-10 space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl">
              <h2 className="text-2xl font-bold">Upload Application</h2>

              <p className="mt-3 leading-7 text-slate-400">
                TXT files use live WebSocket streaming. PDF and DOCX use standard cloud analysis.
              </p>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);

                  const droppedFile = event.dataTransfer.files?.[0];

                  if (!droppedFile) return;

                  if (!isSupportedFile(droppedFile.name)) {
                    alert("Please upload a PDF, DOCX, TXT, or MD file.");
                    return;
                  }

                  setFile(droppedFile);
                  setSelectedHistoryJobId(null);
                }}
                className={`mt-6 rounded-3xl border border-dashed p-6 transition duration-300 ${
                  isDragging
                    ? "border-emerald-400 bg-emerald-500/10 shadow-2xl shadow-emerald-500/10"
                    : "border-slate-700 bg-slate-950 hover:border-blue-500/50 hover:bg-slate-950/80"
                }`}
              >
                <input
                  id="file-upload"
                  type="file"
                  accept=".txt,.pdf,.docx,.md"
                  onChange={(event) => {
                    const selectedUploadFile = event.currentTarget.files?.[0] || null;
                    setFile(selectedUploadFile);
                    event.currentTarget.value = "";
                    setSelectedHistoryJobId(null);
                  }}
                  className="hidden"
                />

                <div className="flex flex-col gap-5">
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-2xl ${
                        file
                          ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                          : isDragging
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : "border-slate-700 bg-slate-900 text-slate-400"
                      }`}
                    >
                      {file ? fileKindIcon(file.name) : "⇪"}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-black text-white">
                        {file
                          ? "File ready for review"
                          : isDragging
                            ? "Release to upload"
                            : "Drop proposal here"}
                      </p>

                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        {file
                          ? "Evalora will run scientific, commercial, risk, integrity, and chair review agents."
                          : "Drag and drop a proposal file, or choose a document from your computer."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      htmlFor="file-upload"
                      className="inline-flex w-fit cursor-pointer rounded-xl bg-white px-4 py-2 font-semibold text-slate-900 transition hover:bg-slate-200"
                    >
                      Choose file
                    </label>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-400">
                      PDF · DOCX · TXT · MD
                    </div>
                  </div>

                  {file ? (
                    <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">
                            Selected file
                          </p>
                          <p className="mt-2 line-clamp-2 font-bold text-white">
                            {shortFileName(file.name, 84)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {fileKindLabel(file.name)} · {formatFileSize(file.size)}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setFile(null);
                            setSelectedHistoryJobId(null);
                          }}
                          className="shrink-0 rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm leading-6 text-slate-500">
                      Recommended: upload a full proposal, application, pitch deck text export, or grant draft.
                    </div>
                  )}

                  {loading && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-emerald-300">
                          Preparing multi-agent review...
                        </p>
                        <span className="text-xs text-emerald-200">Live orchestration</span>
                      </div>

                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-2 w-2/3 animate-pulse rounded-full bg-emerald-400" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={analyzeFile}
                disabled={!file || loading}
                className="mt-6 w-full rounded-2xl bg-white px-5 py-3 text-lg font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Analyzing with Evalora..." : "Analyze with Evalora"}
              </button>

              {(loading || data || events.length > 0) && <AgentTimeline events={events} />}
            </div>

            <WorkspaceQuotaCard
              used={recentAnalyses.length}
              limit={WORKSPACE_MONTHLY_QUOTA}
            />

            <RecentAnalysesPanel
              items={recentAnalyses}
              loading={historyLoading}
              selectedJobId={selectedHistoryJobId}
              onRefresh={loadRecentAnalyses}
              onLoad={(jobId) =>
                loadSavedAnalysis(jobId, {
                  pushUrl: true,
                  scroll: true,
                  toast: "Loaded from history ✓",
                })
              }
              onDownload={downloadSavedReport}
              onShare={shareReport}
            />
          </aside>

          <section
            ref={finalDecisionRef}
            className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl scroll-mt-8"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Final Decision</h2>

                {data && (
                  <p className="mt-1 max-w-2xl truncate text-xs text-slate-500">
                    Report ID: {data.job_id}
                  </p>
                )}
              </div>

              {data && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => shareReport(data.job_id)}
                    className="w-fit rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    Copy PDF Link
                  </button>

                  <button
                    onClick={downloadReport}
                    className="w-fit rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2 font-semibold text-blue-300 transition hover:bg-blue-500/20"
                  >
                    Download PDF Report
                  </button>
                </div>
              )}
            </div>

            {loading && <LiveOrchestrationAnimation />}

            {effectiveTelemetry?.agent_traces?.length > 0 && (
              <AgentTracePanel telemetry={effectiveTelemetry} />
            )}

            {!data && !loading && (
              <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-10 text-center text-slate-500">
                
<div className="rounded-3xl border border-slate-800 bg-[#050816] p-8">
  <div className="grid gap-8 2xl:grid-cols-[1.1fr_0.9fr]">
    <div>
      <div className="mb-4 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1 text-sm font-medium text-emerald-300">
        Welcome to Evalora
      </div>

      <h2 className="text-3xl font-black tracking-tight text-white">
        Start your first AI reviewer panel
      </h2>

      <p className="mt-4 max-w-3xl text-base leading-7 text-slate-400">
        Upload a proposal PDF to generate structured reviewer intelligence,
        scientific and commercial assessment, integrity checks, chair synthesis,
        and a shareable PDF report.
      </p>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-2xl font-black text-blue-300">1</p>
          <p className="mt-2 font-bold text-white">Upload</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Add a PDF, DOCX, TXT, or Markdown proposal.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-2xl font-black text-emerald-300">2</p>
          <p className="mt-2 font-bold text-white">Review</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Five specialist agents evaluate the application.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-2xl font-black text-cyan-300">3</p>
          <p className="mt-2 font-bold text-white">Share</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Export a structured PDF report or copy a PDF link.
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.open(SAMPLE_REPORT_URL, "_blank", "noopener,noreferrer")}
          className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-5 py-3 text-sm font-bold text-blue-300 transition hover:bg-blue-500/20"
        >
          View Sample Report
        </button>

        <button
          type="button"
          onClick={() => setRequestModalOpen(true)}
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/20"
        >
          Request Access
        </button>
      </div>
    </div>

    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
        <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-300">
          What Evalora checks
        </p>

        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="font-bold text-white">Scientific merit</p>
            <p className="mt-1 text-sm text-slate-500">
              Methodology, novelty, validation, feasibility.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="font-bold text-white">Commercial readiness</p>
            <p className="mt-1 text-sm text-slate-500">
              Market, business model, GTM, scalability.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="font-bold text-white">Risk and integrity</p>
            <p className="mt-1 text-sm text-slate-500">
              Operational risk, unsupported claims, AI-likelihood.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
        <p className="text-sm font-bold uppercase tracking-[0.24em] text-blue-300">
          Evaluation templates
        </p>

        <div className="mt-5 grid gap-3">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="font-bold text-white">Grant Proposal Review</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Scientific excellence, impact, feasibility, work plan, and reviewer consensus.
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <p className="font-bold text-white">Accelerator Application</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Market, team, traction, business model, GTM readiness, and execution risk.
            </p>
          </div>

          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4">
            <p className="font-bold text-white">Investment Screening</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Defensibility, scalability, risk profile, evidence quality, and funding readiness.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
        <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-300">
          Coming next
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-400">
            Custom rubrics
          </span>
          <span className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-400">
            Team review
          </span>
          <span className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-400">
            API access
          </span>
          <span className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-400">
            White-label portals
          </span>
        </div>
      </div>
    </div>
  </div>
</div>

              </div>
            )}

            {loading && <LiveEventPanel events={events} />}

            {data && (
              <>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
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

          <PdfPreviewPanel file={file} filePreviewUrl={filePreviewUrl} />
        </section>
      </main>
      <SpeedInsights />
    </div>
  );
}



function LiveOrchestrationAnimation() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    "Scientific Reviewer analyzing methodology",
    "Commercial Reviewer evaluating market readiness",
    "Risk Reviewer assessing execution risks",
    "Integrity Reviewer checking evidence quality",
    "Chair Agent synthesizing final decision",
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, 1600);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="mt-6 rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-300">
            Live orchestration
          </p>
          <h3 className="mt-2 text-2xl font-black text-white">
            Gemini reviewer agents are working
          </h3>
        </div>

        <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300">
          Running
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {steps.map((step, index) => (
          <div
            key={step}
            className={`rounded-2xl border p-4 transition-all duration-500 ${
              activeStep === index
                ? "border-emerald-400/60 bg-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.14)]"
                : "border-slate-800 bg-slate-950/70"
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className={`h-3 w-3 rounded-full ${
                  activeStep === index
                    ? "animate-pulse bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.9)]"
                    : "bg-slate-600"
                }`}
              />
              <p className="font-semibold text-slate-200">{step}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentTracePanel({ telemetry }: { telemetry: any }) {
  const traces = telemetry?.agent_traces || [];
  const traceId = telemetry?.trace_id || "not-available";

  function downloadTraceJson() {
    const blob = new Blob([JSON.stringify(telemetry, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `evalora-agent-trace-${traceId}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-800 bg-slate-950 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-300">
            Agent Trace
          </p>
          <h3 className="mt-2 text-2xl font-black text-white">
            Observable reviewer runtime
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Trace ID: <span className="font-mono text-slate-300">{traceId}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={downloadTraceJson}
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/20"
        >
          Download Trace JSON
        </button>
      </div>

      <div className="mt-5 grid gap-3">
        {traces.map((trace: any, index: number) => (
          <div
            key={`${trace.agent}-${index}`}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold text-white">{trace.agent}</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-slate-500">
                  {trace.status || "completed"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 font-bold text-blue-300">
                  confidence {trace.confidence ?? "-"}
                </span>
                <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-bold text-emerald-300">
                  {trace.duration_ms ?? "-"} ms
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PdfPreviewPanel({
  file,
  filePreviewUrl,
}: {
  file: File | null;
  filePreviewUrl: string | null;
}) {
  const isPdf = Boolean(file && file.name.toLowerCase().endsWith(".pdf"));

  return (
    <aside className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl xl:col-start-2 xl:row-start-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-white">
            Document Preview
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Review the source document alongside AI reviewer output.
          </p>
        </div>

        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-300">
          Source
        </div>
      </div>

      {!file && (
        <div className="mt-5 flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700 bg-slate-950 p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-2xl text-slate-400">
            ◫
          </div>

          <p className="mt-5 text-lg font-black text-white">
            No document selected
          </p>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Upload a PDF proposal to enable side-by-side source preview.
          </p>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs font-semibold text-slate-500">
            PDF preview · proposal context · reviewer trace
          </div>
        </div>
      )}

      {file && !isPdf && (
        <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-blue-500/40 bg-blue-500/10 text-sm font-black text-blue-300">
              {fileKindIcon(file.name)}
            </div>

            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-300">
                Selected document
              </p>
              <p className="mt-2 line-clamp-3 font-bold text-white">
                {shortFileName(file.name, 72)}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {fileKindLabel(file.name)} · {formatFileSize(file.size)}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm leading-6 text-yellow-100">
            Inline source preview is currently available for PDF files. This file
            can still be analyzed normally by Evalora.
          </div>
        </div>
      )}

      {file && isPdf && filePreviewUrl && (
        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
          <div className="border-b border-slate-800 bg-slate-900/80 p-4">
            <p className="line-clamp-2 text-sm font-bold text-white">
              {shortFileName(file.name, 80)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              PDF document · {formatFileSize(file.size)}
            </p>
          </div>

          <iframe
            src={filePreviewUrl}
            title="PDF preview"
            className="h-[620px] w-full bg-slate-950"
          />

          <div className="border-t border-slate-800 bg-slate-900/80 p-3 text-xs leading-5 text-slate-500">
            Preview is local to this browser session. Uploaded content is analyzed
            only when you run Evalora.
          </div>
        </div>
      )}
    </aside>
  );
}


function SharedBrandLogo({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${compact ? "gap-3" : "gap-4"}`}>
      <div className="relative shrink-0">
        <div className="absolute inset-0 rounded-[24px] bg-cyan-400/10 blur-xl" />
        <div
          className={`relative flex items-center justify-center overflow-hidden rounded-[22px] border border-cyan-400/25 bg-slate-950/85 shadow-[0_0_28px_rgba(34,211,238,0.15)] ${
            compact ? "h-14 w-14 md:h-16 md:w-16" : "h-16 w-16 md:h-20 md:w-20"
          }`}
        >
          <img
            src="/evalora-icon.png"
            alt="Evalora"
            className="h-[82%] w-[82%] object-contain"
          />
        </div>
      </div>

      <div className="min-w-0">
        <div className={`font-black tracking-tight text-white ${compact ? "text-2xl md:text-3xl" : "text-4xl md:text-6xl"}`}>
          Evalora ReviewerOS
        </div>
        <div className={`mt-1 font-black uppercase tracking-[0.28em] text-cyan-300 ${compact ? "text-[10px] md:text-xs" : "text-lg md:text-2xl"}`}>
          Multi-Agent Proposal Review
        </div>
      </div>
    </div>
  );
}

function LandingLogin({
  onLogin,
  loading,
  error,
}: {
  onLogin: (
    userId: string,
    accessCode: string,
    mode: "demo" | "admin",
  ) => void;
  loading: boolean;
  error: string | null;
}) {
  const [userId, setUserId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loginMode, setLoginMode] = useState<"demo" | "admin">("demo");
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestEmail, setRequestEmail] = useState("");
  const [requestOrganization, setRequestOrganization] = useState("");
  const [requestUseCase, setRequestUseCase] = useState("Grant proposal review demo");
  const [requestExpectedVolume, setRequestExpectedVolume] = useState("10");

  async function handleRequestAccessSubmit() {
    const email = requestEmail.trim();
    const organization = requestOrganization.trim();
    const useCase = requestUseCase.trim();
    const expectedVolume = requestExpectedVolume.trim();

    if (!email || !email.includes("@")) {
      alert("Please enter a valid email address.");
      return;
    }

    if (!organization) {
      alert("Please enter your organization or workspace name.");
      return;
    }

    if (!useCase) {
      alert("Please describe your use case.");
      return;
    }

    try {
      setRequestSubmitting(true);

      const response = await fetch(REQUEST_ACCESS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          organization,
          use_case: useCase,
          expected_volume: expectedVolume,
          source: "evalora-login",
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Request access failed.");
      }

      setRequestModalOpen(false);
      setRequestEmail("");
      setRequestOrganization("");
      setRequestUseCase("Grant proposal review demo");
      setRequestExpectedVolume("10");
      alert("Access request received. Evalora will follow up with demo access.");
    } catch (error: any) {
      alert(error?.message || "Request access failed.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <style>{`
        @keyframes evaloraBgDrift {
          0% { transform: scale(1.06) translate3d(0px, 0px, 0); filter: saturate(1.05) brightness(0.95); }
          35% { transform: scale(1.10) translate3d(-26px, -16px, 0); filter: saturate(1.18) brightness(1.04); }
          70% { transform: scale(1.08) translate3d(22px, 12px, 0); filter: saturate(1.10) brightness(1.00); }
          100% { transform: scale(1.12) translate3d(-10px, 18px, 0); filter: saturate(1.22) brightness(1.08); }
        }

        @keyframes evaloraLoginCardBreathe {
          0%, 100% {
            transform: translateY(0px);
            border-color: rgba(30, 41, 59, 1);
            box-shadow: 0 0 0 rgba(34, 211, 238, 0);
          }
          50% {
            transform: translateY(-4px);
            border-color: rgba(34, 211, 238, 0.32);
            box-shadow: 0 0 26px rgba(34, 211, 238, 0.10);
          }
        }

        @keyframes evaloraSignalSweep {
          0% {
            transform: translateX(-120%);
            opacity: 0;
          }
          15% {
            opacity: 0.75;
          }
          85% {
            opacity: 0.75;
          }
          100% {
            transform: translateX(120%);
            opacity: 0;
          }
        }

        @keyframes evaloraPanelFloat {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-6px);
          }
        }

        .evalora-login-reviewer-grid {
          position: relative;
          overflow: hidden;
        }

        .evalora-login-reviewer-grid::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.65), rgba(52, 211, 153, 0.65), transparent);
          animation: evaloraSignalSweep 5.2s ease-in-out infinite;
          pointer-events: none;
          z-index: 0;
        }

        .evalora-login-reviewer-grid > div {
          position: relative;
          z-index: 1;
          animation: evaloraLoginCardBreathe 7s ease-in-out infinite;
        }

        .evalora-login-reviewer-grid > div:nth-child(2) {
          animation-delay: 0.8s;
        }

        .evalora-login-reviewer-grid > div:nth-child(3) {
          animation-delay: 1.6s;
        }

        .evalora-login-reviewer-grid > div:nth-child(4) {
          animation-delay: 2.4s;
        }

        .evalora-login-access-panel {
          animation: evaloraPanelFloat 8s ease-in-out infinite;
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0">
        <img
          src="/evalora-space-bg.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-70"
          style={{ animation: "evaloraBgDrift 46s ease-in-out infinite alternate" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#020617]/94 via-[#020617]/76 to-[#020617]/58" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#020617]/76 via-transparent to-[#020617]/95" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_75%_35%,rgba(168,85,247,0.18),transparent_32%),radial-gradient(circle_at_55%_80%,rgba(16,185,129,0.10),transparent_30%)]" />
      </div>

      <RequestAccessModal
        open={requestModalOpen}
        email={requestEmail}
        organization={requestOrganization}
        useCase={requestUseCase}
        expectedVolume={requestExpectedVolume}
        submitting={requestSubmitting}
        onEmailChange={setRequestEmail}
        onOrganizationChange={setRequestOrganization}
        onUseCaseChange={setRequestUseCase}
        onExpectedVolumeChange={setRequestExpectedVolume}
        onClose={() => setRequestModalOpen(false)}
        onSubmit={handleRequestAccessSubmit}
      />

      <header className="relative z-10 border-b border-cyan-400/15 bg-slate-950/45 px-6 py-5 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between gap-6">
          <div>
            <SharedBrandLogo compact />
            <p className="mt-3 max-w-4xl text-slate-400">
              AI-powered multi-agent proposal review workspace for grants, accelerators, and innovation funding.
            </p>
          </div>

          <div className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.12)] md:block">
            Demo Access
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-[1700px] items-start gap-8 px-6 py-10 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-14 lg:[&>*:first-child]:sticky lg:[&>*:first-child]:top-6 lg:[&>*:first-child]:self-start lg:[&>*:first-child]:max-h-[calc(100vh-3rem)] lg:[&>*:first-child]:overflow-y-auto lg:[&>*:first-child]:rounded-[2rem] lg:[&>*:first-child]:border lg:[&>*:first-child]:border-slate-800/80 lg:[&>*:first-child]:bg-slate-950/35 lg:[&>*:first-child]:p-4 lg:[&>*:first-child]:min-h-[calc(100vh-4rem)]">
        <section className="space-y-8">
          <div className="rounded-[2rem] border border-cyan-400/15 bg-slate-950/60 p-7 shadow-[0_0_40px_rgba(34,211,238,0.08)] backdrop-blur-xl">
            <p className="text-sm font-black uppercase tracking-[0.35em] text-cyan-300">
              Reviewer Panel
            </p>

            <h2 className="mt-4 text-4xl font-black leading-tight text-white md:text-5xl">
              Sign in to run observable proposal reviews.
            </h2>

            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Access your Evalora workspace to upload proposals, run Gemini reviewer agents,
              generate reports, and inspect runtime traces.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {[
                ["Scientific Reviewer", "Methodology, novelty, validation, and feasibility."],
                ["Commercial Reviewer", "Market, business model, pricing, and GTM readiness."],
                ["Risk Reviewer", "Operational, regulatory, ethical, and execution risks."],
                ["Integrity Reviewer", "Unsupported claims, AI-likelihood, and data governance."],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-3xl border border-slate-800 bg-slate-950/65 p-5 backdrop-blur transition hover:-translate-y-2 hover:border-cyan-400/40 hover:shadow-[0_0_34px_rgba(34,211,238,0.16)]"
                >
                  <p className="text-lg font-black text-white">{title}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-emerald-400/15 bg-slate-950/55 p-7 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.35em] text-emerald-300">
                  Sales Demo Ready
                </p>
                <h3 className="mt-3 text-3xl font-black text-white">
                  Evaluate proposals before the first upload.
                </h3>
                <p className="mt-3 max-w-2xl text-slate-400">
                  Use sample reports, pricing context, and access requests to turn the demo into a lightweight SaaS acquisition flow.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRequestModalOpen(true)}
                className="rounded-2xl border border-emerald-400/35 bg-emerald-400/10 px-5 py-3 text-sm font-black text-emerald-200 transition hover:-translate-y-0.5 hover:bg-emerald-400/20 hover:shadow-[0_0_30px_rgba(52,211,153,0.20)]"
              >
                Request Access
              </button>
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {[
                ["Starter", "$29", "For individual founders and grant writers."],
                ["Team", "$99", "For labs, accelerators, and proposal teams."],
                ["Institution", "Custom", "White-label portals, quotas, and API access."],
              ].map(([plan, price, body]) => (
                <div key={plan} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                  <p className="font-black text-white">{plan}</p>
                  <p className="mt-3 text-3xl font-black text-white">{price}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="self-start rounded-[2rem] border border-cyan-400/15 bg-slate-950/70 p-7 shadow-[0_0_48px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <p className="text-sm font-black uppercase tracking-[0.35em] text-cyan-300">
            Workspace Access
          </p>

          <h2 className="mt-4 text-3xl font-black text-white">
            Enter your ReviewerOS demo workspace.
          </h2>

          <p className="mt-3 leading-7 text-slate-400">
            Use the workspace ID and access code provided for your Evalora ReviewerOS demo account.
          </p>

          <div className="mt-7 space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-300">Workspace ID</span>
              <input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="client-a"
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-300">Access Code</span>
              <input
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                id="access-code" name="accessCode" placeholder="Enter access code"
                type="password"
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-300">Login Mode</span>
              <select
                value={loginMode}
                onChange={(event) =>
                  setLoginMode(event.target.value as "demo" | "admin")
                }
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-4 text-white outline-none transition focus:border-cyan-400/50"
              >
                <option value="demo">Demo Workspace</option>
                <option value="admin">Admin Console</option>
              </select>
            </label>

            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
              <p className="font-black uppercase tracking-[0.18em] text-cyan-200">
                Jury Demo Access
              </p>
              <div className="mt-3 grid gap-2 text-slate-200">
                <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950/50 px-3 py-2">
                  <span className="text-slate-400">Workspace ID</span>
                  <code className="font-bold text-white">jury-demo</code>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950/50 px-3 py-2">
                  <span className="text-slate-400">Access Code</span>
                  <code className="font-bold text-white">evalora-demo-2026</code>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950/50 px-3 py-2">
                  <span className="text-slate-400">Login Mode</span>
                  <code className="font-bold text-white">Demo Workspace</code>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm leading-6 text-red-200">
                {error}
              </div>
            )}

            <button
              onClick={() => onLogin(userId, accessCode, loginMode)}
              disabled={loading}
              className="w-full rounded-2xl bg-white px-5 py-3 text-lg font-black text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Checking access..." : "Enter Evalora"}
            </button>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/75 p-5 text-sm leading-6 text-slate-300">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
                Example workspace
              </p>
              <p className="mt-2 font-mono text-base font-black text-emerald-300">
                client-a
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                ["Gemini", "Vertex AI runtime"],
                ["MCP", "Trace-ready"],
                ["PDF", "Report export"],
                ["Quota", "Workspace limits"],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-slate-800 bg-slate-950/65 p-4 transition hover:-translate-y-1 hover:border-cyan-400/30"
                >
                  <p className="font-black text-white">{title}</p>
                  <p className="mt-1 text-xs text-slate-400">{body}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-violet-400/15 bg-violet-500/10 p-5">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-300">
                Observable Workspace
              </p>

              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-black text-white">5</p>
                  <p className="text-[11px] text-slate-400">Agents</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-white">JSON</p>
                  <p className="text-[11px] text-slate-400">Traces</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-white">PDF</p>
                  <p className="text-[11px] text-slate-400">Reports</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setRequestModalOpen(true)}
              className="w-full rounded-2xl border border-emerald-400/35 bg-emerald-400/10 px-5 py-3 text-sm font-black text-emerald-200 transition hover:-translate-y-0.5 hover:bg-emerald-400/20 hover:shadow-[0_0_30px_rgba(52,211,153,0.20)]"
            >
              Request demo access
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}



function PublicLandingPage({
  onEnter,
  onRequestAccess,
}: {
  onEnter: () => void;
  onRequestAccess: () => void;
}) {
  type SectionKey = "about" | "workflow" | "architecture" | "pricing" | "docs";

  const aboutRef = useRef<HTMLDivElement | null>(null);
  const workflowRef = useRef<HTMLDivElement | null>(null);
  const architectureRef = useRef<HTMLDivElement | null>(null);
  const pricingRef = useRef<HTMLDivElement | null>(null);
  const docsRef = useRef<HTMLDivElement | null>(null);

  const [activeStep, setActiveStep] = useState(0);
  const [activeNav, setActiveNav] = useState<SectionKey>("about");
  const [architectureOpen, setArchitectureOpen] = useState(false);
  const [architectureZoom, setArchitectureZoom] = useState(1);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % 5);
    }, 1450);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const sections = [
      ["about", aboutRef],
      ["workflow", workflowRef],
      ["architecture", architectureRef],
      ["pricing", pricingRef],
      ["docs", docsRef],
    ] as const;

    function handleScroll() {
      let current: SectionKey = "about";

      for (const [key, ref] of sections) {
        const top = ref.current?.getBoundingClientRect().top ?? 9999;

        if (top < 180) {
          current = key;
        }
      }

      setActiveNav(current);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const x = (event.clientX / window.innerWidth - 0.5) * 18;
    const y = (event.clientY / window.innerHeight - 0.5) * 18;
    setParallax({ x, y });
  }

  function scrollToSection(key: SectionKey, ref: { current: HTMLDivElement | null }) {
    setActiveNav(key);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const navItems = [
    { key: "about" as const, label: "About", ref: aboutRef },
    { key: "workflow" as const, label: "Workflow", ref: workflowRef },
    { key: "architecture" as const, label: "Architecture", ref: architectureRef },
    { key: "pricing" as const, label: "Pricing", ref: pricingRef },
    { key: "docs" as const, label: "Docs", ref: docsRef },
  ];

  const workflowSteps = [
    ["Proposal uploaded", "Document received and parsed"],
    ["Scientific Reviewer", "Methodology, novelty, validation"],
    ["Commercial Reviewer", "Market readiness and GTM fit"],
    ["Risk & Integrity", "Risk, ethics, evidence quality"],
    ["Chair Agent", "Final decision and report"],
  ];

  const capabilities = [
    ["Gemini + Vertex AI", "Reviewer orchestration powered by Google AI.", "🧠"],
    ["MCP-compatible", "Trace endpoints for external observability.", "◈"],
    ["PDF reports", "Institutional-grade reviewer outputs.", "📄"],
    ["Workspace quotas", "SaaS-ready usage governance.", "📈"],
  ];

  const stack = ["Google Cloud", "Vertex AI", "Gemini 2.5 Pro", "Cloud Run", "Firestore", "MCP Compatible"];

  return (
    <div
      onMouseMove={handleMouseMove}
      className="relative min-h-screen overflow-hidden bg-[#020617] text-white"
    >
      <style>{`
        @keyframes evaloraBgDrift {
          0% { transform: scale(1.06) translate3d(0px, 0px, 0); filter: saturate(1.05) brightness(0.95); }
          35% { transform: scale(1.10) translate3d(-26px, -16px, 0); filter: saturate(1.18) brightness(1.04); }
          70% { transform: scale(1.08) translate3d(22px, 12px, 0); filter: saturate(1.10) brightness(1.00); }
          100% { transform: scale(1.12) translate3d(-10px, 18px, 0); filter: saturate(1.22) brightness(1.08); }
        }

        @keyframes evaloraStarField {
          0% { transform: translateY(0px); opacity: 0.25; }
          50% { opacity: 0.55; }
          100% { transform: translateY(-28px); opacity: 0.35; }
        }

        @keyframes evaloraFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }

        @keyframes evaloraSignal {
          0% { transform: translateX(-120%); opacity: 0; }
          15% { opacity: 0.8; }
          85% { opacity: 0.8; }
          100% { transform: translateX(120%); opacity: 0; }
        }

        @keyframes evaloraOrbitSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes evaloraOrbitSpinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        .evalora-signal-card {
          position: relative;
          overflow: hidden;
        }

        .evalora-signal-card::before {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          width: 38%;
          background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.14), transparent);
          animation: evaloraSignal 5.8s ease-in-out infinite;
          pointer-events: none;
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            transform: `translate3d(${parallax.x}px, ${parallax.y}px, 0) scale(1.04)`,
          }}
        >
          <img
            src="/evalora-space-bg.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-90"
            style={{ animation: "evaloraBgDrift 42s ease-in-out infinite alternate" }}
          />
        </div>

        <div
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(125,211,252,0.85) 1px, transparent 1px)",
            backgroundSize: "90px 90px",
            animation: "evaloraStarField 16s linear infinite",
          }}
        />

        <div className="absolute inset-0 bg-gradient-to-r from-[#020617]/90 via-[#020617]/55 to-[#020617]/35" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#020617]/45 via-transparent to-[#020617]/92" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-5">
        <header className="sticky top-4 z-40 mb-12 rounded-3xl border border-white/10 bg-slate-950/72 px-5 py-3 shadow-[0_0_48px_rgba(20,184,166,0.12)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="group text-left"
            >
              <SharedBrandLogo compact />
            </button>

            <nav className="order-3 flex w-full flex-wrap items-center justify-center gap-2 xl:order-none xl:w-auto">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => scrollToSection(item.key, item.ref)}
                  className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:scale-105 ${
                    activeNav === item.key
                      ? "border-cyan-300/50 bg-cyan-400/20 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
                      : "border-white/10 bg-slate-900/80 text-slate-200 hover:border-cyan-400/40 hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRequestAccess}
                className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:-translate-y-0.5 hover:scale-105 hover:bg-emerald-500/20 hover:shadow-[0_0_34px_rgba(16,185,129,0.32)] active:scale-95"
              >
                ✉ Request Access
              </button>

              <button
                type="button"
                onClick={onEnter}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-fuchsia-500 px-4 py-2.5 text-sm font-bold text-white shadow-[0_0_24px_rgba(99,102,241,0.22)] transition hover:-translate-y-0.5 hover:scale-105 hover:shadow-[0_0_42px_rgba(99,102,241,0.44)] active:scale-95"
              >
                🚀 Enter ReviewerOS
              </button>
            </div>
          </div>
        </header>

        <section ref={aboutRef} className="mb-14 grid items-start gap-8 scroll-mt-32 lg:grid-cols-[1.05fr_0.9fr_0.82fr]">
          <div className="pt-4">
            <div className="mb-5 inline-flex rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-violet-200">
              Google Cloud Rapid Agent Hackathon · Arize Track
            </div>

            <h1 className="max-w-3xl text-4xl font-black leading-[0.98] tracking-tight sm:text-5xl md:text-6xl">
              AI reviewer panels for{" "}
              <span className="bg-gradient-to-r from-cyan-300 via-emerald-300 to-fuchsia-300 bg-clip-text text-transparent">
                proposal decisions.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Evalora analyzes proposals with Gemini-powered reviewer agents,
              generates institutional PDF reports, and exposes MCP-compatible runtime traces.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={onEnter}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-7 py-4 text-base font-bold text-white shadow-[0_0_24px_rgba(34,211,238,0.18)] transition hover:-translate-y-1 hover:scale-105 hover:shadow-[0_0_35px_rgba(34,211,238,0.28)] active:scale-95"
              >
                Enter ReviewerOS ↗
              </button>

              <button
                type="button"
                onClick={onRequestAccess}
                className="rounded-2xl border border-violet-400/35 bg-violet-500/10 px-7 py-4 text-base font-semibold text-violet-100 transition hover:-translate-y-1 hover:scale-105 hover:bg-violet-500/20"
              >
                Request Demo Access
              </button>

              <button
                type="button"
                onClick={() => scrollToSection("architecture", architectureRef)}
                className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-7 py-4 text-base font-semibold text-cyan-100 transition hover:-translate-y-1 hover:bg-cyan-500/20"
              >
                View Architecture
              </button>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ["Gemini Agents", "Proposal review, risk scoring, and synthesis"],
                ["Arize MCP-ready", "Trace-oriented observability configuration"],
                ["Google Cloud", "Cloud Run backend with Firestore governance"],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4 backdrop-blur"
                >
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                    {title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {body}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5 backdrop-blur">
              <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-300">
                <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-cyan-100">
                  Proposal
                </span>
                <span className="text-cyan-400">→</span>
                <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-4 py-2 text-fuchsia-100">
                  Review Agents
                </span>
                <span className="text-cyan-400">→</span>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-emerald-100">
                  PDF Report
                </span>
                <span className="text-cyan-400">→</span>
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-amber-100">
                  Observable Trace
                </span>
              </div>
            </div>
          </div>

          <div
            className="relative min-h-[420px] overflow-hidden rounded-[2rem] md:min-h-[520px] border border-cyan-400/15 bg-slate-950/78 p-6 shadow-[0_0_40px_rgba(34,211,238,0.08)] backdrop-blur-xl"
            style={{ animation: "evaloraFloat 7s ease-in-out infinite" }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(59,130,246,0.22),transparent_25%),radial-gradient(circle_at_60%_60%,rgba(168,85,247,0.20),transparent_30%)]" />

            <div className="relative flex h-[380px] items-center justify-center md:h-[480px]">
              <div className="absolute h-[330px] w-[330px] rounded-full border border-cyan-400/20" style={{ animation: "evaloraOrbitSpin 18s linear infinite" }} />
              <div className="absolute h-[240px] w-[420px] rounded-full border border-fuchsia-400/15" style={{ animation: "evaloraOrbitSpinReverse 24s linear infinite" }} />
              <div className="absolute h-[180px] w-[520px] rounded-full border border-blue-400/15" style={{ animation: "evaloraOrbitSpin 30s linear infinite" }} />

              <div className="absolute h-52 w-52 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(125,211,252,0.95),rgba(99,102,241,0.55),rgba(147,51,234,0.4))] shadow-[0_0_80px_rgba(34,211,238,0.35)]" />

              {[
                ["Gemini / Vertex AI", "top-12 left-1/2 -translate-x-1/2"],
                ["Multi-Agent", "left-6 top-[45%]"],
                ["Observability", "right-6 top-28"],
                ["MCP Compatible", "bottom-14 left-7"],
                ["PDF Reports", "bottom-16 right-7"],
              ].map(([label, position]) => (
                <div
                  key={label}
                  className={`absolute ${position} rounded-2xl border border-cyan-400/20 bg-slate-900/85 px-4 py-3 text-sm font-semibold text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.12)] transition hover:-translate-y-1 hover:border-cyan-300/45`}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div ref={workflowRef} className="evalora-signal-card rounded-[2rem] border border-emerald-400/15 bg-slate-950/82 p-6 shadow-[0_0_40px_rgba(16,185,129,0.08)] backdrop-blur-xl scroll-mt-32">
            <div className="mb-6 flex items-center justify-between">
              <div className="text-sm font-bold uppercase tracking-[0.28em] text-emerald-300">
                ● Live Agent Workflow
              </div>
              <div className="animate-pulse text-sm font-semibold text-emerald-300">
                Live
              </div>
            </div>

            <div className="space-y-4">
              {workflowSteps.map(([title, body], index) => {
                const isActive = activeStep === index;
                const isDone = activeStep > index;

                return (
                  <div
                    key={title}
                    className={`rounded-2xl border p-4 transition-all duration-500 ${
                      isActive
                        ? "border-cyan-400/45 bg-cyan-500/10 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
                        : "border-white/10 bg-slate-900/72"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                          isDone || isActive
                            ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-200"
                            : "border-slate-700 bg-slate-900 text-slate-400"
                        }`}
                      >
                        {index + 1}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-bold text-white">{title}</div>
                        <div className="mt-1 text-sm leading-6 text-slate-400">{body}</div>
                      </div>

                      <div
                        className={`mt-1 h-8 w-8 rounded-full border-2 ${
                          isDone
                            ? "border-emerald-400 bg-emerald-400/15"
                            : isActive
                            ? "animate-pulse border-cyan-400"
                            : "border-slate-600"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 text-center text-base font-semibold text-emerald-300">
              Observable. Traceable. Trustworthy.
            </div>

            <div className="mt-5 rounded-2xl border border-cyan-400/15 bg-slate-950/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
                  Live telemetry
                </p>
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.9)]" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["model", "gemini-2.5-pro"],
                  ["latency", `${(3.2 + activeStep * 0.18).toFixed(2)}s`],
                  ["tokens", `${2200 + activeStep * 41}`],
                  ["cost", `$${(0.00072 + activeStep * 0.00003).toFixed(5)}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
                    <p className="mt-1 font-mono text-cyan-100">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mb-14 rounded-[2rem] border border-white/10 bg-slate-950/65 p-5 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {stack.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-slate-800 bg-slate-900/75 px-5 py-3 text-sm font-bold text-slate-200 transition hover:-translate-y-1 hover:border-cyan-400/35 hover:text-cyan-100"
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {capabilities.map(([title, body, icon]) => (
            <div
              key={title}
              className="group rounded-[1.6rem] border border-white/10 bg-slate-900/78 p-6 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-cyan-400/30 hover:shadow-[0_0_25px_rgba(34,211,238,0.12)]"
            >
              <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-4xl shadow-[0_0_28px_rgba(34,211,238,0.10)] transition group-hover:scale-110 group-hover:rotate-6">
                {icon}
              </div>
              <div className="text-xl font-bold text-white">{title}</div>
              <div className="mt-3 text-sm leading-7 text-slate-400">{body}</div>
            </div>
          ))}
        </section>

        <section ref={architectureRef} className="mb-14 scroll-mt-32 rounded-[2rem] border border-cyan-400/15 bg-slate-950/72 p-6 shadow-[0_0_44px_rgba(34,211,238,0.08)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.3em] text-cyan-300">
                Architecture
              </p>
              <h2 className="mt-3 text-3xl font-black text-white">
                Full observable reviewer system.
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                Cloud Run backend, Gemini/Vertex AI orchestration, Firestore history,
                Cloud Storage reports, and MCP-compatible trace endpoints.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setArchitectureZoom(1);
                setArchitectureOpen(true);
              }}
              className="rounded-2xl border border-cyan-400/35 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:-translate-y-0.5 hover:bg-cyan-500/20"
            >
              View full architecture →
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
                setArchitectureZoom(1);
                setArchitectureOpen(true);
              }}
            className="mt-6 block w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-left transition hover:border-cyan-400/35 hover:shadow-[0_0_40px_rgba(34,211,238,0.12)]"
          >
            <img
              src="/evalora-system-architecture.png"
              alt="Evalora ReviewerOS system architecture"
              className="w-full object-cover"
            />
          </button>
        </section>

        <section ref={pricingRef} className="mb-14 scroll-mt-32 rounded-[2rem] border border-emerald-400/15 bg-slate-950/65 p-7 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.3em] text-emerald-300">
                Demo Access & Pricing
              </p>
              <h2 className="mt-3 text-3xl font-black text-white">
                Productization-ready SaaS flow.
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                Pricing shown for product roadmap context. Hackathon demo access is available by request.
              </p>
            </div>

            <button
              type="button"
              onClick={onRequestAccess}
              className="rounded-2xl border border-emerald-400/35 bg-emerald-400/10 px-5 py-3 text-sm font-black text-emerald-200 transition hover:-translate-y-0.5 hover:bg-emerald-400/20"
            >
              Request Access
            </button>
          </div>

          <div className="mt-7 grid gap-4 md:grid-cols-3">
            {[
              ["Starter", "$29", "For individual founders and grant writers."],
              ["Team", "$99", "For labs, accelerators, and proposal teams."],
              ["Institution", "Custom", "White-label portals, quotas, and API access."],
            ].map(([plan, price, body]) => (
              <div key={plan} className="rounded-2xl border border-slate-800 bg-slate-950/72 p-5">
                <p className="font-black text-white">{plan}</p>
                <p className="mt-3 text-3xl font-black text-white">{price}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section ref={docsRef} className="mb-14 scroll-mt-32 rounded-[2rem] border border-violet-400/15 bg-slate-950/65 p-7 backdrop-blur-xl">
          <p className="text-sm font-black uppercase tracking-[0.3em] text-violet-300">
            Docs & API
          </p>

          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {[
              ["Analyze", "POST /analyze", "Run a proposal through the reviewer panel."],
              ["History", "GET /analyses", "Retrieve saved analyses and report metadata."],
              ["Trace List", "GET /mcp/traces", "Inspect MCP-compatible trace summaries."],
              ["Trace Detail", "GET /mcp/traces/{trace_id}", "Open full trace metadata for one run."],
            ].map(([title, endpoint, body]) => (
              <div key={title} className="rounded-2xl border border-slate-800 bg-slate-950/72 p-5">
                <p className="text-lg font-black text-white">{title}</p>
                <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 font-mono text-xs text-cyan-200">
                  {endpoint}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10 rounded-[2rem] border border-white/10 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-fuchsia-500/10 p-8 text-center backdrop-blur-xl">
          <h2 className="text-4xl font-black text-white">
            Ready to run an observable reviewer panel?
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-slate-300">
            Enter ReviewerOS to test the demo workspace or request access for a guided evaluation workflow.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-4">
            <button
              type="button"
              onClick={onEnter}
              className="rounded-2xl bg-white px-7 py-4 text-base font-black text-slate-950 transition hover:-translate-y-1 hover:bg-slate-200"
            >
              Enter ReviewerOS
            </button>
            <button
              type="button"
              onClick={onRequestAccess}
              className="rounded-2xl border border-emerald-400/35 bg-emerald-400/10 px-7 py-4 text-base font-black text-emerald-200 transition hover:-translate-y-1 hover:bg-emerald-400/20"
            >
              Request Demo Access
            </button>
          </div>
        </section>
      </div>

      {architectureOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-5 backdrop-blur-xl">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-hidden rounded-[2rem] border border-cyan-400/20 bg-slate-950 shadow-[0_0_80px_rgba(34,211,238,0.20)]">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
                  Evalora ReviewerOS
                </p>
                <p className="mt-1 text-xl font-black text-white">
                  Full System Architecture
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setArchitectureZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))}
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  −
                </button>

                <button
                  type="button"
                  onClick={() => setArchitectureZoom(1)}
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  {Math.round(architectureZoom * 100)}%
                </button>

                <button
                  type="button"
                  onClick={() => setArchitectureZoom((value) => Math.min(2.5, Number((value + 0.25).toFixed(2))))}
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  +
                </button>

                <button
                  type="button"
                  onClick={() => setArchitectureOpen(false)}
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[78vh] overflow-auto p-4">
              <div
                className="origin-top-left transition-transform duration-300"
                style={{ transform: `scale(${architectureZoom})`, width: `${100 / architectureZoom}%` }}
              >
                <img
                  src="/evalora-system-architecture.png"
                  alt="Evalora ReviewerOS full system architecture"
                  className="w-full rounded-2xl border border-slate-800"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function WorkspaceQuotaCard({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const safeLimit = Math.max(limit, 1);
  const percentage = Math.min(100, Math.round((used / safeLimit) * 100));
  const remaining = Math.max(0, limit - used);

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white">Workspace Quota</h3>
          <div className="mt-4 rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-300">
              Runtime Intelligence Mini
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-900/70 p-3">
                <p className="text-slate-500">Trace Status</p>
                <p className="font-bold text-emerald-300">Observable</p>
              </div>
              <div className="rounded-xl bg-slate-900/70 p-3">
                <p className="text-slate-500">Agents</p>
                <p className="font-bold text-cyan-300">5 Active</p>
              </div>
              <div className="rounded-xl bg-slate-900/70 p-3">
                <p className="text-slate-500">Pipeline</p>
                <p className="font-bold text-violet-300">Multi-agent</p>
              </div>
              <div className="rounded-xl bg-slate-900/70 p-3">
                <p className="text-slate-500">Telemetry</p>
                <p className="font-bold text-amber-300">Enabled</p>
              </div>
            </div>
          </div>

          <p className="mt-1 text-xs leading-5 text-slate-500">
            Demo usage visibility for sales and client workspaces.
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300">
          Demo
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-black text-white">
              {used}
              <span className="text-base text-slate-500"> / {limit}</span>
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
              analyses used
            </p>
          </div>

          <p className="text-sm font-bold text-slate-300">
            {remaining} remaining
          </p>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-2 rounded-full bg-emerald-400 transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <p className="font-bold text-slate-300">Plan</p>
          <p className="mt-1 text-slate-500">Demo Workspace</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <p className="font-bold text-slate-300">Reset</p>
          <p className="mt-1 text-slate-500">Monthly</p>
        </div>
      </div>
    </div>
  );
}

function RecentAnalysesPanel({
  items,
  loading,
  selectedJobId,
  onRefresh,
  onLoad,
  onDownload,
  onShare,
}: {
  items: RecentAnalysis[];
  loading: boolean;
  selectedJobId: string | null;
  onRefresh: () => void;
  onLoad: (jobId: string) => void;
  onDownload: (jobId: string) => void;
  onShare: (jobId: string) => void;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div>

          <h3 className="text-lg font-bold">Recent Analyses</h3>
          <p className="mt-1 text-xs text-slate-500">Saved reports from this workspace.</p>
        </div>

        <button
          onClick={onRefresh}
          className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="reviewer-scroll mt-4 max-h-[430px] space-y-3 overflow-y-auto pr-1">
        {items.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-sm leading-6 text-slate-400">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10 text-blue-300">
              ✦
            </div>
            <p className="font-bold text-slate-200">No analyses yet</p>
            <p className="mt-1 text-slate-500">
              Upload your first proposal to generate a multi-agent reviewer panel report.
            </p>
          </div>
        )}

        {items.map((item) => {
          const selected = selectedJobId === item.job_id;

          return (
            <div
              key={item.job_id}
              className={`rounded-2xl border bg-slate-950 p-4 transition ${
                selected
                  ? "border-emerald-400/70 shadow-lg shadow-emerald-500/10"
                  : "border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold text-white">
                    {shortFileName(item.file_name || "Untitled analysis", 58)}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(item.created_at)}
                  </p>
                </div>

                <div
                  className={`shrink-0 rounded-xl border px-3 py-1 text-sm font-black ${
                    selected
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-blue-500/30 bg-blue-500/10 text-blue-300"
                  }`}
                >
                  {item.final_score ?? "-"}
                </div>
              </div>

              {selected && (
                <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300">
                  Loaded from history ✓
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <MiniStat label="Decision" value={item.recommendation || "-"} />
                <MiniStat label="Risk" value={item.risk_level || "-"} />
                <MiniStat label="Tokens" value={formatTelemetryValue(item.tokens)} />
                <MiniStat
                  label="Latency"
                  value={item.latency_seconds ? `${item.latency_seconds}s` : "-"}
                />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={() => onLoad(item.job_id)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                    selected
                      ? "bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                      : "bg-white text-slate-950 hover:bg-slate-200"
                  }`}
                >
                  {selected ? "Loaded" : "Load"}
                </button>

                <button
                  onClick={() => onShare(item.job_id)}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Copy Link
                </button>

                <button
                  onClick={() => onDownload(item.job_id)}
                  className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-300 transition hover:bg-blue-500/20"
                >
                  PDF
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 truncate font-semibold text-slate-200">{String(value)}</p>
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
      className={`premium-card-enter grid min-w-0 gap-5 rounded-3xl border bg-slate-900/70 p-5 shadow-xl transition hover:-translate-y-1 hover:shadow-2xl 2xl:grid-cols-[260px_1fr] ${styles.border} ${styles.glow}`}
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

      <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
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
  const isAwaiting =
    value === "-" ||
    value === undefined ||
    value === null ||
    value === "";

  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <p className="text-sm text-slate-400">{title}</p>

      {isAwaiting ? (
        <div className="mt-3">
          <p className="text-base font-bold text-slate-400">Awaiting analysis</p>
          <div className="mt-3 h-2 w-24 animate-pulse rounded-full bg-slate-800" />
        </div>
      ) : (
        <p className="mt-3 break-words text-2xl font-black">{String(value)}</p>
      )}
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

function TelemetryBar({
  telemetry,
  loading,
  events,
}: {
  telemetry: any;
  loading: boolean;
  events: StreamEvent[];
}) {
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
            <p className="font-semibold text-cyan-300">Evalora Orchestration Console</p>
            <p className="text-xs text-slate-500">Real-time multi-agent execution trace</p>
          </div>

          <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            STREAM LIVE
          </div>
        </div>

        <div className="reviewer-scroll max-h-[420px] space-y-3 overflow-y-auto font-mono text-sm">
          {events.map((event, index) => (
            <div
              key={`${event.type}-${index}`}
              className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            >
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
                    <span className="text-xs text-slate-500">
                      [{new Date().toLocaleTimeString()}]
                    </span>
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

  if (event.type === "session_started") return "Evalora orchestration session initialized.";
  if (event.type === "chair_started") return "Chair Agent synthesizing reviewer consensus.";
  if (event.type === "agent_completed") return `${event.agent_label} completed review successfully.`;
  if (event.type === "agent_failed") {
    return `${event.agent_label} failed, but ReviewerOS generated a safe fallback output and continued orchestration.`;
  }
  if (event.type === "chair_completed") return "Chair Agent finalized executive recommendation.";
  if (event.type === "session_completed") return "Evalora orchestration completed.";
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
      default:
        return "Reviewer agent started.";
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

function isSupportedFile(fileName: string) {
  const normalized = fileName.toLowerCase();

  return (
    normalized.endsWith(".pdf") ||
    normalized.endsWith(".docx") ||
    normalized.endsWith(".txt") ||
    normalized.endsWith(".md")
  );
}

function fileKindIcon(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".pdf")) return "PDF";
  if (normalized.endsWith(".docx")) return "DOC";
  if (normalized.endsWith(".txt")) return "TXT";
  if (normalized.endsWith(".md")) return "MD";

  return "FILE";
}

function fileKindLabel(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".pdf")) return "PDF document";
  if (normalized.endsWith(".docx")) return "Word document";
  if (normalized.endsWith(".txt")) return "Text document";
  if (normalized.endsWith(".md")) return "Markdown document";

  return "Document";
}

function formatFileSize(bytes: number) {
  if (!bytes || Number.isNaN(bytes)) return "Unknown size";

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size = size / 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function shortFileName(fileName: string, maxLength = 72) {
  if (fileName.length <= maxLength) return fileName;

  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex !== -1 ? fileName.slice(dotIndex) : "";
  const baseName = dotIndex !== -1 ? fileName.slice(0, dotIndex) : fileName;

  const trimmedBase = baseName.slice(0, Math.max(12, maxLength - extension.length - 3));

  return `${trimmedBase}...${extension}`;
}

function getReportJobIdFromPath() {
  const hash = window.location.hash || "";

  if (hash.includes("report=")) {
    const hashValue = hash.split("report=")[1]?.split("&")[0];

    if (hashValue) {
      return decodeURIComponent(hashValue.trim());
    }
  }

  const params = new URLSearchParams(window.location.search);
  const queryJobId = params.get("report");

  if (queryJobId) {
    return queryJobId.trim();
  }

  const pathMatch = window.location.pathname.match(/^\/report\/([^/]+)\/?$/);

  return pathMatch?.[1]?.trim() || null;
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

function formatDate(value?: string) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

async function downloadBlobResponse(response: Response, filename: string) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.URL.revokeObjectURL(url);
}

export default App;


function RequestAccessModal({
  open,
  email,
  organization,
  useCase,
  expectedVolume,
  submitting,
  onEmailChange,
  onOrganizationChange,
  onUseCaseChange,
  onExpectedVolumeChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  email: string;
  organization: string;
  useCase: string;
  expectedVolume: string;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onOrganizationChange: (value: string) => void;
  onUseCaseChange: (value: string) => void;
  onExpectedVolumeChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-300">
              Evalora Access
            </p>
            <h2 className="mt-2 text-3xl font-black text-white">
              Request demo workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Share your details and use case. Evalora will save the request for follow-up.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 transition hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-300">
              Email address
            </span>
            <input
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@organization.com"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-300">
              Organization / workspace
            </span>
            <input
              value={organization}
              onChange={(event) => onOrganizationChange(event.target.value)}
              placeholder="University, accelerator, fund, company..."
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-300">
              Use case
            </span>
            <textarea
              value={useCase}
              onChange={(event) => onUseCaseChange(event.target.value)}
              rows={3}
              placeholder="Grant proposal review, accelerator screening, investment diligence..."
              className="mt-2 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-300">
              Expected monthly proposal volume
            </span>
            <input
              value={expectedVolume}
              onChange={(event) => onExpectedVolumeChange(event.target.value)}
              placeholder="10"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-700 px-5 py-3 font-bold text-slate-300 transition hover:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-2xl bg-emerald-400 px-5 py-3 font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}




function AdminControlPanel({
  authSession,
}: {
  authSession: AuthSession;
}) {
  const fallbackItems: any[] = [];

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetUser, setTargetUser] = useState("jury-demo");
  const [quota, setQuota] = useState("25");
  const [search, setSearch] = useState("");
  const [demoDisabled, setDemoDisabled] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminCode, setAdminCode] = useState(authSession.accessCode || "");
  const [activeTab, setActiveTab] = useState("Genel Bakış");
  const [users, setUsers] = useState<any[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newUserCode, setNewUserCode] = useState("");
  const [newUserRole, setNewUserRole] = useState("demo");
  const [newUserLimit, setNewUserLimit] = useState("25");
  const [accessCodeUserId, setAccessCodeUserId] = useState("");
  const [accessCodeValue, setAccessCodeValue] = useState("");

  function adminHeaders(extra: Record<string, string> = {}) {
    return {
      ...extra,
      "X-ReviewerOS-Access-Code": adminCode.trim(),
    };
  }

  async function loadUsers() {
    if (!adminCode.trim()) return;

    try {
      const response = await fetch(ADMIN_USERS_ENDPOINT, {
        headers: adminHeaders(),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Failed to load users.");
      }

      setUsers(json.items || []);
    } catch (error: any) {
      setAdminMessage(error?.message || "Failed to load users.");
    }
  }

  async function loadWorkspaces() {
    if (!adminCode.trim()) {
      setAdminMessage("Admin access code is missing.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(ADMIN_WORKSPACES_ENDPOINT, {
        headers: adminHeaders(),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Failed to load workspaces.");
      }

      setItems(json.items || fallbackItems);
      setDemoDisabled(Boolean(json.demo_control?.demo_disabled));
    } catch (error) {
      console.error(error);
      setItems(fallbackItems);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspaces();
    loadUsers();
  }, []);

  async function createUser() {
    if (!newUserId.trim() || !newUserCode.trim()) {
      setAdminMessage("Kullanıcı ID ve access code gerekli.");
      return;
    }

    try {
      setLoading(true);
      setAdminMessage(`Creating user ${newUserId.trim()}...`);

      const response = await fetch(ADMIN_USERS_CREATE_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          user_id: newUserId.trim(),
          access_code: newUserCode.trim(),
          role: newUserRole.trim() || "demo",
          limit: Number(newUserLimit || 25),
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "User creation failed.");
      }

      setNewUserId("");
      setNewUserCode("");
      setNewUserRole("demo");
      setNewUserLimit("25");

      await loadUsers();
      await loadWorkspaces();

      setAdminMessage(`${json.user.user_id} kullanıcısı oluşturuldu.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "User creation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function disableUser(userId: string, disabled: boolean) {
    try {
      setLoading(true);

      const response = await fetch(ADMIN_USERS_DISABLE_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          user_id: userId,
          disabled,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "User status update failed.");
      }

      await loadUsers();
      await loadWorkspaces();

      setAdminMessage(`${userId} ${disabled ? "kapatıldı" : "açıldı"}.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "User status update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(userId: string) {
    const confirmed = window.confirm(`${userId} kullanıcısını silmek istiyor musun?`);
    if (!confirmed) return;

    try {
      setLoading(true);

      const response = await fetch(`${API_URL}/admin/users/delete/${userId}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "User delete failed.");
      }

      await loadUsers();
      await loadWorkspaces();

      setAdminMessage(`${userId} kullanıcısı silindi.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "User delete failed.");
    } finally {
      setLoading(false);
    }
  }

  async function changeUserAccessCode() {
    if (!accessCodeUserId.trim() || !accessCodeValue.trim()) {
      setAdminMessage("Access code değiştirmek için kullanıcı ve yeni kod gerekli.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(ADMIN_USERS_ACCESS_CODE_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          user_id: accessCodeUserId.trim(),
          access_code: accessCodeValue.trim(),
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Access code update failed.");
      }

      setAccessCodeUserId("");
      setAccessCodeValue("");

      await loadUsers();

      setAdminMessage(`${json.user.user_id} access code güncellendi.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "Access code update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function updateQuota() {
    setAdminMessage(`Sending quota update for ${targetUser.trim()}...`);

    if (!adminCode.trim()) {
      setAdminMessage("Admin access code is missing.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(ADMIN_API_QUOTA_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          user_id: targetUser,
          limit: Number(quota),
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Quota update failed.");
      }

      await loadWorkspaces();
      alert(`Quota updated for ${targetUser}`);
    } catch (error: any) {
      alert(error?.message || "Quota update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function quickUpdateQuota(userId: string, nextLimit: number) {
    const safeLimit = Math.max(0, Number(nextLimit || 0));

    try {
      setLoading(true);
      setAdminMessage(`${userId} quota ${safeLimit} olarak güncelleniyor...`);

      const response = await fetch(ADMIN_API_QUOTA_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          user_id: userId,
          limit: safeLimit,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Quota update failed.");
      }

      await loadWorkspaces();

      setTargetUser(userId);
      setQuota(String(safeLimit));
      setAdminMessage(`${userId} quota ${safeLimit} olarak güncellendi.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "Quota update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function resetUsage(userId: string) {
    try {
      setLoading(true);

      const response = await fetch(`${API_URL}/admin/reset-usage/${userId}`, {
        method: "POST",
        headers: adminHeaders(),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Usage reset failed.");
      }

      await loadWorkspaces();
      setAdminMessage(`Usage reset for ${userId}.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "Usage reset failed.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleWorkspace(userId: string, disabled: boolean) {
    try {
      setLoading(true);

      const response = await fetch(ADMIN_WORKSPACE_STATUS_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          user_id: userId,
          disabled,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Workspace update failed.");
      }

      await loadWorkspaces();
      setAdminMessage(`${userId} ${disabled ? "disabled" : "enabled"}.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "Workspace update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleDemoControl() {
    try {
      setLoading(true);

      const response = await fetch(ADMIN_DEMO_CONTROL_ENDPOINT, {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          demo_disabled: !demoDisabled,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.detail || "Demo control update failed.");
      }

      setDemoDisabled(Boolean(json.demo_control?.demo_disabled));
      setAdminMessage(`Demo access ${!demoDisabled ? "disabled" : "enabled"}.`);
    } catch (error: any) {
      setAdminMessage(error?.message || "Demo control update failed.");
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = items.filter((item) =>
    item.user_id.toLowerCase().includes(search.toLowerCase())
  );

  const totalQuota = items.reduce((sum, item) => sum + Number(item.limit || 0), 0);
  const totalUsed = items.reduce((sum, item) => sum + Number(item.used || 0), 0);
  const activeCount = items.filter((item) => !item.disabled).length;

  const telemetryEvents = [
    "Vertex runtime healthy · Gemini 2.5 Pro ready",
    "MCP trace stream active",
    "Firestore quota store synchronized",
    "PDF report generator online",
    "Workspace safety checks enabled",
  ];

  return (
    <div
      className="relative z-[9999] grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)] pointer-events-auto"
      style={{ pointerEvents: "auto" }}
    >
      <aside className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl">
        <p className="mb-5 text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
          Admin Kontrol Paneli
        </p>

        {["Genel Bakış", "Workspace Yönetimi", "Telemetry", "Runtime", "Quota", "Erişim Talepleri", "Ayarlar"].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setActiveTab(item);
              setAdminMessage(`${item} sekmesi açıldı.`);
            }}
            className={`mb-2 w-full rounded-2xl px-4 py-3 text-left text-sm font-bold transition ${
              activeTab === item
                ? "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`}
          >
            {item}
          </button>
        ))}

        <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
            System
          </p>
          <p className="mt-2 text-2xl font-black text-white">Healthy</p>
          <p className="mt-1 text-xs text-slate-400">
            Cloud Run · Vertex AI · Firestore
          </p>
        </div>
      </aside>

      <div className="space-y-8">
        <section className={`${activeTab === "Erişim Talepleri" ? "hidden" : ""} relative z-10 rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-6 shadow-2xl backdrop-blur`} style={{ display: activeTab === "Erişim Talepleri" ? "none" : undefined }}>
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.32em] text-fuchsia-300">
                Admin Console
              </div>

              <h2 className="mt-2 text-4xl font-black text-white">
                {activeTab === "Genel Bakış" && "ReviewerOS Control Center"}
                {activeTab === "Workspace Yönetimi" && "Workspace Yönetimi"}
                {activeTab === "Telemetry" && "Telemetry İzleme"}
                {activeTab === "Runtime" && "Runtime Sağlığı"}
                {activeTab === "Quota" && "Quota Yönetimi"}
                {activeTab === "Erişim Talepleri" && "Erişim Talepleri"}
                {activeTab === "Ayarlar" && "Admin Ayarları"}
              </h2>

              <p className="mt-3 max-w-2xl text-lg leading-8 text-slate-300">
                {activeTab === "Genel Bakış" && "Manage workspaces, quotas, runtime access, telemetry safety, and demo infrastructure controls."}
                {activeTab === "Workspace Yönetimi" && "Workspace kayıtlarını ara, quota değiştir, usage resetle ve workspace durumunu yönet."}
                {activeTab === "Telemetry" && "MCP traces, runtime events, agent latency ve gözlemlenebilirlik akışını takip et."}
                {activeTab === "Runtime" && "Cloud Run, Vertex AI, Firestore ve PDF runtime sağlığını izle."}
                {activeTab === "Quota" && "Demo, jury ve kurum workspace quota limitlerini yönet."}
                {activeTab === "Erişim Talepleri" && "Request Access formlarını ve demo taleplerini incele."}
                {activeTab === "Ayarlar" && "Global demo kill switch ve admin güvenlik kontrollerini yönet."}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              {[
                ["Workspaces", items.length, "text-white"],
                ["Active", activeCount, "text-emerald-300"],
                ["Total Quota", totalQuota, "text-cyan-300"],
                ["Used", totalUsed, "text-amber-300"],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-2xl border border-slate-700 bg-slate-950/80 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
                  <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className={`${activeTab === "Erişim Talepleri" ? "hidden" : ""} relative z-10 rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.22em] text-cyan-200">
                  {activeTab}
                </div>

                <h3 className="text-2xl font-black text-white">
                  {activeTab === "Genel Bakış" ? "Workspace Management" : activeTab}
                </h3>
                <p className="mt-2 text-slate-400">
                  Her workspace için quota seç, artır/azalt, usage resetle veya manuel limit gir.
                </p>

                <input
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  placeholder="Admin access code"
                  type="password"
                  className="mt-4 w-full max-w-xl rounded-2xl border border-fuchsia-500/30 bg-slate-950/90 px-4 py-3 text-white outline-none"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <input
                  value={targetUser}
                  onChange={(e) => setTargetUser(e.target.value)}
                  placeholder="workspace id"
                  className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none"
                />

                <input
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                  placeholder="quota"
                  className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none"
                />

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="search workspace"
                  className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none"
                />

                <button
                  type="button"
                  onClick={() => {
                    console.log("Update quota clicked");
                    updateQuota();
                  }}
                  disabled={loading}
                  className="relative z-[9999] rounded-2xl bg-fuchsia-500 px-5 py-3 font-black text-white transition hover:scale-[1.02]"
                >
                  Update Quota
                </button>
              </div>
            </div>

            <div className={`mt-6 rounded-2xl border px-5 py-4 text-sm font-bold ${
              adminMessage
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-slate-700 bg-slate-950/70 text-slate-400"
            }`}>
              {adminMessage || "Admin panel ready. Choose an action."}
            </div>

            <div className="mt-8 overflow-x-auto rounded-3xl border border-slate-800">
              <table className="min-w-[1080px] w-full border-collapse">
                <thead className="bg-slate-950/90">
                  <tr className="text-left text-xs uppercase tracking-[0.22em] text-slate-400">
                    <th className="px-6 py-4">Workspace</th>
                    <th className="px-6 py-4">Used</th>
                    <th className="px-6 py-4">Limit</th>
                    <th className="px-6 py-4">Remaining</th>
                    <th className="px-6 py-4">Actions</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.user_id} className="border-t border-slate-800 bg-slate-950/40">
                      <td className="px-6 py-5 font-black text-white">{item.user_id}</td>
                      <td className="px-6 py-5 text-slate-300">{item.used}</td>
                      <td className="px-6 py-5 text-cyan-300">{item.limit}</td>
                      <td className="px-6 py-5 text-emerald-300">{item.remaining}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex min-w-[280px] flex-nowrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => quickUpdateQuota(item.user_id, Number(item.limit || 0) - 5)}
                            className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
                          >
                            -5
                          </button>

                          <button
                            type="button"
                            onClick={() => quickUpdateQuota(item.user_id, Number(item.limit || 0) + 5)}
                            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
                          >
                            +5
                          </button>

                          <button
                            type="button"
                            onClick={() => resetUsage(item.user_id)}
                            className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs font-bold text-yellow-100 hover:bg-yellow-500/20"
                          >
                            Reset
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleWorkspace(item.user_id, !item.disabled)}
                            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                              item.disabled ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200"
                            }`}
                          >
                            {item.disabled ? "Enable" : "Disable"}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-5 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                          item.disabled ? "bg-red-500/20 text-red-200" : "bg-emerald-500/20 text-emerald-200"
                        }`}>
                          {item.disabled ? "disabled" : "active"}
                        </span>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>


          {activeTab === "Erişim Talepleri" && (

          <section className="xl:col-span-2 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl backdrop-blur" style={{ display: activeTab !== "Erişim Talepleri" ? "none" : undefined }}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
                  Kullanıcı Yönetimi
                </div>

                <h3 className="text-2xl font-black text-white">
                  Users / Access Control
                </h3>

                <p className="mt-2 max-w-2xl text-slate-400">
                  Kullanıcı oluştur, kapat/aç, access code değiştir ve silebilirsin.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  loadUsers();
                  loadWorkspaces();
                  setAdminMessage("Kullanıcı listesi yenilendi.");
                }}
                className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Refresh Users
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
                <h4 className="text-lg font-black text-white">Yeni Kullanıcı Oluştur</h4>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input value={newUserId} onChange={(e) => setNewUserId(e.target.value)} placeholder="user id örn. client-b" className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none" />
                  <input value={newUserCode} onChange={(e) => setNewUserCode(e.target.value)} placeholder="access code" className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none" />
                  <input value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)} placeholder="role" className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none" />
                  <input value={newUserLimit} onChange={(e) => setNewUserLimit(e.target.value)} placeholder="quota" className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none" />
                </div>

                <button
                  type="button"
                  onClick={createUser}
                  disabled={loading}
                  className="mt-4 w-full rounded-2xl bg-emerald-500 px-5 py-3 font-black text-slate-950 transition hover:scale-[1.01]"
                >
                  Create User
                </button>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
                <h4 className="text-lg font-black text-white">Access Code Değiştir</h4>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input value={accessCodeUserId} onChange={(e) => setAccessCodeUserId(e.target.value)} placeholder="user id" className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none" />
                  <input value={accessCodeValue} onChange={(e) => setAccessCodeValue(e.target.value)} placeholder="new access code" className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-white outline-none" />
                </div>

                <button
                  type="button"
                  onClick={changeUserAccessCode}
                  disabled={loading}
                  className="mt-4 w-full rounded-2xl border border-fuchsia-400/40 bg-fuchsia-500/15 px-5 py-3 font-black text-fuchsia-100 transition hover:bg-fuchsia-500/25"
                >
                  Change Access Code
                </button>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto rounded-3xl border border-slate-800">
              <table className="min-w-[900px] w-full border-collapse">
                <thead className="bg-slate-950/90">
                  <tr className="text-left text-xs uppercase tracking-[0.22em] text-slate-400">
                    <th className="px-6 py-4">User</th>
                    <th className="px-6 py-4">Role</th>
                    <th className="px-6 py-4">Access Code</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {users.map((user: any) => (
                    <tr key={user.user_id} className="border-t border-slate-800 bg-slate-950/40">
                      <td className="px-6 py-5 font-black text-white">{user.user_id}</td>
                      <td className="px-6 py-5 text-cyan-300">{user.role}</td>
                      <td className="px-6 py-5 text-slate-300">{user.has_access_code ? "Configured" : "Missing"}</td>
                      <td className="px-6 py-5">
                        <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                          user.disabled ? "bg-red-500/20 text-red-200" : "bg-emerald-500/20 text-emerald-200"
                        }`}>
                          {user.disabled ? "disabled" : "active"}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-nowrap gap-2">
                          <button
                            type="button"
                            onClick={() => disableUser(user.user_id, !user.disabled)}
                            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                              user.disabled ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200"
                            }`}
                          >
                            {user.disabled ? "Enable" : "Disable"}
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteUser(user.user_id)}
                            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 transition hover:bg-red-500/20"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                        Kullanıcı bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          )}

          <aside className="relative z-10 space-y-6" style={{ display: activeTab === "Erişim Talepleri" ? "none" : undefined }}>
            <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-6">
              <div className={`${activeTab === "Erişim Talepleri" || activeTab === "Ayarlar" ? "hidden" : ""} flex items-center justify-between`}>
                <h3 className="text-xl font-black text-white">Live Runtime</h3>
                <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.9)]" />
              </div>

              <div className="mt-5 space-y-3">
                {telemetryEvents.map((event, index) => (
                  <div key={event} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs font-mono text-cyan-200">
                      {`18:${String(30 + index).padStart(2, "0")}:${String(index * 7).padStart(2, "0")}`}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">{event}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-red-500/25 bg-red-500/10 p-6">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-red-300">
                Danger Zone
              </p>

              <h3 className="mt-2 text-2xl font-black text-white">
                Demo Kill Switch
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-300">
                Immediately disable or re-enable demo access if public traffic,
                abuse, or Vertex cost risk increases.
              </p>

              <button
                type="button"
                onClick={() => {
                console.log("Demo control clicked");
                toggleDemoControl();
              }}
                className={`mt-5 w-full rounded-2xl px-5 py-4 font-black transition ${
                  demoDisabled
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-red-500 text-white"
                }`}
              >
                {demoDisabled ? "Enable Demo Access" : "Disable Demo Access"}
              </button>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
