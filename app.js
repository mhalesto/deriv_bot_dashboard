/* =============================================================
   Deriv Bot Terminal
   Static control surface for the local controller API
   (controller_api.py). Every number rendered here comes from
   /api/status, /api/trades, /api/predictions, /api/logs or a
   read-only /api/query against bot.db — nothing is simulated.
   ============================================================= */

const LS = {
  apiUrl: "derivBot.apiUrl",
  token: "derivBot.token",
  remember: "derivBot.rememberToken",
  refreshMs: "derivBot.refreshMs",
  autoLogs: "derivBot.autoLogs",
  autoPredictions: "derivBot.autoPredictions",
  pageSize: "derivBot.pageSize",
  savedQueries: "derivBot.savedQueries",
  queryHistory: "derivBot.queryHistory",
  view: "derivBot.view",
};

const state = {
  apiUrl: localStorage.getItem(LS.apiUrl) || "http://127.0.0.1:8765",
  token: localStorage.getItem(LS.token) || "",
  rememberToken: localStorage.getItem(LS.remember) !== "0",
  refreshMs: Number(localStorage.getItem(LS.refreshMs) ?? 5000),
  autoLogs: localStorage.getItem(LS.autoLogs) === "1",
  autoPredictions: localStorage.getItem(LS.autoPredictions) === "1",
  pageSize: Number(localStorage.getItem(LS.pageSize) || 50),

  connected: false,
  status: null,
  symbols: {},
  runtimeSymbols: {},

  pnlRange: "all",
  pnlRows: [],
  equity: [],
  modelReports: [],

  symbolDirty: {},
  symbolsEnabledOnly: false,
  symbolFilter: "",
  activeSymbol: null,

  trades: [],
  tradePage: 1,
  tradeSort: "desc",

  predictions: [],
  predictionSelected: null,
  predictionPaused: false,

  queryResult: null,
  logLines: [],
  logFollow: true,
  openLogRows: new Set(),

  refreshTimer: null,
  inFlight: false,
};

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- formatting ---------------- */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function fmtMoney(value, digits = 2) {
  const n = Number(value || 0);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(digits)}`;
}

function fmtSignedMoney(value, digits = 2) {
  const n = Number(value || 0);
  if (n > 0) return `+${fmtMoney(n, digits)}`;
  return fmtMoney(n, digits);
}

function fmtPct(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "n/a";
}

function fmtNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function fmtInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

function fmtAge(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return "n/a";
  if (n < 60) return `${n.toFixed(0)}s`;
  if (n < 3600) return `${(n / 60).toFixed(1)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

function fmtInterval(milliseconds) {
  const value = Number(milliseconds || 0);
  if (!value) return "Off";
  if (value < 60000) return `${value / 1000} sec`;
  if (value < 3600000) return `${value / 60000} min`;
  if (value < 86400000) return `${value / 3600000} hour${value === 3600000 ? "" : "s"}`;
  return `${value / 86400000} day`;
}

function clockOf(isoish) {
  if (!isoish) return "--:--:--";
  const str = String(isoish);
  const match = str.match(/(\d{2}:\d{2}:\d{2})(\.\d+)?/);
  if (!match) return str.slice(0, 19);
  return `${match[1]}${(match[2] || "").slice(0, 4)}`;
}

function tone(value) {
  const n = Number(value || 0);
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "flat";
}

/* ---------------- clipboard / files ---------------- */
async function copyText(text, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, "good");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(label, "good");
    } catch {
      toast("Clipboard blocked by the browser", "bad");
    }
    ta.remove();
  }
}

function toCsv(rows) {
  if (!rows || !rows.length) return "";
  const columns = Object.keys(rows[0]);
  const cell = (value) => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\n");
}

function downloadFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/* ---------------- toasts ---------------- */
const TOAST_ICONS = { good: "check_circle", bad: "error", warn: "warning", info: "info" };

function toast(title, kind = "info", subtitle = "") {
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.innerHTML = `
    <div class="toast__icon"><span class="ms">${TOAST_ICONS[kind] || "info"}</span></div>
    <div>
      <p class="toast__title">${escapeHtml(title)}</p>
      ${subtitle ? `<p class="toast__text">${escapeHtml(subtitle)}</p>` : ""}
    </div>`;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 220);
  }, 4200);
}

/* ---------------- modal ---------------- */
let modalResolve = null;

function confirmDialog({ title, body, confirmLabel = "Confirm", danger = true, checkLabel = "" }) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    $("modalTitle").textContent = title;
    $("modalBody").textContent = body;
    $("modalConfirm").textContent = confirmLabel;
    $("modalConfirm").className = `btn ${danger ? "btn--danger" : "btn--primary"}`;
    $("modalIcon").className = `modal__icon${danger ? "" : " modal__icon--info"}`;
    $("modalIcon").innerHTML = `<span class="ms">${danger ? "warning" : "help"}</span>`;
    const wrap = $("modalCheckWrap");
    wrap.hidden = !checkLabel;
    $("modalCheck").checked = false;
    $("modalCheckLabel").textContent = checkLabel || "";
    $("modalRoot").hidden = false;
    $("modalConfirm").focus();
  });
}

function closeModal(result) {
  $("modalRoot").hidden = true;
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

/* ---------------- drawers ---------------- */
function openDrawer(id) {
  $$(".drawer").forEach((d) => {
    d.classList.toggle("is-open", d.id === id);
    d.setAttribute("aria-hidden", d.id === id ? "false" : "true");
  });
  const isControls = id === "controlsDrawer";
  document.body.classList.toggle("drawer-open", isControls);
  document.body.classList.toggle("drawer-overlay", !isControls);
  $("scrim").hidden = isControls;
}

function closeDrawers() {
  $$(".drawer").forEach((d) => {
    d.classList.remove("is-open");
    d.setAttribute("aria-hidden", "true");
  });
  document.body.classList.remove("drawer-open", "drawer-overlay");
  $("scrim").hidden = true;
}

function anyDrawerOpen() {
  return $$(".drawer").some((d) => d.classList.contains("is-open"));
}

/* ---------------- api ---------------- */
function normalizedUrl() {
  return state.apiUrl.replace(/\/+$/, "");
}

async function api(path, options = {}) {
  const res = await fetch(`${normalizedUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Control-Token": state.token,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiQuery(sql, maxRows = 500) {
  const data = await api("/api/query", {
    method: "POST",
    body: JSON.stringify({ sql, max_rows: maxRows }),
  });
  return data.rows || [];
}

function persistConnection() {
  localStorage.setItem(LS.apiUrl, state.apiUrl);
  if (state.rememberToken) {
    localStorage.setItem(LS.token, state.token);
  } else {
    localStorage.removeItem(LS.token);
  }
  localStorage.setItem(LS.remember, state.rememberToken ? "1" : "0");
}

function syncConnectionInputs(from) {
  if (from !== "drawer") {
    $("apiUrl").value = state.apiUrl;
    $("apiToken").value = state.token;
  }
  if (from !== "settings") {
    $("setApiUrl").value = state.apiUrl;
    $("setApiToken").value = state.token;
    $("setRememberToken").checked = state.rememberToken;
  }
}

function readConnectionFrom(source) {
  const urlEl = source === "settings" ? $("setApiUrl") : $("apiUrl");
  const tokenEl = source === "settings" ? $("setApiToken") : $("apiToken");
  state.apiUrl = (urlEl.value || "").trim() || "http://127.0.0.1:8765";
  state.token = (tokenEl.value || "").trim();
  persistConnection();
  syncConnectionInputs(source);
}

/* ---------------- routing ---------------- */
const VIEWS = ["overview", "symbols", "trades", "predictions", "query", "logs", "settings"];

function switchView(view, { push = true } = {}) {
  if (!VIEWS.includes(view)) view = "overview";
  $$(".navlink").forEach((a) => {
    const on = a.dataset.view === view;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${view}`));
  localStorage.setItem(LS.view, view);
  if (push && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);

  if (view === "query") syncGutter();
  if (view === "overview") drawEquityChart();
  if (view === "trades" && !state.trades.length && state.connected) loadTrades();
  if (view === "predictions" && !state.predictions.length && state.connected) loadPredictions();
  if (view === "logs" && !state.logLines.length && state.connected) loadLogs();
}

/* ---------------- status pills ---------------- */
function setPill(id, kind, title) {
  const el = $(id);
  const dot = el.querySelector(".dot");
  dot.className = `dot dot--${kind}`;
  if (kind === "warn") dot.classList.add("dot--pulse");
  if (title) el.title = title;
}

function setRefreshIndicator() {
  const el = $("refreshState");
  const live = state.connected && state.refreshMs > 0;
  el.classList.toggle("is-live", live);
  $("refreshMs").value = String(state.refreshMs);
  $("setRefreshMs").value = String(state.refreshMs);
  el.title = state.connected ? `Auto-refresh: ${fmtInterval(state.refreshMs)}` : "Controller offline";
}

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  if (state.refreshMs > 0 && state.connected) {
    state.refreshTimer = setInterval(tick, state.refreshMs);
  }
  setRefreshIndicator();
}

function updateRefreshInterval(value, { notify = true } = {}) {
  state.refreshMs = Number(value || 0);
  localStorage.setItem(LS.refreshMs, String(state.refreshMs));
  scheduleRefresh();
  if (notify) toast(state.refreshMs ? `Polling every ${fmtInterval(state.refreshMs)}` : "Auto-refresh off", "info");
}

async function tick() {
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    await refreshStatus();
    if (state.autoLogs) await loadLogs({ quiet: true });
    if (state.autoPredictions && !state.predictionPaused) await loadPredictions({ quiet: true });
  } catch (err) {
    state.connected = false;
    setPill("apiPill", "bad", `API error: ${err.message}`);
    setRefreshIndicator();
  } finally {
    state.inFlight = false;
  }
}

/* =============================================================
   STATUS + OVERVIEW
   ============================================================= */
async function refreshStatus() {
  const data = await api("/api/status");
  state.status = data;
  state.symbols = data.symbols || {};
  state.runtimeSymbols = (data.runtime || {}).symbols || {};
  state.connected = true;

  const runtime = data.runtime || {};
  const proc = data.process || {};
  const metrics = data.metrics || {};

  setPill("apiPill", "good", "Controller API reachable");
  setPill("botPill", proc.running ? "good" : "", proc.running ? `Bot running (pid ${proc.pid})` : "Bot stopped");
  setPill("wsPill", runtime.ws_connected ? "good" : "warn", runtime.ws_connected
    ? `WebSocket connected, last message ${fmtAge(runtime.ws_last_message_age_seconds)} ago`
    : "WebSocket offline");

  const authorized = Boolean(runtime.deriv_authorized);
  const lastError = runtime.last_error || "";
  setPill("authPill", authorized ? "good" : (lastError ? "bad" : (proc.running ? "warn" : "")),
    authorized && runtime.deriv_loginid ? `Authorized as ${runtime.deriv_loginid}` : (lastError || "Authorization pending"));

  $("lastUpdated").textContent = clockOf(runtime.timestamp) || "--:--:--";
  $("controlsBtnIcon").textContent = proc.running ? "stop_circle" : "play_arrow";

  renderKpis(metrics, runtime, proc);
  renderRiskTiles(runtime);
  renderStrategyTable(metrics);
  renderModelValidation(runtime);
  renderSymbols();
  renderSymbolSelects();
  renderControlsDrawer(runtime, proc);
  setRefreshIndicator();

  await refreshPnlRange();
  await refreshEquity();
  const currentView = location.hash.slice(1) || localStorage.getItem(LS.view) || "overview";
  if (currentView === "trades") await loadTrades({ quiet: true, preservePage: true });
}

function kpiTile({ label, value, sub, kind = "", glow = false, meter = null, pair = false }) {
  return `
    <article class="kpi${kind ? ` kpi--${kind}` : ""}">
      ${glow ? '<div class="kpi__glow"></div>' : ""}
      <span class="kpi__label">${escapeHtml(label)}</span>
      <span class="kpi__value${pair ? " kpi__value--pair" : ""}">${value}</span>
      ${meter ? `<div class="meter"><div class="meter__fill meter__fill--${meter.kind}" style="width:${meter.pct}%"></div></div>` : ""}
      ${sub ? `<span class="kpi__sub">${escapeHtml(sub)}</span>` : ""}
    </article>`;
}

