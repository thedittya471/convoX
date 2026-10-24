import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem, platform, release } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { summarize } from "./accounting.mjs";

const recoveryMode = process.env.LOAD_RECOVERY === "1";
const connections = Number(process.env.LOAD_CONNECTIONS ?? 30);
const rate = Number(process.env.LOAD_RATE ?? 3);
const seconds = Number(process.env.LOAD_SECONDS ?? 5);
const warmup = Number(process.env.LOAD_WARMUP ?? 3);
const seed = process.env.LOAD_SEED ?? "convox-20261024";
assert.ok(Number.isInteger(connections) && connections >= 30 && connections <= 1000 && connections % 10 === 0);
assert.ok(Number.isInteger(rate) && rate > 0 && rate <= 100);
assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 600);
assert.ok(Number.isInteger(warmup) && warmup >= 0 && warmup <= 60);

if (!process.argv.includes("--run")) {
  assert.ok(process.env.COMPOSE_PROJECT_NAME?.startsWith("convox-test-") || process.env.COMPOSE_PROJECT_NAME === "convox-release", "Set an explicit disposable Compose project");
  const directory = resolve(process.env.LOAD_RESULTS ?? `/tmp/convox-load-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  const name = `convox-load-driver-${Date.now()}`;
  const environment = ["LOAD_CONNECTIONS", "LOAD_RATE", "LOAD_SECONDS", "LOAD_WARMUP", "LOAD_SEED", "LOAD_RECOVERY"].flatMap((key) => process.env[key] ? ["-e", `${key}=${process.env[key]}`] : []);
  const resourceSamples = [];
  const sample = () => {
    try {
      const rows = execFileSync("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...[1, 2, 3].map((n) => `${process.env.COMPOSE_PROJECT_NAME}-server-${n}-1`)], { encoding: "utf8", timeout: 5000 });
      resourceSamples.push({ at: new Date().toISOString(), rows: rows.trim().split("\n").map(JSON.parse) });
    } catch { resourceSamples.push({ at: new Date().toISOString(), unavailable: true }); }
  };
  const timer = setInterval(sample, 10000);
  let crashed = false;
  try {
    const child = spawn("docker", ["compose", "run", "--name", name, "--no-deps", ...environment, "server-2", "node", ...(recoveryMode ? ["--import", "/app/apps/web/node_modules/tsx/dist/loader.mjs"] : []), "tests/load/run.mjs", "--run"], { stdio: recoveryMode ? ["pipe", "pipe", "inherit"] : "inherit" });
    const completed = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
    if (recoveryMode) {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line === "KILL_SERVER_3" || line === "RESTART_SERVER_3") {
          crashed = line === "KILL_SERVER_3";
          execFileSync("docker", ["compose", ...(crashed ? ["kill", "-s", "SIGKILL", "server-3"] : ["start", "server-3"])], { stdio: "ignore", timeout: 30000 });
          child.stdin.write("done\n");
        } else console.log(line);
      }
      child.stdin.end();
    }
    const code = await completed;
    execFileSync("docker", ["cp", `${name}:/tmp/load-result.json.gz`, join(directory, "raw.json.gz")]);
    const docker = execFileSync("docker", ["info", "--format", "{{.ServerVersion}} CPUs={{.NCPU}} Memory={{.MemTotal}} Kernel={{.KernelVersion}}"], { encoding: "utf8" }).trim();
    writeFileSync(join(directory, "environment.json"), JSON.stringify({ commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, cpuCount: cpus().length, memory: totalmem(), docker, topology: recoveryMode ? "one local Docker VM; three replicas, PostgreSQL 17, Redis 8; gateway HTTP/application clients, direct offline/rejoin probes" : "one local Docker VM; three application replicas, NGINX, PostgreSQL 17, Redis 8; direct private HTTP sends and sockets", resourceSamples }, null, 2));
    console.log(`Load artifacts: ${directory}`);
    process.exitCode = code ?? 1;
  } finally {
    clearInterval(timer);
    if (crashed) execFileSync("docker", ["compose", "start", "server-3"], { stdio: "ignore", timeout: 30000 });
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
} else {
  assert.notEqual(process.env.DEPLOYMENT_MODE, "production", "Never run synthetic load against production");
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "postgres", "Use the isolated Compose database");
  assert.equal(process.env.SMTP_HOST, "mailpit", "Synthetic signup requires local mail capture");
  const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
  const { io } = require("socket.io-client");
  const { pool } = await import("../../apps/server/dist/db/client.js");
  const { verifyFixture } = await import("../integration/verify-email.mjs");
  const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
  const actors = [], pairs = [], sockets = [], records = new Map(), inFlight = new Set(), metrics = [];
  const distribution = [0, 0, 0];
  const runId = randomUUID();
  const origin = process.env.BETTER_AUTH_URL;
  const request = (server, path, actor, body) => fetch(`${server}${path}`, {
    method: body ? "POST" : "GET", headers: { origin, "x-real-ip": actor?.ip ?? "198.18.0.1", "x-forwarded-for": actor?.ip ?? "198.18.0.1", "content-type": "application/json", ...(actor ? { cookie: actor.cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
  });
  async function scrape() {
    metrics.push({ at: performance.now(), instances: await Promise.all(servers.map(async (server) => {
      try { const r = await fetch(`${server}/internal/metrics`, { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` }, signal: AbortSignal.timeout(3000) }); return { status: r.status, text: await r.text() }; }
      catch { return { unavailable: true }; }
    })) });
  }
  let metricTimer, recovery;
  const receive = (i, message) => {
    const row = records.get(message.clientMessageId);
    if (!row || !row.expected.includes(i)) return;
    if (row.receipts.has(i)) row.duplicates++;
    else row.receipts.set(i, performance.now() - row.started);
  };
  try {
    for (let i = 0; i < connections / 5; i++) {
      const email = `load-${runId}-${i}@example.com`;
      const actor = { ip: `198.18.${Math.floor(i / 250)}.${i % 250 + 1}` };
      const r = await request(servers[i % 3], "/api/auth/sign-up/email", actor, { email, name: "Synthetic load", password: randomBytes(20).toString("hex") });
      assert.equal(r.status, 200, "synthetic signup");
      Object.assign(actor, (await r.json()).user, { cookie: r.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") });
      actors.push(actor);
      await verifyFixture(email);
    }
    for (let i = 0; i < actors.length; i += 2) {
      const opened = await request(servers[i % 3], "/api/conversations", actors[i], { otherUserId: actors[i + 1].id });
      assert.equal(opened.status, 201);
      pairs.push({ sender: actors[i], recipient: actors[i + 1], id: (await opened.json()).conversation.id, views: [] });
    }
    if (recoveryMode) recovery = await (await import("./recovery.mjs")).createRecovery({ actors, pairs, pool, origin, receive });
    for (let i = 0; i < connections; i++) {
      const actor = actors[Math.floor(i / 5)], serverIndex = i % 3;
      const socket = io(recovery ? recovery.url(i) : servers[serverIndex], { autoConnect: false, transports: ["websocket"], reconnection: Boolean(recovery), reconnectionDelay: 250, reconnectionDelayMax: 1000, timeout: 2000, extraHeaders: { origin, cookie: actor.cookie, "x-real-ip": actor.ip, "x-forwarded-for": actor.ip } });
      sockets.push(socket);
      if (Math.floor(i / 5) % 2 === 1) pairs[Math.floor(i / 10)].views.push({ id: i, serverIndex });
      if (!recovery) socket.on("message:created", (message) => receive(i, message));
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Connection ramp timed out")), 10000);
        socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
        socket.once("realtime:ready", (ready) => { clearTimeout(timer); if (!recovery) assert.equal(ready.instanceId, `server-${serverIndex + 1}`); distribution[Number(ready.instanceId.at(-1)) - 1]++; resolve(); });
      });
      if (recovery) await recovery.attach(socket, i); else socket.connect();
      await ready;
    }
    await scrape();
    metricTimer = setInterval(() => void scrape(), 5000);
    let offered = 0, driverOverload = 0;
    async function send(row, pair, serverIndex) {
      const body = { clientMessageId: row.id, encryptedPayload: `synthetic:${seed}:${offered}` };
      for (let attempt = 0; attempt < 2; attempt++) {
        row.attempts++;
        try {
          const r = await request(recovery ? "http://nginx" : servers[serverIndex], `/api/conversations/${pair.id}/messages`, pair.sender, body);
          row.status = r.status;
          if (r.ok) { const value = await r.json(); row.canonical = value.message.id; row.accepted = true; return; }
          row.rejected = true;
          if (![429, 502, 503, 504].includes(r.status)) return;
          const retry = Math.max(1, Number(r.headers.get("retry-after")) || 1);
          await sleep(Math.min(retry, 5) * 1000);
        } catch (error) { row.requestErrors++; if (["TimeoutError", "AbortError"].includes(error.name)) row.timeouts++; }
      }
    }
    async function offer(duration, measured) {
      const start = performance.now();
      for (let n = 0; n < rate * duration; n++) {
        await sleep(Math.max(0, start + n * 1000 / rate - performance.now()));
        const pair = pairs[offered % pairs.length], serverIndex = offered % 3;
        const hex = createHash("sha256").update(`${seed}:${offered++}`).digest("hex");
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        const row = { id, measured, started: performance.now(), expected: pair.views.map((v) => v.id), cross: recovery ? [] : pair.views.filter((v) => v.serverIndex !== serverIndex).map((v) => v.id), receipts: new Map(), accepted: false, rejected: false, attempts: 0, duplicates: 0, timeouts: 0, requestErrors: 0 };
        records.set(id, row);
        if (inFlight.size >= 200) { driverOverload++; row.rejected = true; row.status = "driver_overload"; continue; }
        const pending = send(row, pair, serverIndex).finally(() => inFlight.delete(pending));
        inFlight.add(pending);
      }
      await sleep(Math.max(0, start + duration * 1000 - performance.now()));
    }
    console.log(JSON.stringify({ phase: "warmup", connections, distribution, rate, seconds, warmup, seed }));
    await offer(warmup, false);
    await Promise.all(inFlight);
    const started = performance.now();
    const faultTask = recovery?.run();
    faultTask?.catch(() => {});
    await offer(seconds, true);
    const offeredElapsedMs = performance.now() - started;
    await Promise.all(inFlight);
    if (faultTask) await faultTask;
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline && [...records.values()].some((r) => r.accepted && r.receipts.size < r.expected.length)) await sleep(100);
    await scrape();
    const rows = [...records.values()].filter((r) => r.measured);
    const stored = await pool.query("SELECT client_message_id, count(*)::int AS copies FROM message WHERE sender_id=ANY($1::text[]) AND client_message_id=ANY($2::uuid[]) GROUP BY client_message_id", [actors.map((a) => a.id), rows.map((r) => r.id)]);
    const summary = { ...summarize(rows, new Map(stored.rows.map((r) => [r.client_message_id, r.copies]))), connections, distribution, connectedAtEnd: (recovery ? recovery.views.map((v) => v.socket) : sockets).filter((s) => s.connected).length, rate, seconds, warmup, seed, offeredElapsedMs, driverOverload };
    summary.passed = summary.accepted === rate * seconds && summary.missing === 0 && summary.storedDuplicates === 0 && summary.uncertain === 0 && summary.rejected === 0 && summary.connectedAtEnd === connections && summary.latencyMs.p95 !== null && summary.latencyMs.p95 < 500 && offeredElapsedMs < seconds * 1000 + 1000;
    const recoveryResult = recovery ? await recovery.finish() : undefined;
    if (recoveryResult) summary.passed = summary.missing === 0 && summary.storedDuplicates === 0 && summary.transportDuplicates === 0 && summary.accepted === rate * seconds && summary.rejected === 0 && summary.uncertain === 0 && driverOverload === 0 && recoveryResult.passed && summary.connectedAtEnd === connections;
    writeFileSync("/tmp/load-result.json.gz", gzipSync(JSON.stringify({ summary, recovery: recoveryResult, metrics, records: rows.map((r) => ({ ...r, receipts: [...r.receipts] })) })));
    console.log(JSON.stringify(summary));
    if (recoveryResult) console.log(JSON.stringify({ recovery: { affected: recoveryResult.affected.length, recovered: recoveryResult.recovered.length, worstMs: recoveryResult.worstMs, p95Ms: recoveryResult.p95Ms, offlineMs: recoveryResult.offlineMs, typingClearedMs: recoveryResult.typingClearedMs, appliedDuplicates: recoveryResult.appliedDuplicates, passed: recoveryResult.passed } }));
    if (!summary.passed) process.exitCode = 1;
  } catch (error) {
    writeFileSync("/tmp/load-result.json.gz", gzipSync(JSON.stringify({ failed: true, error: error.message, metrics, recovery: recovery?.fault, records: [...records.values()].map((r) => ({ ...r, receipts: [...r.receipts] })) })));
    throw error;
  } finally {
    clearInterval(metricTimer);
    if (recovery) await recovery.stop();
    for (const socket of sockets) socket.disconnect();
    const ids = actors.map((a) => a.id);
    await pool.query("DELETE FROM message WHERE sender_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM conversation WHERE direct_user_low_id=ANY($1::text[]) OR direct_user_high_id=ANY($1::text[])", [ids]);
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [ids]);
    await pool.end();
  }
}
