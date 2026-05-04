const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";
const ROOT = __dirname;
const FRONTEND_DIR = path.join(ROOT, "..", "frontend");
const DIST_DIR = path.join(FRONTEND_DIR, "dist");
const PUBLIC_DIR = path.join(FRONTEND_DIR, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const ML_DIR = path.join(ROOT, "..", "ml");
const ML_ARTIFACTS_DIR = path.join(ML_DIR, "artifacts");

const ISSUE_TYPES = ["Pothole", "Garbage", "Broken Light", "Water Leak", "Road Block", "Unsupported"];
const STATUSES = ["submitted", "verified", "assigned", "in_progress", "resolved", "rejected"];
const sessions = new Map();
const CIVIC_KEYWORDS = ["pothole", "garbage", "waste", "trash", "bin", "street light", "light", "lamp", "dark road", "water leak", "burst pipe", "flood", "sewage", "drain", "road blocked", "blocked lane", "fallen tree", "debris", "obstruction", "road crack"];
const NON_CIVIC_KEYWORDS = ["car", "cars", "vehicle", "vehicles", "porsche", "gt1", "gt3", "race", "racing", "supercar", "coupe", "sedan", "suv", "motorcycle", "bike", "concept art", "wallpaper", "render", "illustration"];

const sampleIssues = [
  {
    title: "Deep pothole near bus stop",
    description: "Large pothole creating traffic slowdown near school bus pickup.",
    address: "MG Road, Bengaluru",
    lat: 12.9759,
    lng: 77.6037,
    imageName: "pothole-road.jpg",
    imageData: ""
  },
  {
    title: "Overflowing garbage bins",
    description: "Waste has spilled across the street and smells bad.",
    address: "Indiranagar 100 Feet Road",
    lat: 12.9718,
    lng: 77.6412,
    imageName: "garbage-bin.jpg",
    imageData: ""
  },
  {
    title: "Street light not working",
    description: "Dark stretch at night, unsafe for pedestrians.",
    address: "Koramangala 5th Block",
    lat: 12.9352,
    lng: 77.6245,
    imageName: "broken-light.jpg",
    imageData: ""
  },
  {
    title: "Garbage dumping beside lake",
    description: "Repeated dumping, many bags, attracting animals.",
    address: "Ulsoor Lake Road",
    lat: 12.982,
    lng: 77.619,
    imageName: "garbage-lake.jpg",
    imageData: ""
  },
  {
    title: "Pothole cluster after rain",
    description: "Multiple potholes, water filled and hard to see.",
    address: "Richmond Road",
    lat: 12.9664,
    lng: 77.6033,
    imageName: "water-pothole.jpg",
    imageData: ""
  }
];

function ensureDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) return;

  const now = new Date().toISOString();
  const users = [
    createUser("Admin Officer", "admin@city.gov", "admin123", "admin"),
    createUser("Priya Citizen", "citizen@example.com", "citizen123", "citizen")
  ];

  const db = {
    users,
    issues: sampleIssues.map((issue, index) => {
      const ml = classifyIssue(issue);
      return {
        id: crypto.randomUUID(),
        citizenId: users[1].id,
        title: issue.title,
        description: issue.description,
        address: issue.address,
        lat: issue.lat,
        lng: issue.lng,
        imageName: issue.imageName,
        imageData: "",
        status: index === 0 ? "assigned" : index === 2 ? "resolved" : "submitted",
        assignedTo: index === 0 ? "Roads team" : "",
        notes: index === 2 ? "Fixed by electrical maintenance team." : "",
        createdAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
        updatedAt: now,
        ml
      };
    })
  };

  writeDb(db);
}