function renderKpis(metrics, runtime, proc) {
  const overall = metrics.overall || {};
  const totalPnl = Number(overall.pnl || 0);
  const sessionPnl = Number(runtime.session_pnl || 0);
  const running = Boolean(proc.running);

  $("kpiTiles").innerHTML = [
    kpiTile({
      label: "Bot Status",
      value: `<i class="dot dot--${running ? "good dot--pulse" : ""}"></i>${running ? "Running" : "Stopped"}`,
      sub: proc.pid ? `pid ${proc.pid}` : "no process",
      kind: running ? "pos" : "",
    }),
    kpiTile({ label: "Balance", value: fmtMoney(runtime.balance), sub: runtime.deriv_loginid || "not authorized" }),
    kpiTile({
      label: "Session PnL",
      value: fmtSignedMoney(sessionPnl),
      kind: sessionPnl > 0 ? "pos" : sessionPnl < 0 ? "neg" : "",
      sub: "since daily reset",
    }),
    kpiTile({
      label: "Total PnL",
      value: fmtSignedMoney(totalPnl),
      kind: totalPnl > 0 ? "pos" : totalPnl < 0 ? "neg" : "",
      glow: totalPnl > 0,
      sub: overall.last_trade ? `last ${overall.last_trade}` : "no trades yet",
    }),
    kpiTile({
      label: "Win Rate",
      value: fmtPct(overall.win_rate),
      kind: Number(overall.win_rate || 0) >= 50 ? "pos" : "neg",
      sub: `avg ${fmtSignedMoney(overall.avg_pnl || 0, 4)} / trade`,
    }),
    kpiTile({
      label: "Settled Trades",
      value: fmtInt(overall.trades || 0),
      sub: `${fmtInt(runtime.open_trades_total || 0)} active · avg stake ${fmtMoney(overall.avg_stake || 0)}`,
    }),
  ].join("");
}

function renderRiskTiles(runtime) {
  const loss = Number(runtime.current_daily_loss || 0);
  const limit = Number(runtime.daily_loss_limit || 0);
  const lossPct = limit > 0 ? Math.min(100, (loss / limit) * 100) : 0;
  const trades = Number(runtime.confirmed_trades_today || 0);
  const cap = Number(runtime.max_trades_per_day || 0);
  const capPct = cap > 0 ? Math.min(100, (trades / cap) * 100) : 0;
  const openTrades = Number(runtime.open_trades_total || 0);
  const openLimit = Number(runtime.max_open_trades_total || 0);

  const symbolRows = Object.values(state.runtimeSymbols || {});
  const enabled = symbolRows.filter((s) => s.enabled);
  const modelsReady = symbolRows.filter((s) => s.model_loaded).length;
  const training = symbolRows.filter((s) => s.model_training).length;
  const rejected = enabled.filter((s) => s.last_training_report?.accepted === false).length;

  $("riskTiles").innerHTML = [
    kpiTile({
      label: "Daily Risk",
      value: `${fmtMoney(loss)} / ${fmtMoney(limit)}`,
      pair: true,
      kind: lossPct >= 80 ? "neg" : lossPct >= 50 ? "warn" : "",
      meter: { pct: lossPct, kind: lossPct >= 80 ? "bad" : lossPct >= 50 ? "warn" : "good" },
      sub: limit > 0 ? `${lossPct.toFixed(0)}% of daily stop` : "no daily stop set",
    }),
    kpiTile({
      label: "Daily Trades",
      value: `${fmtInt(trades)} / ${cap > 0 ? fmtInt(cap) : "∞"}`,
      pair: true,
      meter: { pct: cap > 0 ? capPct : 0, kind: capPct >= 90 ? "warn" : "good" },
      sub: cap > 0 ? `${Math.max(0, cap - trades)} remaining today` : "no daily cap",
    }),
    kpiTile({
      label: "Exposure",
      value: `${fmtInt(openTrades)} / ${openLimit > 0 ? fmtInt(openLimit) : "∞"} open`,
      kind: openTrades > 0 ? "warn" : "",
      sub: `${fmtInt(runtime.pending_orders_total || 0)} pending · ${fmtInt(runtime.max_open_trades_per_symbol || 0)} per symbol`,
    }),
    kpiTile({
      label: "Warmup",
      value: runtime.warmup_active ? "Active" : "Off",
      kind: runtime.warmup_active ? "warn" : "",
      sub: runtime.warmup_active ? "no live orders while warming" : "trading window open",
    }),
    kpiTile({
      label: "WS Latency",
      value: fmtAge(runtime.ws_last_message_age_seconds),
      kind: Number(runtime.ws_last_message_age_seconds || 0) > 30 ? "warn" : "",
      sub: runtime.ws_last_message_type ? `last: ${runtime.ws_last_message_type}` : "no messages yet",
    }),
    kpiTile({
      label: "Execution",
      value: `${modelsReady} ML / ${enabled.length || symbolRows.length} rules`,
      kind: training > 0 ? "accent" : "",
      sub: training > 0 ? `${training} training now` : `${rejected} ML candidate${rejected === 1 ? "" : "s"} gated`,
    }),
  ].join("");
}

