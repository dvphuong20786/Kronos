// Model selection, Binance combobox, and market data downloading
let binanceSymbolList = [];

async function loadAvailableModels() {
  try {
    const response = await axios.get("/api/available-models");
    if (response.data.model_available) {
      availableModels = response.data.models;
      populateModelSelect();
      console.log("✅ Available models loaded successfully:", availableModels);
    } else {
      console.warn("⚠️ Kronos model library not available");
      showStatus("warning", "Không tìm thấy thư viện mô hình Kronos");
    }
  } catch (error) {
    console.error("❌ Failed to load available models:", error);
    showStatus("error", "Không tải được danh sách mô hình");
  }
}

function populateModelSelect() {
  const modelSelect = document.getElementById("model-select");
  modelSelect.innerHTML = '<option value="">Vui lòng chọn mô hình</option>';

  Object.entries(availableModels).forEach(([key, model]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${model.name} (${model.params}) - ${model.description}`;
    modelSelect.appendChild(option);
  });
  if (availableModels["kronos-mini"]) {
    modelSelect.value = "kronos-mini";
  }
}

async function loadModel() {
  const modelKey = document.getElementById("model-select").value;
  const device = document.getElementById("device-select").value;

  if (!modelKey) {
    showStatus("error", "Vui lòng chọn mô hình", "model-status");
    return;
  }

  const loadModelBtn = document.getElementById("load-model-btn");
  try {
    showLoading(true);
    if (loadModelBtn) loadModelBtn.disabled = true;
    showStatus(
      "info",
      `⏳ Đang tải mô hình ${modelKey} trên ${device.toUpperCase()}...`,
      "model-status",
    );

    const response = await axios.post("/api/load-model", {
      model_key: modelKey,
      device: device,
    });

    if (response.data.success) {
      modelLoaded = true;
      showStatus(
        "success",
        `✅ Đã tải mô hình ${modelKey} trên ${device.toUpperCase()} thành công!`,
        "model-status",
      );
      updatePredictButtonState();
      await loadDataFiles();
      if (getSelectedFilePaths().length > 0) {
        await loadData();
      }
      console.log("✅ Model loaded successfully:", response.data.model_info);
    } else {
      showStatus("error", `❌ ${response.data.error}`, "model-status");
    }
  } catch (error) {
    console.error("❌ Model loading failed:", error);
    showStatus(
      "error",
      `❌ Tải mô hình thất bại: ${error.response?.data?.error || error.message}`,
      "model-status",
    );
  } finally {
    showLoading(false);
    if (loadModelBtn) loadModelBtn.disabled = false;
  }
}

async function updateModelStatus() {
  try {
    const response = await axios.get("/api/model-status");
    const status = response.data;

    if (status.loaded) {
      modelLoaded = true;
      showStatus(
        "success",
        `✅ Đã tải mô hình ${status.current_model.name} trên ${status.current_model.device}`,
        "model-status",
      );
    } else if (status.available) {
      modelLoaded = false;
      showStatus(
        "info",
        "Mô hình sẵn sàng nhưng chưa được tải",
        "model-status",
      );
    } else {
      modelLoaded = false;
      showStatus("warning", "Không tìm thấy thư viện mô hình", "model-status");
    }
    updatePredictButtonState();
  } catch (error) {
    console.error("❌ Failed to get model status:", error);
    modelLoaded = false;
    updatePredictButtonState();
  }
}

function renderBinanceDropdown(query = "") {
  const dropdown = document.getElementById("binance-symbol-dropdown");
  const q = (query || "").trim().toUpperCase();
  const filtered = q
    ? binanceSymbolList.filter(
        (item) =>
          item.symbol.includes(q) ||
          (item.base_asset && item.base_asset.toUpperCase().includes(q)),
      )
    : binanceSymbolList;

  if (filtered.length === 0) {
    dropdown.innerHTML =
      '<div style="padding: 10px 12px; font-size: 13px; color: #718096; text-align: center;">Không tìm thấy cặp phù hợp</div>';
    return;
  }

  dropdown.innerHTML = filtered
    .map(
      (item) => `
          <div class="combobox-item" data-symbol="${item.symbol}" style="padding: 8px 12px; cursor: pointer; font-size: 13px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f7fafc;">
              <span style="font-weight: 600;">${item.symbol}</span>
              <span style="color: #718096; font-size: 12px;">${item.base_asset || ""} / ${item.quote_asset || ""}</span>
          </div>
      `,
    )
    .join("");

  dropdown.querySelectorAll(".combobox-item").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const symbol = el.getAttribute("data-symbol");
      const input = document.getElementById("binance-symbol");
      input.value = symbol;
      dropdown.style.display = "none";
      fetchMarketData("binance");
    });
  });
}

async function loadBinanceSymbols() {
  const countLabel = document.getElementById("binance-symbol-count");
  const input = document.getElementById("binance-symbol");
  const arrow = document.getElementById("binance-symbol-arrow");
  const dropdown = document.getElementById("binance-symbol-dropdown");

  try {
    const response = await axios.get("/api/binance-symbols");
    binanceSymbolList = response.data.symbols || [];
    countLabel.textContent = `Có ${response.data.count} cặp USDT đang giao dịch. Gõ để tìm kiếm.`;
    console.log("✅ Binance symbol list loaded:", response.data.count);
  } catch (error) {
    countLabel.textContent =
      "Không tải được danh sách. Bạn vẫn có thể tự nhập mã cặp Binance.";
    console.error("Failed to load Binance symbols:", error);
  }

  const openDropdown = (filterQuery = "") => {
    renderBinanceDropdown(filterQuery);
    dropdown.style.display = "block";
  };

  input.addEventListener("focus", () => {
    openDropdown(input.value === "BTCUSDT" ? "" : input.value);
    input.select();
  });

  input.addEventListener("input", () => {
    openDropdown(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.style.display = "none";
    } else if (e.key === "Enter") {
      const firstItem = dropdown.querySelector(".combobox-item");
      if (firstItem && dropdown.style.display === "block") {
        e.preventDefault();
        input.value = firstItem.getAttribute("data-symbol");
        dropdown.style.display = "none";
        fetchMarketData("binance");
      } else if (input.value.trim()) {
        e.preventDefault();
        dropdown.style.display = "none";
        fetchMarketData("binance");
      }
    }
  });

  arrow.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.style.display === "block") {
      dropdown.style.display = "none";
    } else {
      input.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (
      !input.contains(e.target) &&
      !arrow.contains(e.target) &&
      !dropdown.contains(e.target)
    ) {
      dropdown.style.display = "none";
    }
  });
}

async function loadConfigStatus() {
  try {
    const response = await axios.get("/api/config-status");
    if (response.data.alpha_vantage_configured) {
      document.getElementById("alpha-api-key").placeholder =
        "Alpha Vantage API key đã được lưu trên máy";
    }
  } catch (error) {
    console.error("Không đọc được trạng thái cấu hình:", error);
  }
}

function getSelectedIntervals() {
  const checked = document.querySelectorAll(
    ".market-interval-checkbox:checked",
  );
  if (checked.length > 0) {
    return Array.from(checked).map((cb) => cb.value);
  }
  const singleSelect = document.getElementById("market-interval");
  return singleSelect ? [singleSelect.value] : ["1h"];
}

function syncSelectAllIntervalsCheckbox() {
  const selectAll = document.getElementById("select-all-intervals");
  if (!selectAll) return;
  const allBoxes = document.querySelectorAll(".market-interval-checkbox");
  const checkedBoxes = document.querySelectorAll(
    ".market-interval-checkbox:checked",
  );
  selectAll.checked =
    allBoxes.length > 0 && allBoxes.length === checkedBoxes.length;
  selectAll.indeterminate =
    checkedBoxes.length > 0 && checkedBoxes.length < allBoxes.length;
}

async function fetchMarketData(market, specificIntervals = null) {
  const buttonMap = {
    binance: "fetch-btc-btn",
    btcusdt: "fetch-btc-btn",
    "gold-paxg": "fetch-gold-btn",
    "gold-alpha": "fetch-gld-btn",
  };
  const button = document.getElementById(buttonMap[market]);
  const intervals =
    specificIntervals && specificIntervals.length > 0
      ? specificIntervals
      : market === "gold-alpha"
        ? ["1w"]
        : getSelectedIntervals();

  if (intervals.length === 0) {
    showStatus(
      "info",
      "Vui lòng tick chọn ít nhất 1 khung thời gian nến.",
      "market-status",
    );
    return;
  }

  const rows = parseInt(document.getElementById("market-rows").value);
  let pairLabel = market;
  if (market === "binance" || market === "btcusdt") {
    pairLabel =
      document.getElementById("binance-symbol").value.trim().toUpperCase() ||
      "BTCUSDT";
  } else if (market === "gold-paxg") {
    pairLabel = "PAXGUSDT (Vàng Binance)";
  } else if (market === "gold-alpha") {
    pairLabel = "GLD ETF (Alpha Vantage)";
  }

  try {
    showLoading(true);
    if (button) button.disabled = true;

    const downloadedPaths = [];
    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      showStatus(
        "info",
        `⏳ Đang tải (${i + 1}/${intervals.length}) ${pairLabel} [${interval}] (${rows} nến)...`,
        "market-status",
      );

      const requestData = {
        market,
        interval,
        rows,
      };
      if (market === "binance") {
        requestData.symbol = document
          .getElementById("binance-symbol")
          .value.trim()
          .toUpperCase();
        if (!requestData.symbol) {
          throw new Error(
            "Vui lòng nhập cặp Binance, ví dụ BTCUSDT hoặc ETHUSDT.",
          );
        }
      }
      if (market === "gold-alpha") {
        requestData.api_key = document
          .getElementById("alpha-api-key")
          .value.trim();
        if (!requestData.api_key) {
          delete requestData.api_key;
        }
      }

      const response = await axios.post("/api/fetch-market-data", requestData);
      if (response.data.file_path) {
        downloadedPaths.push(response.data.file_path);
      }
    }

    await loadDataFiles(true, downloadedPaths);
    showStatus(
      "success",
      `✅ Đã tải xong ${pairLabel} (${intervals.join(", ")} — ${rows} nến/file, đã dọn bản cũ)!`,
      "market-status",
    );
    await loadData();
  } catch (error) {
    console.error("Market data download failed:", error);
    showStatus(
      "error",
      `❌ Tải dữ liệu thị trường thất bại: ${error.response?.data?.error || error.message}`,
      "market-status",
    );
  } finally {
    showLoading(false);
    if (button) button.disabled = false;
  }
}

