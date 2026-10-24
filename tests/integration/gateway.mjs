import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
const execute = promisify(execFile);
const compose = (...args) => execute("docker", ["compose", ...args], { timeout: 30000 });
if (!process.argv.includes("--run")) {
  const restore = () => compose("exec", "-T", "postgres", "sh", "-c", 'if test -f "$PGDATA/pg_hba.conf.task24"; then cp -p "$PGDATA/pg_hba.conf.task24" "$PGDATA/pg_hba.conf"; rm "$PGDATA/pg_hba.conf.task24"; psql -U convox -d convox -c "SELECT pg_reload_conf()"; fi');
  const child = spawn("docker", ["compose", "exec", "-T", "server-2", "node", "tests/integration/gateway.mjs", "--run"], { stdio: ["pipe", "pipe", "inherit"] });
  const complete = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Gateway suite exited ${code}`))); });
  try {
    const output = (async () => {
      for await (const line of createInterface({ input: child.stdout })) {
        if (["BLOCK_DB", "RESTORE_DB", "CHANGE_DNS"].includes(line)) {
          const { stdout: id } = await compose("ps", "-q", "server-3");
          const { stdout } = await execute("docker", ["inspect", "--format", "{{json .NetworkSettings.Networks}}", id.trim()]);
          const [network, connection] = Object.entries(JSON.parse(stdout))[0];
          const ip = connection.IPAddress;
          assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/);
          if (line === "BLOCK_DB") {
            await compose("exec", "-T", "postgres", "sh", "-c", `cp -p "$PGDATA/pg_hba.conf" "$PGDATA/pg_hba.conf.task24"; { printf 'host all all ${ip}/32 reject\\n'; cat "$PGDATA/pg_hba.conf.task24"; } > "$PGDATA/pg_hba.conf"; psql -U convox -d convox -c "SELECT pg_reload_conf()"`);
            await compose("exec", "-T", "postgres", "psql", "-U", "convox", "-d", "convox", "-c", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='server-3'");
          } else if (line === "RESTORE_DB") await restore();
          else {
            const parts = ip.split("."); parts[3] = parts[3] === "240" ? "241" : "240";
            await compose("stop", "server-3");
            await execute("docker", ["network", "disconnect", network, id.trim()]);
            await execute("docker", ["network", "connect", "--alias", "server-3", "--ip", parts.join("."), network, id.trim()]);
            // A returning replica starts fresh at the replacement address.
            await compose("start", "server-3");
          }
          child.stdin.write("done\n");
        } else console.log(line);
      }
    })();
    await Promise.all([complete, output]);
  } finally { child.stdin.end(); await restore(); }
} else {
  async function command(value) {
    const resumed = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Controller timed out: ${value}`)), 60000); process.stdin.once("data", () => { clearTimeout(timer); resolve(); }); });
    console.log(value); await resumed;
  }
  async function until(check, message) { const start = performance.now(); while (performance.now()-start < 20000) { if (await check()) return; await sleep(200); } assert.fail(message); }
  const get = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
  try {
    await command("BLOCK_DB");
    await until(async () => (await get("http://server-3:4000/api/health/ready")).status === 503, "reachable replica must lose readiness");
    assert.equal((await get("http://server-3:4000/api/health/live")).status, 200);
    const rejected = await get("http://server-3:4000/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.get("x-convox-not-accepted"), "1");
    for (let i=0; i<20; i++) {
      const response = await get("http://nginx/api/health/ready");
      assert.equal(response.status, 200);
      assert.notEqual((await response.json()).instanceId, "server-3", "unready process must be ejected/retried for GET");
    }
    await command("RESTORE_DB");
    await until(async () => (await get("http://server-3:4000/api/health/ready")).status === 200, "restored database readiness");
    await command("CHANGE_DNS");
    await until(async () => { try { const response = await get("http://nginx/api/health/realtime"); return response.ok && (await response.json()).instanceId === "server-3"; } catch { return false; } }, "gateway must resolve returning replica at its new IP");
    console.log("Gateway readiness passed: reachable DB-unready replica rejected before work, healthy GET failover, restored readiness and backend DNS/IP replacement.");
  } finally { process.stdin.pause(); }
}
