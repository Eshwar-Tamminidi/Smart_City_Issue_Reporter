import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
const API_BASE = "https://smart-city-issue-reporter-cmpo.onrender.com";
const initialToken = localStorage.getItem("civicpulse_token") || "";
const initialUser = JSON.parse(localStorage.getItem("civicpulse_user") || "null");
const statusOptions = ["submitted", "verified", "assigned", "in_progress", "resolved", "rejected"];

function App() {
  const [token, setToken] = useState(initialToken);
  const [user, setUser] = useState(initialUser);
  const [issues, setIssues] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [route, setRoute] = useState(window.location.hash || "#home");

  const api = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const showToast = (message, type = "info") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  };

  const saveSession = (nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    localStorage.setItem("civicpulse_token", nextToken);
    localStorage.setItem("civicpulse_user", JSON.stringify(nextUser));
  };

  const clearSession = () => {
    setToken("");
    setUser(null);
    setIssues([]);
    setAnalytics(null);
    localStorage.removeItem("civicpulse_token");
    localStorage.removeItem("civicpulse_user");
  };

  const refreshAll = async () => {
    if (!user) return;
    try {
      const issueData = await api("/api/issues");
      setIssues(issueData.issues);
      if (user.role === "admin") {
        const analyticsData = await api("/api/analytics");
        setAnalytics(analyticsData);
      } else {
        setAnalytics(null);
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  useEffect(() => {
    const validateSession = async () => {
      if (!token || !user) return;
      try {
        await api("/api/me");
        await refreshAll();
      } catch {
        clearSession();
      }
    };
    validateSession();
    // The first load intentionally validates the locally stored session once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncRoute = () => setRoute(window.location.hash || "#home");
    window.addEventListener("hashchange", syncRoute);
    syncRoute();
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    if (user) refreshAll();
    // Refresh after login/register role changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  const login = async (body) => {
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(body) });
      saveSession(data.token, data.user);
      showToast(`Welcome, ${data.user.name}.`);
      window.location.hash = data.user.role === "admin" ? "#admin" : "#report";
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  const register = async (body) => {
    try {
      const data = await api("/api/register", { method: "POST", body: JSON.stringify(body) });
      saveSession(data.token, data.user);
      showToast("Citizen account created.");
      window.location.hash = "#report";
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  const logout = async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch {
      // Local cleanup is enough if the in-memory session already expired.
    }
    clearSession();
    showToast("Logged out.");
  };

  const submitIssue = async (body) => {
    if (!user) {
      showToast("Please login before submitting a complaint.", "error");
      return false;
    }
    try {
      const data = await api("/api/issues", { method: "POST", body: JSON.stringify(body) });
      setPrediction(data.issue.ml);
      showToast(`Submitted as ${data.issue.ml.priority}.`);
      setPreview(null);
      await refreshAll();
      window.location.hash = "#tracking";
      return true;
    } catch (error) {
      showToast(error.message, "error");
      return false;
    }
  };

  const updateIssue = async (id, status, assignedTo) => {
    try {
      await api("/api/issues", { method: "PATCH", body: JSON.stringify({ id, status, assignedTo }) });
      showToast("Complaint updated.");
      await refreshAll();
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  const heroOpen = analytics?.stats.open ?? issues.filter((issue) => !["resolved", "rejected"].includes(issue.status)).length;
  const heroClusters = analytics?.stats.clusters.length ?? 0;
  const topIssue = analytics?.issues ? [...analytics.issues].sort((a, b) => b.ml.severityScore - a.ml.severityScore)[0] : null;

  if (!user) {
    return (
      <>
        <div className="shell auth-shell">
          <Header user={user} onLogout={logout} route={route} />
          <main>
            <AuthLanding onLogin={login} onRegister={register} route={route} />
          </main>
        </div>
        <Toast toast={toast} />
      </>
    );
  }

  return (
    <>
      <div className="shell">
        <Header user={user} onLogout={logout} route={route} />
        <main>
          {user.role === "admin" ? (
            <AdminHome analytics={analytics} onRefresh={refreshAll} onUpdateIssue={updateIssue} />
          ) : (
            <CitizenHome
              issues={issues}
              onSubmit={submitIssue}
              onRefresh={refreshAll}
              preview={preview}
              setPreview={setPreview}
              prediction={prediction}
              showToast={showToast}
            />
          )}
        </main>
      </div>
      <Toast toast={toast} />
    </>
  );
}

function Header({ user, onLogout, route }) {
  return (
    <header className="topbar">
      <a className="brand" href="#home" aria-label="CivicPulse AI home">
        <span className="brand-mark">CP</span>
        <span>
          <strong>CivicPulse AI</strong>
          <small>Smart city response platform</small>
        </span>
      </a>
      {user && (
        <nav className="nav">
          {user.role === "admin" ? (
            <a href="#admin">Admin Dashboard</a>
          ) : (
            <>
              <a href="#report">Report</a>
              <a href="#tracking">Track</a>
            </>
          )}
        </nav>
      )}
      <div className="account-area">
        {user ? (
          <>
            <span className="account-chip">
              {user.name} · {user.role}
            </span>
            <button className="button ghost" type="button" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <div className="nav">
            <a className={`button ghost ${route === "#login" ? "nav-button-active" : ""}`} href="#login">Login</a>
            <a className={`button primary ${route === "#signup" ? "nav-button-active" : ""}`} href="#signup">Sign up</a>
          </div>
        )}
      </div>
    </header>
  );
}

function AuthLanding({ onLogin, onRegister, route }) {
  const isLoginRoute = route === "#login";
  const isSignupRoute = route === "#signup";
  const isChooserRoute = !isLoginRoute && !isSignupRoute;

  return (
    <section className="login-page">
      <div className={`login-stage ${isChooserRoute ? "chooser-stage" : "form-stage"}`}>
        <div className="login-hero">
          <p className="eyebrow">Secure civic access</p>
          <h1>One place to report, track, and manage city issues.</h1>
          <p className="hero-text">
            CivicPulse AI keeps citizen complaints, ML prioritization, and authority actions behind a clean authenticated entry point.
          </p>
          <div className="trust-strip">
            <span>No guest mode</span>
            <span>Citizen accounts</span>
            <span>Protected admin dashboard</span>
          </div>
          <div className="auth-micro-stats">
            <div className="mini-stat">
              <strong>ML Ranked</strong>
              <small>Severity and priority scored instantly</small>
            </div>
            <div className="mini-stat">
              <strong>Track Updates</strong>
              <small>Follow every complaint from submission to closure</small>
            </div>
            <div className="mini-stat">
              <strong>Admin Ready</strong>
              <small>Protected workflow for verification and assignment</small>
            </div>
          </div>
        </div>
        {isLoginRoute || isSignupRoute ? (
          <AuthGrid onLogin={onLogin} onRegister={onRegister} mode={isLoginRoute ? "login" : "signup"} />
        ) : (
          <section className="auth-cta-panel panel">
            <div className="auth-cta-copy">
              <p className="eyebrow">Choose access</p>
              <h2>Start with the action you need.</h2>
              <p className="hero-text">
                Existing users can log in right away. New citizens can create an account in a few seconds and begin reporting issues.
              </p>
            </div>
            <div className="auth-choice-grid">
              <a className="auth-choice-card login-card" href="#login">
                <span className="auth-choice-tag">Returning user</span>
                <h3>Login</h3>
                <p>Open your account to submit complaints, track status, or manage city operations.</p>
                <span className="auth-choice-action">Go to login</span>
              </a>
              <a className="auth-choice-card signup-card" href="#signup">
                <span className="auth-choice-tag">New citizen</span>
                <h3>Sign up</h3>
                <p>Create a citizen account to report civic issues with images, location, and live ML insights.</p>
                <span className="auth-choice-action">Create account</span>
              </a>
            </div>
          </section>
        )}
      </div>
      {!isChooserRoute && (
        <div className="auth-return-row">
          <a className="button ghost" href="#home">Back to access options</a>
        </div>
      )}
    </section>
  );
}

function CitizenHome({ issues, onSubmit, onRefresh, preview, setPreview, prediction, showToast }) {
  const openIssues = issues.filter((issue) => !["resolved", "rejected"].includes(issue.status)).length;

  return (
    <>
      <Hero open={openIssues} clusters={0} priority="Citizen Portal" mode="citizen" />
      <ReportSection onSubmit={onSubmit} preview={preview} setPreview={setPreview} prediction={prediction} showToast={showToast} />
      <TrackingSection issues={issues} onRefresh={onRefresh} />
    </>
  );
}

function AdminHome({ analytics, onRefresh, onUpdateIssue }) {
  const topIssue = analytics?.issues ? [...analytics.issues].sort((a, b) => b.ml.severityScore - a.ml.severityScore)[0] : null;

  return (
    <>
      <Hero
        open={analytics?.stats.open ?? 0}
        clusters={analytics?.stats.clusters.length ?? 0}
        priority={topIssue?.ml.priority || "Admin Command"}
        mode="admin"
      />
      <AdminSection analytics={analytics} onRefresh={onRefresh} onUpdateIssue={onUpdateIssue} />
    </>
  );
}

function Hero({ open, clusters, priority, mode = "admin" }) {
  return (
    <section id="home" className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Computer vision assisted civic operations</p>
        <h1>{mode === "admin" ? "Authority dashboard for complete complaint control." : "Report city problems and track every update."}</h1>
        <p className="hero-text">
          {mode === "admin"
            ? "Admins can view all complaints, inspect ML priority, detect hotspots, assign teams, and update field status from one protected dashboard."
            : "Citizens can upload issue photos, get ML-assisted priority classification, and track only their own complaints from submission to resolution."}
        </p>
        <div className="hero-actions">
          {mode === "admin" ? (
            <a className="button primary" href="#admin">Open Admin Dashboard</a>
          ) : (
            <>
              <a className="button primary" href="#report">Submit a Complaint</a>
              <a className="button ghost" href="#tracking">Track My Complaints</a>
            </>
          )}
        </div>
        <div className="trust-strip">
          <span>Image + text ML scoring</span>
          <span>Geo-hotspot clustering</span>
          <span>Citizen status tracking</span>
        </div>
      </div>
      <div className="hero-panel">
        <div className="scan-card">
          <div className="scan-grid"></div>
          <span className="scan-line"></span>
          <div className="scan-content">
            <p>Live ML Priority</p>
            <strong>{priority}</strong>
            <small>{mode === "admin" ? "All city complaints ranked by confidence and severity" : "Your reports stay private to your citizen account"}</small>
          </div>
        </div>
        <div className="floating-card top">
          <span className="dot red"></span>
          <div>
            <strong>{open}</strong>
            <small>Open reports</small>
          </div>
        </div>
        <div className="floating-card bottom">
          <span className="dot amber"></span>
          <div>
            <strong>{clusters}</strong>
            <small>Active hotspots</small>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuthGrid({ onLogin, onRegister, mode }) {
  return (
    <section className="auth-grid single-auth">
      {mode === "login" ? (
        <article className="panel auth-card auth-form-card">
          <div className="auth-card-head">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Welcome back</h2>
            </div>
            <p className="muted">Use your citizen or admin credentials to continue.</p>
          </div>
          <LoginForm onSubmit={onLogin} />
        </article>
      ) : (
        <article className="panel auth-card auth-form-card">
          <div className="auth-card-head">
            <div>
              <p className="eyebrow">Citizens</p>
              <h2>Create your account</h2>
            </div>
            <p className="muted">Register once to start reporting and tracking civic issues.</p>
          </div>
          <RegisterForm onSubmit={onRegister} />
        </article>
      )}
    </section>
  );
}

function LoginForm({ onSubmit }) {
  const [email, setEmail] = useState("citizen@example.com");
  const [password, setPassword] = useState("citizen123");
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ email, password });
      }}
    >
      <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>
      <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
      <button className="button primary" type="submit">Login Securely</button>
      <p className="hint">Admin demo: admin@city.gov / admin123</p>
    </form>
  );
}

function RegisterForm({ onSubmit }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
        setForm({ name: "", email: "", password: "" });
      }}
    >
      <label>Name<input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Your full name" required /></label>
      <label>Email<input value={form.email} onChange={(event) => update("email", event.target.value)} type="email" placeholder="you@example.com" required /></label>
      <label>Password<input value={form.password} onChange={(event) => update("password", event.target.value)} type="password" minLength="6" placeholder="Minimum 6 characters" required /></label>
      <button className="button dark" type="submit">Register Citizen</button>
    </form>
  );
}