function renderStrategyTable(metrics) {
  const rows = metrics.by_strategy || [];
  if (!rows.length) {
    $("strategyTable").innerHTML = emptyState("No strategy attribution yet", "strategy");
    return;
  }
  const body = rows.map((row) => {
    const pnl = Number(row.pnl || 0);
    const win = Number(row.win_rate || 0);
    return `
      <tr>
        <td><span class="symcell"><i class="dot ${pnl > 0 ? "dot--good" : pnl < 0 ? "dot--bad" : ""}"></i>${escapeHtml(row.strategy)}</span></td>
        <td class="num">${fmtInt(row.trades)}</td>
        <td class="num ${tone(pnl) === "pos" ? "pos" : tone(pnl) === "neg" ? "neg" : ""}">${fmtSignedMoney(pnl)}</td>
        <td class="num ${win >= 50 ? "pos" : "neg"}">${fmtPct(win)}</td>
        <td class="num">${row.avg_pred_ev === null || row.avg_pred_ev === undefined
          ? "-"
          : `<span class="chip chip--info"><span class="ms" style="font-size:12px">model_training</span>${fmtPct(Number(row.avg_pred_ev) * 100)}</span>`}</td>
      </tr>`;
  }).join("");

  $("strategyTable").innerHTML = `
    <table>
      <thead><tr>
        <th>Strategy</th><th class="num">Trades</th><th class="num">Net PnL</th><th class="num">Win Rate</th><th class="num">Avg Pred EV</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function emptyState(text, icon = "inbox") {
  return `<div class="empty"><span class="ms">${icon}</span>${escapeHtml(text)}</div>`;
}

/* ---------------- PnL by symbol (range-aware) ---------------- */
const RANGE_SQL = {
  today: "and time >= strftime('%s', 'now', 'start of day') + 0",
  "24h": "and time >= strftime('%s', 'now', '-1 day') + 0",
  "7d": "and time >= strftime('%s', 'now', '-7 days') + 0",
  "30d": "and time >= strftime('%s', 'now', '-30 days') + 0",
  all: "",
};

async function refreshPnlRange() {
  try {
    if (state.pnlRange === "all") {
      state.pnlRows = (state.status?.metrics?.by_symbol || []).map((r) => ({
        symbol: r.symbol, pnl: Number(r.pnl || 0), trades: Number(r.trades || 0), win_rate: Number(r.win_rate || 0),
      }));
    } else {
      const sql = `select symbol, round(coalesce(sum(pnl), 0), 2) as pnl, count(*) as trades, `
        + `round(avg(case when outcome = 1 then 1.0 when outcome = 0 then 0.0 end) * 100, 2) as win_rate `
        + `from trades where 1 = 1 ${RANGE_SQL[state.pnlRange]} group by symbol order by pnl desc`;
      state.pnlRows = await apiQuery(sql, 50);
    }
  } catch (err) {
    state.pnlRows = [];
    if (state.pnlRange !== "all") toast(`PnL range failed: ${err.message}`, "bad");
  }
  renderPnlBars();
}

function renderPnlBars() {
  const configured = Object.values(state.symbols || {});
  const byName = new Map(state.pnlRows.map((r) => [r.symbol, r]));

  const merged = configured.map((cfg) => {
    const row = byName.get(cfg.symbol) || byName.get(cfg.api_name);
    return {
      symbol: cfg.symbol,
      display: cfg.display_name || cfg.symbol,
      pnl: Number(row?.pnl || 0),
      trades: Number(row?.trades || 0),
      win_rate: Number(row?.win_rate || 0),
    };
  });
  state.pnlRows.forEach((row) => {
    if (!merged.some((m) => m.symbol === row.symbol)) {
      merged.push({ symbol: row.symbol, display: row.symbol, pnl: Number(row.pnl || 0), trades: Number(row.trades || 0), win_rate: Number(row.win_rate || 0) });
    }
  });

  if (!merged.length) {
    $("pnlBars").innerHTML = emptyState("No symbols configured", "monitoring");
    return;
  }

  merged.sort((a, b) => b.pnl - a.pnl || b.trades - a.trades);
  const maxAbs = Math.max(0.01, ...merged.map((m) => Math.abs(m.pnl)));

  $("pnlBars").innerHTML = merged.map((m) => {
    const t = tone(m.pnl);
    const pct = m.pnl === 0 ? 2 : Math.max(4, (Math.abs(m.pnl) / maxAbs) * 100);
    return `
      <div class="pnlrow${m.trades === 0 ? " pnlrow--idle" : ""}">
        <div class="pnlrow__top">
          <span class="pnlrow__name">${escapeHtml(m.display)}</span>
          <span class="pnlrow__value pnlrow__value--${t}">${m.pnl === 0 ? fmtMoney(0) : fmtSignedMoney(m.pnl)}</span>
        </div>
        <div class="pnlrow__track"><div class="pnlrow__fill pnlrow__fill--${t}" style="width:${pct}%"></div></div>
        <div class="pnlrow__top" style="margin-top:4px;margin-bottom:0">
          <span class="pnlrow__meta">${fmtInt(m.trades)} trade${m.trades === 1 ? "" : "s"}</span>
          <span class="pnlrow__meta">${m.trades ? fmtPct(m.win_rate) : "--"}</span>
        </div>
      </div>`;
  }).join("");
}

/* ---------------- equity curve ---------------- */
async function refreshEquity() {
  try {
    const rows = await apiQuery("select time, pnl from trades order by time desc limit 1000", 1000);
    state.equity = rows.slice().reverse().map((r) => ({ time: Number(r.time), pnl: Number(r.pnl || 0) }));
  } catch {
    state.equity = [];
  }
  drawEquityChart();
}

function drawEquityChart() {
  const canvas = $("equityChart");
  if (!canvas || !canvas.clientWidth) return;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = Math.max(180, canvas.clientHeight || 220);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const cSecondary = styles.getPropertyValue("--secondary").trim() || "#44e092";
  const cError = styles.getPropertyValue("--error").trim() || "#ffb4ab";
  const cLine = styles.getPropertyValue("--border-subtle").trim() || "#2B2F36";
  const cText = styles.getPropertyValue("--text-secondary").trim() || "#9BA3AF";

  const pad = { l: 8, r: 8, t: 16, b: 16 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  if (state.equity.length < 1) {
    ctx.fillStyle = cText;
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No settled trades yet", width / 2, height / 2);
    $("equityDelta").textContent = "--";
    $("equityMeta").textContent = "no trades";
    return;
  }

  let running = 0;
  const points = state.equity.map((row) => (running += row.pnl));
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;
  const xAt = (i) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const yAt = (v) => pad.t + h - ((v - min) / span) * h;
  const last = points[points.length - 1];
  const positive = last >= 0;
  const color = positive ? cSecondary : cError;

  // zero baseline
  if (min < 0 && max > 0) {
    ctx.strokeStyle = cLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yAt(0));
    ctx.lineTo(width - pad.r, yAt(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // area fill
  const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  gradient.addColorStop(0, `${color}44`);
  gradient.addColorStop(1, `${color}00`);
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(points[0]));
  points.forEach((v, i) => ctx.lineTo(xAt(i), yAt(v)));
  ctx.lineTo(xAt(points.length - 1), pad.t + h);
  ctx.lineTo(xAt(0), pad.t + h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(points[0]));
  points.forEach((v, i) => ctx.lineTo(xAt(i), yAt(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  // last marker
  ctx.beginPath();
  ctx.arc(xAt(points.length - 1), yAt(last), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  const delta = $("equityDelta");
  delta.textContent = fmtSignedMoney(last);
  delta.className = `chip mono ${positive ? "chip--good" : "chip--bad"}`;
  const peak = Math.max(...points);
  const drawdown = peak > 0 ? peak - last : 0;
  $("equityMeta").textContent = `${points.length} trades · peak ${fmtSignedMoney(peak)} · dd ${fmtMoney(drawdown)}`;
}

/* ---------------- model validation ---------------- */
function modelGateLimits(runtime = {}) {
  return {
    minTrades: Number(runtime.model_gate_limits?.min_holdout_trades ?? 8),
    minEv: Number(runtime.model_gate_limits?.min_holdout_ev ?? 0),
    maxBrier: Number(runtime.model_gate_limits?.max_brier ?? 0.25),
    maxEce: Number(runtime.model_gate_limits?.max_ece ?? 0.15),
  };
}

function modelFailureReasons(report = {}, limits = modelGateLimits()) {
  if (Array.isArray(report.rejection_reasons) && report.rejection_reasons.length) {
    return report.rejection_reasons;
  }
  const reasons = [];
  const trades = Number(report.holdout_trades || 0);
  const ev = Number(report.holdout_ev_per_stake || 0);
  const brier = report.val_brier === null || report.val_brier === undefined ? Number.NaN : Number(report.val_brier);
  const ece = report.val_ece === null || report.val_ece === undefined ? Number.NaN : Number(report.val_ece);
  if (trades < limits.minTrades) reasons.push(`holdout ${trades}/${limits.minTrades} trades`);
  if (ev <= limits.minEv) reasons.push(`EV ${ev.toFixed(3)} ≤ ${limits.minEv.toFixed(3)}`);
  if (!Number.isFinite(brier) || brier > limits.maxBrier) reasons.push(`Brier ${Number.isFinite(brier) ? brier.toFixed(3) : "n/a"} > ${limits.maxBrier.toFixed(3)}`);
  if (!Number.isFinite(ece) || ece > limits.maxEce) reasons.push(`ECE ${Number.isFinite(ece) ? ece.toFixed(3) : "n/a"} > ${limits.maxEce.toFixed(3)}`);
  return reasons;
}

function renderModelValidation(runtime = {}) {
  const limits = modelGateLimits(runtime);
  state.modelReports = Object.entries(state.runtimeSymbols || {})
    .filter(([, rt]) => rt.enabled && rt.last_training_report)
    .map(([symbol, rt]) => ({ symbol, loaded: Boolean(rt.model_loaded), ...rt.last_training_report }));

  const accepted = state.modelReports.filter((r) => r.accepted || r.loaded).length;
  const rejected = state.modelReports.filter((r) => r.accepted === false && !r.loaded).length;
  const summary = $("modelGateSummary");
  summary.textContent = state.modelReports.length ? `${accepted} accepted · ${rejected} gated` : "no reports";
  summary.className = `chip mono ${accepted ? "chip--good" : rejected ? "chip--warn" : "chip--muted"}`;

  $("modelValidationSummary").innerHTML = state.modelReports.length
    ? state.modelReports.map((report) => {
      const reasons = modelFailureReasons(report, limits);
      const passed = Boolean(report.accepted || report.loaded);
      const detail = passed
        ? `Accepted · ${fmtInt(report.holdout_trades)} holdout trades · EV ${fmtNum(report.holdout_ev_per_stake, 3)}`
        : `Rules active · ${reasons.slice(0, 2).join(" · ") || "candidate did not pass"}`;
      return `<button class="model-row" type="button" data-model-symbol="${escapeHtml(report.symbol)}">
        <span class="model-row__symbol"><i class="dot dot--${passed ? "good" : "warn"}"></i>${escapeHtml(report.symbol)}</span>
        <span class="model-row__detail">${escapeHtml(detail)}</span>
        <span class="chip chip--${passed ? "good" : "warn"}">${passed ? "ML accepted" : "ML gated"}</span>
      </button>`;
    }).join("")
    : emptyState("No model validation reports yet", "model_training");
  drawModelQualityChart(limits);
}

function drawModelQualityChart(limits = modelGateLimits()) {
  const canvas = $("modelQualityChart");
  if (!canvas || !canvas.clientWidth) return;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = Math.max(190, canvas.clientHeight || 230);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const brierColor = styles.getPropertyValue("--primary").trim() || "#c2c1ff";
  const eceColor = styles.getPropertyValue("--status-warning").trim() || "#ffb000";
  const lineColor = styles.getPropertyValue("--border-subtle").trim() || "#2b2f36";
  const textColor = styles.getPropertyValue("--text-secondary").trim() || "#9ba3af";
  const reports = state.modelReports;
  if (!reports.length) {
    ctx.fillStyle = textColor;
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Validation data will appear after training", width / 2, height / 2);
    return;
  }

  const pad = { l: 34, r: 12, t: 18, b: 34 };
  const chartW = width - pad.l - pad.r;
  const chartH = height - pad.t - pad.b;
  const values = reports.flatMap((r) => [Number(r.val_brier || 0), Number(r.val_ece || 0)]);
  const maxValue = Math.max(0.35, ...values, limits.maxBrier, limits.maxEce);
  const yAt = (v) => pad.t + chartH - (Math.max(0, v) / maxValue) * chartH;

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  [0, maxValue / 2, maxValue].forEach((value) => {
    const y = yAt(value);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
    ctx.fillStyle = textColor; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right";
    ctx.fillText(value.toFixed(2), pad.l - 5, y + 3);
  });

  const groupW = chartW / reports.length;
  const barW = Math.min(18, Math.max(7, groupW * 0.22));
  reports.forEach((report, index) => {
    const center = pad.l + groupW * index + groupW / 2;
    [[Number(report.val_brier || 0), brierColor, -barW - 2], [Number(report.val_ece || 0), eceColor, 2]].forEach(([value, color, offset]) => {
      const y = yAt(value);
      ctx.fillStyle = color;
      ctx.fillRect(center + offset, y, barW, pad.t + chartH - y);
    });
    ctx.fillStyle = textColor; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
    ctx.fillText(report.symbol.replace("R_", "R"), center, height - 10);
  });
}

/* =============================================================
   SYMBOLS
   ============================================================= */
const SYMBOL_FIELDS = [
  { field: "duration_minutes", min: 1, step: 1 },
  { field: "granularity_seconds", min: 1, step: 1 },
  { field: "candle_count_for_history", min: 250, step: 50, wide: true },
  { field: "trade_amount", min: 0.35, step: 0.01 },
  { field: "min_expected_value", min: null, step: 0.001 },
];

function symbolStatus(rt) {
  if (!rt) return { text: "No runtime data", kind: "muted" };
  if (rt.model_training) return { text: "Training model", kind: "info" };
  if (rt.model_loaded) return { text: "Model accepted", kind: "good" };
  const report = rt.last_training_report || {};
  if (report.accepted === false) {
    const reason = modelFailureReasons(report, modelGateLimits(state.status?.runtime || {}))[0] || "candidate did not pass validation";
    return { text: "ML gated", kind: "warn", detail: `Rules active · ${reason}` };
  }
  return { text: "Rules only", kind: "muted" };
}

function dirtyCount() {
  return Object.values(state.symbolDirty).reduce((sum, patch) => sum + Object.keys(patch).length, 0);
}

function markDirty(symbol, field, value, original) {
  const same = typeof value === "boolean" ? value === Boolean(original) : Number(value) === Number(original);
  if (!state.symbolDirty[symbol]) state.symbolDirty[symbol] = {};
  if (same) delete state.symbolDirty[symbol][field];
  else state.symbolDirty[symbol][field] = value;
  if (!Object.keys(state.symbolDirty[symbol]).length) delete state.symbolDirty[symbol];
  updateSaveBar();
}

function updateSaveBar() {
  const count = dirtyCount();
  $("symbolsSaveBar").hidden = count === 0;
  $("symbolsDirtyCount").textContent = `${count} Unsaved Change${count === 1 ? "" : "s"}`;
}

function renderSymbols() {
  const all = Object.values(state.symbols || {});
  const needle = state.symbolFilter.trim().toLowerCase();
  const rows = all.filter((cfg) => {
    if (state.symbolsEnabledOnly && !cfg.enable_trading) return false;
    if (!needle) return true;
    return `${cfg.symbol} ${cfg.display_name}`.toLowerCase().includes(needle);
  });

  if (!rows.length) {
    $("symbolRows").innerHTML = `<tr><td colspan="11">${emptyState(all.length ? "No symbols match this filter" : "No symbols configured in SYMBOLS_CONFIG_JSON", "monitoring")}</td></tr>`;
    return;
  }

  $("symbolRows").innerHTML = rows.map((cfg) => {
    const rt = state.runtimeSymbols[cfg.symbol] || state.runtimeSymbols[cfg.api_name] || null;
    const dirty = state.symbolDirty[cfg.symbol] || {};
    const enabled = "enable_trading" in dirty ? dirty.enable_trading : cfg.enable_trading;
    const status = symbolStatus(rt);
    const running = Boolean(rt && rt.enabled && state.status?.process?.running);
    const dot = running ? "dot--good" : rt && rt.enabled ? "dot--warn" : "";
    const threshold = rt && rt.threshold !== null && rt.threshold !== undefined ? fmtNum(rt.threshold, 3) : "--";
    const sym = escapeHtml(cfg.symbol);

    const inputs = SYMBOL_FIELDS.map(({ field, min, step, wide }) => {
      const value = field in dirty ? dirty[field] : cfg[field];
      return `<td class="num"><input class="cellinput${wide ? " cellinput--wide" : ""}${field in dirty ? " is-dirty" : ""}"
        type="number" data-symbol="${sym}" data-field="${field}"
        ${min !== null ? `min="${min}"` : ""} step="${step}" value="${escapeHtml(value ?? 0)}" ${enabled ? "" : "disabled"}></td>`;
    }).join("");

    return `
      <tr data-symbol-row="${sym}" class="${enabled ? "" : "is-off"}">
        <td class="col-run">
          <label class="switch">
            <input type="checkbox" data-symbol="${sym}" data-field="enable_trading" ${enabled ? "checked" : ""}>
            <span class="switch__track"></span>
          </label>
        </td>
        <td>
          <span class="symcell">
            <i class="dot ${dot}"></i>
            <span class="symcell__text">
              <span class="symcell__name">${escapeHtml(cfg.display_name || cfg.symbol)}</span>
              <span class="symcell__code">${sym}</span>
            </span>
          </span>
        </td>
        <td><span class="chip chip--${status.kind}" title="${escapeHtml(status.detail || status.text)}">${escapeHtml(status.text)}</span>
          <div class="symcell__code symbol-status-detail">${escapeHtml(status.detail || `${fmtInt(rt?.buffer_candles || 0)} candles`)}</div></td>
        ${inputs}
        <td class="num">${fmtInt(rt?.trade_count || 0)}</td>
        <td class="num">${threshold}</td>
        <td class="col-more"><button class="iconbtn" data-symbol-detail="${sym}" title="Symbol details"><span class="ms">chevron_right</span></button></td>
      </tr>`;
  }).join("");

  updateSaveBar();
}

function renderSymbolSelects() {
  const names = Object.keys(state.symbols || {});
  const options = `<option value="">All symbols</option>${names.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}`;
  ["tradeSymbol", "predictionSymbol"].forEach((id) => {
    const el = $(id);
    const current = el.value;
    el.innerHTML = options;
    if (current && names.includes(current)) el.value = current;
  });
}

function renderModelReport(report) {
  if (!report) return '<div class="empty"><span class="ms">model_training</span>No training report recorded</div>';
  const limits = modelGateLimits(state.status?.runtime || {});
  const reasons = modelFailureReasons(report, limits);
  const accepted = Boolean(report.accepted);
  return `
    <div class="validation-status validation-status--${accepted ? "good" : "warn"}">
      <span class="ms">${accepted ? "verified" : "shield"}</span>
      <div>
        <strong>${accepted ? "Candidate accepted" : "Candidate safely gated"}</strong>
        <span>${accepted ? "Eligible for ML execution when enabled" : "Rule strategies remain active while ML stays out of execution"}</span>
      </div>
    </div>
    <div class="kv-grid">
      <div class="kv"><span class="kv__label">Accuracy</span><span class="kv__value">${fmtPct(Number(report.val_accuracy) * 100)}</span></div>
      <div class="kv"><span class="kv__label">Brier</span><span class="kv__value">${report.val_brier != null ? fmtNum(report.val_brier, 4) : "--"}</span></div>
      <div class="kv"><span class="kv__label">ECE</span><span class="kv__value">${report.val_ece != null ? fmtNum(report.val_ece, 4) : "--"}</span></div>
      <div class="kv"><span class="kv__label">Holdout trades</span><span class="kv__value">${fmtInt(report.holdout_trades || 0)}</span></div>
      <div class="kv"><span class="kv__label">Holdout EV/stake</span><span class="kv__value">${fmtNum(report.holdout_ev_per_stake, 4)}</span></div>
      <div class="kv"><span class="kv__label">Calibration</span><span class="kv__value">${escapeHtml(report.calibration_method || "none")}</span></div>
    </div>
    ${reasons.length ? `<div class="validation-reasons"><span>Failed gates</span>${reasons.map((reason) => `<div><i class="dot dot--warn"></i>${escapeHtml(reason)}</div>`).join("")}</div>` : ""}
    <details class="report-raw">
      <summary>Raw validation report</summary>
      <pre class="codeblock">${escapeHtml(JSON.stringify(report, null, 2))}</pre>
    </details>`;
}

async function saveSymbols() {
  const updates = state.symbolDirty;
  const count = dirtyCount();
  if (!count) return;
  try {
    const data = await api("/api/config", { method: "POST", body: JSON.stringify({ symbols: updates }) });
    state.symbols = data.symbols || state.symbols;
    state.symbolDirty = {};
    renderSymbols();
    toast(`Saved ${data.changed?.length || count} field${(data.changed?.length || count) === 1 ? "" : "s"}`, "good", "Restart the bot to apply structural changes");
  } catch (err) {
    toast(err.message, "bad", "Save failed");
  }
}

/* ---------------- symbol detail drawer ---------------- */
const ADVANCED_FIELDS = [
  { field: "retrain_interval_trades", label: "Retrain every N trades", min: 1, step: 1 },
  { field: "min_samples_for_retrain", label: "Min samples for retrain", min: 1, step: 1 },
  { field: "payout_rate", label: "Payout rate", min: 0, step: 0.01 },
  { field: "max_stake", label: "Max stake ($)", min: 0, step: 0.01 },
];

async function openSymbolDetail(symbol) {
  const cfg = state.symbols[symbol];
  if (!cfg) return;
  state.activeSymbol = symbol;
  const rt = state.runtimeSymbols[symbol] || state.runtimeSymbols[cfg.api_name] || {};
  const status = symbolStatus(rt);

  $("symbolDrawerHead").innerHTML = `
    <div class="detail-hero__left">
      <i class="dot ${rt.enabled ? "dot--good" : ""}"></i>
      <div>
        <h2 class="drawer__title">${escapeHtml(cfg.display_name || symbol)}</h2>
        <p class="drawer__sub">${escapeHtml(symbol)}</p>
      </div>
    </div>
    <button class="iconbtn" data-close-drawer type="button"><span class="ms">close</span></button>`;

  $("symbolDrawerBody").innerHTML = `
    <section>
      <h3 class="section-title">Performance (24h)</h3>
      <div class="kv-grid" id="symbolPerf">
        <div class="kv"><span class="kv__label">Loading</span><span class="kv__value">--</span></div>
      </div>
    </section>
    <section>
      <h3 class="section-title">Runtime</h3>
      <div class="kv-grid">
        <div class="kv"><span class="kv__label">Status</span><span class="kv__value">${escapeHtml(status.text)}</span></div>
        <div class="kv"><span class="kv__label">Threshold</span><span class="kv__value">${rt.threshold != null ? fmtNum(rt.threshold, 4) : "--"}</span></div>
        <div class="kv"><span class="kv__label">Buffer</span><span class="kv__value">${fmtInt(rt.buffer_candles || 0)}</span></div>
        <div class="kv"><span class="kv__label">Open trades</span><span class="kv__value">${fmtInt(rt.open_trades || 0)}</span></div>
        <div class="kv"><span class="kv__label">Learned trades</span><span class="kv__value">${fmtInt(rt.trade_count || 0)}</span></div>
        <div class="kv"><span class="kv__label">Scaler</span><span class="kv__value">${rt.scaler_loaded ? "loaded" : "none"}</span></div>
      </div>
    </section>
    <section>
      <h3 class="section-title">Advanced config</h3>
      <div class="form">
        ${ADVANCED_FIELDS.map(({ field, label, min, step }) => `
          <label class="field">
            <span class="field__label">${escapeHtml(label)}</span>
            <input type="number" min="${min}" step="${step}" data-advanced="${field}" value="${escapeHtml(cfg[field] ?? 0)}">
          </label>`).join("")}
      </div>
    </section>
    <section>
      <h3 class="section-title">Last ML validation</h3>
      ${renderModelReport(rt.last_training_report)}
    </section>
    <section>
      <h3 class="section-title">Recent trades</h3>
      <div class="linelist" id="symbolRecent"><div class="lineitem">Loading...</div></div>
    </section>`;

  openDrawer("symbolDrawer");

  try {
    const perf = await apiQuery(
      `select count(*) as trades, round(coalesce(sum(pnl), 0), 2) as pnl, `
      + `round(avg(case when outcome = 1 then 1.0 when outcome = 0 then 0.0 end) * 100, 2) as win_rate, `
      + `round(avg(expected_value), 4) as avg_ev `
      + `from trades where symbol = ${sqlString(cfg.api_name || symbol)} and time >= strftime('%s', 'now', '-1 day') + 0`, 1);
    const row = perf[0] || {};
    const pnl = Number(row.pnl || 0);
    $("symbolPerf").innerHTML = `
      <div class="kv"><span class="kv__label">Trades</span><span class="kv__value">${fmtInt(row.trades || 0)}</span></div>
      <div class="kv"><span class="kv__label">Win rate</span><span class="kv__value">${row.trades ? fmtPct(row.win_rate) : "--"}</span></div>
      <div class="kv"><span class="kv__label">PnL</span><span class="kv__value kv__value--${tone(pnl) === "pos" ? "pos" : tone(pnl) === "neg" ? "neg" : ""}">${fmtSignedMoney(pnl)}</span></div>
      <div class="kv"><span class="kv__label">Avg pred EV</span><span class="kv__value kv__value--accent">${row.avg_ev != null ? fmtNum(row.avg_ev, 4) : "--"}</span></div>`;

    const recent = await apiQuery(
      `select datetime(time, 'unixepoch') as t, contract_type, pnl from trades `
      + `where symbol = ${sqlString(cfg.api_name || symbol)} order by time desc limit 6`, 6);
    $("symbolRecent").innerHTML = recent.length
      ? recent.map((r) => `
        <div class="lineitem">
          <span>${escapeHtml(r.contract_type || "?")} <span class="muted">${escapeHtml(r.t || "")}</span></span>
          <span class="lineitem__value ${Number(r.pnl) >= 0 ? "kv__value--pos" : "kv__value--neg"}">${fmtSignedMoney(r.pnl, 4)}</span>
        </div>`).join("")
      : '<div class="lineitem">No trades recorded</div>';
  } catch (err) {
    $("symbolPerf").innerHTML = `<div class="kv kv--wide"><span class="kv__label">Error</span><span class="kv__value">${escapeHtml(err.message)}</span></div>`;
    $("symbolRecent").innerHTML = "";
  }
}

async function applySymbolAdvanced() {
  const symbol = state.activeSymbol;
  if (!symbol) return;
  const patch = {};
  $$("[data-advanced]", $("symbolDrawerBody")).forEach((input) => {
    patch[input.dataset.advanced] = Number(input.value);
  });
  try {
    const data = await api("/api/config", { method: "POST", body: JSON.stringify({ symbols: { [symbol]: patch } }) });
    state.symbols = data.symbols || state.symbols;
    renderSymbols();
    toast(`Updated ${symbol}`, "good", `${data.changed?.length || 0} field(s) written to .env`);
    closeDrawers();
  } catch (err) {
    toast(err.message, "bad", "Update failed");
  }
}

/* =============================================================
   TRADES
   ============================================================= */
async function loadTrades({ quiet = false, preservePage = false } = {}) {
  try {
    const symbol = $("tradeSymbol").value;
    const suffix = symbol ? `?symbol=${encodeURIComponent(symbol)}&limit=500` : "?limit=500";
    const data = await api(`/api/trades${suffix}`);
    const active = data.active_trades || [];
    const activeIds = new Set(active.map((trade) => String(trade.contract_id)));
    const settled = (data.trades || []).filter((trade) => !activeIds.has(String(trade.contract_id)));
    state.trades = [...active, ...settled];
    if (!preservePage) state.tradePage = 1;
    renderTradeMetrics();
    renderTrades();
    if (!quiet) toast(`Loaded ${state.trades.length} contract${state.trades.length === 1 ? "" : "s"}`, "good", `${active.length} active · ${settled.length} settled`);
  } catch (err) {
    if (!quiet) toast(err.message, "bad", "Trade load failed");
  }
}

function filteredTrades() {
  const needle = $("tradeSearch").value.trim().toLowerCase();
  const type = $("tradeType").value;
  const outcome = $("tradeOutcome").value;

  let rows = state.trades.filter((t) => {
    if (type && String(t.contract_type || "").toUpperCase() !== type) return false;
    if (outcome === "won" && Number(t.outcome) !== 1) return false;
    if (outcome === "lost" && Number(t.outcome) !== 0) return false;
    if (outcome === "open" && t.outcome !== null && t.outcome !== undefined) return false;
    if (!needle) return true;
    return `${t.symbol} ${t.contract_id} ${t.strategy_source}`.toLowerCase().includes(needle);
  });
  rows = rows.slice().sort((a, b) => {
    const cmp = String(a.time || "").localeCompare(String(b.time || ""));
    return state.tradeSort === "desc" ? -cmp : cmp;
  });
  return rows;
}

function renderTradeMetrics() {
  const rows = state.trades;
  const settled = rows.filter((t) => t.outcome === 0 || t.outcome === 1);
  const active = rows.filter((t) => t.outcome === null || t.outcome === undefined);
  const wins = settled.filter((t) => Number(t.outcome) === 1).length;
  const pnl = settled.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const strategies = new Set(rows.map((t) => t.strategy_source).filter(Boolean));

  $("tradeMetrics").innerHTML = [
    kpiTile({ label: "Contracts Loaded", value: fmtInt(rows.length), sub: `${settled.length} settled · ${active.length} active` }),
    kpiTile({
      label: "Win Rate",
      value: settled.length ? fmtPct((wins / settled.length) * 100) : "--",
      kind: settled.length && wins / settled.length >= 0.5 ? "pos" : settled.length ? "neg" : "",
      sub: `${wins}W / ${settled.length - wins}L`,
    }),
    kpiTile({
      label: "Settled PnL",
      value: fmtSignedMoney(pnl),
      kind: pnl > 0 ? "pos" : pnl < 0 ? "neg" : "",
      sub: settled.length ? `avg ${fmtSignedMoney(pnl / settled.length, 4)}` : "no settled trades",
    }),
    kpiTile({
      label: "Strategies",
      value: fmtInt(strategies.size),
      kind: "accent",
      sub: Array.from(strategies).slice(0, 3).join(", ") || "none",
    }),
  ].join("");
}

function renderTrades() {
  const rows = filteredTrades();
  const size = state.pageSize;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  state.tradePage = Math.min(state.tradePage, pages);
  const start = (state.tradePage - 1) * size;
  const page = rows.slice(start, start + size);

  $("tradesList").innerHTML = page.length ? page.map((t) => {
    const pnl = Number(t.pnl || 0);
    const settled = t.outcome === 0 || t.outcome === 1;
    const won = Number(t.outcome) === 1;
    const dir = String(t.contract_type || "").toUpperCase().includes("PUT") ? "put" : "call";
    const conf = Number(t.confidence_at_trade);
    const prob = Number(t.probability_used);
    const ev = Number(t.expected_value);
    const id = escapeHtml(t.contract_id || "");
    return `
      <div class="rowgrid traderow" data-trade-id="${id}">
        <div class="traderow__stack">
          <span class="traderow__primary">${escapeHtml(t.time || "")}</span>
          <span class="traderow__secondary"><i class="dot ${settled ? (won ? "dot--good" : "dot--bad") : "dot--warn"}"></i>${settled ? "Settled" : "Open"}</span>
        </div>
        <div class="traderow__stack">
          <span class="traderow__secondary" style="gap:8px">
            <span class="traderow__badge">${escapeHtml(String(t.symbol || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase())}</span>
            <span class="traderow__primary">${escapeHtml(t.symbol || "")}</span>
          </span>
          <span class="traderow__secondary">${escapeHtml(t.strategy_source || "unattributed")}</span>
        </div>
        <div class="traderow__stack">
          <span class="traderow__dir traderow__dir--${dir}">
            <span class="ms">${dir === "put" ? "trending_down" : "trending_up"}</span>${escapeHtml(t.contract_type || "?")}
          </span>
          <span class="traderow__secondary mono">${fmtMoney(t.buy_price)}</span>
        </div>
        <div class="traderow__stack">
          <span class="traderow__conf">
            <span class="meter"><span class="meter__fill" style="width:${Number.isFinite(conf) ? Math.min(100, conf * 100).toFixed(0) : 0}%"></span></span>
            <span class="traderow__primary">${Number.isFinite(conf) ? `${(conf * 100).toFixed(0)}%` : "--"}</span>
          </span>
          <span class="traderow__secondary mono">Pr ${Number.isFinite(prob) ? `${(prob * 100).toFixed(1)}%` : "--"} · EV ${Number.isFinite(ev) ? ev.toFixed(2) : "--"}</span>
        </div>
        <div class="traderow__stack traderow__stack--end">
          <span class="traderow__pnl traderow__pnl--${pnl >= 0 ? "pos" : "neg"}">${fmtSignedMoney(pnl, 4)}</span>
          ${settled ? "" : '<span class="traderow__secondary">live PnL</span>'}
          <span class="tag tag--${settled ? (won ? "won" : "lost") : "open"}">${settled ? (won ? "Won" : "Lost") : "Open"}</span>
        </div>
        <div class="traderow__stack traderow__stack--end">
          <span class="traderow__secondary mono">${id || "--"}</span>
        </div>
        <div class="traderow__actions">
          <button class="iconbtn" data-copy="${id}" title="Copy contract ID"><span class="ms">content_copy</span></button>
          <span class="ms" style="color:var(--text-secondary);font-size:20px">chevron_right</span>
        </div>
      </div>`;
  }).join("") : emptyState(state.trades.length ? "No trades match these filters" : "No trades loaded yet", "swap_horiz");

  $("tradesCount").textContent = rows.length
    ? `Showing ${start + 1}-${Math.min(start + size, rows.length)} of ${fmtInt(rows.length)}${rows.length !== state.trades.length ? ` (filtered from ${fmtInt(state.trades.length)})` : ""}`
    : "No trades to show";
  renderPager("tradesPager", pages, state.tradePage, (p) => {
    state.tradePage = p;
    renderTrades();
    $("tradesList").scrollTop = 0;
  });
}

function renderPager(containerId, pages, current, onGo) {
  const el = $(containerId);
  if (pages <= 1) {
    el.innerHTML = "";
    return;
  }
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - current) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  el.innerHTML = `
    <button class="pagebtn" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}><span class="ms" style="font-size:18px">chevron_left</span></button>
    ${nums.map((n) => n === "…"
      ? '<span class="pagebtn" style="cursor:default">…</span>'
      : `<button class="pagebtn${n === current ? " is-active" : ""}" data-page="${n}">${n}</button>`).join("")}
    <button class="pagebtn" data-page="${current + 1}" ${current === pages ? "disabled" : ""}><span class="ms" style="font-size:18px">chevron_right</span></button>`;
  $$("[data-page]", el).forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.page);
      if (p >= 1 && p <= pages) onGo(p);
    });
  });
}

async function openTradeDetail(contractId) {
  const listRow = state.trades.find((t) => String(t.contract_id) === String(contractId));
  openDrawer("tradeDrawer");
  $("tradeDrawerBody").innerHTML = '<div class="empty">Loading trade...</div>';

  let full = listRow || {};
  try {
    if (contractId) {
      const rows = await apiQuery(`select * from trades where contract_id = ${sqlString(contractId)} limit 1`, 1);
      if (rows.length) full = { ...listRow, ...rows[0] };
    }
  } catch {
    /* fall back to the list row */
  }

  const pnl = Number(full.pnl || 0);
  const settled = full.outcome === 0 || full.outcome === 1;
  const won = Number(full.outcome) === 1;
  const dir = String(full.contract_type || "").toUpperCase().includes("PUT") ? "put" : "call";
  const conf = Number(full.confidence_at_trade);
  const threshold = Number(full.conf_threshold_used);
  const epochToText = (v) => new Date(Number(v) * 1000).toISOString().slice(0, 19).replace("T", " ");
  const time = typeof full.time === "number"
    ? epochToText(full.time)
    : (full.time || (full.date_start ? epochToText(full.date_start) : ""));

  $("tradeDrawerBody").innerHTML = `
    <div class="detail-hero">
      <div class="detail-hero__left">
        <div class="detail-hero__badge">${escapeHtml(String(full.symbol || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase())}</div>
        <div>
          <div class="detail-hero__name">${escapeHtml(full.symbol || "Unknown")}</div>
          <div class="detail-hero__meta">${escapeHtml(full.strategy_source || "unattributed")}</div>
        </div>
      </div>
      <div class="detail-hero__right">
        <span class="chip chip--${dir === "put" ? "bad" : "good"}">${escapeHtml(full.contract_type || "?")}</span>
        <span class="traderow__secondary mono">${escapeHtml(full.contract_id || "no id")}</span>
      </div>
    </div>

    <div class="kv-grid">
      <div class="kv"><span class="kv__label">Time</span><span class="kv__value">${escapeHtml(time || "--")}</span></div>
      <div class="kv"><span class="kv__label">Outcome</span><span class="kv__value kv__value--${settled ? (won ? "pos" : "neg") : ""}">${settled ? (won ? "Won (1)" : "Lost (0)") : "Open"}</span></div>
      <div class="kv"><span class="kv__label">Buy price</span><span class="kv__value">${fmtMoney(full.buy_price)}</span></div>
      <div class="kv"><span class="kv__label">Sell price</span><span class="kv__value">${full.sell_price != null ? fmtMoney(full.sell_price) : "--"}</span></div>
      <div class="kv kv--wide"><span class="kv__label">Net PnL</span><span class="kv__value kv__value--${pnl >= 0 ? "pos" : "neg"}" style="font-size:20px">${fmtSignedMoney(pnl, 4)}</span></div>
      <div class="kv"><span class="kv__label">Entry spot</span><span class="kv__value">${full.entry_spot != null ? fmtNum(full.entry_spot, 4) : "--"}</span></div>
      <div class="kv"><span class="kv__label">Exit tick</span><span class="kv__value">${full.exit_tick != null ? fmtNum(full.exit_tick, 4) : "--"}</span></div>
      <div class="kv"><span class="kv__label">Probability</span><span class="kv__value">${full.probability_used != null ? fmtNum(full.probability_used, 4) : "--"}</span></div>
      <div class="kv"><span class="kv__label">Expected value</span><span class="kv__value kv__value--accent">${full.expected_value != null ? fmtNum(full.expected_value, 4) : "--"}</span></div>
      <div class="kv"><span class="kv__label">Payout rate</span><span class="kv__value">${full.payout_rate_used != null ? fmtNum(full.payout_rate_used, 3) : "--"}</span></div>
      ${!settled ? `<div class="kv"><span class="kv__label">Expires</span><span class="kv__value">${full.expiry_time ? escapeHtml(epochToText(full.expiry_time)) : "--"}</span></div>` : ""}
      <div class="kv"><span class="kv__label">Regime</span><span class="kv__value">${escapeHtml(full.market_regime_at_trade || "--")}</span></div>
    </div>

    ${Number.isFinite(conf) ? `
    <section>
      <h3 class="section-title">Confidence vs threshold</h3>
      <div class="confbar">
        <div class="confbar__head">
          <span class="confbar__label">Confidence at trade</span>
          <div>
            <div class="confbar__value" style="color:var(--${Number.isFinite(threshold) && conf >= threshold ? "secondary" : "status-warning"})">${(conf * 100).toFixed(1)}%</div>
            <div class="confbar__req">Required ${Number.isFinite(threshold) ? `${(threshold * 100).toFixed(1)}%` : "n/a"}</div>
          </div>
        </div>
        <div class="confbar__track">
          <div class="confbar__fill confbar__fill--${Number.isFinite(threshold) && conf >= threshold ? "pass" : "fail"}" style="width:${Math.min(100, conf * 100).toFixed(1)}%"></div>
          ${Number.isFinite(threshold) ? `<div class="confbar__marker" style="left:${Math.min(100, threshold * 100).toFixed(1)}%"></div>` : ""}
        </div>
        <div class="confbar__scale">
          <span>0%</span>
          ${Number.isFinite(threshold) ? `<strong>Threshold ${threshold.toFixed(4)}</strong>` : "<span></span>"}
          <span>100%</span>
        </div>
      </div>
    </section>` : ""}

    <section>
      <h3 class="section-title">Indicators at entry</h3>
      <div class="kv-grid">
        <div class="kv"><span class="kv__label">RSI</span><span class="kv__value">${full.rsi_at_trade != null ? fmtNum(full.rsi_at_trade, 2) : "--"}</span></div>
        <div class="kv"><span class="kv__label">MACD hist</span><span class="kv__value">${full.macd_hist_at_trade != null ? fmtNum(full.macd_hist_at_trade, 5) : "--"}</span></div>
        <div class="kv"><span class="kv__label">Return 5</span><span class="kv__value">${full.return_5_at_trade != null ? fmtNum(full.return_5_at_trade, 5) : "--"}</span></div>
        <div class="kv"><span class="kv__label">ATR</span><span class="kv__value">${full.atr_at_trade != null ? fmtNum(full.atr_at_trade, 5) : "--"}</span></div>
      </div>
    </section>

    <section>
      <h3 class="section-title">Raw record</h3>
      <pre class="codeblock">${escapeHtml(JSON.stringify(full, null, 2))}</pre>
      <div class="form__row" style="margin-top:12px">
        <button class="btn btn--surface" data-copy-json="1"><span class="ms">content_copy</span>Copy JSON</button>
        ${full.contract_id ? `<button class="btn btn--surface" data-copy="${escapeHtml(full.contract_id)}"><span class="ms">tag</span>Copy ID</button>` : ""}
      </div>
    </section>`;

  const jsonBtn = $("tradeDrawerBody").querySelector("[data-copy-json]");
  if (jsonBtn) jsonBtn.addEventListener("click", () => copyText(JSON.stringify(full, null, 2), "Trade JSON copied"));
}

/* =============================================================
   PREDICTIONS
   ============================================================= */
function isTriggered(row) {
  const outcome = String(row.filter_stage_outcome || "").toLowerCase();
  return outcome.includes("pass") || outcome.includes("trade") || outcome.includes("trigger") || outcome.includes("executed");
}

async function loadPredictions({ quiet = false } = {}) {
  try {
    const symbol = $("predictionSymbol").value;
    const suffix = symbol ? `?symbol=${encodeURIComponent(symbol)}&limit=500` : "?limit=500";
    const data = await api(`/api/predictions${suffix}`);
    state.predictions = data.predictions || [];
    if (!state.predictionSelected && state.predictions.length) {
      state.predictionSelected = 0;
    }
    renderPredictionMetrics();
    renderPredictionStream();
    renderBlockReasons();
    renderPredictionDetail();
    if (!quiet) toast(`Loaded ${state.predictions.length} attempt${state.predictions.length === 1 ? "" : "s"}`, "good");
  } catch (err) {
    if (!quiet) toast(err.message, "bad", "Prediction load failed");
  }
}

function visiblePredictions() {
  const outcome = $("predictionOutcome").value;
  return state.predictions.filter((row) => {
    if (outcome === "triggered") return isTriggered(row);
    if (outcome === "blocked") return !isTriggered(row);
    return true;
  });
}

function renderPredictionMetrics() {
  const rows = state.predictions;
  const triggered = rows.filter(isTriggered).length;
  const blocked = rows.length - triggered;
  const confidences = rows.map((r) => Number(r.model_confidence)).filter(Number.isFinite);
  const avgConf = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : NaN;
  const passRate = rows.length ? (triggered / rows.length) * 100 : 0;

  $("predictionMetrics").innerHTML = [
    kpiTile({ label: "Attempts", value: fmtInt(rows.length), sub: "loaded window" }),
    kpiTile({ label: "Triggered", value: fmtInt(triggered), kind: "accent", sub: "passed every filter" }),
    kpiTile({ label: "Blocked", value: fmtInt(blocked), kind: blocked ? "warn" : "", sub: "filtered before order" }),
    kpiTile({
      label: "Avg Confidence",
      value: Number.isFinite(avgConf) ? fmtPct(avgConf * 100) : "--",
      sub: confidences.length ? `${confidences.length} scored` : "no scores",
    }),
    kpiTile({
      label: "Pass Rate",
      value: fmtPct(passRate),
      meter: { pct: passRate, kind: passRate > 0 ? "good" : "warn" },
      sub: `${triggered} of ${rows.length}`,
    }),
  ].join("");
}

function renderPredictionStream() {
  const rows = visiblePredictions();
  if (!rows.length) {
    $("predictionStream").innerHTML = emptyState(state.predictions.length ? "Nothing matches this filter" : "No prediction attempts loaded", "psychology");
    return;
  }
  $("predictionStream").innerHTML = rows.slice(0, 200).map((row) => {
    const index = state.predictions.indexOf(row);
    const triggered = isTriggered(row);
    const conf = Number(row.model_confidence);
    const dir = String(row.predicted_direction || "").toUpperCase().includes("PUT") ? "put" : "call";
    return `
      <article class="streamcard streamcard--${triggered ? "triggered" : "blocked"}${index === state.predictionSelected ? " is-selected" : ""}" data-prediction="${index}">
        <span class="chip chip--${triggered ? "good" : "warn"} streamcard__badge">${triggered ? "Triggered" : "Blocked"}</span>
        <div class="streamcard__top">
          <span class="streamcard__symbol">${escapeHtml(row.symbol || "?")}</span>
          <span class="streamcard__time">${escapeHtml(clockOf(row.timestamp))}</span>
        </div>
        <div class="streamcard__bottom">
          <span class="streamcard__dir streamcard__dir--${dir}">${escapeHtml(row.predicted_direction || "?")} ${dir === "put" ? "↓" : "↑"}</span>
          <span class="streamcard__conf">${Number.isFinite(conf) ? `${(conf * 100).toFixed(1)}%` : "--"} <span>conf</span></span>
        </div>
      </article>`;
  }).join("");
}

function renderPredictionDetail() {
  const row = state.predictions[state.predictionSelected];
  const panel = $("predictionDetail");
  if (!row) {
    panel.innerHTML = `<div class="panel__body" style="padding:24px">${emptyState("Select an attempt from the stream", "psychology")}</div>`;
    return;
  }
  const triggered = isTriggered(row);
  const conf = Number(row.model_confidence);
  const threshold = Number(row.final_eval_conf_thresh);
  const dir = String(row.predicted_direction || "").toUpperCase().includes("PUT") ? "put" : "call";
  const passes = Number.isFinite(threshold) && conf >= threshold;

  panel.innerHTML = `
    <div class="panel__head preddetail__head">
      <div>
        <div class="preddetail__meta">
          <span class="chip chip--${triggered ? "good" : "warn"}">${triggered ? "Triggered" : "Blocked"}</span>
          <span class="mono" style="color:var(--text-secondary)">${escapeHtml(row.timestamp || "")}</span>
        </div>
        <h2 class="preddetail__title">
          <span class="mono">${escapeHtml(row.symbol || "?")}</span>
          <span class="dir dir--${dir}">${escapeHtml(row.predicted_direction || "?")} ${dir === "put" ? "↓" : "↑"}</span>
        </h2>
      </div>
      <button class="btn btn--surface" id="predCopyBtn" type="button"><span class="ms">content_copy</span>Copy</button>
    </div>
    <div class="panel__body">
      <div class="confbar">
        <div class="confbar__head">
          <span class="confbar__label">Confidence assessment</span>
          <div>
            <div class="confbar__value" style="color:var(--${passes ? "secondary" : "status-warning"})">${Number.isFinite(conf) ? `${(conf * 100).toFixed(1)}%` : "--"}</div>
            <div class="confbar__req">Required: ${Number.isFinite(threshold) ? `${(threshold * 100).toFixed(1)}%` : "n/a"}</div>
          </div>
        </div>
        <div class="confbar__track">
          <div class="confbar__fill confbar__fill--${passes ? "pass" : "fail"}" style="width:${Number.isFinite(conf) ? Math.min(100, conf * 100).toFixed(1) : 0}%"></div>
          ${Number.isFinite(threshold) ? `<div class="confbar__marker" style="left:${Math.min(100, threshold * 100).toFixed(1)}%"></div>` : ""}
        </div>
        <div class="confbar__scale">
          <span>0%</span>
          ${Number.isFinite(threshold) ? `<strong>Threshold: ${threshold.toFixed(4)}</strong>` : "<span></span>"}
          <span>100%</span>
        </div>
      </div>

      <div class="kv-grid" style="margin-top:20px">
        <div class="kv"><span class="kv__label">Filter stage</span><span class="kv__value">${escapeHtml(row.filter_stage_outcome || "--")}</span></div>
        <div class="kv"><span class="kv__label">Margin</span><span class="kv__value kv__value--${passes ? "pos" : "neg"}">${Number.isFinite(conf) && Number.isFinite(threshold) ? `${((conf - threshold) * 100).toFixed(2)} pts` : "--"}</span></div>
        <div class="kv kv--wide"><span class="kv__label">Reason</span><span class="kv__value" style="white-space:normal;font-size:12px">${escapeHtml(row.reason_if_blocked_early || (triggered ? "Passed all filters" : "No reason recorded"))}</span></div>
      </div>

      <h3 class="section-title" style="margin-top:24px">Raw evaluation payload</h3>
      <pre class="codeblock" id="predRaw">${escapeHtml(JSON.stringify(row, null, 2))}</pre>
    </div>`;

  $("predCopyBtn").addEventListener("click", () => copyText(JSON.stringify(row, null, 2), "Prediction JSON copied"));
  loadPredictionRaw(row);
}

async function loadPredictionRaw(row) {
  if (!row.timestamp || !row.symbol) return;
  try {
    const rows = await apiQuery(
      `select * from predictions where symbol = ${sqlString(row.symbol)} and timestamp = ${sqlString(row.timestamp)} limit 1`, 1);
    if (rows.length && state.predictions[state.predictionSelected] === row) {
      const el = $("predRaw");
      if (el) el.textContent = JSON.stringify(rows[0], null, 2);
    }
  } catch {
    /* keep the summary payload */
  }
}

function renderBlockReasons() {
  const blocked = state.predictions.filter((r) => !isTriggered(r));
  const counts = new Map();
  blocked.forEach((row) => {
    const key = (row.reason_if_blocked_early || row.filter_stage_outcome || "unspecified").trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) {
    $("blockReasons").innerHTML = emptyState("Nothing blocked in this window", "check_circle");
    return;
  }
  const max = rows[0][1];
  $("blockReasons").innerHTML = rows.map(([reason, count]) => `
    <div class="reasonrow">
      <div class="reasonrow__top">
        <span class="reasonrow__text" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>
        <span class="reasonrow__count">${count} · ${((count / blocked.length) * 100).toFixed(0)}%</span>
      </div>
      <div class="pnlrow__track"><div class="pnlrow__fill pnlrow__fill--flat" style="width:${(count / max) * 100}%;background:var(--status-warning)"></div></div>
    </div>`).join("");
}

/* =============================================================
   QUERY
   ============================================================= */
const SCHEMA = {
  trades: [
    ["contract_id", "TEXT"], ["time", "REAL epoch"], ["symbol", "TEXT"], ["contract_type", "TEXT"],
    ["pnl", "REAL"], ["outcome", "INTEGER 0/1"], ["buy_price", "REAL"], ["sell_price", "REAL"],
    ["entry_spot", "REAL"], ["entry_tick_time", "REAL"], ["exit_tick", "REAL"], ["barrier", "REAL"],
    ["date_start", "REAL"], ["confidence_at_trade", "REAL"], ["original_confidence", "REAL"],
    ["market_regime_at_trade", "TEXT"], ["rsi_at_trade", "REAL"], ["macd_hist_at_trade", "REAL"],
    ["return_5_at_trade", "REAL"], ["atr_at_trade", "REAL"], ["is_override_trade", "INTEGER"],
    ["conf_threshold_used", "REAL"], ["was_sent_to_public", "INTEGER"], ["strategy_source", "TEXT"],
    ["probability_used", "REAL"], ["expected_value", "REAL"], ["payout_rate_used", "REAL"],
  ],
  predictions: [
    ["timestamp", "TEXT"], ["symbol", "TEXT"], ["market_regime", "TEXT"], ["atr_at_decision", "REAL"],
    ["base_dyn_conf_thresh", "REAL"], ["final_eval_conf_thresh", "REAL"], ["predicted_direction", "TEXT"],
    ["model_confidence", "REAL"], ["filter_stage_outcome", "TEXT"], ["reason_if_blocked_early", "TEXT"],
    ["rsi_at_decision", "REAL"], ["macd_hist_at_decision", "REAL"], ["return_5_at_decision", "REAL"],
  ],
  spots: [["contract_id", "TEXT"], ["update_epoch", "REAL"], ["current_spot", "REAL"], ["pnl_at_update", "REAL"]],
};

function renderSchema() {
  $("schemaTree").innerHTML = Object.entries(SCHEMA).map(([table, cols]) => `
    <div class="schema-table">
      <div class="schema-table__name"><span class="ms">table</span>${table}</div>
      ${cols.map(([name, type]) => `<div class="schema-col" data-insert="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><em>${escapeHtml(type)}</em></div>`).join("")}
    </div>`).join("");
}

function syncGutter() {
  const lines = $("sqlQuery").value.split("\n").length;
  $("sqlGutter").innerHTML = Array.from({ length: Math.max(lines, 8) }, (_, i) => `<div>${i + 1}</div>`).join("");
}

function insertAtCursor(text) {
  const ta = $("sqlQuery");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = `${ta.value.slice(0, start)}${text}${ta.value.slice(end)}`;
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  syncGutter();
}

async function runQuery() {
  const sql = $("sqlQuery").value.trim();
  if (!sql) return;
  const maxRows = Number($("queryMaxRows").value || 500);
  $("queryStatus").innerHTML = '<span class="chip chip--info">Running...</span>';
  const started = performance.now();
  try {
    const data = await api("/api/query", { method: "POST", body: JSON.stringify({ sql, max_rows: maxRows }) });
    const ms = Math.round(performance.now() - started);
    const rows = data.rows || [];
    state.queryResult = { columns: data.columns || (rows[0] ? Object.keys(rows[0]) : []), rows };
    renderQueryResult(ms);
    pushQueryHistory(sql);
  } catch (err) {
    state.queryResult = null;
    $("queryStatus").innerHTML = `<span class="chip chip--bad"><span class="ms" style="font-size:14px">error</span>${escapeHtml(err.message)}</span>`;
    $("queryTable").innerHTML = emptyState(err.message, "error");
  }
}

function renderQueryResult(ms) {
  const { columns, rows } = state.queryResult;
  $("queryStatus").innerHTML = `
    <span class="chip chip--good"><span class="ms" style="font-size:14px">check_circle</span>Query successful</span>
    <span class="results__stat"><span class="ms">table_rows</span><strong>${fmtInt(rows.length)}</strong>rows</span>
    <span class="results__stat"><span class="ms">timer</span><strong>${ms}ms</strong>elapsed</span>`;
  $("queryTable").innerHTML = renderDataTable(columns, rows);
}

function renderDataTable(columns, rows) {
  if (!rows.length) return emptyState("Query returned no rows", "table_rows");
  const cols = columns.length ? columns : Object.keys(rows[0]);
  return `
    <table>
      <thead><tr>${cols.map((c) => `<th class="${typeof rows[0][c] === "number" ? "num" : ""}">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${cols.map((c) => {
        const value = row[c];
        if (typeof value === "number") {
          const cls = /pnl|profit/i.test(c) ? (value > 0 ? "num pos" : value < 0 ? "num neg" : "num") : "num";
          // show what SQLite returned, only trimming float noise
          return `<td class="${cls}">${Number.isInteger(value) ? fmtInt(value) : String(Number(value.toFixed(6)))}</td>`;
        }
        return `<td>${escapeHtml(value ?? "")}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

function readList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function pushQueryHistory(sql) {
  const history = readList(LS.queryHistory).filter((s) => s !== sql);
  history.unshift(sql);
  localStorage.setItem(LS.queryHistory, JSON.stringify(history.slice(0, 25)));
}

function showQueryList(kind) {
  const key = kind === "saved" ? LS.savedQueries : LS.queryHistory;
  const items = readList(key);
  const title = kind === "saved" ? "Saved queries" : "Query history";
  if (!items.length) {
    toast(`No ${title.toLowerCase()} yet`, "info");
    return;
  }
  $("queryStatus").innerHTML = `<span class="chip chip--info">${title}</span>`;
  $("queryTable").innerHTML = `<div style="padding:12px"><div class="querylist">${items.map((sql, i) => `
    <div class="queryitem" data-load-query="${i}" data-kind="${kind}">
      <span class="ms" style="font-size:16px;color:var(--text-secondary)">${kind === "saved" ? "bookmark" : "history"}</span>
      <span class="queryitem__sql">${escapeHtml(sql.replace(/\s+/g, " ").slice(0, 160))}</span>
      <button class="iconbtn" data-del-query="${i}" data-kind="${kind}" title="Remove"><span class="ms">close</span></button>
    </div>`).join("")}</div></div>`;
}

/* =============================================================
   LOGS
   ============================================================= */
function logLevelOf(line) {
  const text = line.toLowerCase();
  if (/\b(error|exception|traceback|failed|❌)\b/.test(text) || text.includes("error:")) return "error";
  if (/\b(warn|warning|⚠)\b/.test(text)) return "warn";
  if (/\b(success|authorized|connected|started|✅)\b/.test(text)) return "success";
  return "info";
}

function parseLogLine(line) {
  const timeMatch = line.match(/(\d{4}-\d{2}-\d{2}[ T])?(\d{2}:\d{2}:\d{2})(\.\d+)?/);
  const symbolMatch = line.match(/\b(R_\d+|[A-Z]{3}[A-Z]{3}|frx[A-Za-z]+|BOOM\d+|CRASH\d+)\b/);
  return {
    raw: line,
    time: timeMatch ? `${timeMatch[2]}${(timeMatch[3] || "").slice(0, 4)}` : "",
    level: logLevelOf(line),
    context: symbolMatch ? symbolMatch[1] : "",
  };
}

async function loadLogs({ quiet = false } = {}) {
  try {
    const lines = Number($("logLines").value || 350);
    const data = await api(`/api/logs?lines=${lines}`);
    state.logLines = (data.lines || []).map(parseLogLine);
    renderLogs();
    if (!quiet) toast(`Loaded ${state.logLines.length} line${state.logLines.length === 1 ? "" : "s"}`, "good");
  } catch (err) {
    if (!quiet) toast(err.message, "bad", "Log load failed");
  }
}

function renderLogs() {
  const needle = $("logGrep").value.trim().toLowerCase();
  const level = $("logLevel").value;
  const rows = state.logLines.filter((row) => {
    if (level && row.level !== level) return false;
    if (needle && !row.raw.toLowerCase().includes(needle)) return false;
    return true;
  });

  const body = $("logBody");
  if (!rows.length) {
    body.innerHTML = emptyState(state.logLines.length ? "No lines match this filter" : "No log lines loaded", "list_alt");
    $("logCount").textContent = state.logLines.length ? `0 of ${fmtInt(state.logLines.length)} lines shown` : "No log lines loaded";
    return;
  }

  body.innerHTML = rows.map((row, index) => `
    <div class="loggrid logrow logrow--${row.level}${state.openLogRows.has(row.raw) ? " is-open" : ""}" data-log-index="${index}">
      <div class="logrow__time">${escapeHtml(row.time || "--")}</div>
      <div><span class="loglevel loglevel--${row.level}">${row.level.toUpperCase()}</span></div>
      <div class="logrow__msg">${escapeHtml(row.raw)}</div>
      <div class="logrow__ctx">${row.context ? `<span style="color:var(--primary)">${escapeHtml(row.context)}</span>` : ""}</div>
      <div class="logrow__chev"><span class="ms">expand_more</span></div>
    </div>`).join("");

  $("logCount").textContent = `${fmtInt(rows.length)} of ${fmtInt(state.logLines.length)} lines shown`;
  if (state.logFollow) body.scrollTop = body.scrollHeight;
}

/* =============================================================
   BOT CONTROL
   ============================================================= */
function renderControlsDrawer(runtime, proc) {
  const running = Boolean(proc.running);
  $("drawerStatus").innerHTML = `<i class="dot ${running ? "dot--good dot--pulse" : ""}"></i>${running ? "Running" : "Stopped"}`;
  $("drawerPid").textContent = proc.pid || "--";
  $("drawerExposure").textContent = `${runtime.open_trades_total || 0} / ${runtime.max_open_trades_total || "∞"}`;
  $("drawerWarmup").textContent = runtime.warmup_active ? "yes" : "no";
  $("drawerError").textContent = runtime.last_error || "none";
  $("startBtn").disabled = running;
  $("stopBtn").disabled = !running;
}

async function connect({ quiet = false } = {}) {
  readConnectionFrom("drawer");
  try {
    await refreshStatus();
    state.connected = true;
    scheduleRefresh();
    if (!quiet) toast("Connected to controller", "good", normalizedUrl());
    return true;
  } catch (err) {
    state.connected = false;
    setPill("apiPill", "bad", err.message);
    setRefreshIndicator();
    if (!quiet) toast(err.message, "bad", "Connection failed");
    return false;
  }
}

async function startBot() {
  readConnectionFrom("drawer");
  const warmup = Number($("warmupMinutes").value || 0);
  try {
    const data = await api("/api/start", { method: "POST", body: JSON.stringify({ warmup_minutes: warmup }) });
    if (data.started) toast("Bot started", "good", warmup > 0 ? `${warmup} minute warmup` : "Execution engine active");
    else toast(data.message || "Start refused", "warn");
    await refreshStatus();
    scheduleRefresh();
  } catch (err) {
    toast(err.message, "bad", "Start failed");
  }
}

async function stopBot({ force = false } = {}) {
  readConnectionFrom("drawer");
  const runtime = state.status?.runtime || {};
  const open = Number(runtime.open_trades_total || 0);
  const pending = Number(runtime.pending_orders_total || 0);

  const ok = await confirmDialog({
    title: force ? "Force stop the bot?" : "Stop trading?",
    body: force
      ? "This kills the bot process immediately, even with contracts open. Open positions will not be closed for you and must be settled on Deriv."
      : "This stops the execution engine. The controller refuses to stop while contracts are open or orders are pending, so you will be offered a force stop if that is the case.",
    confirmLabel: force ? "Force stop" : "Stop bot",
    danger: true,
    checkLabel: force || open > 0 || pending > 0
      ? `I accept responsibility for ${open} open trade(s) and ${pending} pending order(s)`
      : "",
  });
  if (!ok) return;

  try {
    const data = await api("/api/stop", { method: "POST", body: JSON.stringify({ timeout: 15, force }) });
    if (data.stopped) {
      toast("Bot stop requested", "good");
    } else if (data.blocked) {
      toast(data.message || "Stop blocked", "warn", "Open exposure");
      const forceOk = await confirmDialog({
        title: "Stop blocked by open exposure",
        body: `${data.message}\n\nForce stopping kills the process without settling anything. Only do this if you will handle the open contracts on Deriv yourself.`,
        confirmLabel: "Force stop anyway",
        danger: true,
        checkLabel: "I understand open contracts will be left running",
      });
      if (forceOk) {
        const forced = await api("/api/stop", { method: "POST", body: JSON.stringify({ timeout: 15, force: true }) });
        toast(forced.stopped ? "Bot force stopped" : (forced.message || "Force stop refused"), forced.stopped ? "warn" : "bad");
      }
    } else {
      toast(data.message || "Stop refused", "warn");
    }
    await refreshStatus();
  } catch (err) {
    toast(err.message, "bad", "Stop failed");
  }
}

/* =============================================================
   SETTINGS
   ============================================================= */
const SHORTCUTS = [
  ["Command palette", "⌘K / Ctrl K"],
  ["Overview / Symbols / Trades", "G then 1 / 2 / 3"],
  ["Predictions / Query / Logs", "G then 4 / 5 / 6"],
  ["Refresh status now", "R"],
  ["Run SQL query", "⌘⏎ / Ctrl ⏎"],
  ["Toggle bot controls", "B"],
  ["Close drawer or dialog", "Esc"],
];

function renderShortcuts() {
  $("shortcutList").innerHTML = SHORTCUTS
    .map(([label, keys]) => `<li><span>${escapeHtml(label)}</span><kbd>${escapeHtml(keys)}</kbd></li>`)
    .join("");
}

function applySettingsToInputs() {
  $("setRefreshMs").value = String(state.refreshMs);
  $("refreshMs").value = String(state.refreshMs);
  $("setAutoLogs").checked = state.autoLogs;
  $("setAutoPredictions").checked = state.autoPredictions;
  $("setPageSize").value = String(state.pageSize);
  syncConnectionInputs();
}

async function testHealth() {
  readConnectionFrom("settings");
  const box = $("healthResult");
  box.hidden = false;
  box.className = "callout";
  box.textContent = "Checking...";
  try {
    const res = await fetch(`${normalizedUrl()}/api/health`);
    const data = await res.json();
    box.className = `callout ${data.ok ? "callout--good" : "callout--bad"}`;
    box.textContent = `ok: ${data.ok}\ntoken_configured: ${data.token_configured}\nserver time: ${data.time}`
      + (data.token_configured ? "" : "\n\nCONTROL_API_TOKEN is not set in .env — the controller printed a temporary token at startup.");
  } catch (err) {
    box.className = "callout callout--bad";
    box.textContent = `Unreachable: ${err.message}\n\nCheck that controller_api.py is running and that CONTROL_ALLOWED_ORIGINS permits this page.`;
  }
}

/* =============================================================
   COMMAND PALETTE
   ============================================================= */
const COMMANDS = [
  { id: "overview", label: "Go to Overview", icon: "grid_view", hint: "view", run: () => switchView("overview") },
  { id: "symbols", label: "Go to Symbols", icon: "monitoring", hint: "view", run: () => switchView("symbols") },
  { id: "trades", label: "Go to Trades", icon: "swap_horiz", hint: "view", run: () => switchView("trades") },
  { id: "predictions", label: "Go to Predictions", icon: "psychology", hint: "view", run: () => switchView("predictions") },
  { id: "query", label: "Go to Query", icon: "terminal", hint: "view", run: () => switchView("query") },
  { id: "logs", label: "Go to Logs", icon: "list_alt", hint: "view", run: () => switchView("logs") },
  { id: "settings", label: "Go to Settings", icon: "settings", hint: "view", run: () => switchView("settings") },
  { id: "controls", label: "Open bot controls", icon: "tune", hint: "action", run: () => openDrawer("controlsDrawer") },
  { id: "connect", label: "Connect to controller", icon: "link", hint: "action", run: () => connect() },
  { id: "refresh", label: "Refresh status now", icon: "refresh", hint: "action", run: () => tick() },
  { id: "start", label: "Start bot", icon: "play_arrow", hint: "action", run: () => startBot() },
  { id: "stop", label: "Stop bot", icon: "stop", hint: "action", run: () => stopBot() },
  { id: "loadTrades", label: "Reload trades", icon: "swap_horiz", hint: "action", run: () => { switchView("trades"); loadTrades(); } },
  { id: "loadPredictions", label: "Reload predictions", icon: "psychology", hint: "action", run: () => { switchView("predictions"); loadPredictions(); } },
  { id: "loadLogs", label: "Reload logs", icon: "list_alt", hint: "action", run: () => { switchView("logs"); loadLogs(); } },
  { id: "exportTrades", label: "Export trades as CSV", icon: "download", hint: "action", run: () => exportTrades() },
];

let paletteIndex = 0;

function openPalette() {
  $("paletteRoot").hidden = false;
  $("paletteInput").value = "";
  paletteIndex = 0;
  renderPalette();
  $("paletteInput").focus();
}

function closePalette() {
  $("paletteRoot").hidden = true;
}

function paletteMatches() {
  const needle = $("paletteInput").value.trim().toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter((c) => c.label.toLowerCase().includes(needle));
}

function renderPalette() {
  const matches = paletteMatches();
  paletteIndex = Math.max(0, Math.min(paletteIndex, matches.length - 1));
  $("paletteList").innerHTML = matches.length
    ? matches.map((c, i) => `
      <li class="palette__item${i === paletteIndex ? " is-active" : ""}" data-cmd="${c.id}">
        <span class="ms">${c.icon}</span>${escapeHtml(c.label)}<small>${c.hint}</small>
      </li>`).join("")
    : '<li class="palette__item">No matching command</li>';
}

function runPalette(id) {
  const cmd = COMMANDS.find((c) => c.id === id);
  closePalette();
  if (cmd) cmd.run();
}

/* =============================================================
   EXPORTS
   ============================================================= */
function exportTrades() {
  const rows = filteredTrades();
  if (!rows.length) return toast("Nothing to export", "warn");
  downloadFile(`trades-${stamp()}.csv`, toCsv(rows), "text/csv");
  toast(`Exported ${rows.length} trades`, "good");
}

function exportPredictions() {
  const rows = visiblePredictions();
  if (!rows.length) return toast("Nothing to export", "warn");
  downloadFile(`predictions-${stamp()}.csv`, toCsv(rows), "text/csv");
  toast(`Exported ${rows.length} attempts`, "good");
}

/* =============================================================
   EVENT WIRING
   ============================================================= */
function bindNavigation() {
  $$(".navlink").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(a.dataset.view);
    });
  });
  window.addEventListener("hashchange", () => switchView(location.hash.slice(1) || "overview", { push: false }));
}

