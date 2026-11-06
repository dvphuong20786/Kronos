// Trang backtest: tải model, chọn file, gọi /api/backtest rồi vẽ kết quả.

const el = (id) => document.getElementById(id);

// Kết quả + tham số của lần chạy gần nhất, dùng khi bấm "Lưu kết quả"
let lastRun = null;

// ---------- Khởi tạo ----------
document.addEventListener("DOMContentLoaded", async () => {
  loadDataFiles();
  loadSavedList();
  el("bt-run").addEventListener("click", runBacktest);
  el("bt-save").addEventListener("click", saveBacktest);
  el("bt-view-saved").addEventListener("click", viewSavedBacktest);

  // Tự động tải lại khi đổi model hoặc device
  el("bt-model").addEventListener("change", loadModel);
  el("bt-device").addEventListener("change", loadModel);

  el("bt-temperature").addEventListener("input", (e) => {
    el("bt-temperature-val").textContent = e.target.value;
  });
  el("bt-top-p").addEventListener("input", (e) => {
    el("bt-top-p-val").textContent = e.target.value;
  });

  // Kiểm tra trạng thái hoặc tự động tải mô hình ngay khi vào trang
  await checkAndAutoLoadModel();
});

function showModelStatus(type, message) {
  const statusDiv = el("bt-model-status");
  if (!statusDiv) return;
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = "block";
}

async function checkAndAutoLoadModel() {
  try {
    const res = await fetch("/api/model-status");
    const status = await res.json();
    if (status.loaded) {
      showModelStatus(
        "success",
        `✅ Đã tải mô hình ${status.current_model.name} trên ${status.current_model.device}`,
      );
    } else {
      await loadModel();
    }
  } catch (err) {
    showModelStatus("error", "❌ Không kiểm tra được mô hình: " + err);
  }
}

async function loadDataFiles() {
  const res = await fetch("/api/data-files");
  const files = await res.json();
  const select = el("bt-file");
  select.innerHTML = "";
  files.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.path;
    opt.textContent = `${f.name} (${f.size})`;
    select.appendChild(opt);
  });
}

async function refreshModelStatus() {
  try {
    const res = await fetch("/api/model-status");
    const status = await res.json();
    if (status.loaded) {
      showModelStatus(
        "success",
        `✅ Đã tải mô hình ${status.current_model.name} trên ${status.current_model.device}`,
      );
    } else if (status.available) {
      showModelStatus("info", "Mô hình sẵn sàng nhưng chưa được tải");
    } else {
      showModelStatus("warning", "Không tìm thấy thư viện mô hình");
    }
  } catch (err) {
    showModelStatus("error", "❌ Lỗi trạng thái: " + err);
  }
}

async function loadModel() {
  const modelKey = el("bt-model").value;
  const device = el("bt-device").value;
  showModelStatus(
    "info",
    `⏳ Đang tải mô hình ${modelKey} trên ${device.toUpperCase()}...`,
  );
  try {
    const res = await fetch("/api/load-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_key: modelKey, device: device }),
    });
    const data = await res.json();
    if (!res.ok) {
      showModelStatus("error", "❌ " + (data.error || "Tải mô hình thất bại"));
      return;
    }
    showModelStatus(
      "success",
      `✅ Đã tải mô hình ${modelKey} trên ${device.toUpperCase()} thành công!`,
    );
  } catch (err) {
    showModelStatus("error", "❌ " + err);
  }
}

// ---------- Chạy backtest ----------
async function runBacktest() {
  const button = el("bt-run");
  button.disabled = true;
  el("bt-status").textContent = "⏳ Đang chạy backtest, vui lòng chờ...";
  const startedAt = Date.now();

  try {
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: el("bt-file").value,
        model_key: el("bt-model").value,
        lookback: Number(el("bt-lookback").value),
        pred_len: Number(el("bt-predlen").value),
        step: Number(el("bt-step").value),
        max_windows: Number(el("bt-max").value),
        temperature: Number(el("bt-temperature").value),
        top_p: Number(el("bt-top-p").value),
        sample_count: Number(el("bt-sample-count").value),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      el("bt-status").textContent = "❌ " + data.error;
      return;
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    el("bt-status").textContent = `✅ Xong trong ${seconds} giây`;
    renderAll(data);
    lastRun = { result: data, file_path: el("bt-file").value, model_key: el("bt-model").value };
    el("bt-save").disabled = false;
  } catch (err) {
    el("bt-status").textContent = "❌ " + err;
  } finally {
    button.disabled = false;
  }
}

// ---------- Hiển thị ----------
function card(value, label, cssClass = "") {
  return `<div class="bt-card"><div class="value ${cssClass}">${value}</div><div class="label">${label}</div></div>`;
}

