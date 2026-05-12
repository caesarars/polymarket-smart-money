// Polymarket BTC Intelligence — dashboard. Plain ES2020, no build step.

const REFRESH_MS = 8_000;

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

function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(digits)}%`;
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

function renderStats(stats, btcMetrics) {
  if (!stats) return;
  const { counts = {}, lastPipelineRun, pipelineScheduler } = stats;
  $("stat-markets").textContent = fmtNumber(counts.activeMarkets);
  $("stat-markets-sub").textContent = `${fmtNumber(counts.totalMarkets)} total`;
  $("stat-alerts").textContent = fmtNumber(counts.alerts);

  if (btcMetrics) {
    $("stat-signal").textContent = fmtScore(btcMetrics.signalScore);
    $("stat-signal-sub").textContent =
      btcMetrics.signalScore >= 60 ? "elevated" : "neutral";
    $("stat-prob").textContent = fmtPct(btcMetrics.modelProbability);
    $("stat-price").textContent = fmtNumber(btcMetrics.metrics?.lastPrice, { maximumFractionDigits: 2 });
    $("stat-price-sub").textContent = `mark ${fmtNumber(btcMetrics.metrics?.markPrice, { maximumFractionDigits: 2 })}`;
  }

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

function renderBtcMetrics(btcMetrics) {
  if (!btcMetrics || !btcMetrics.metrics) {
    $("metrics-age").textContent = "not ready";
    return;
  }
  const m = btcMetrics.metrics;
  $("metrics-age").textContent = fmtRelative(m.timestamp);
  $("m-price").textContent = fmtNumber(m.lastPrice, { maximumFractionDigits: 2 });
  $("m-mark").textContent = fmtNumber(m.markPrice, { maximumFractionDigits: 2 });
  $("m-v5").textContent = fmtPct(m.priceVelocity5s);
  $("m-v15").textContent = fmtPct(m.priceVelocity15s);
  $("m-v60").textContent = fmtPct(m.priceVelocity60s);
  $("m-vol").textContent = fmtPct(m.volatilityExpansion, 4);
  $("m-of").textContent = m.orderflowImbalance.toFixed(3);
  $("m-spread").textContent = fmtPct(m.bidAskSpread);
  $("m-liq").textContent = m.liquidationPressure.toFixed(3);
}

function renderSignals(payload) {
  const body = $("signals-body");
  const signals = payload?.signals ?? [];
  if (signals.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No signals yet — waiting for Binance + Polymarket data.</td></tr>`;
    return;
  }
  body.innerHTML = signals
    .map((s) => {
      const q = s.market?.question ?? "(unknown)";
      const edge = s.edge;
      const edgeStr = `${edge > 0 ? "+" : ""}${fmtPct(edge)}`;
      const confClass =
        s.confidence === "HIGH" ? "hot" : s.confidence === "MEDIUM" ? "warm" : "";
      return `<tr>
        <td>${fmtRelative(s.timestamp)}</td>
        <td>${q}</td>
        <td class="num">${s.side}</td>
        <td class="num">${edgeStr}</td>
        <td><span class="score-pill ${confClass}">${s.confidence}</span></td>
      </tr>`;
    })
    .join("");
}

function renderAlerts(payload) {
  const body = $("alerts-body");
  const alerts = payload?.alerts ?? [];
  if (alerts.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No alerts yet.</td></tr>`;
    return;
  }
  body.innerHTML = alerts
    .map((a) => {
      const q = a.market?.question ?? "(unknown)";
      return `<tr>
        <td>${fmtRelative(a.sentAt)}<div class="muted" style="font-size:11px">${fmtDate(a.sentAt)}</div></td>
        <td>${q}</td>
        <td class="num">${a.side ?? "–"}</td>
        <td class="num">${a.message?.includes("Edge:") ? a.message.split("Edge:")[1]?.split("\n")[0]?.trim() : "–"}</td>
      </tr>`;
    })
    .join("");
}

function renderMarkets(payload) {
  const body = $("markets-body");
  const markets = payload?.markets ?? [];
  if (markets.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No BTC markets synced yet.</td></tr>`;
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
    getJSON("/btc/metrics"),
    getJSON("/btc/signals/latest"),
    getJSON("/btc/markets"),
    getJSON("/alerts/recent?limit=20"),
  ]);

  const [health, stats, btcMetrics, signals, markets, alerts] = results.map(
    (r) => (r.status === "fulfilled" ? r.value : null),
  );

  renderHealth(health);
  renderStats(stats, btcMetrics);
  renderBtcMetrics(btcMetrics);
  renderSignals(signals);
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