function bindConnection() {
  $("connectBtn").addEventListener("click", () => connect());
  $("setConnectBtn").addEventListener("click", async () => {
    readConnectionFrom("settings");
    await connect();
  });
  $("setHealthBtn").addEventListener("click", testHealth);
  $("controlsBtn").addEventListener("click", () => {
    if ($("controlsDrawer").classList.contains("is-open")) closeDrawers();
    else openDrawer("controlsDrawer");
  });
  $("refreshNowBtn").addEventListener("click", () => tick());
  $("refreshMs").addEventListener("change", (e) => updateRefreshInterval(e.target.value));
  $("startBtn").addEventListener("click", startBot);
  $("stopBtn").addEventListener("click", () => stopBot());
  $("forceStopBtn").addEventListener("click", () => stopBot({ force: true }));

  const reveal = (btnId, inputId) => {
    $(btnId).addEventListener("click", () => {
      const input = $(inputId);
      input.type = input.type === "password" ? "text" : "password";
      $(btnId).querySelector(".ms").textContent = input.type === "password" ? "visibility" : "visibility_off";
    });
  };
  reveal("revealTokenBtn", "setApiToken");
  reveal("revealTokenBtn2", "apiToken");

  ["apiUrl", "apiToken"].forEach((id) => {
    $(id).addEventListener("change", () => readConnectionFrom("drawer"));
  });
  ["setApiUrl", "setApiToken"].forEach((id) => {
    $(id).addEventListener("change", () => readConnectionFrom("settings"));
  });
  $("setRememberToken").addEventListener("change", (e) => {
    state.rememberToken = e.target.checked;
    persistConnection();
    toast(e.target.checked ? "Token will be saved in this browser" : "Token cleared from localStorage", "info");
  });

  $$("[data-close-drawer]").forEach((btn) => btn.addEventListener("click", closeDrawers));
  $("scrim").addEventListener("click", closeDrawers);
  document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close-drawer]");
    if (closer) closeDrawers();
  });

  $("modalConfirm").addEventListener("click", () => {
    const wrap = $("modalCheckWrap");
    if (!wrap.hidden && !$("modalCheck").checked) {
      toast("Tick the acknowledgement to continue", "warn");
      return;
    }
    closeModal(true);
  });
  $$("[data-modal-cancel]").forEach((el) => el.addEventListener("click", () => closeModal(false)));
}

