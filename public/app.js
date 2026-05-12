// Polymarket Smart Money — dashboard. Plain ES2020, no build step.

const REFRESH_MS = 15_000;

const $ = (id) => document.getElementById(id);

function shortAddress(addr) {
  if (!addr) return "–";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtNumber(n, opts = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const { maximumFractionDigits = 0 } = opts;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(n);
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "–";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtScore(n) {
  if (!Number.isFinite(n)) return "–";
  return n.toFixed(1);
}

function fmtRelative(timestamp) {
  if (!timestamp) return "–";
  const ms = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  if (!Number.isFinite(ms)) return "–";
  const diff = Date.now() - ms;
  if (diff < 0) return "in the future";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function fmtDate(timestamp) {
  if (!timestamp) return "–";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString();
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

// ----- renderers -----

function renderHealth(health) {
  const dot = $("status-dot");
  const text = $("status-text");
  if (!health) {
    dot.className = "status-dot status-unknown";
    text.textContent = "unreachable";
    return;
  }
  const ok = health.status === "ok";
  dot.className = `status-dot status-${ok ? "ok" : "err"}`;
  const checks = health.checks ?? {};
  text.textContent = ok
    ? `healthy · db ${checks.database} · redis ${checks.redis}`
    : `degraded · db ${checks.database} · redis ${checks.redis}`;
}

function renderStats(stats) {
  if (!stats) return;
  const { counts = {}, threshold, lastPipelineRun, pipelineScheduler } = stats;
  $("stat-markets").textContent = fmtNumber(counts.activeMarkets);
  $("stat-markets-sub").textContent = `${fmtNumber(counts.totalMarkets)} total`;
  $("stat-wallets").textContent = fmtNumber(counts.wallets);
  $("stat-smart").textContent = fmtNumber(counts.smartWallets);
  $("stat-smart-sub").textContent = `≥ ${fmtScore(threshold)}`;
  $("stat-trades").textContent = fmtNumber(counts.trades);
  $("stat-alerts").textContent = fmtNumber(counts.alerts);

  if (pipelineScheduler) {
    $("scheduler-info").textContent = pipelineScheduler.enabled
      ? `scheduler: every ${pipelineScheduler.intervalMinutes}m`
      : "scheduler: disabled";
  }

  const pre = $("last-run");
  if (!lastPipelineRun) {
    pre.textContent = "No run recorded yet.";
    return;
  }
  const lines = [
    `status     : ${lastPipelineRun.status}`,
    `finished   : ${fmtDate(lastPipelineRun.finishedAt)} (${fmtRelative(lastPipelineRun.finishedAt)})`,
    `job id     : ${lastPipelineRun.id ?? "–"}`,
  ];
  if (lastPipelineRun.error) {
    lines.push(`error      : ${lastPipelineRun.error}`);
  }
  if (lastPipelineRun.summary) {
    lines.push("summary    :");
    for (const [k, v] of Object.entries(lastPipelineRun.summary)) {
      lines.push(`  ${k.padEnd(22, " ")} ${v}`);
    }
  }
  pre.textContent = lines.join("\n");
}

function renderWallets(payload, threshold) {
  const body = $("wallets-body");
  const wallets = payload?.wallets ?? [];
  if (wallets.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No wallets yet — wait for the first pipeline run.</td></tr>`;
    return;
  }
  body.innerHTML = wallets
    .map((w) => {
      const hot = w.smartScore >= (threshold ?? 75);
      return `<tr>
        <td><span class="mono">${shortAddress(w.address)}</span></td>
        <td class="num"><span class="score-pill ${hot ? "hot" : ""}">${fmtScore(w.smartScore)}</span></td>
        <td class="num">${fmtMoney(w.totalVolume)}</td>
        <td>${fmtRelative(w.lastSeenAt)}</td>
      </tr>`;
    })
    .join("");
}

function renderAlerts(payload) {
  const body = $("alerts-body");
  const alerts = payload?.alerts ?? [];
  if (alerts.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No alerts yet.</td></tr>`;
    return;
  }
  body.innerHTML = alerts
    .map((a) => {
      const q = a.market?.question ?? "(unknown market)";
      const slug = a.market?.slug;
      const marketCell = slug
        ? `<a href="https://polymarket.com/market/${encodeURIComponent(slug)}" target="_blank">${q}</a>`
        : q;
      return `<tr>
        <td>${fmtRelative(a.sentAt)}<div class="muted" style="font-size:11px">${fmtDate(a.sentAt)}</div></td>
        <td><span class="mono">${shortAddress(a.walletAddress)}</span><div class="muted" style="font-size:11px">score ${fmtScore(a.wallet?.smartScore)}</div></td>
        <td>${marketCell}</td>
      </tr>`;
    })
    .join("");
}

function renderMarkets(payload) {
  const body = $("markets-body");
  const markets = payload?.markets ?? [];
  if (markets.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No markets synced yet.</td></tr>`;
    return;
  }
  body.innerHTML = markets
    .slice(0, 15)
    .map((m) => {
      const slug = m.slug
        ? `<a href="https://polymarket.com/market/${encodeURIComponent(m.slug)}" target="_blank">${m.question}</a>`
        : m.question;
      return `<tr>
        <td>${slug}</td>
        <td class="muted">${m.category ?? "–"}</td>
        <td class="num">${fmtMoney(m.volume)}</td>
        <td>${m.endDate ? fmtDate(m.endDate) : "–"}</td>
      </tr>`;
    })
    .join("");
}

// ----- main refresh -----

async function refresh() {
  $("last-refresh").textContent = "refreshing…";
  const results = await Promise.allSettled([
    getJSON("/health"),
    getJSON("/stats"),
    getJSON("/wallets/top?limit=20"),
    getJSON("/markets/active?limit=15"),
    getJSON("/alerts/recent?limit=20"),
  ]);

  const [health, stats, wallets, markets, alerts] = results.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  );

  renderHealth(health);
  renderStats(stats);
  renderWallets(wallets, stats?.threshold);
  renderAlerts(alerts);
  renderMarkets(markets);

  $("last-refresh").textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
}

async function runPipeline() {
  const btn = $("run-pipeline-btn");
  btn.disabled = true;
  btn.textContent = "Enqueuing…";
  try {
    const res = await fetch("/jobs/run-pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topMarkets: 10, tradesPerMarket: 100 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    toast(`Pipeline enqueued (job ${data.jobId})`, "ok");
    setTimeout(refresh, 1500);
  } catch (err) {
    toast(`Failed to enqueue: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Run pipeline now";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("refresh-btn").addEventListener("click", refresh);
  $("run-pipeline-btn").addEventListener("click", runPipeline);
  refresh();
  setInterval(refresh, REFRESH_MS);
});
