const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Server did not start in time."));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Smart City Issue Reporter running")) {
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on("data", (chunk) => {
      reject(new Error(chunk.toString()));
    });
  });
}

test("admin can login and read analytics", async (t) => {
  const port = 3417;
  const server = await startServer(port);
  t.after(() => server.kill());

  const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /CivicPulse AI/);

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@city.gov", password: "admin123" })
  });
  assert.equal(loginResponse.status, 200);

  const login = await loginResponse.json();
  assert.equal(login.user.role, "admin");
  assert.ok(login.token);

  const analyticsResponse = await fetch(`http://127.0.0.1:${port}/api/analytics`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  assert.equal(analyticsResponse.status, 200);

  const analytics = await analyticsResponse.json();
  assert.ok(analytics.stats.total >= 5);
  assert.ok(Array.isArray(analytics.stats.clusters));
});