function bindOverview() {
  $$("#pnlRange .seg").forEach((btn) => {
    btn.addEventListener("click", async () => {
      $$("#pnlRange .seg").forEach((b) => b.classList.toggle("is-active", b === btn));
      state.pnlRange = btn.dataset.range;
      await refreshPnlRange();
    });
  });
  $("strategyToTradesBtn").addEventListener("click", () => {
    switchView("trades");
    if (!state.trades.length) loadTrades();
  });
  $("modelValidationSummary").addEventListener("click", (e) => {
    const row = e.target.closest("[data-model-symbol]");
    if (row) openSymbolDetail(row.dataset.modelSymbol);
  });
  window.addEventListener("resize", () => {
    clearTimeout(window.__equityResize);
    window.__equityResize = setTimeout(() => {
      drawEquityChart();
      drawModelQualityChart(modelGateLimits(state.status?.runtime || {}));
    }, 150);
  });
}

function bindSymbols() {
  $("symbolFilter").addEventListener("input", (e) => {
    state.symbolFilter = e.target.value;
    renderSymbols();
  });
  $("symbolShowEnabledBtn").addEventListener("click", () => {
    state.symbolsEnabledOnly = !state.symbolsEnabledOnly;
    $("symbolShowEnabledBtn").setAttribute("aria-pressed", String(state.symbolsEnabledOnly));
    $("symbolShowEnabledBtn").classList.toggle("btn--toggle", state.symbolsEnabledOnly);
    $("symbolShowEnabledBtn").classList.toggle("is-on", state.symbolsEnabledOnly);
    renderSymbols();
  });

  $("symbolRows").addEventListener("change", (e) => {
    const input = e.target.closest("[data-symbol]");
    if (!input) return;
    const { symbol, field } = input.dataset;
    const cfg = state.symbols[symbol];
    if (!cfg) return;
    const value = input.type === "checkbox" ? input.checked : Number(input.value);
    markDirty(symbol, field, value, cfg[field]);
    if (field === "enable_trading") renderSymbols();
    else input.classList.toggle("is-dirty", Boolean(state.symbolDirty[symbol]?.[field] !== undefined));
  });

  $("symbolRows").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-symbol-detail]");
    if (btn) openSymbolDetail(btn.dataset.symbolDetail);
  });

  $("saveSymbolsBtn").addEventListener("click", saveSymbols);
  $("discardSymbolsBtn").addEventListener("click", () => {
    state.symbolDirty = {};
    renderSymbols();
    toast("Changes discarded", "info");
  });
  $("applySymbolBtn").addEventListener("click", applySymbolAdvanced);
}

