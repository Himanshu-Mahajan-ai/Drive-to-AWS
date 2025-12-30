import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

interface ImportResponse {
  id: string;
  status: string;
  folder_url: string;
  bucket: string;
  prefix?: string;
  region?: string;
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
  // Inject CSS animation for pulse effect
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.2); }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

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
  const [showDashboard, setShowDashboard] = useState(false);
  const [allJobs, setAllJobs] = useState<ImportResponse[]>([]);
  const [allImages, setAllImages] = useState<ImageResponse[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // load history from localStorage and credentials on startup
  useEffect(() => {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch {
        setHistory([]);
      }
    }
    // IMPORTANT: Always load credentials on page load
    fetchCredentials();
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
      console.log("Loaded credentials from database:", res.data); // Debug log
      setCredentials(res.data);
      // Set defaults or first credential
      const awsCred = res.data.find(c => c.credential_type === "aws" && c.is_default) || res.data.find(c => c.credential_type === "aws");
      const googleCred = res.data.find(c => c.credential_type === "google" && c.is_default) || res.data.find(c => c.credential_type === "google");
      if (awsCred && !selectedAWSCred) setSelectedAWSCred(awsCred.id);
      if (googleCred && !selectedGoogleCred) setSelectedGoogleCred(googleCred.id);
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
    try {
      const res = await api.get<ImportResponse>(`/imports/${jobId}`);
      setJob(res.data);
      const imgs = await api.get<ImageResponse[]>("/images", { params: { job_id: jobId, limit: 500 } });
      setImages(imgs.data);
      return res.data;
    } catch (err) {
      console.error("Failed to fetch job:", err);
      setMessage("Failed to refresh job status");
      setTimeout(() => setMessage(null), 3000);
      return null;
    }
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
    // Validate that either bucket is provided or a custom AWS credential is selected
    if (!bucket && !selectedAWSCred) {
      setMessage("❌ Please add or select an AWS credential before starting transfer. Click ⚙️ Settings to add one.");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const res = await api.post<ImportResponse>("/imports", {
        folder_url: folderUrl,
        prefix: prefix || null,
        bucket: bucket || null,
        aws_credential_id: selectedAWSCred || null,
        google_credential_id: selectedGoogleCred || null,
      });
      setJob(res.data);
      persistHistory([{ ...res.data, last_seen: new Date().toISOString() }, ...history].slice(0, 10));
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || "Failed to start import");
    } finally {
      setLoading(false);
    }
  };

  // Real-time polling for active jobs
  useEffect(() => {
    if (!job) return;
    
    // Don't poll if job is in terminal state
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      return;
    }
    
    const interval = setInterval(async () => {
      try {
        const updated = await fetchJob(job.id);
        if (updated) {
          // Update last refresh timestamp
          setLastUpdate(new Date());
          
          // Update history
          persistHistory(
            [{ ...updated, last_seen: new Date().toISOString() }, ...history.filter((h) => h.id !== updated.id)].slice(0, 10)
          );
          
          // Stop polling if job reached terminal state
          if (updated.status === "completed" || updated.status === "failed" || updated.status === "canceled") {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error("Error polling job:", err);
      }
    }, 1000);  // Poll every 1 second for real-time updates
    
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  const percent = useMemo(() => {
    if (!job) return 0;
    
    // If job is completed, always show 100%
    if (job.status === "completed") return 100;
    
    // If job is failed or canceled, show current progress
    if (job.status === "failed" || job.status === "canceled") {
      if (!job.total_files) return 0;
      return Math.min(100, Math.round((job.completed_files / job.total_files) * 100));
    }
    
    // If we have total_files, calculate exact percentage
    if (job.total_files && job.total_files > 0) {
      return Math.min(100, Math.round((job.completed_files / job.total_files) * 100));
    }
    
    // If scanning (no total yet), show estimated progress
    if (job.completed_files > 0) {
      // Show at least some progress, but cap at 90% until we know total
      return Math.min(90, Math.round((job.completed_files / Math.max(job.completed_files + 10, 50)) * 100));
    }
    
    return 0;
  }, [job?.status, job?.completed_files, job?.total_files]);

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
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginBottom: "1rem" }}>
            <button
              onClick={() => {
                setShowDashboard(true);
                // Load all data when dashboard opens
                fetchCredentials();
                api.get<ImageResponse[]>("/images", { params: { limit: 1000 } }).then(res => setAllImages(res.data)).catch(err => console.error("Failed to load images:", err));
              }}
              style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #404040", background: "#1a1a1a", color: "#a3a3a3", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = "#ececec"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#1a1a1a"; e.currentTarget.style.color = "#a3a3a3"; }}
            >
              📊 Activity Dashboard
            </button>
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
              <div>
                <label style={{ display: "block", fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 500 }}>AWS Credential (optional)</label>
                <select
                  style={{ width: "100%", background: "#1a1a1a", color: "#ececec", border: "1px solid #404040", borderRadius: 12, padding: "0.875rem 1rem", fontSize: "0.95rem", outline: "none", transition: "border-color 0.2s", cursor: "pointer" }}
                  value={selectedAWSCred || ""}
                  onChange={(e) => setSelectedAWSCred(e.target.value || null)}
                  onFocus={(e) => e.target.style.borderColor = "#10b981"}
                  onBlur={(e) => e.target.style.borderColor = "#404040"}
                >
                  <option value="">Use default AWS credentials (from env)</option>
                  {credentials.filter(c => c.credential_type === "aws").map(cred => (
                    <option key={cred.id} value={cred.id}>
                      {cred.name} {cred.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: "0.8rem", color: credentials.filter(c => c.credential_type === "aws").length === 0 ? "#dc2626" : "#737373", marginTop: "0.25rem" }}>
                  {credentials.filter(c => c.credential_type === "aws").length === 0 
                    ? "⚠️ No AWS credentials added. Click Settings to add one before starting transfer."
                    : selectedAWSCred 
                    ? "✓ Using selected AWS credential" 
                    : "Using default AWS credential from environment"}
                </div>
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
            <div style={{ background: "#262626", border: "1px solid #404040", borderRadius: 12, padding: "1.25rem", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
              {/* Compact Progress Box */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                {/* Status Badge */}
                <span style={{ background: statusTone(job.status), color: "#fff", padding: "0.4rem 0.75rem", borderRadius: 16, fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {job.status}
                </span>

                {/* Real-time Progress Numbers */}
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.85rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span style={{ color: "#737373" }}>Progress:</span>
                    <span style={{ color: "#10b981", fontWeight: 700 }}>{job.completed_files || 0}</span>
                    <span style={{ color: "#525252" }}>/</span>
                    <span style={{ color: "#ececec", fontWeight: 700 }}>{job.total_files || "..."}</span>
                    {(job.failed_files || 0) > 0 && (
                      <>
                        <span style={{ color: "#525252", marginLeft: "0.5rem" }}>•</span>
                        <span style={{ color: "#dc2626", fontWeight: 700, marginLeft: "0.5rem" }}>{job.failed_files} failed</span>
                      </>
                    )}
                  </div>
                  <div style={{ color: "#06b6d4", fontWeight: 700, fontSize: "0.9rem" }}>
                    {percent}%
                  </div>
                  {(job.status === "running" || job.status === "pending") && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "#10b981", fontSize: "0.7rem" }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }} />
                      LIVE
                    </div>
                  )}
                </div>

                {/* S3 Link */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem" }}>
                  <span style={{ color: "#737373" }}>📦</span>
                  <span style={{ fontFamily: "monospace", color: "#a3a3a3", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    s3://{job.bucket}/{job.prefix || ""}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`s3://${job.bucket}/${job.prefix || ""}`);
                      setMessage("✓ S3 path copied!");
                      setTimeout(() => setMessage(null), 2000);
                    }}
                    style={{ padding: "0.25rem 0.5rem", background: "#404040", border: "none", borderRadius: 6, color: "#a3a3a3", cursor: "pointer", fontSize: "0.7rem", fontWeight: 500, transition: "background 0.2s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#525252"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#404040"}
                  >
                    Copy
                  </button>
                  <a
                    href={`https://s3.console.aws.amazon.com/s3/buckets/${job.bucket}?prefix=${job.prefix || ""}&region=${job.region || "us-east-1"}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ padding: "0.25rem 0.5rem", background: "#10b981", border: "none", borderRadius: 6, color: "#fff", textDecoration: "none", fontSize: "0.7rem", fontWeight: 500, transition: "background 0.2s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#059669"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#10b981"}
                  >
                    AWS
                  </a>
                </div>
              </div>

              {/* Minimal Progress Bar */}
              <div style={{ marginTop: "0.75rem", height: 4, borderRadius: 999, background: "#1a1a1a", overflow: "hidden" }}>
                <div 
                  style={{ 
                    width: `${percent}%`, 
                    height: "100%", 
                    background: job.status === "completed" ? "#10b981" : "linear-gradient(90deg, #06b6d4, #10b981)", 
                    transition: "width 0.5s ease"
                  }} 
                />
              </div>

              {/* Completion Message */}
              {job.status === "completed" && (
                <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#064e3b", border: "1px solid #10b981", borderRadius: 8, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "1rem" }}>✅</span>
                  <span style={{ fontWeight: 600, color: "#10b981", fontSize: "0.85rem" }}>Transfer Complete! {job.completed_files} files uploaded</span>
                </div>
              )}

              {/* Compact Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: "0.75rem", flexWrap: "wrap" }}>
                <button
                  onClick={cancelImport}
                  disabled={!job || job.status === "completed" || job.status === "canceled" || loading}
                  style={{ 
                    padding: "0.5rem 0.875rem", 
                    borderRadius: 8, 
                    border: "1px solid #dc2626", 
                    background: !job || job.status === "completed" || job.status === "canceled" ? "#262626" : "#7f1d1d", 
                    color: !job || job.status === "completed" || job.status === "canceled" ? "#666" : "#fca5a5", 
                    cursor: !job || job.status === "completed" || job.status === "canceled" ? "not-allowed" : "pointer", 
                    fontWeight: 600, 
                    fontSize: "0.75rem", 
                    transition: "all 0.2s" 
                  }}
                >
                  Stop
                </button>
                <button
                  onClick={() => images.length && downloadCsv(images, job.id)}
                  disabled={!images.length}
                  style={{ padding: "0.5rem 0.875rem", borderRadius: 8, border: "1px solid #404040", background: images.length ? "#1a1a1a" : "#262626", color: images.length ? "#10b981" : "#525252", cursor: images.length ? "pointer" : "not-allowed", fontSize: "0.75rem", fontWeight: 500, transition: "all 0.2s" }}
                >
                  CSV
                </button>
                <button
                  onClick={() => images.length && downloadJson(images, job.id)}
                  disabled={!images.length}
                  style={{ padding: "0.5rem 0.875rem", borderRadius: 8, border: "1px solid #404040", background: images.length ? "#1a1a1a" : "#262626", color: images.length ? "#06b6d4" : "#525252", cursor: images.length ? "pointer" : "not-allowed", fontSize: "0.75rem", fontWeight: 500, transition: "all 0.2s" }}
                >
                  JSON
                </button>
                <button
                  onClick={() => images.length && downloadExcel(images, job.id)}
                  disabled={!images.length}
                  style={{ padding: "0.5rem 0.875rem", borderRadius: 8, border: "1px solid #404040", background: images.length ? "#1a1a1a" : "#262626", color: images.length ? "#f59e0b" : "#525252", cursor: images.length ? "pointer" : "not-allowed", fontSize: "0.75rem", fontWeight: 500, transition: "all 0.2s" }}
                >
                  Excel
                </button>
                <button
                  onClick={async () => {
                    setLoading(true);
                    await fetchJob(job.id);
                    setLoading(false);
                  }}
                  disabled={loading}
                  style={{ padding: "0.5rem 0.875rem", borderRadius: 8, border: "1px solid #404040", background: loading ? "#262626" : "#1a1a1a", color: loading ? "#525252" : "#a3a3a3", cursor: loading ? "not-allowed" : "pointer", fontSize: "0.75rem", fontWeight: 500, transition: "all 0.2s" }}
                >
                  {loading ? "..." : "Refresh"}
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

        {showDashboard && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, overflowY: "auto", padding: "2rem" }}>
            <ActivityDashboard
              credentials={credentials}
              history={history}
              images={allImages}
              statusTone={statusTone}
              onClose={() => setShowDashboard(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityDashboard({
  credentials,
  history,
  images,
  statusTone,
  onClose,
}: {
  credentials: Credential[];
  history: JobHistory[];
  images: ImageResponse[];
  statusTone: (status?: string) => string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"credentials" | "imports" | "images">("credentials");

  const awsCredentials = credentials.filter(c => c.credential_type === "aws");
  const googleCredentials = credentials.filter(c => c.credential_type === "google");
  
  const completedImages = images.filter(i => i.status === "completed");
  const failedImages = images.filter(i => i.status === "failed");
  const pendingImages = images.filter(i => i.status === "pending" || i.status === "transferring");

  return (
    <div style={{ background: "#262626", border: "1px solid #404040", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: "1200px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", position: "sticky", top: 0, background: "#262626", zIndex: 10, paddingBottom: "1rem", borderBottom: "1px solid #404040" }}>
        <h2 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 600, color: "#ececec" }}>📊 Activity Dashboard</h2>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#a3a3a3", transition: "color 0.2s" }}
          onMouseEnter={(e) => e.currentTarget.style.color = "#ececec"}
          onMouseLeave={(e) => e.currentTarget.style.color = "#a3a3a3"}
        >
          ✕
        </button>
      </div>

      {/* Stats Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <div style={{ background: "#1a1a1a", border: "1px solid #10b981", borderRadius: 12, padding: "1.25rem" }}>
          <div style={{ fontSize: "0.875rem", color: "#10b981", marginBottom: "0.5rem", fontWeight: 600 }}>AWS Credentials</div>
          <div style={{ fontSize: "2rem", color: "#ececec", fontWeight: 700 }}>{awsCredentials.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#737373", marginTop: "0.25rem" }}>{awsCredentials.filter(c => c.is_default).length} default</div>
        </div>
        <div style={{ background: "#1a1a1a", border: "1px solid #06b6d4", borderRadius: 12, padding: "1.25rem" }}>
          <div style={{ fontSize: "0.875rem", color: "#06b6d4", marginBottom: "0.5rem", fontWeight: 600 }}>Google Credentials</div>
          <div style={{ fontSize: "2rem", color: "#ececec", fontWeight: 700 }}>{googleCredentials.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#737373", marginTop: "0.25rem" }}>{googleCredentials.filter(c => c.is_default).length} default</div>
        </div>
        <div style={{ background: "#1a1a1a", border: "1px solid #f59e0b", borderRadius: 12, padding: "1.25rem" }}>
          <div style={{ fontSize: "0.875rem", color: "#f59e0b", marginBottom: "0.5rem", fontWeight: 600 }}>Import Jobs</div>
          <div style={{ fontSize: "2rem", color: "#ececec", fontWeight: 700 }}>{history.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#737373", marginTop: "0.25rem" }}>{history.filter(h => h.status === "completed").length} completed</div>
        </div>
        <div style={{ background: "#1a1a1a", border: "1px solid #8b5cf6", borderRadius: 12, padding: "1.25rem" }}>
          <div style={{ fontSize: "0.875rem", color: "#8b5cf6", marginBottom: "0.5rem", fontWeight: 600 }}>Total Images</div>
          <div style={{ fontSize: "2rem", color: "#ececec", fontWeight: 700 }}>{images.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#737373", marginTop: "0.25rem" }}>
            {completedImages.length} ✓ / {failedImages.length} ✗ / {pendingImages.length} ⏳
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid #404040", paddingBottom: "1rem" }}>
        <button
          onClick={() => setTab("credentials")}
          style={{ padding: "0.625rem 1.25rem", background: tab === "credentials" ? "#404040" : "transparent", border: "none", color: tab === "credentials" ? "#10b981" : "#a3a3a3", cursor: "pointer", fontWeight: 600, borderRadius: 6, fontSize: "0.9rem", transition: "all 0.2s" }}
        >
          🔐 Credentials ({credentials.length})
        </button>
        <button
          onClick={() => setTab("imports")}
          style={{ padding: "0.625rem 1.25rem", background: tab === "imports" ? "#404040" : "transparent", border: "none", color: tab === "imports" ? "#10b981" : "#a3a3a3", cursor: "pointer", fontWeight: 600, borderRadius: 6, fontSize: "0.9rem", transition: "all 0.2s" }}
        >
          📦 Import Jobs ({history.length})
        </button>
        <button
          onClick={() => setTab("images")}
          style={{ padding: "0.625rem 1.25rem", background: tab === "images" ? "#404040" : "transparent", border: "none", color: tab === "images" ? "#10b981" : "#a3a3a3", cursor: "pointer", fontWeight: 600, borderRadius: 6, fontSize: "0.9rem", transition: "all 0.2s" }}
        >
          🖼️ Images ({images.length})
        </button>
      </div>

      {/* Content */}
      {tab === "credentials" && (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#10b981", marginBottom: "1rem" }}>AWS Credentials</h3>
            {awsCredentials.length === 0 ? (
              <div style={{ padding: "2rem", background: "#1a1a1a", borderRadius: 12, textAlign: "center", color: "#737373" }}>
                No AWS credentials added yet
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr style={{ color: "#737373", textAlign: "left", borderBottom: "2px solid #404040" }}>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Name</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>ID</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Default</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awsCredentials.map((cred) => (
                      <tr key={cred.id} style={{ borderBottom: "1px solid #333" }}>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#ececec", fontWeight: 500 }}>{cred.name}</td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3", fontFamily: "monospace", fontSize: "0.8rem" }}>{cred.id.slice(0, 8)}...</td>
                        <td style={{ padding: "0.875rem 0.5rem" }}>
                          {cred.is_default ? (
                            <span style={{ color: "#10b981", fontWeight: 600 }}>✓ Yes</span>
                          ) : (
                            <span style={{ color: "#525252" }}>No</span>
                          )}
                        </td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3" }}>{formatDate(cred.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#06b6d4", marginBottom: "1rem" }}>Google Credentials</h3>
            {googleCredentials.length === 0 ? (
              <div style={{ padding: "2rem", background: "#1a1a1a", borderRadius: 12, textAlign: "center", color: "#737373" }}>
                No Google credentials added yet
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr style={{ color: "#737373", textAlign: "left", borderBottom: "2px solid #404040" }}>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Name</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>ID</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Default</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleCredentials.map((cred) => (
                      <tr key={cred.id} style={{ borderBottom: "1px solid #333" }}>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#ececec", fontWeight: 500 }}>{cred.name}</td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3", fontFamily: "monospace", fontSize: "0.8rem" }}>{cred.id.slice(0, 8)}...</td>
                        <td style={{ padding: "0.875rem 0.5rem" }}>
                          {cred.is_default ? (
                            <span style={{ color: "#06b6d4", fontWeight: 600 }}>✓ Yes</span>
                          ) : (
                            <span style={{ color: "#525252" }}>No</span>
                          )}
                        </td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3" }}>{formatDate(cred.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "imports" && (
        <div>
          {history.length === 0 ? (
            <div style={{ padding: "2rem", background: "#1a1a1a", borderRadius: 12, textAlign: "center", color: "#737373" }}>
              No import jobs yet
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ color: "#737373", textAlign: "left", borderBottom: "2px solid #404040" }}>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Job ID</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Status</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Bucket</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Progress</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((job) => (
                    <tr key={job.id} style={{ borderBottom: "1px solid #333" }}>
                      <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3", fontFamily: "monospace", fontSize: "0.8rem" }}>
                        {job.id.slice(0, 13)}...
                      </td>
                      <td style={{ padding: "0.875rem 0.5rem" }}>
                        <span style={{ background: statusTone(job.status), color: "#fff", padding: "0.25rem 0.75rem", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
                          {job.status}
                        </span>
                      </td>
                      <td style={{ padding: "0.875rem 0.5rem", color: "#ececec", fontFamily: "monospace", fontSize: "0.85rem" }}>{job.bucket}</td>
                      <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3" }}>
                        {job.completed_files} / {job.total_files || "?"} ({toPercent(job)}%)
                      </td>
                      <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3" }}>{formatDate(job.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "images" && (
        <div>
          {images.length === 0 ? (
            <div style={{ padding: "2rem", background: "#1a1a1a", borderRadius: 12, textAlign: "center", color: "#737373" }}>
              No images transferred yet
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ padding: "0.75rem 1.25rem", background: "#1a1a1a", borderRadius: 8, border: "1px solid #10b981" }}>
                  <span style={{ color: "#10b981", fontWeight: 600 }}>✓ Completed: {completedImages.length}</span>
                </div>
                <div style={{ padding: "0.75rem 1.25rem", background: "#1a1a1a", borderRadius: 8, border: "1px solid #dc2626" }}>
                  <span style={{ color: "#dc2626", fontWeight: 600 }}>✗ Failed: {failedImages.length}</span>
                </div>
                <div style={{ padding: "0.75rem 1.25rem", background: "#1a1a1a", borderRadius: 8, border: "1px solid #f59e0b" }}>
                  <span style={{ color: "#f59e0b", fontWeight: 600 }}>⏳ Pending: {pendingImages.length}</span>
                </div>
              </div>
              <div style={{ overflowX: "auto", maxHeight: "500px", overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#262626", zIndex: 5 }}>
                    <tr style={{ color: "#737373", textAlign: "left", borderBottom: "2px solid #404040" }}>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>File Name</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Job ID</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Size</th>
                      <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>S3 Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {images.map((img) => (
                      <tr key={img.id} style={{ borderBottom: "1px solid #333" }}>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#ececec", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.name}</td>
                        <td style={{ padding: "0.875rem 0.5rem" }}>
                          <span style={{ color: statusTone(img.status), fontSize: "0.8rem", fontWeight: 600 }}>{img.status}</span>
                        </td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3", fontFamily: "monospace", fontSize: "0.75rem" }}>{img.job_id.slice(0, 8)}...</td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#a3a3a3" }}>{img.size_bytes ? `${Math.round(img.size_bytes / 1024)} KB` : "-"}</td>
                        <td style={{ padding: "0.875rem 0.5rem", color: "#737373", fontFamily: "monospace", fontSize: "0.75rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.s3_key || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
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
  const [editingAwsId, setEditingAwsId] = useState<string | null>(null);
  const [googleForm, setGoogleForm] = useState({ name: "", apiKey: "", serviceAccountJson: "" });
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<{ [key: string]: { valid: boolean; message: string } }>({});

  const addOrUpdateAwsCredential = async () => {
    if (!awsForm.name || !awsForm.accessKeyId || !awsForm.secretAccessKey || !awsForm.bucket) {
      onMessage("All fields required for AWS credentials");
      return;
    }
    setLoading(true);
    try {
      if (editingAwsId) {
        await api.put(`/credentials/aws/${editingAwsId}`, {
          name: awsForm.name,
          access_key_id: awsForm.accessKeyId,
          secret_access_key: awsForm.secretAccessKey,
          region: awsForm.region,
          bucket: awsForm.bucket,
          endpoint_url: awsForm.endpointUrl || null,
          force_path_style: false,
        });
        onMessage("AWS credentials updated");
      } else {
        await api.post("/credentials/aws", {
          name: awsForm.name,
          access_key_id: awsForm.accessKeyId,
          secret_access_key: awsForm.secretAccessKey,
          region: awsForm.region,
          bucket: awsForm.bucket,
          endpoint_url: awsForm.endpointUrl || null,
          force_path_style: false,
        });
        onMessage("AWS credentials added");
      }
      setAwsForm({ name: "", accessKeyId: "", secretAccessKey: "", region: "us-east-1", bucket: "", endpointUrl: "" });
      setEditingAwsId(null);
      setTab("list");
      onCredentialsUpdated();
    } catch (err: any) {
      onMessage(err?.response?.data?.detail || (editingAwsId ? "Failed to update AWS credentials" : "Failed to add AWS credentials"));
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

  const verifyCredential = async (id: string) => {
    setVerifying(id);
    try {
      const res = await api.post<{ valid: boolean; message: string }>(`/credentials/aws/${id}/verify`);
      setCredentialStatus(prev => ({ ...prev, [id]: { valid: res.data.valid, message: res.data.message } }));
      onMessage(res.data.message);
    } catch (err: any) {
      const message = err?.response?.data?.message || "Failed to verify credential";
      setCredentialStatus(prev => ({ ...prev, [id]: { valid: false, message } }));
      onMessage(message);
    } finally {
      setVerifying(null);
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
            {awsCreds.length === 0 && (
              <div style={{ padding: "1rem", background: "#1a1a1a", borderRadius: 8, color: "#737373", fontSize: "0.875rem" }}>No AWS credentials added</div>
            )}
            {awsCreds.length > 0 && (
              <>
                {awsCreds.map(cred => (
                  <div key={cred.id}>
                    <div style={{ padding: "0.75rem", background: "#1a1a1a", borderRadius: 8, border: `1px solid ${selectedAWSCred === cred.id ? "#10b981" : "#404040"}`, marginBottom: "0.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.875rem", color: "#ececec", fontWeight: 500 }}>{cred.name}</div>
                        <div style={{ fontSize: "0.75rem", color: "#737373" }}>{cred.is_default ? "Default" : "Custom"}</div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button onClick={() => { onSelectAWS(cred.id); setDefault(cred.id); }} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: selectedAWSCred === cred.id ? "#10b981" : "#404040", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer" }}>Use</button>
                        <button onClick={() => verifyCredential(cred.id)} disabled={verifying === cred.id} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: verifying === cred.id ? "#525252" : "#06b6d4", border: "none", borderRadius: 4, color: "#fff", cursor: verifying === cred.id ? "not-allowed" : "pointer" }}>{verifying === cred.id ? "Verifying..." : "Verify"}</button>
                        <button onClick={() => { setTab("add-aws"); setEditingAwsId(cred.id); setAwsForm({ name: cred.name, accessKeyId: "", secretAccessKey: "", region: "us-east-1", bucket: "", endpointUrl: "" }); }} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: "#1f2937", border: "none", borderRadius: 4, color: "#e5e7eb", cursor: "pointer" }}>Edit</button>
                        <button onClick={() => deleteCredential(cred.id)} style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", background: "#7f1d1d", border: "none", borderRadius: 4, color: "#fca5a5", cursor: "pointer" }}>Delete</button>
                      </div>
                    </div>
                    {credentialStatus[cred.id] && (
                      <div style={{ padding: "0.5rem 0.75rem", background: credentialStatus[cred.id].valid ? "#064e3b" : "#7f1d1d", borderRadius: 6, marginBottom: "0.5rem", fontSize: "0.75rem", color: credentialStatus[cred.id].valid ? "#86efac" : "#fca5a5", border: `1px solid ${credentialStatus[cred.id].valid ? "#10b981" : "#dc2626"}` }}>
                        {credentialStatus[cred.id].message}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          <div>
            <div style={{ fontSize: "0.875rem", color: "#a3a3a3", marginBottom: "0.5rem", fontWeight: 600 }}>Google Credentials</div>
            {googleCreds.length === 0 && (
              <div style={{ padding: "1rem", background: "#1a1a1a", borderRadius: 8, color: "#737373", fontSize: "0.875rem" }}>No Google credentials added</div>
            )}
            {googleCreds.length > 0 && (
              <>
                {googleCreds.map(cred => (
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
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "add-aws" && (
        <div style={{ display: "grid", gap: "1rem" }}>
          <div style={{ padding: "0.75rem", background: "#1f2937", borderRadius: 8, border: "1px solid #374151", fontSize: "0.85rem", color: "#d1d5db" }}>
            ℹ️ After adding your credentials, click "Verify" in the credentials list to confirm they work.
          </div>
          <input placeholder="Credential name" value={awsForm.name} onChange={(e) => setAwsForm({...awsForm, name: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Access Key ID" value={awsForm.accessKeyId} onChange={(e) => setAwsForm({...awsForm, accessKeyId: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Secret Access Key" type="password" value={awsForm.secretAccessKey} onChange={(e) => setAwsForm({...awsForm, secretAccessKey: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="S3 Bucket" value={awsForm.bucket} onChange={(e) => setAwsForm({...awsForm, bucket: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Region (us-east-1)" value={awsForm.region} onChange={(e) => setAwsForm({...awsForm, region: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <input placeholder="Endpoint URL (optional)" value={awsForm.endpointUrl} onChange={(e) => setAwsForm({...awsForm, endpointUrl: e.target.value})} style={{ padding: "0.75rem", background: "#1a1a1a", border: "1px solid #404040", borderRadius: 8, color: "#ececec", outline: "none" }} />
          <button onClick={addOrUpdateAwsCredential} disabled={loading} style={{ padding: "0.75rem", background: loading ? "#404040" : "#10b981", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Saving..." : editingAwsId ? "Update AWS Credential" : "Add AWS Credential"}
          </button>
          {editingAwsId && (
            <button onClick={() => { setEditingAwsId(null); setAwsForm({ name: "", accessKeyId: "", secretAccessKey: "", region: "us-east-1", bucket: "", endpointUrl: "" }); setTab("list"); }} disabled={loading} style={{ padding: "0.75rem", background: "#404040", color: "#e5e7eb", border: "none", borderRadius: 8, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              Cancel edit
            </button>
          )}
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