function ReportSection({ onSubmit, preview, setPreview, prediction, showToast }) {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    lat: "12.9716",
    lng: "77.5946",
    imageName: "",
    imageData: "",
    imageStats: {}
  });

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const looksLikeNonCivicImage = (fileName, stats) => {
    const text = String(fileName || "").toLowerCase();
    const nonCivicKeywords = ["car", "vehicle", "porsche", "gt1", "gt3", "race", "racing", "supercar", "sedan", "suv", "bike", "motorcycle", "concept art", "render", "wallpaper"];
    const hasKeyword = nonCivicKeywords.some((keyword) => text.includes(keyword));
    const hasVehicleColorProfile = Number(stats.redRatio || 0) > 0.22 && Number(stats.edgeDensity || 0) > 0.12 && Number(stats.brownRatio || 0) < 0.2;
    return hasKeyword || hasVehicleColorProfile;
  };

  const handleImage = async (file) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      showToast("Please choose an image under 5 MB.", "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const imageData = await readImage(file);
    const imageStats = await getImageStats(imageData);
    if (looksLikeNonCivicImage(file.name, imageStats)) {
      setPreview(null);
      setForm((current) => ({ ...current, imageName: "", imageData: "", imageStats: {} }));
      if (fileInputRef.current) fileInputRef.current.value = "";
      showToast("Unable to process. The uploaded image does not appear to contain a civic issue. Please try again with a clear photo of the actual problem area.", "error");
      return;
    }
    setPreview(imageData);
    setForm((current) => ({ ...current, imageName: file.name, imageData, imageStats }));
  };

  const useLocation = () => {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported in this browser.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6)
        }));
        showToast("Location added to the report.");
      },
      () => showToast("Could not access location. You can enter coordinates manually.", "error")
    );
  };

  const resetReport = () => {
    setForm({
      title: "",
      description: "",
      address: "",
      lat: "12.9716",
      lng: "77.5946",
      imageName: "",
      imageData: "",
      imageStats: {}
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section id="report" className="section-grid">
      <article className="panel report-panel">
        <div className="section-heading">
          <p className="eyebrow">Citizen Portal</p>
          <h2>Upload a city issue</h2>
          <p>The image is analyzed in-browser for visual signals, then the server combines those features with your description for type, severity, and priority prediction.</p>
        </div>
        <form
          className="form report-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const submitted = await onSubmit({ ...form, lat: Number(form.lat), lng: Number(form.lng) });
            if (submitted) resetReport();
          }}
        >
          <label>Issue title<input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Example: Large pothole near school gate" required /></label>
          <label>Description<textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe the danger, size, repeat frequency, traffic impact, or safety risk." required /></label>
          <div className="split">
            <label>Address<input value={form.address} onChange={(event) => update("address", event.target.value)} placeholder="Street, landmark, ward" required /></label>
            <label>Issue photo<input ref={fileInputRef} onChange={(event) => handleImage(event.target.files[0])} type="file" accept="image/*" required /></label>
          </div>
          <div className="split">
            <label>Latitude<input value={form.lat} onChange={(event) => update("lat", event.target.value)} type="number" step="any" required /></label>
            <label>Longitude<input value={form.lng} onChange={(event) => update("lng", event.target.value)} type="number" step="any" required /></label>
          </div>
          <div className="form-actions">
            <button className="button primary" type="submit">Analyze & Submit</button>
            <button className="button ghost" type="button" onClick={useLocation}>Use My Location</button>
          </div>
        </form>
      </article>
      <aside className="panel preview-card">
        <p className="eyebrow">ML Preview</p>
        <div className="image-preview">{preview ? <img src={preview} alt="Uploaded issue preview" /> : "Upload an image to preview it here"}</div>
        {prediction ? <PredictionCard ml={prediction} /> : <div className="prediction-empty">Latest prediction will appear after submission.</div>}
      </aside>
    </section>
  );
}

