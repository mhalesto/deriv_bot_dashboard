const state = {
  apiUrl: localStorage.getItem("derivBot.apiUrl") || "http://127.0.0.1:8765",
  token: localStorage.getItem("derivBot.token") || "",
  status: null,
  refreshTimer: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtMoney(value) {
  const n = Number(value || 0);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "n/a";
}

function fmtNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function setToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(setToast.timer);
  setToast.timer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setPill(id, text, tone) {
  const el = $(id);
  el.textContent = text;
  el.className = `pill ${tone || "neutral"}`;
}

async function api(path, options = {}) {
  const url = `${state.apiUrl.replace(/\/$/, "")}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Control-Token": state.token,
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function saveConnectionFields() {
  state.apiUrl = $("apiUrl").value.trim() || "http://127.0.0.1:8765";
  state.token = $("apiToken").value.trim();
  localStorage.setItem("derivBot.apiUrl", state.apiUrl);
  localStorage.setItem("derivBot.token", state.token);
}

function metricTile(label, value, toneClass = "") {
  return `
    <div class="metric">
      <div class="label">${label}</div>
      <div class="value ${toneClass}">${value}</div>
    </div>
  `;
}

function renderMetrics(metrics, runtime, process) {
  const overall = metrics?.overall || {};
  const pnl = Number(overall.pnl || 0);
  const sessionPnl = Number(runtime?.session_pnl || 0);
  $("metricTiles").innerHTML = [
    metricTile("Process", process?.running ? "Running" : "Stopped", process?.running ? "positive" : ""),
    metricTile("Balance", fmtMoney(runtime?.balance || 0)),
    metricTile("Session PnL", fmtMoney(sessionPnl), sessionPnl >= 0 ? "positive" : "negative"),
    metricTile("Total PnL", fmtMoney(pnl), pnl >= 0 ? "positive" : "negative"),
    metricTile("Win Rate", fmtPct(overall.win_rate || 0)),
    metricTile("Trades", overall.trades || 0),
  ].join("");
}

function renderTable(containerId, rows) {
  const target = $(containerId);
  target.innerHTML = "";
  if (!rows || rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "subline";
    empty.style.padding = "12px";
    empty.textContent = "No rows";
    target.appendChild(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const columns = Object.keys(rows[0]);

  const headRow = document.createElement("tr");
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      const value = row[col];
      if (typeof value === "number") {
        td.className = "number";
        td.textContent = Number.isInteger(value) ? String(value) : value.toFixed(4);
      } else {
        td.textContent = value ?? "";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  target.appendChild(wrap);
}

function renderStrategyTable(metrics) {
  renderTable("strategyTable", metrics?.by_strategy || []);
}

function drawPnlChart(metrics) {
  const canvas = $("pnlChart");
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  const height = 260;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rows = (metrics?.by_symbol || []).slice(0, 12);
  if (!rows.length) {
    ctx.fillStyle = "#667085";
    ctx.fillText("No PnL data", 18, 32);
    return;
  }

  const padding = { left: 54, right: 20, top: 22, bottom: 52 };
  const values = rows.map((r) => Number(r.pnl || 0));
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const zeroY = padding.top + chartH / 2;
  const barW = Math.max(14, chartW / rows.length - 10);

  ctx.strokeStyle = "#d6dde5";
  ctx.beginPath();
  ctx.moveTo(padding.left, zeroY);
  ctx.lineTo(width - padding.right, zeroY);
  ctx.stroke();

  rows.forEach((row, idx) => {
    const pnl = Number(row.pnl || 0);
    const x = padding.left + idx * (chartW / rows.length) + 5;
    const barH = Math.abs(pnl) / maxAbs * (chartH / 2 - 10);
    const y = pnl >= 0 ? zeroY - barH : zeroY;
    ctx.fillStyle = pnl >= 0 ? "#087443" : "#b42318";
    ctx.fillRect(x, y, barW, barH);

    ctx.save();
    ctx.translate(x + barW / 2, height - 10);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "#344054";
    ctx.font = "11px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(row.symbol, 0, 0);
    ctx.restore();
  });

  ctx.fillStyle = "#667085";
  ctx.font = "12px system-ui";
  ctx.fillText(fmtMoney(maxAbs), 8, padding.top + 8);
  ctx.fillText(`-${fmtMoney(maxAbs).replace("$", "")}`, 8, padding.top + chartH);
}

function optionRows(symbols) {
  const names = Object.keys(symbols || {});
  return `<option value="">All symbols</option>${names.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}`;
}

function renderSymbols(symbols, runtimeSymbols = {}) {
  $("tradeSymbol").innerHTML = optionRows(symbols);
  $("predictionSymbol").innerHTML = optionRows(symbols);

  const rows = Object.values(symbols || {}).map((sym) => {
    const rt = runtimeSymbols[sym.symbol] || {};
    const status = rt.model_loaded ? "Model" : "No model";
    const threshold = rt.threshold === undefined || rt.threshold === null ? "" : fmtNum(rt.threshold, 3);
    const symbolName = escapeHtml(sym.symbol);
    const displayName = escapeHtml(sym.display_name || "");
    return `
      <tr data-symbol-row="${symbolName}">
        <td><input data-field="enable_trading" type="checkbox" ${sym.enable_trading ? "checked" : ""}></td>
        <td><strong>${symbolName}</strong><div class="subline">${displayName}</div></td>
        <td>${status}<div class="subline">${rt.buffer_candles || 0} candles</div></td>
        <td><input data-field="duration_minutes" type="number" min="1" step="1" value="${sym.duration_minutes || 1}"></td>
        <td><input data-field="granularity_seconds" type="number" min="1" step="1" value="${sym.granularity_seconds || 60}"></td>
        <td><input data-field="candle_count_for_history" type="number" min="250" step="50" value="${sym.candle_count_for_history || 1500}"></td>
        <td><input data-field="trade_amount" type="number" min="0.35" step="0.01" value="${sym.trade_amount || 0}"></td>
        <td><input data-field="min_expected_value" type="number" step="0.001" value="${sym.min_expected_value || 0}"></td>
        <td class="number">${rt.trade_count || 0}</td>
        <td class="number">${threshold}</td>
      </tr>
    `;
  }).join("");
  $("symbolRows").innerHTML = rows;
}

function collectSymbolUpdates() {
  const updates = {};
  document.querySelectorAll("[data-symbol-row]").forEach((row) => {
    const symbol = row.getAttribute("data-symbol-row");
    updates[symbol] = {};
    row.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.getAttribute("data-field");
      updates[symbol][field] = input.type === "checkbox" ? input.checked : Number(input.value);
    });
  });
  return updates;
}

async function refreshStatus() {
  saveConnectionFields();
  const data = await api("/api/status");
  state.status = data;
  const runtime = data.runtime || {};
  const process = data.process || {};
  const metrics = data.metrics || {};

  setPill("apiPill", "API connected", "good");
  setPill("botPill", process.running ? "Bot running" : "Bot stopped", process.running ? "good" : "neutral");
  setPill("wsPill", runtime.ws_connected ? "WS connected" : "WS offline", runtime.ws_connected ? "good" : "warn");
  const authorized = Boolean(runtime.deriv_authorized);
  const lastError = runtime.last_error || "";
  setPill(
    "authPill",
    authorized ? "Deriv authorized" : (lastError ? "Deriv error" : "Auth pending"),
    authorized ? "good" : (lastError ? "bad" : (process.running ? "warn" : "neutral"))
  );
  $("authPill").title = authorized && runtime.deriv_loginid ? `Account ${runtime.deriv_loginid}` : lastError;
  $("lastUpdated").textContent = runtime.timestamp
    ? `Updated ${runtime.timestamp}${lastError ? ` | ${lastError}` : ""}`
    : "Connected";

  renderMetrics(metrics, runtime, process);
  renderStrategyTable(metrics);
  drawPnlChart(metrics);
  renderSymbols(data.symbols || {}, runtime.symbols || {});
}

async function connect() {
  try {
    await refreshStatus();
    setToast("Connected");
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => refreshStatus().catch(() => {}), 5000);
  } catch (err) {
    setPill("apiPill", "API error", "bad");
    setToast(err.message);
  }
}

async function startBot() {
  try {
    saveConnectionFields();
    const warmup = Number($("warmupMinutes").value || 0);
    const data = await api("/api/start", { method: "POST", body: JSON.stringify({ warmup_minutes: warmup }) });
    setToast(data.message || "Start requested");
    await refreshStatus();
  } catch (err) {
    setToast(err.message);
  }
}

async function stopBot() {
  try {
    saveConnectionFields();
    const data = await api("/api/stop", { method: "POST", body: JSON.stringify({ timeout: 15 }) });
    setToast(data.message || "Stop requested");
    await refreshStatus();
  } catch (err) {
    setToast(err.message);
  }
}

async function saveSymbols() {
  try {
    const updates = collectSymbolUpdates();
    const data = await api("/api/config", { method: "POST", body: JSON.stringify({ symbols: updates }) });
    renderSymbols(data.symbols || {}, state.status?.runtime?.symbols || {});
    setToast(`Saved ${data.changed?.length || 0} fields`);
  } catch (err) {
    setToast(err.message);
  }
}

async function loadTrades() {
  try {
    const symbol = $("tradeSymbol").value;
    const suffix = symbol ? `?symbol=${encodeURIComponent(symbol)}&limit=150` : "?limit=150";
    const data = await api(`/api/trades${suffix}`);
    renderTable("tradesTable", data.trades || []);
  } catch (err) {
    setToast(err.message);
  }
}

async function loadPredictions() {
  try {
    const symbol = $("predictionSymbol").value;
    const suffix = symbol ? `?symbol=${encodeURIComponent(symbol)}&limit=250` : "?limit=250";
    const data = await api(`/api/predictions${suffix}`);
    renderTable("predictionsTable", data.predictions || []);
  } catch (err) {
    setToast(err.message);
  }
}

async function runQuery() {
  try {
    const data = await api("/api/query", {
      method: "POST",
      body: JSON.stringify({ sql: $("sqlQuery").value, max_rows: 500 }),
    });
    renderTable("queryTable", data.rows || []);
  } catch (err) {
    setToast(err.message);
  }
}

async function loadLogs() {
  try {
    const data = await api("/api/logs?lines=350");
    $("logOutput").textContent = (data.lines || []).join("\n");
  } catch (err) {
    setToast(err.message);
  }
}

function switchView(viewId) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-view") === viewId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
}

function bindEvents() {
  $("apiUrl").value = state.apiUrl;
  $("apiToken").value = state.token;
  $("connectBtn").addEventListener("click", connect);
  $("refreshOverviewBtn").addEventListener("click", () => refreshStatus().catch((err) => setToast(err.message)));
  $("startBtn").addEventListener("click", startBot);
  $("stopBtn").addEventListener("click", stopBot);
  $("saveSymbolsBtn").addEventListener("click", saveSymbols);
  $("loadTradesBtn").addEventListener("click", loadTrades);
  $("loadPredictionsBtn").addEventListener("click", loadPredictions);
  $("runQueryBtn").addEventListener("click", runQuery);
  $("loadLogsBtn").addEventListener("click", loadLogs);
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.getAttribute("data-view")));
  });
}

bindEvents();
if (state.token) {
  connect();
}