function createUser(name, email, password, role) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    id: crypto.randomUUID(),
    name,
    email: email.toLowerCase(),
    role,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString()
  };
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function readDb() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 7_000_000) {
        reject(new Error("Payload is too large. Please upload an image under 5 MB."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireAuth(req, db, role) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  if (!user || (role && user.role !== role)) return null;
  return user;
}

function keywordScore(text, keywords) {
  return keywords.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
}

function detectUnsupportedUpload(input) {
  const text = `${input.title || ""} ${input.description || ""} ${input.address || ""} ${input.imageName || ""}`.toLowerCase();
  const civicHits = keywordScore(text, CIVIC_KEYWORDS);
  const nonCivicHits = keywordScore(text, NON_CIVIC_KEYWORDS);
  const image = input.imageStats || {};
  const redBias = Number(image.redRatio || 0);
  const hasStrongVehicleSignal = nonCivicHits >= 1 || (redBias > 0.22 && Number(image.edgeDensity || 0) > 0.12 && civicHits === 0);

  if (hasStrongVehicleSignal && civicHits === 0) {
    return {
      reason: "This image looks like a vehicle or non-civic visual, not a reportable civic issue. Please upload a photo of the actual problem area."
    };
  }

  return null;
}

function classifyIssue(input) {
  const modelPrediction = classifyIssueWithTrainedModel(input);
  if (modelPrediction) return modelPrediction;

  const unsupported = detectUnsupportedUpload(input);
  if (unsupported) {
    return {
      issueType: "Unsupported",
      severity: "Low",
      severityScore: 15,
      priority: "P4 Low",
      confidence: 22,
      model: "CivicPulse-UploadGuard-v1",
      explanation: unsupported.reason,
      unsupported: true
    };
  }

  const text = `${input.title || ""} ${input.description || ""} ${input.imageName || ""}`.toLowerCase();
  const image = input.imageStats || {};
  const darkBias = image.brightness !== undefined ? Math.max(0, 1 - image.brightness / 120) : 0;
  const greenBias = image.greenRatio || 0;
  const brownBias = image.brownRatio || 0;

  const scores = {
    Pothole: keywordScore(text, ["pothole", "hole", "road", "crack", "water filled", "traffic"]) + brownBias * 3,
    Garbage: keywordScore(text, ["garbage", "waste", "trash", "dump", "smell", "bin", "bags"]) + greenBias * 2,
    "Broken Light": keywordScore(text, ["light", "lamp", "dark", "night", "electric", "pole"]) + darkBias * 3,
    "Water Leak": keywordScore(text, ["water", "leak", "pipe", "drain", "flood", "sewage"]) + (image.blueRatio || 0) * 3,
    "Road Block": keywordScore(text, ["blocked", "tree", "vehicle", "debris", "construction", "obstruction"])
  };

  const issueType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  const severityHints = keywordScore(text, ["danger", "unsafe", "major", "large", "deep", "multiple", "school", "traffic", "accident", "urgent"]);
  const visualRisk = (image.edgeDensity || 0) * 18 + darkBias * 12 + brownBias * 10;
  const base = issueType === "Broken Light" ? 42 : issueType === "Pothole" ? 55 : issueType === "Garbage" ? 48 : 45;
  const severityScore = clamp(Math.round(base + severityHints * 9 + visualRisk), 15, 100);
  const severity = severityScore >= 78 ? "Critical" : severityScore >= 58 ? "High" : severityScore >= 38 ? "Medium" : "Low";
  const priority = severityScore >= 78 ? "P1 Emergency" : severityScore >= 58 ? "P2 High" : severityScore >= 38 ? "P3 Normal" : "P4 Low";
  const confidence = clamp(Math.round(62 + Math.max(...Object.values(scores)) * 8 + (input.imageStats ? 8 : 0)), 55, 96);

  return {
    issueType,
    severity,
    severityScore,
    priority,
    confidence,
    model: "CivicVision-Heuristic-v1",
    explanation: `Detected ${issueType.toLowerCase()} from report text and image signals; assigned ${severity.toLowerCase()} severity based on risk words, visual density, and public-safety impact.`
  };
}

function classifyIssueWithTrainedModel(input) {
  const classifierPath = path.join(ML_ARTIFACTS_DIR, "issue_type_classifier.joblib");
  const regressorPath = path.join(ML_ARTIFACTS_DIR, "severity_regressor.joblib");
  if (!fs.existsSync(classifierPath) || !fs.existsSync(regressorPath)) return null;

  const result = spawnSync("python3", ["-m", "civicpulse_ml.predict", "--input", JSON.stringify(input), "--artifacts", ML_ARTIFACTS_DIR], {
    cwd: path.join(ROOT, ".."),
    env: { ...process.env, PYTHONPATH: ML_DIR },
    encoding: "utf8",
    timeout: 7000,
    maxBuffer: 1024 * 1024
  });

  if (result.status !== 0 || !result.stdout) {
    console.warn("Trained ML inference failed; falling back to heuristic model.", result.stderr || result.error?.message || "");
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    console.warn("Trained ML inference returned invalid JSON; falling back to heuristic model.");
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function haversineKm(a, b) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function buildClusters(issues) {
  const unresolved = issues.filter((issue) => issue.status !== "resolved" && issue.status !== "rejected");
  const clusters = [];
  const used = new Set();

  unresolved.forEach((issue) => {
    if (used.has(issue.id)) return;
    const group = unresolved.filter((candidate) => !used.has(candidate.id) && haversineKm(issue, candidate) <= 1.2);
    group.forEach((item) => used.add(item.id));
    const avgLat = group.reduce((sum, item) => sum + Number(item.lat), 0) / group.length;
    const avgLng = group.reduce((sum, item) => sum + Number(item.lng), 0) / group.length;
    const avgSeverity = Math.round(group.reduce((sum, item) => sum + item.ml.severityScore, 0) / group.length);
    const types = [...new Set(group.map((item) => item.ml.issueType))];
    clusters.push({
      id: crypto.createHash("sha1").update(group.map((item) => item.id).join("-")).digest("hex").slice(0, 10),
      lat: Number(avgLat.toFixed(5)),
      lng: Number(avgLng.toFixed(5)),
      count: group.length,
      avgSeverity,
      hotspot: group.length >= 2 || avgSeverity >= 72,
      issueTypes: types,
      issueIds: group.map((item) => item.id)
    });
  });

  return clusters.sort((a, b) => b.count * b.avgSeverity - a.count * a.avgSeverity);
}

function buildStats(issues) {
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, issues.filter((issue) => issue.status === status).length]));
  const byType = Object.fromEntries(ISSUE_TYPES.map((type) => [type, issues.filter((issue) => issue.ml.issueType === type).length]));
  const openIssues = issues.filter((issue) => issue.status !== "resolved" && issue.status !== "rejected");
  return {
    total: issues.length,
    open: openIssues.length,
    resolved: byStatus.resolved,
    critical: issues.filter((issue) => issue.ml.severity === "Critical").length,
    avgSeverity: issues.length ? Math.round(issues.reduce((sum, issue) => sum + issue.ml.severityScore, 0) / issues.length) : 0,
    byStatus,
    byType,
    clusters: buildClusters(issues)
  };
}

function publicIssue(issue) {
  return {
    ...issue,
    imageData: issue.imageData || ""
  };
}

function serveStatic(req, res) {
  const clientDir = fs.existsSync(path.join(DIST_DIR, "index.html")) ? DIST_DIR : PUBLIC_DIR;
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.normalize(path.join(clientDir, url.pathname === "/" ? "index.html" : url.pathname));
  if (!filePath.startsWith(clientDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(clientDir, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    sendError(res, 503, "React build not found. Run npm install and npm run build, then start the server again.");
    return;
  }
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const db = readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === "POST /api/register") {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!name || !email || password.length < 6) return sendError(res, 400, "Name, valid email, and 6+ character password are required.");
      if (db.users.some((user) => user.email === email)) return sendError(res, 409, "An account already exists with this email.");
      const user = createUser(name, email, password, "citizen");
      db.users.push(user);
      writeDb(db);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { userId: user.id, createdAt: Date.now() });
      return sendJson(res, 201, { token, user: safeUser(user) });
    }

    if (route === "POST /api/login") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find((item) => item.email === email);
      if (!user || hashPassword(password, user.salt) !== user.passwordHash) return sendError(res, 401, "Invalid email or password.");
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { userId: user.id, createdAt: Date.now() });
      return sendJson(res, 200, { token, user: safeUser(user) });
    }

    if (route === "GET /api/me") {
      const user = requireAuth(req, db);
      if (!user) return sendError(res, 401, "Please log in.");
      return sendJson(res, 200, { user: safeUser(user) });
    }

    if (route === "POST /api/logout") {
      sessions.delete(getToken(req));
      return sendJson(res, 200, { ok: true });
    }

    if (route === "GET /api/issues") {
      const user = requireAuth(req, db);
      if (!user) return sendError(res, 401, "Please log in.");
      const issues = user.role === "admin" ? db.issues : db.issues.filter((issue) => issue.citizenId === user.id);
      return sendJson(res, 200, { issues: issues.map(publicIssue).sort((a, b) => b.ml.severityScore - a.ml.severityScore) });
    }

    if (route === "POST /api/issues") {
      const user = requireAuth(req, db);
      if (!user) return sendError(res, 401, "Please log in.");
      const body = await parseBody(req);
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const address = String(body.address || "").trim();
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!title || !description || !address || Number.isNaN(lat) || Number.isNaN(lng)) {
        return sendError(res, 400, "Title, description, address, latitude, and longitude are required.");
      }
      const ml = classifyIssue(body);
      if (ml.unsupported) return sendError(res, 400, ml.explanation);
      const issue = {
        id: crypto.randomUUID(),
        citizenId: user.id,
        title,
        description,
        address,
        lat,
        lng,
        imageName: String(body.imageName || "citizen-upload.jpg").slice(0, 120),
        imageData: String(body.imageData || ""),
        status: "submitted",
        assignedTo: "",
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ml
      };
      db.issues.push(issue);
      writeDb(db);
      return sendJson(res, 201, { issue: publicIssue(issue) });
    }

    if (route === "PATCH /api/issues") {
      const user = requireAuth(req, db, "admin");
      if (!user) return sendError(res, 403, "Admin access is required.");
      const body = await parseBody(req);
      const issue = db.issues.find((item) => item.id === body.id);
      if (!issue) return sendError(res, 404, "Issue not found.");
      if (body.status && STATUSES.includes(body.status)) issue.status = body.status;
      issue.assignedTo = String(body.assignedTo || issue.assignedTo || "").slice(0, 80);
      issue.notes = String(body.notes || issue.notes || "").slice(0, 500);
      issue.updatedAt = new Date().toISOString();
      writeDb(db);
      return sendJson(res, 200, { issue: publicIssue(issue) });
    }

    if (route === "GET /api/analytics") {
      const user = requireAuth(req, db, "admin");
      if (!user) return sendError(res, 403, "Admin access is required.");
      return sendJson(res, 200, { stats: buildStats(db.issues), issues: db.issues.map(publicIssue) });
    }

    sendError(res, 404, "API route not found.");
  } catch (error) {
    sendError(res, 500, error.message || "Something went wrong.");
  }
}

ensureDatabase();

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  })
  .listen(PORT, HOST, () => {
    console.log(`Smart City Issue Reporter running at http://${HOST}:${PORT}`);
    console.log("Demo admin: admin@city.gov / admin123");
    console.log("Demo citizen: citizen@example.com / citizen123");
  });