function bindTrades() {
  $("loadTradesBtn").addEventListener("click", () => loadTrades());
  $("exportTradesBtn").addEventListener("click", exportTrades);
  ["tradeSearch", "tradeType", "tradeOutcome"].forEach((id) => {
    $(id).addEventListener("input", () => {
      state.tradePage = 1;
      renderTrades();
    });
  });
  $("tradeSymbol").addEventListener("change", () => loadTrades());
  $$("#tradesHead .sortable").forEach((el) => {
    el.addEventListener("click", () => {
      state.tradeSort = state.tradeSort === "desc" ? "asc" : "desc";
      el.querySelector(".ms").textContent = state.tradeSort === "desc" ? "arrow_downward" : "arrow_upward";
      renderTrades();
    });
  });
  $("tradesList").addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      e.stopPropagation();
      copyText(copyBtn.dataset.copy, "Contract ID copied");
      return;
    }
    const row = e.target.closest("[data-trade-id]");
    if (row) openTradeDetail(row.dataset.tradeId);
  });
  $("tradeDrawerBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) copyText(btn.dataset.copy, "Contract ID copied");
  });
}

function bindPredictions() {
  $("loadPredictionsBtn").addEventListener("click", () => loadPredictions());
  $("exportPredictionsBtn").addEventListener("click", exportPredictions);
  $("predictionSymbol").addEventListener("change", () => loadPredictions());
  $("predictionOutcome").addEventListener("change", () => {
    renderPredictionStream();
    renderBlockReasons();
  });
  $("predPauseBtn").addEventListener("click", () => {
    state.predictionPaused = !state.predictionPaused;
    $("predPauseBtn").querySelector(".ms").textContent = state.predictionPaused ? "play_arrow" : "pause";
    $("predPauseBtn").title = state.predictionPaused ? "Resume stream" : "Pause stream";
    toast(state.predictionPaused ? "Stream paused" : "Stream resumed", "info");
  });
  $("predictionStream").addEventListener("click", (e) => {
    const card = e.target.closest("[data-prediction]");
    if (!card) return;
    state.predictionSelected = Number(card.dataset.prediction);
    renderPredictionStream();
    renderPredictionDetail();
  });
}