function renderSummary(s) {
  const accClass = s.accuracy_pct >= 50 ? "bt-good" : "bt-bad";
  el("bt-summary").innerHTML =
    card(`${s.accuracy_pct.toFixed(1)}%`, "Tỉ lệ đoán đúng hướng", accClass) +
    card(`<span class="bt-good">${s.correct}</span> / <span class="bt-bad">${s.wrong}</span>`, `Đúng / Sai (${s.windows} lần)`) +
    card(`${s.avg_mape.toFixed(2)}%`, "Sai số giá trung bình (MAPE)") +
    card(`${s.avg_inside_range_pct.toFixed(1)}%`, "Giá thật nằm trong vùng High-Low dự báo");
}

function renderChart(data) {
  // Đường giá thật màu xám làm nền
  const traces = [
    {
      x: data.actual_series.timestamps,
      y: data.actual_series.close,
      type: "scatter",
      mode: "lines",
      name: "Giá thật (close)",
      line: { color: "#4a5568", width: 1.5 },
    },
  ];

  // Mỗi lần dự báo là 1 đoạn: xanh nếu đúng hướng, đỏ nếu sai
  data.windows.forEach((w) => {
    traces.push({
      x: w.timestamps,
      y: w.pred_close,
      type: "scatter",
      mode: "lines",
      name: `#${w.index} ${w.direction_correct ? "Đúng" : "Sai"}`,
      line: { color: w.direction_correct ? "#38a169" : "#e53e3e", width: 2 },
      showlegend: false,
      hovertemplate: `#${w.index} dự báo: %{y:.2f}<extra></extra>`,
    });
  });

  Plotly.newPlot("bt-chart", traces, {
    title: "Giá thật (xám) và các lần dự báo (xanh = đúng hướng, đỏ = sai hướng)",
    margin: { t: 40, l: 60, r: 20, b: 40 },
    hovermode: "closest",
  });
}

function directionText(d) {
  return d === "up" ? "▲ Tăng" : d === "down" ? "▼ Giảm" : "= Đi ngang";
}

function renderTable(windows) {
  const rows = windows
    .map(
      (w) => `
      <tr>
        <td>#${w.index}</td>
        <td class="left">${w.forecast_start.slice(0, 16)} → ${w.forecast_end.slice(0, 16)}</td>
        <td>${directionText(w.pred_direction)} (${w.pred_change_pct.toFixed(2)}%)</td>
        <td>${directionText(w.actual_direction)} (${w.actual_change_pct.toFixed(2)}%)</td>
        <td class="${w.direction_correct ? "bt-good" : "bt-bad"}">${w.direction_correct ? "✔ Đúng" : "✘ Sai"}</td>
        <td>${w.mape.toFixed(2)}%</td>
        <td>${w.inside_range_pct.toFixed(1)}%</td>
      </tr>`
    )
    .join("");

  el("bt-table-wrap").innerHTML = `
    <table class="bt-table">
      <thead>
        <tr>
          <th>Lần</th><th>Khoảng dự báo</th><th>Dự báo</th><th>Thực tế</th>
          <th>Kết quả</th><th>MAPE</th><th>Trong vùng H-L</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}


// Vẽ toàn bộ kết quả (dùng chung cho chạy mới và xem lại)
function renderAll(data) {
  renderSummary(data.summary);
  renderChart(data);
  renderTable(data.windows);
}

// ---------- Lưu / xem lại ----------
async function saveBacktest() {
  if (!lastRun) return;
  const res = await fetch("/api/backtest/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lastRun),
  });
  const data = await res.json();
  if (!res.ok) {
    el("bt-saved-status").textContent = "❌ " + data.error;
    return;
  }
  el("bt-saved-status").textContent = "✅ Đã lưu";
  el("bt-save").disabled = true; // tránh bấm lưu trùng 1 kết quả
  await loadSavedList();
  el("bt-saved").value = data.id;
}

async function loadSavedList() {
  const res = await fetch("/api/backtest/saved");
  const items = await res.json();
  const select = el("bt-saved");
  select.innerHTML = items.length ? "" : '<option value="">(chưa có)</option>';
  items.forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.id;
    // Ví dụ: 06/11 19:20 | BTCUSDT 4h | kronos-mini | cpu | 400→120 | 20 lần | 55.0%
    const time = it.saved_at.replace("T", " ").slice(5, 16);
    const pair = it.symbol ? `${it.symbol} ${it.interval}` : it.data_file;
    const parts = [time, pair, it.model_key, it.device, `${it.lookback}→${it.pred_len}`, `${it.windows} lần`, `${it.accuracy_pct.toFixed(1)}%`];
    opt.textContent = parts.filter(Boolean).join(" | ");
    select.appendChild(opt);
  });
}

async function viewSavedBacktest() {
  const id = el("bt-saved").value;
  if (!id) return;
  const res = await fetch(`/api/backtest/saved/${id}`);
  const record = await res.json();
  if (!res.ok) {
    el("bt-saved-status").textContent = "❌ " + record.error;
    return;
  }
  renderAll(record.result);
  const pair = record.symbol ? `${record.symbol} ${record.interval}` : record.data_file;
  el("bt-saved-status").textContent = `📂 Đang xem: ${pair} | ${record.model_key} | ${record.device || "?"} | lưu lúc ${record.saved_at.replace("T", " ")}`;
}
