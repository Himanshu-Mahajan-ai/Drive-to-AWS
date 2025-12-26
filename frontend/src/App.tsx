import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

interface ImportResponse {
  id: string;
  status: string;
  folder_url: string;
  bucket: string;
  prefix?: string;
  total_files?: number;
  completed_files: number;
  failed_files: number;
  created_at?: string;
  updated_at?: string;
}

interface ImageResponse {
  id: string;
  job_id: string;
  name: string;
  mime_type?: string;
  size_bytes?: number;
  s3_bucket?: string;
  s3_key?: string;
  status: string;
  error?: string;
}

interface Credential {
  id: string;
  credential_type: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

type JobHistory = ImportResponse & { last_seen: string };

const HISTORY_KEY = "import-job-history";

function formatDate(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function toPercent(job?: ImportResponse | null) {
  if (!job || !job.total_files) return 0;
  return Math.min(100, Math.round((job.completed_files / job.total_files) * 100));
}

function downloadCsv(images: ImageResponse[], jobId: string) {
  if (!images.length) return;
  const header = ["id", "job_id", "name", "mime_type", "size_bytes", "s3_bucket", "s3_key", "status", "error"];
  const rows = images.map((img) =>
    [img.id, img.job_id, img.name, img.mime_type ?? "", img.size_bytes ?? "", img.s3_bucket ?? "", img.s3_key ?? "", img.status, img.error ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `metadata-${jobId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(images: ImageResponse[], jobId: string) {
  if (!images.length) return;
  const report = {
    generated: new Date().toISOString(),
    total: images.length,
    images,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `metadata-${jobId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadExcel(images: ImageResponse[], jobId: string) {
  if (!images.length) return;
  // Excel-friendly TSV with .xls extension for easy opening in spreadsheet apps
  const header = ["id", "job_id", "name", "mime_type", "size_bytes", "s3_bucket", "s3_key", "status", "error"];
  const rows = images.map((img) => [
    img.id,
    img.job_id,
    img.name,
    img.mime_type ?? "",
    img.size_bytes ?? "",
    img.s3_bucket ?? "",
    img.s3_key ?? "",
    img.status,
    img.error ?? "",
  ]);
  const tsv = [header.join("\t"), ...rows.map((r) => r.map((v) => String(v)).join("\t"))].join("\n");
  const blob = new Blob([tsv], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `metadata-${jobId}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [folderUrl, setFolderUrl] = useState("");
  const [prefix, setPrefix] = useState("");
  const [bucket, setBucket] = useState("");
  const [job, setJob] = useState<ImportResponse | null>(null);
  const [images, setImages] = useState<ImageResponse[]>([]);
  const [history, setHistory] = useState<JobHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedAWSCred, setSelectedAWSCred] = useState<string | null>(null);
  const [selectedGoogleCred, setSelectedGoogleCred] = useState<string | null>(null);

  // load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch {
        setHistory([]);
      }
    }
  }, []);

  // Load credentials when settings open
  useEffect(() => {
    if (showSettings) {
      fetchCredentials();
    }
  }, [showSettings]);

  const fetchCredentials = async () => {
    try {
      const res = await api.get<Credential[]>("/credentials");
      setCredentials(res.data);
      // Set defaults
      const awsCred = res.data.find(c => c.credential_type === "aws" && c.is_default);
      const googleCred = res.data.find(c => c.credential_type === "google" && c.is_default);
      if (awsCred) setSelectedAWSCred(awsCred.id);
      if (googleCred) setSelectedGoogleCred(googleCred.id);
    } catch (err) {
      console.error("Failed to load credentials:", err);
    }
  };

  const persistHistory = (next: JobHistory[]) => {
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 10)));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
    setMessage("History cleared");
    setTimeout(() => setMessage(null), 2000);
  };

  const fetchJob = async (jobId: string) => {
    const res = await api.get<ImportResponse>(`/imports/${jobId}`);
    setJob(res.data);
    const imgs = await api.get<ImageResponse[]>("/images", { params: { job_id: jobId, limit: 500 } });
    setImages(imgs.data);
    return res.data;
  };

  const cancelImport = async () => {
    if (!job) return;
    setLoading(true);
    try {
      const res = await api.post<ImportResponse>(`/imports/${job.id}/cancel`);
      setJob(res.data);
      persistHistory(
        [{ ...res.data, last_seen: new Date().toISOString() }, ...history.filter((h) => h.id !== res.data.id)].slice(0, 10)
      );
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || "Failed to cancel");
    } finally {
      setLoading(false);
    }
  };

  const createImport = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.post<ImportResponse>("/imports", {
        folder_url: folderUrl,
        prefix: prefix || null,
        bucket: bucket || null
      });
      setJob(res.data);
      persistHistory([{ ...res.data, last_seen: new Date().toISOString() }, ...history].slice(0, 10));
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || "Failed to start import");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!job) return;
    const interval = setInterval(async () => {
      try {
        const updated = await fetchJob(job.id);
        persistHistory(
          [{ ...updated, last_seen: new Date().toISOString() }, ...history.filter((h) => h.id !== updated.id)].slice(0, 10)
        );
      } catch (err) {
        console.error("Error polling job:", err);
      }
    }, 1000);  // Poll every 1 second for faster updates
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const percent = useMemo(() => {
    const p = toPercent(job);
    // Show 100% when job is completed
    return job?.status === "completed" ? 100 : p;
  }, [job]);

  const statusTone = (status?: string) => {
    if (!status) return "#525252";
    if (status === "completed") return "#10b981";
    if (status === "failed") return "#dc2626";
    if (status === "running") return "#f59e0b";
    if (status === "transferring") return "#06b6d4";
    return "#737373";
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(to bottom, #0a0a0a, #1a1a1a)", color: "#ececec", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <header style={{ textAlign: "center", marginBottom: "3rem" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
            <button
              onClick={() => setShowSettings(true)}
              style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #404040", background: "#1a1a1a", color: "#a3a3a3", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = "#ececec"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#1a1a1a"; e.currentTarget.style.color = "#a3a3a3"; }}
            >
              ⚙️ Settings
            </button>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #10b981, #06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", boxShadow: "0 8px 24px rgba(16, 185, 129, 0.3)" }}>
              ☁️
            </div>
            <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 600, background: "linear-gradient(to right, #10b981, #06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Drive to AWS
            </h1>
          </div>
          <p style={{ margin: 0, color: "#999", fontSize: "0.95rem" }}>Transfer your Google Drive images to AWS S3 effortlessly</p>
        </header>

        <section style={{ marginBottom: "2rem" }}>
          <div style={{ background: "#262626", border: "1px solid #404040", borderRadius: 16, padding: "2rem", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
            {message && (
              <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#dc2626", border: "1px solid #ef4444", borderRadius: 12, color: "#fecaca", fontSize: "0.9rem" }}>
                {message}
              </div>
            )}
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 500 }}>Google Drive Folder URL</label>
                <input
                  style={{ width: "100%", background: "#1a1a1a", color: "#ececec", border: "1px solid #404040", borderRadius: 12, padding: "0.875rem 1rem", fontSize: "0.95rem", outline: "none", transition: "border-color 0.2s" }}
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  onFocus={(e) => e.target.style.borderColor = "#10b981"}
                  onBlur={(e) => e.target.style.borderColor = "#404040"}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 500 }}>Bucket (optional)</label>
                  <input
                    style={{ width: "100%", background: "#1a1a1a", color: "#ececec", border: "1px solid #404040", borderRadius: 12, padding: "0.875rem 1rem", fontSize: "0.95rem", outline: "none", transition: "border-color 0.2s" }}
                    placeholder="my-bucket"
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    onFocus={(e) => e.target.style.borderColor = "#10b981"}
                    onBlur={(e) => e.target.style.borderColor = "#404040"}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 500 }}>Prefix (optional)</label>
                  <input
                    style={{ width: "100%", background: "#1a1a1a", color: "#ececec", border: "1px solid #404040", borderRadius: 12, padding: "0.875rem 1rem", fontSize: "0.95rem", outline: "none", transition: "border-color 0.2s" }}
                    placeholder="folder/subfolder"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    onFocus={(e) => e.target.style.borderColor = "#10b981"}
                    onBlur={(e) => e.target.style.borderColor = "#404040"}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  disabled={loading || !folderUrl}
                  onClick={createImport}
                  style={{ flex: 1, padding: "0.875rem 1.5rem", borderRadius: 12, border: "none", background: loading || !folderUrl ? "#404040" : "linear-gradient(135deg, #10b981, #059669)", color: "#fff", fontWeight: 600, cursor: loading || !folderUrl ? "not-allowed" : "pointer", fontSize: "0.95rem", boxShadow: loading || !folderUrl ? "none" : "0 4px 16px rgba(16, 185, 129, 0.4)", transition: "all 0.2s" }}
                >
                  {loading ? "Starting..." : "Start Transfer"}
                </button>
                <button
                  onClick={cancelImport}
                  disabled={!job || job.status === "completed" || job.status === "canceled" || loading}
                  style={{ padding: "0.875rem 1.5rem", borderRadius: 12, border: "1px solid #dc2626", background: !job || job.status === "completed" || job.status === "canceled" ? "#262626" : "#7f1d1d", color: !job || job.status === "completed" || job.status === "canceled" ? "#666" : "#fca5a5", cursor: !job || job.status === "completed" || job.status === "canceled" ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "0.95rem", transition: "all 0.2s" }}
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        </section>

        {job && (
          <section key={job.id} style={{ marginBottom: "2rem" }}>
            <div style={{ background: "#262626", border: "1px solid #404040", borderRadius: 16, padding: "2rem", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1.5rem" }}>
                <div>
                  <div style={{ fontSize: "0.85rem", color: "#737373", marginBottom: "0.25rem" }}>Job ID</div>
                  <div style={{ fontSize: "0.95rem", fontFamily: "monospace", color: "#a3a3a3" }}>{job.id}</div>
                </div>
                <span style={{ background: statusTone(job.status), color: "#fff", padding: "0.4rem 0.85rem", borderRadius: 20, fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {job.status}
                </span>
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.875rem", color: "#a3a3a3", fontWeight: 500 }}>Transfer Progress</span>
                  <span style={{ fontSize: "0.875rem", color: "#10b981", fontWeight: 600 }}>{percent}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "#1a1a1a", overflow: "hidden", border: "1px solid #404040" }}>
                  <div style={{ width: `${percent}%`, height: "100%", background: "linear-gradient(90deg, #10b981, #34d399)", transition: "width 0.5s ease" }} />
                </div>
                <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
                  <span style={{ color: "#10b981" }}>✓ {job.completed_files} completed</span>
                  <span style={{ color: "#737373" }}>Total: {job.total_files ?? "calculating..."}</span>
                  {job.failed_files > 0 && <span style={{ color: "#ef4444" }}>✗ {job.failed_files} failed</span>}
                </div>
              </div>

              {job.status === "completed" && (
                <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "#1a1a1a", border: "1px solid #10b981", borderRadius: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "1.25rem" }}>✅</span>
                    <span style={{ fontWeight: 600, color: "#10b981", fontSize: "0.95rem" }}>Transfer Complete!</span>
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.75rem" }}>
                    Your files are now available in AWS S3
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.75rem", background: "#0a0a0a", borderRadius: 8, border: "1px solid #404040" }}>
                    <span style={{ fontSize: "0.85rem", color: "#737373" }}>📦</span>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontSize: "0.75rem", color: "#737373", marginBottom: "0.15rem" }}>S3 Location:</div>
                      <div style={{ fontSize: "0.875rem", fontFamily: "monospace", color: "#10b981", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        s3://{job.bucket}/{job.prefix || ""}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`s3://${job.bucket}/${job.prefix || ""}`);
                        setMessage("S3 path copied to clipboard!");
                        setTimeout(() => setMessage(null), 2000);
                      }}
                      style={{ padding: "0.5rem 0.75rem", background: "#404040", border: "none", borderRadius: 8, color: "#a3a3a3", cursor: "pointer", fontSize: "0.8rem", fontWeight: 500, transition: "background 0.2s" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#525252"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "#404040"}
                    >
                      Copy
                    </button>
                  </div>
                  <a
                    href={`https://s3.console.aws.amazon.com/s3/buckets/${job.bucket}?prefix=${job.prefix || ""}&region=${job.bucket.includes("us-east-1") ? "us-east-1" : "us-west-2"}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-block", marginTop: "0.75rem", padding: "0.625rem 1rem", background: "#404040", border: "none", borderRadius: 8, color: "#ececec", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500, transition: "background 0.2s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#525252"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#404040"}
                  >
                    Open in AWS Console →
                  </a>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                <div style={{ background: "#1a1a1a", border: "1px solid #404040", borderRadius: 12, padding: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "#737373", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>Bucket</div>
                  <div style={{ fontSize: "0.9rem", color: "#ececec", fontFamily: "monospace", wordBreak: "break-all" }}>{job.bucket}</div>
                </div>
                <div style={{ background: "#1a1a1a", border: "1px solid #404040", borderRadius: 12, padding: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "#737373", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>Prefix</div>
                  <div style={{ fontSize: "0.9rem", color: "#ececec", fontFamily: "monospace", wordBreak: "break-all" }}>{job.prefix || "none"}</div>
                </div>
                <div style={{ background: "#1a1a1a", border: "1px solid #404040", borderRadius: 12, padding: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "#737373", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>Updated</div>
                  <div style={{ fontSize: "0.9rem", color: "#ececec" }}>{formatDate(job.updated_at)}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => images.length && downloadCsv(images, job.id)}
                  disabled={!images.length}
                  style={{ padding: "0.625rem 1.25rem", borderRadius: 10, border: "1px solid #404040", background: images.length ? "#1a1a1a" : "#262626", color: images.length ? "#10b981" : "#525252", cursor: images.length ? "pointer" : "not-allowed", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
                  onMouseEnter={(e) => images.length && (e.currentTarget.style.background = "#0a0a0a")}
                  onMouseLeave={(e) => images.length && (e.currentTarget.style.background = "#1a1a1a")}
                >
                  Download CSV
                </button>
                <button
                  onClick={() => images.length && downloadJson(images, job.id)}
                  disabled={!images.length}
                  style={{ padding: "0.625rem 1.25rem", borderRadius: 10, border: "1px solid #404040", background: images.length ? "#1a1a1a" : "#262626", color: images.length ? "#06b6d4" : "#525252", cursor: images.length ? "pointer" : "not-allowed", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
                  onMouseEnter={(e) => images.length && (e.currentTarget.style.background = "#0a0a0a")}
                  onMouseLeave={(e) => images.length && (e.currentTarget.style.background = "#1a1a1a")}
                >
                  Download JSON
                </button>
                <button
                  onClick={() => images.length && downloadExcel(images, job.id)}
                  disabled={!images.length}
                  style={{ padding: "0.625rem 1.25rem", borderRadius: 10, border: "1px solid #404040", background: images.length ? "#1a1a1a" : "#262626", color: images.length ? "#f59e0b" : "#525252", cursor: images.length ? "pointer" : "not-allowed", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
                  onMouseEnter={(e) => images.length && (e.currentTarget.style.background = "#0a0a0a")}
                  onMouseLeave={(e) => images.length && (e.currentTarget.style.background = "#1a1a1a")}
                >
                  Download Excel
                </button>
                <button
                  onClick={() => fetchJob(job.id)}
                  style={{ padding: "0.625rem 1.25rem", borderRadius: 10, border: "1px solid #404040", background: "#1a1a1a", color: "#a3a3a3", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#0a0a0a"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#1a1a1a"}
                >
                  Refresh
                </button>
              </div>
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section style={{ marginBottom: "2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#ececec", margin: 0 }}>Recent Transfers</h3>
              <button
                onClick={clearHistory}
                style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #dc2626", background: "#7f1d1d", color: "#fca5a5", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#991b1b"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#7f1d1d"}
              >
                Clear History
              </button>
            </div>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => fetchJob(h.id)}
                  style={{ textAlign: "left", background: "#262626", border: "1px solid #404040", borderRadius: 12, padding: "1rem 1.25rem", cursor: "pointer", transition: "all 0.2s", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#2a2a2a";
                    e.currentTarget.style.borderColor = "#525252";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#262626";
                    e.currentTarget.style.borderColor = "#404040";
                  }}
                >
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: "0.9rem", color: "#ececec", marginBottom: "0.35rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {h.folder_url.replace("https://drive.google.com/drive/folders/", "").slice(0, 40)}...
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#737373" }}>
                      {formatDate(h.updated_at || h.last_seen)}
                    </div>
                  </div>
                  <span style={{ background: statusTone(h.status), color: "#fff", padding: "0.35rem 0.75rem", borderRadius: 16, fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {h.status}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {images.length > 0 && (
          <section>
            <div style={{ background: "#262626", border: "1px solid #404040", borderRadius: 16, padding: "2rem", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Transferred Files ({images.length})</h3>
                  <p style={{ margin: "0.25rem 0 0", color: "#737373", fontSize: "0.875rem" }}>
                    {images.length > 20 ? "Summary view for large batches" : "Detailed file information"}
                  </p>
                </div>
              </div>
              {images.length <= 20 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ color: "#737373", textAlign: "left", borderBottom: "1px solid #404040" }}>
                        <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>File Name</th>
                        <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Status</th>
                        <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>S3 Key</th>
                        <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {images.map((img) => (
                        <tr key={img.id} style={{ borderBottom: "1px solid #333" }}>
                          <td style={{ padding: "0.75rem 0.5rem", color: "#ececec" }}>{img.name}</td>
                          <td style={{ padding: "0.75rem 0.5rem" }}>
                            <span style={{ color: statusTone(img.status), fontSize: "0.8rem", fontWeight: 600 }}>{img.status}</span>
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem", color: "#a3a3a3", fontFamily: "monospace", fontSize: "0.8rem" }}>{img.s3_key || "-"}</td>
                          <td style={{ padding: "0.75rem 0.5rem", color: "#a3a3a3" }}>{img.size_bytes ? `${Math.round(img.size_bytes / 1024)} KB` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "2rem", textAlign: "center" }}>
                  <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📦</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#ececec", marginBottom: "0.5rem" }}>
                    Transferring {images.length} files
                  </div>
                  <div style={{ fontSize: "0.95rem", color: "#737373", marginBottom: "1.5rem" }}>
                    {images.filter(i => i.status === "completed").length} completed • 
                    {images.filter(i => i.status === "failed").length} failed • 
                    {images.filter(i => i.status === "transferring" || i.status === "pending").length} in progress
                  </div>
                  <div style={{ padding: "0.75rem 1.25rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 10, display: "inline-block" }}>
                    <span style={{ fontSize: "0.875rem", color: "#a3a3a3" }}>💡 Use "Download CSV" above for full details</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {showSettings && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <SettingsModal
              credentials={credentials}
              selectedAWSCred={selectedAWSCred}
              selectedGoogleCred={selectedGoogleCred}
              onClose={() => setShowSettings(false)}
              onCredentialsUpdated={fetchCredentials}
              onSelectAWS={setSelectedAWSCred}
              onSelectGoogle={setSelectedGoogleCred}
              onMessage={setMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsModal({
  credentials,
  selectedAWSCred,
  selectedGoogleCred,
  onClose,
  onCredentialsUpdated,
  onSelectAWS,
  onSelectGoogle,
  onMessage,
}: {
  credentials: Credential[];
  selectedAWSCred: string | null;
  selectedGoogleCred: string | null;
  onClose: () => void;
  onCredentialsUpdated: () => void;
  onSelectAWS: (id: string) => void;
  onSelectGoogle: (id: string) => void;
  onMessage: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"list" | "add-aws" | "add-google">("list");
  const [awsForm, setAwsForm] = useState({ name: "", accessKeyId: "", secretAccessKey: "", region: "us-east-1", bucket: "", endpointUrl: "" });
  const [googleForm, setGoogleForm] = useState({ name: "", apiKey: "", serviceAccountJson: "" });
  const [loading, setLoading] = useState(false);

  const addAwsCredential = async () => {
    if (!awsForm.name || !awsForm.accessKeyId || !awsForm.secretAccessKey || !awsForm.bucket) {
      onMessage("All fields required for AWS credentials");
      return;
    }
    setLoading(true);
    try {
      await api.post("/credentials/aws", {
        name: awsForm.name,
        access_key_id: awsForm.accessKeyId,
        secret_access_key: awsForm.secretAccessKey,
        region: awsForm.region,
        bucket: awsForm.bucket,
        endpoint_url: awsForm.endpointUrl || null,
      });
      onMessage("AWS credentials added");
      setAwsForm({ name: "", accessKeyId: "", secretAccessKey: "", region: "us-east-1", bucket: "", endpointUrl: "" });
      setTab("list");
      onCredentialsUpdated();
    } catch (err: any) {
      onMessage(err?.response?.data?.detail || "Failed to add AWS credentials");
    } finally {
      setLoading(false);
    }
  };

  const addGoogleCredential = async () => {
    if (!googleForm.name || (!googleForm.apiKey && !googleForm.serviceAccountJson)) {
      onMessage("Provide API key or service account JSON");
      return;
    }
    setLoading(true);
    try {
      await api.post("/credentials/google", {
        name: googleForm.name,
        api_key: googleForm.apiKey || null,
        service_account_json: googleForm.serviceAccountJson || null,
      });
      onMessage("Google credentials added");
      setGoogleForm({ name: "", apiKey: "", serviceAccountJson: "" });
      setTab("list");
      onCredentialsUpdated();
    } catch (err: any) {
      onMessage(err?.response?.data?.detail || "Failed to add Google credentials");
    } finally {
      setLoading(false);
    }
  };

  const deleteCredential = async (id: string) => {
    if (!confirm("Delete this credential?")) return;
    try {
      await api.delete(`/credentials/${id}`);
      onMessage("Credential deleted");
      onCredentialsUpdated();
    } catch (err: any) {
      onMessage(err?.response?.data?.detail || "Failed to delete credential");
    }
  };

  const setDefault = async (id: string) => {
    try {
      await api.post(`/credentials/${id}/set-default`);
      onMessage("Default credential updated");
      onCredentialsUpdated();
    } catch (err: any) {
      onMessage(err?.response?.data?.detail || "Failed to set default");
    }
  };

  const awsCreds = credentials.filter(c => c.credential_type === "aws");
  const googleCreds = credentials.filter(c => c.credential_type === "google");

  return (
    <div style={{ background: "#262626", border: "1px solid #404040", borderRadius: 16, padding: "2rem", maxWidth: "600px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600, color: "#ececec" }}>Credentials</h2>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#a3a3a3" }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid #404040", paddingBottom: "1rem" }}>
        <button
          onClick={() => setTab("list")}
          style={{ padding: "0.5rem 1rem", background: tab === "list" ? "#404040" : "transparent", border: "none", color: tab === "list" ? "#10b981" : "#a3a3a3", cursor: "pointer", fontWeight: 500, borderRadius: 6 }}
        >
          My Credentials
        </button>
        <button
          onClick={() => setTab("add-aws")}
          style={{ padding: "0.5rem 1rem", background: tab === "add-aws" ? "#404040" : "transparent", border: "none", color: tab === "add-aws" ? "#10b981" : "#a3a3a3", cursor: "pointer", fontWeight: 500, borderRadius: 6 }}
        >
          Add AWS
        </button>
        <button
          onClick={() => setTab("add-google")}
          style={{ padding: "0.5rem 1rem", background: tab === "add-google" ? "#404040" : "transparent", border: "none", color: tab === "add-google" ? "#10b981" : "#a3a3a3", cursor: "pointer", fontWeight: 500, borderRadius: 6 }}
        >
          Add Google
        </button>
      </div>

      {tab === "list" && (
        <div style={{ display: "grid", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 600 }}>AWS Credentials</div>
            {awsCreds.length === 0 ? (
              <div style={{ padding: "1rem", background: "#1a1a1a", borderRadius: 8, color: "#737373", fontSize: "0.875rem" }}>No AWS credentials added</div>
            ) : (
              awsCreds.map(cred => (
                <div key={cred.id} style={{ padding: "0.75rem", background: "#1a1a1a", borderRadius: 8, border: `1px solid ${selectedAWSCred === cred.id ? "#10b981" : "#404040"}`, marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "0.875rem", color: "#ececec", fontWeight: 500 }}>{cred.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#737373" }}>{cred.is_default ? "Default" : "Custom"}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={() => { onSelectAWS(cred.id); setDefault(cred.id); }} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: selectedAWSCred === cred.id ? "#10b981" : "#404040", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer" }}>Use</button>
                    <button onClick={() => deleteCredential(cred.id)} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: "#7f1d1d", border: "none", borderRadius: 4, color: "#fca5a5", cursor: "pointer" }}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            <div style={{ fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 600 }}>Google Credentials</div>
            {googleCreds.length === 0 ? (
              <div style={{ padding: "1rem", background: "#1a1a1a", borderRadius: 8, color: "#737373", fontSize: "0.875rem" }}>No Google credentials added</div>
            ) : (
              googleCreds.map(cred => (
                <div key={cred.id} style={{ padding: "0.75rem", background: "#1a1a1a", borderRadius: 8, border: `1px solid ${selectedGoogleCred === cred.id ? "#06b6d4" : "#404040"}`, marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "0.875rem", color: "#ececec", fontWeight: 500 }}>{cred.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#737373" }}>{cred.is_default ? "Default" : "Custom"}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={() => { onSelectGoogle(cred.id); setDefault(cred.id); }} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: selectedGoogleCred === cred.id ? "#06b6d4" : "#404040", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer" }}>Use</button>
                    <button onClick={() => deleteCredential(cred.id)} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: "#7f1d1d", border: "none", borderRadius: 4, color: "#fca5a5", cursor: "pointer" }}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "add-aws" && (
        <div style={{ display: "grid", gap: "1rem" }}>
          <input placeholder="Credential name" value={awsForm.name} onChange={(e) => setAwsForm({...awsForm, name: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Access Key ID" value={awsForm.accessKeyId} onChange={(e) => setAwsForm({...awsForm, accessKeyId: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Secret Access Key" type="password" value={awsForm.secretAccessKey} onChange={(e) => setAwsForm({...awsForm, secretAccessKey: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="S3 Bucket" value={awsForm.bucket} onChange={(e) => setAwsForm({...awsForm, bucket: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Region (us-east-1)" value={awsForm.region} onChange={(e) => setAwsForm({...awsForm, region: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Endpoint URL (optional)" value={awsForm.endpointUrl} onChange={(e) => setAwsForm({...awsForm, endpointUrl: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <button onClick={addAwsCredential} disabled={loading} style={{ padding: "0.75rem", background: loading ? "#404040" : "#10b981", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Adding..." : "Add AWS Credential"}
          </button>
        </div>
      )}

      {tab === "add-google" && (
        <div style={{ display: "grid", gap: "1rem" }}>
          <input placeholder="Credential name" value={googleForm.name} onChange={(e) => setGoogleForm({...googleForm, name: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="API Key (optional)" value={googleForm.apiKey} onChange={(e) => setGoogleForm({...googleForm, apiKey: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <textarea placeholder="Service Account JSON (optional)" value={googleForm.serviceAccountJson} onChange={(e) => setGoogleForm({...googleForm, serviceAccountJson: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none", minHeight: "120px", fontFamily: "monospace", fontSize: "0.85rem" }} />
          <button onClick={addGoogleCredential} disabled={loading} style={{ padding: "0.75rem", background: loading ? "#404040" : "#06b6d4", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Adding..." : "Add Google Credential"}
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div style={{ background: "#0b1424", border: "1px solid #1f2d3d", borderRadius: 10, padding: "0.6rem" }}>
      <div style={{ color: "#9bb3ce", fontSize: 12 }}>{label}</div>
      <div style={{ color: "#e8edf2", fontWeight: 600, marginTop: 4, wordBreak: "break-all" }}>{value || "-"}</div>
    </div>
  );
}

export default App;