function bindQuery() {
  const ta = $("sqlQuery");
  ta.addEventListener("input", syncGutter);
  ta.addEventListener("scroll", () => {
    $("sqlGutter").scrollTop = ta.scrollTop;
  });
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      insertAtCursor("  ");
    }
  });
  $("runQueryBtn").addEventListener("click", runQuery);
  $("schemaBtn").addEventListener("click", () => {
    const panel = $("schemaPanel");
    panel.hidden = !panel.hidden;
    document.querySelector(".query-layout").classList.toggle("has-schema", !panel.hidden);
    $("schemaBtn").setAttribute("aria-pressed", String(!panel.hidden));
  });
  $("schemaCloseBtn").addEventListener("click", () => {
    $("schemaPanel").hidden = true;
    document.querySelector(".query-layout").classList.remove("has-schema");
    $("schemaBtn").setAttribute("aria-pressed", "false");
  });
  $("schemaTree").addEventListener("click", (e) => {
    const col = e.target.closest("[data-insert]");
    if (col) insertAtCursor(col.dataset.insert);
  });
  $("historyBtn").addEventListener("click", () => showQueryList("history"));
  $("savedBtn").addEventListener("click", () => showQueryList("saved"));
  $("saveQueryBtn").addEventListener("click", () => {
    const sql = ta.value.trim();
    if (!sql) return;
    const saved = readList(LS.savedQueries).filter((s) => s !== sql);
    saved.unshift(sql);
    localStorage.setItem(LS.savedQueries, JSON.stringify(saved.slice(0, 25)));
    toast("Query saved", "good");
  });
  $("copyQueryResultsBtn").addEventListener("click", () => {
    if (!state.queryResult?.rows?.length) return toast("No results to copy", "warn");
    copyText(toCsv(state.queryResult.rows), "Results copied as CSV");
  });
  $("exportQueryBtn").addEventListener("click", () => {
    if (!state.queryResult?.rows?.length) return toast("No results to export", "warn");
    downloadFile(`query-${stamp()}.csv`, toCsv(state.queryResult.rows), "text/csv");
    toast(`Exported ${state.queryResult.rows.length} rows`, "good");
  });
  $("queryTable").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del-query]");
    if (del) {
      e.stopPropagation();
      const kind = del.dataset.kind;
      const key = kind === "saved" ? LS.savedQueries : LS.queryHistory;
      const items = readList(key);
      items.splice(Number(del.dataset.delQuery), 1);
      localStorage.setItem(key, JSON.stringify(items));
      showQueryList(kind);
      return;
    }
    const load = e.target.closest("[data-load-query]");
    if (load) {
      const key = load.dataset.kind === "saved" ? LS.savedQueries : LS.queryHistory;
      const sql = readList(key)[Number(load.dataset.loadQuery)];
      if (sql) {
        ta.value = sql;
        syncGutter();
        runQuery();
      }
    }
  });
}

