export function summarize(records, stored) {
  const latencies = [];
  let accepted = 0, rejected = 0, uncertain = 0, retries = 0, missing = 0, duplicates = 0, storedDuplicates = 0, timeouts = 0, requestErrors = 0;
  for (const row of records) {
    retries += Math.max(0, row.attempts - 1);
    duplicates += row.duplicates;
    timeouts += row.timeouts;
    requestErrors += row.requestErrors ?? 0;
    const copies = stored.get(row.id) ?? 0;
    storedDuplicates += Math.max(0, copies - 1);
    if (row.accepted || copies > 0) {
      accepted++;
      if (copies === 0) missing++;
      for (const client of row.expected) {
        const latency = row.receipts.get(client);
        if (latency === undefined) missing++;
        else if (row.cross.includes(client)) latencies.push(latency);
      }
    } else if (row.rejected) rejected++;
    else uncertain++;
  }
  latencies.sort((a, b) => a - b);
  const percentile = (p) => latencies.length ? latencies[Math.max(0, Math.ceil(p * latencies.length) - 1)] : null;
  return { offered: records.length, accepted, rejected, uncertain, retries, timeouts, requestErrors, missing, transportDuplicates: duplicates, storedDuplicates,
    crossInstanceSamples: latencies.length, latencyMs: { min: latencies[0] ?? null, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: latencies.at(-1) ?? null } };
}