function PredictionCard({ ml }) {
  return (
    <div className="prediction-card">
      <span className={`badge ${ml.severity.toLowerCase()}`}>{ml.severity}</span>
      <strong>{ml.issueType} · {ml.priority}</strong>
      <p>{ml.confidence}% confidence · Severity {ml.severityScore}/100</p>
      <p className="muted">{ml.explanation}</p>
    </div>
  );
}

function buildComplaintSections(issues) {
  return [
    {
      key: "submitted",
      title: "Submitted",
      description: "New complaints waiting for authority review.",
      items: issues.filter((issue) => issue.status === "submitted")
    },
    {
      key: "ongoing",
      title: "Ongoing",
      description: "Verified, assigned, or actively being worked on.",
      items: issues.filter((issue) => ["verified", "assigned", "in_progress"].includes(issue.status))
    },
    {
      key: "resolved",
      title: "Resolved",
      description: "Complaints completed by the authority team.",
      items: issues.filter((issue) => issue.status === "resolved")
    },
    {
      key: "rejected",
      title: "Rejected",
      description: "Complaints rejected after review.",
      items: issues.filter((issue) => issue.status === "rejected")
    }
  ];
}

function TrackingSection({ issues, onRefresh }) {
  const sections = buildComplaintSections(issues);
  const [activeSection, setActiveSection] = useState("submitted");
  const selectedSection = sections.find((section) => section.key === activeSection) || sections[0];

  return (
    <section id="tracking" className="section-grid">
      <article className="panel wide">
        <div className="section-heading horizontal">
          <div>
            <p className="eyebrow">Tracking</p>
            <h2>My complaints</h2>
          </div>
          <button className="button ghost" type="button" onClick={onRefresh}>Refresh</button>
        </div>
        <div className="section-jump-buttons" aria-label="Complaint status shortcuts">
          {sections.map((section) => (
            <button
              key={section.key}
              className={`button ghost jump-button ${section.key} ${activeSection === section.key ? "jump-button-active" : ""}`}
              type="button"
              onClick={() => setActiveSection(section.key)}
            >
              {section.title}
              <span>{section.items.length}</span>
            </button>
          ))}
        </div>
        {issues.length === 0 ? (
          <div className="empty tracking-empty">No complaints yet. Submit your first issue above.</div>
        ) : (
          <div className="status-sections">
            <ComplaintStatusSection section={selectedSection} />
          </div>
        )}
      </article>
      <aside className="panel auth-card">
        <p className="eyebrow">Status Guide</p>
        <div className="timeline">
          <span>Submitted</span>
          <span>Verified</span>
          <span>Assigned</span>
          <span>In Progress</span>
          <span>Resolved</span>
        </div>
      </aside>
    </section>
  );
}