function bindLogs() {
  $("loadLogsBtn").addEventListener("click", () => loadLogs());
  $("logLines").addEventListener("change", () => loadLogs());
  ["logGrep", "logLevel"].forEach((id) => $(id).addEventListener("input", renderLogs));
  $("logFollowBtn").addEventListener("click", () => {
    state.logFollow = !state.logFollow;
    $("logFollowBtn").classList.toggle("is-on", state.logFollow);
    $("logFollowBtn").setAttribute("aria-pressed", String(state.logFollow));
    if (state.logFollow) {
      const body = $("logBody");
      body.scrollTop = body.scrollHeight;
    }
  });
  $("downloadLogsBtn").addEventListener("click", () => {
    if (!state.logLines.length) return toast("No log lines loaded", "warn");
    downloadFile(`bot-log-${stamp()}.log`, state.logLines.map((l) => l.raw).join("\n"));
    toast(`Downloaded ${state.logLines.length} lines`, "good");
  });
  $("logBody").addEventListener("click", (e) => {
    const row = e.target.closest("[data-log-index]");
    if (!row) return;
    row.classList.toggle("is-open");
    const raw = row.querySelector(".logrow__msg").textContent;
    if (state.openLogRows.has(raw)) state.openLogRows.delete(raw);
    else state.openLogRows.add(raw);
  });
}

function bindSettings() {
  $("setRefreshMs").addEventListener("change", (e) => {
    updateRefreshInterval(e.target.value);
  });
  $("setAutoLogs").addEventListener("change", (e) => {
    state.autoLogs = e.target.checked;
    localStorage.setItem(LS.autoLogs, state.autoLogs ? "1" : "0");
  });
  $("setAutoPredictions").addEventListener("change", (e) => {
    state.autoPredictions = e.target.checked;
    localStorage.setItem(LS.autoPredictions, state.autoPredictions ? "1" : "0");
  });
  $("setPageSize").addEventListener("change", (e) => {
    state.pageSize = Number(e.target.value);
    localStorage.setItem(LS.pageSize, String(state.pageSize));
    state.tradePage = 1;
    renderTrades();
  });
  $("clearLocalBtn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear saved settings?",
      body: "Removes the stored API URL, token, saved queries and preferences from this browser. The bot itself is untouched.",
      confirmLabel: "Clear",
      danger: true,
    });
    if (!ok) return;
    Object.values(LS).forEach((key) => localStorage.removeItem(key));
    toast("Local settings cleared", "good", "Reload to start fresh");
  });
}

function bindPalette() {
  $("paletteHint").addEventListener("click", openPalette);
  $("paletteInput").addEventListener("input", () => {
    paletteIndex = 0;
    renderPalette();
  });
  $("paletteInput").addEventListener("keydown", (e) => {
    const matches = paletteMatches();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteIndex = Math.min(paletteIndex + 1, matches.length - 1);
      renderPalette();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteIndex = Math.max(paletteIndex - 1, 0);
      renderPalette();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[paletteIndex]) runPalette(matches[paletteIndex].id);
    }
  });
  $("paletteList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-cmd]");
    if (item) runPalette(item.dataset.cmd);
  });
  $$("[data-palette-cancel]").forEach((el) => el.addEventListener("click", closePalette));
}

function bindKeyboard() {
  let chord = false;
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key === "Escape") {
      if (!$("paletteRoot").hidden) return closePalette();
      if (!$("modalRoot").hidden) return closeModal(false);
      if (anyDrawerOpen()) return closeDrawers();
      return;
    }
    if (typing) return;

    if (chord) {
      chord = false;
      const map = { 1: "overview", 2: "symbols", 3: "trades", 4: "predictions", 5: "query", 6: "logs", 7: "settings" };
      if (map[e.key]) {
        e.preventDefault();
        switchView(map[e.key]);
      }
      return;
    }
    if (e.key.toLowerCase() === "g") {
      chord = true;
      setTimeout(() => { chord = false; }, 1200);
      return;
    }
    if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      tick();
    }
    if (e.key.toLowerCase() === "b") {
      e.preventDefault();
      if ($("controlsDrawer").classList.contains("is-open")) closeDrawers();
      else openDrawer("controlsDrawer");
    }
  });
}

/* =============================================================
   BOOTSTRAP
   ============================================================= */
function init() {
  syncConnectionInputs();
  applySettingsToInputs();
  renderShortcuts();
  renderSchema();
  syncGutter();
  renderSymbols();
  renderTradeMetrics();
  renderTrades();
  renderPredictionMetrics();
  renderPredictionStream();
  renderPredictionDetail();
  renderBlockReasons();
  renderPnlBars();
  setRefreshIndicator();

  bindNavigation();
  bindConnection();
  bindOverview();
  bindSymbols();
  bindTrades();
  bindPredictions();
  bindQuery();
  bindLogs();
  bindSettings();
  bindPalette();
  bindKeyboard();

  const initial = location.hash.slice(1) || localStorage.getItem(LS.view) || "overview";
  switchView(initial, { push: false });

  if (state.token) {
    connect({ quiet: true }).then((ok) => {
      if (ok) toast("Connected to controller", "good", normalizedUrl());
    });
  } else {
    toast("Enter your control token to connect", "info", "Bot Controls or Settings");
    openDrawer("controlsDrawer");
  }
}

init();