function ComplaintStatusSection({ section }) {
  return (
    <div id={`complaints-${section.key}`} className={`complaint-section ${section.key}`}>
      <div className="complaint-section-head">
        <div>
          <h3>{section.title}</h3>
          <p className="muted">{section.description}</p>
        </div>
        <span className={`badge ${section.key}`}>{section.items.length}</span>
      </div>
      <div className="cards-list compact">
        {section.items.length === 0 ? (
          <div className="empty small">No {section.title.toLowerCase()} complaints.</div>
        ) : (
          section.items.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue }) {
  return (
    <article className="issue-card">
      <IssueImage issue={issue} />
      <div>
        <h3>{issue.title}</h3>
        <p className="muted">{issue.address} · {new Date(issue.createdAt).toLocaleString()}</p>
        <div className="issue-meta">
          <span className="badge">{issue.ml.issueType}</span>
          <span className={`badge ${issue.ml.severity.toLowerCase()}`}>{issue.ml.severity}</span>
          <span className="badge">{issue.ml.priority}</span>
          <span className={`badge ${issue.status}`}>{formatStatus(issue.status)}</span>
        </div>
      </div>
      <div>
        <strong>{issue.ml.severityScore}/100</strong>
        <p className="muted">{issue.ml.confidence}% confidence</p>
      </div>
    </article>
  );
}

function AdminSection({ analytics, onRefresh, onUpdateIssue }) {
  const [activeSection, setActiveSection] = useState("submitted");
  const [focusedIssueId, setFocusedIssueId] = useState(null);

  if (!analytics) {
    return (
      <section id="admin" className="admin-zone">
        <div className="section-heading horizontal">
          <div>
            <p className="eyebrow">Authority Command Center</p>
            <h2>Admin dashboard</h2>
            <p>Login as an admin to view all city complaints, ML ranking, operational KPIs, clusters, and update field status.</p>
          </div>
          <button className="button dark" type="button" onClick={onRefresh}>Refresh Dashboard</button>
        </div>
        <div className="locked panel">Loading admin dashboard. If it does not appear, refresh after logging in with admin credentials.</div>
      </section>
    );
  }

  const { stats, issues } = analytics;
  const sections = buildComplaintSections(issues).map((section) => ({
    ...section,
    items: [...section.items].sort((a, b) => b.ml.severityScore - a.ml.severityScore)
  }));
  const selectedSection = sections.find((section) => section.key === activeSection) || sections[0];

  return (
    <section id="admin" className="admin-zone">
      <div className="section-heading horizontal">
        <div>
          <p className="eyebrow">Authority Command Center</p>
          <h2>Admin dashboard</h2>
          <p>Login as an admin to view all city complaints, ML ranking, operational KPIs, clusters, and update field status.</p>
        </div>
        <button className="button dark" type="button" onClick={onRefresh}>Refresh Dashboard</button>
      </div>
      <div className="stats-grid">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Open" value={stats.open} />
        <StatCard label="Critical" value={stats.critical} />
        <StatCard label="Avg Severity" value={`${stats.avgSeverity}/100`} />
      </div>
      <div className="dashboard-grid">
        <div className="panel wide">
          <div className="section-heading horizontal">
            <div>
              <p className="eyebrow">Geo Intelligence</p>
              <h2>Complaint map</h2>
            </div>
            <span className="badge">{stats.clusters.length} clusters</span>
          </div>
          <ComplaintMap issues={issues} clusters={stats.clusters} focusedIssueId={focusedIssueId} />
        </div>
        <div className="side-panel">
          <div className="cluster-card">
            <p className="eyebrow">Hotspots</p>
            {stats.clusters.length ? stats.clusters.map((cluster) => <ClusterCard key={cluster.id} cluster={cluster} />) : <p className="muted">No active clusters.</p>}
          </div>
          <div className="cluster-card">
            <p className="eyebrow">Issue Mix</p>
            {Object.entries(stats.byType).map(([type, count]) => (
              <p key={type}><strong>{type}</strong> <span className="muted">{count}</span></p>
            ))}
          </div>
        </div>
      </div>
      <div className="panel wide admin-queue">
        <div className="section-heading horizontal">
          <div>
            <p className="eyebrow">Work Queue</p>
            <h2>{selectedSection.title} complaints</h2>
          </div>
        </div>
        <div className="section-jump-buttons" aria-label="Admin complaint status filters">
          {sections.map((section) => (
            <button
              key={section.key}
              className={`button ghost jump-button ${section.key} ${activeSection === section.key ? "jump-button-active" : ""}`}
              type="button"
              onClick={() => setActiveSection(section.key)}
            >
              {section.title}
              <span>{section.items.length}</span>
            </button>
          ))}
        </div>
        <div className="complaint-section-head admin-filter-summary">
          <div>
            <h3>{selectedSection.title}</h3>
            <p className="muted">{selectedSection.description}</p>
          </div>
          <span className={`badge ${selectedSection.key}`}>{selectedSection.items.length}</span>
        </div>
        <div className="cards-list">
          {selectedSection.items.length === 0 ? (
            <div className="empty small">No {selectedSection.title.toLowerCase()} complaints.</div>
          ) : (
            selectedSection.items.map((issue) => (
              <AdminIssueCard key={issue.id} issue={issue} onUpdateIssue={onUpdateIssue} onLocateIssue={setFocusedIssueId} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ComplaintMap({ issues, clusters, focusedIssueId }) {
  const normalizedIssues = useMemo(
    () => issues
      .map((issue) => ({
        issue,
        lat: Number(issue.lat),
        lng: Number(issue.lng),
      }))
      .filter(({ lat, lng }) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180),
    [issues]
  );
  const normalizedClusters = useMemo(
    () => clusters
      .map((cluster) => ({
        cluster,
        lat: Number(cluster.lat),
        lng: Number(cluster.lng),
      }))
      .filter(({ lat, lng }) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180),
    [clusters]
  );
  const points = useMemo(
    () => normalizedIssues.map(({ lat, lng }) => [lat, lng]),
    [normalizedIssues]
  );
  const issueIcon = useMemo(
    () => (score) => L.divIcon({
      className: "",
      html: `<div class="map-marker issue-marker"><span>${score}</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -10],
    }),
    []
  );
  const clusterIcon = useMemo(
    () => (cluster) => L.divIcon({
      className: "",
      html: `<div class="map-marker cluster-marker ${cluster.hotspot ? "hot" : ""}"><span>${cluster.count}</span></div>`,
      iconSize: [50, 50],
      iconAnchor: [25, 25],
      popupAnchor: [0, -18],
    }),
    []
  );

  const openDirections = (lat, lng) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=driving`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <p className="muted">Pan freely, zoom out to the full world map, and click any marker for details and Google Maps directions.</p>
      </div>
      <div className="map-frame">
        <MapContainer
          className="map"
          center={[20, 0]}
          zoom={2}
          minZoom={2}
          maxZoom={19}
          worldCopyJump
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapViewport issues={normalizedIssues} points={points} focusedIssueId={focusedIssueId} />
          <MapToolbar points={points} />
          {normalizedIssues.map(({ issue, lat, lng }) => (
            <Marker
              key={issue.id}
              position={[lat, lng]}
              icon={issueIcon(issue.ml.severityScore)}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{issue.title}</strong>
                  <p>{issue.address}</p>
                  <p>Severity {issue.ml.severityScore}/100</p>
                  <div className="map-popup-actions">
                    <button className="button dark map-popup-button" type="button" onClick={() => openDirections(lat, lng)}>
                      Directions
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
          {normalizedClusters.map(({ cluster, lat, lng }) => (
            <Marker
              key={cluster.id}
              position={[lat, lng]}
              icon={clusterIcon(cluster)}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{cluster.hotspot ? "Hotspot" : "Cluster"} · {cluster.count} reports</strong>
                  <p>{cluster.issueTypes.join(", ")}</p>
                  <p>Average severity {cluster.avgSeverity}/100</p>
                  <div className="map-popup-actions">
                    <button className="button dark map-popup-button" type="button" onClick={() => openDirections(lat, lng)}>
                      Directions
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

function MapViewport({ issues, points, focusedIssueId }) {
  const map = useMap();

  useEffect(() => {
    if (focusedIssueId) {
      const issueMatch = issues.find(({ issue }) => issue.id === focusedIssueId);
      if (!issueMatch) return;
      map.flyTo([issueMatch.lat, issueMatch.lng], Math.max(map.getZoom(), 15), {
        animate: true,
        duration: 0.9,
      });
      return;
    }

    if (points.length) {
      map.fitBounds(points, { padding: [36, 36], maxZoom: 15 });
    } else {
      map.setView([20, 0], 2);
    }
  }, [focusedIssueId, issues, map, points]);

  return null;
}

function MapToolbar({ points }) {
  const map = useMap();

  return (
    <div className="leaflet-top leaflet-right">
      <div className="leaflet-control civic-map-toolbar">
        <button className="button ghost map-control-button" type="button" onClick={() => map.zoomIn()}>
          Zoom In
        </button>
        <button className="button ghost map-control-button" type="button" onClick={() => map.zoomOut()}>
          Zoom Out
        </button>
        <button
          className="button ghost map-control-button"
          type="button"
          onClick={() => {
            if (points.length) {
              map.fitBounds(points, { padding: [36, 36], maxZoom: 15 });
              return;
            }
            map.setView([20, 0], 2);
          }}
        >
          Fit Issues
        </button>
        <button className="button ghost map-control-button" type="button" onClick={() => map.setView([20, 0], 2)}>
          World View
        </button>
      </div>
    </div>
  );
}

function ClusterCard({ cluster }) {
  return (
    <div className="cluster-card">
      <strong>{cluster.hotspot ? "Hotspot" : "Cluster"} · {cluster.count} reports</strong>
      <p className="muted">{cluster.issueTypes.join(", ")} · Avg severity {cluster.avgSeverity}/100</p>
    </div>
  );
}

function AdminIssueCard({ issue, onUpdateIssue, onLocateIssue }) {
  const [status, setStatus] = useState(issue.status);
  const [assignedTo, setAssignedTo] = useState(issue.assignedTo || "");

  useEffect(() => {
    setStatus(issue.status);
    setAssignedTo(issue.assignedTo || "");
  }, [issue.status, issue.assignedTo]);

  return (
    <article className="admin-card">
      <IssueCard issue={issue} />
      <div className="admin-controls">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {statusOptions.map((option) => <option key={option} value={option}>{formatStatus(option)}</option>)}
        </select>
        <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="Assign team" />
        <button className="button ghost" type="button" onClick={() => {
          onLocateIssue(issue.id);
          window.location.hash = "#admin";
        }}>Locate on Map</button>
        <button className="button dark" type="button" onClick={() => onUpdateIssue(issue.id, status, assignedTo)}>Update</button>
      </div>
    </article>
  );
}

function IssueImage({ issue }) {
  if (issue.imageData) return <img src={issue.imageData} alt={issue.title} />;
  return <div className="issue-thumb"></div>;
}

function Toast({ toast }) {
  return (
    <div className={`toast ${toast ? "show" : ""}`} style={{ background: toast?.type === "error" ? "#9f2d24" : "#10211c" }} role="status" aria-live="polite">
      {toast?.message}
    </div>
  );
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function getImageStats(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 96;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      let brightness = 0;
      let green = 0;
      let red = 0;
      let blue = 0;
      let brown = 0;
      let edges = 0;
      let previous = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const current = (r + g + b) / 3;
        brightness += current;
        if (r > g * 1.1 && r > b * 1.1) red += 1;
        if (g > r * 1.08 && g > b * 1.08) green += 1;
        if (b > r * 1.05 && b > g * 1.02) blue += 1;
        if (r > 70 && g > 45 && g < 140 && b < 95 && r > b * 1.2) brown += 1;
        if (Math.abs(current - previous) > 48) edges += 1;
        previous = current;
      }

      const total = pixels.length / 4;
      resolve({
        brightness: Number((brightness / total).toFixed(2)),
        redRatio: Number((red / total).toFixed(3)),
        greenRatio: Number((green / total).toFixed(3)),
        blueRatio: Number((blue / total).toFixed(3)),
        brownRatio: Number((brown / total).toFixed(3)),
        edgeDensity: Number((edges / total).toFixed(3))
      });
    };
    image.onerror = () => resolve({});
    image.src = dataUrl;
  });
}

function formatStatus(status) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default App;
