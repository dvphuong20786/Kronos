// Application initialization and event listeners
document.addEventListener("DOMContentLoaded", function () {
  initializeApp();
});

async function initializeApp() {
  console.log("🚀 Initializing Kronos Web UI...");

  setupEventListeners();
  initializeTimeSlider();

  await Promise.all([
    loadAvailableModels(),
    updateModelStatus(),
    loadDataFiles(),
  ]);

  loadBinanceSymbols();
  loadConfigStatus();

  if (!modelLoaded && document.getElementById("model-select").value) {
    console.log("🔄 Auto loading model on first entry...");
    await loadModel();
  }

  console.log("✅ Application initialization completed");
}

function setupEventListeners() {
  document
    .getElementById("load-model-btn")
    ?.addEventListener("click", loadModel);

  document.getElementById("model-select")?.addEventListener("change", () => {
    if (document.getElementById("model-select").value) {
      loadModel();
    }
  });
  document.getElementById("device-select")?.addEventListener("change", () => {
    if (document.getElementById("model-select").value) {
      loadModel();
    }
  });

  document.getElementById("load-data-btn")?.addEventListener("click", loadData);

  const selectAllCheckbox = document.getElementById("select-all-files");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", (e) => {
      const checked = e.target.checked;
      document.querySelectorAll(".data-file-checkbox").forEach((cb) => {
        cb.checked = checked;
      });
      loadData();
    });
  }

  document
    .getElementById("fetch-btc-btn")
    ?.addEventListener("click", () => fetchMarketData("binance"));
  document
    .getElementById("fetch-gold-btn")
    ?.addEventListener("click", () => fetchMarketData("gold-paxg"));
  document
    .getElementById("fetch-gld-btn")
    ?.addEventListener("click", () => fetchMarketData("gold-alpha"));

  const selectAllIntervals = document.getElementById("select-all-intervals");
  if (selectAllIntervals) {
    selectAllIntervals.addEventListener("change", (e) => {
      const checked = e.target.checked;
      document
        .querySelectorAll(".market-interval-checkbox")
        .forEach((cb) => (cb.checked = checked));
      if (checked && document.getElementById("binance-symbol")?.value.trim()) {
        fetchMarketData("binance");
      }
    });
  }

  document.querySelectorAll(".market-interval-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      syncSelectAllIntervalsCheckbox();
      if (
        e.target.checked &&
        document.getElementById("binance-symbol")?.value.trim()
      ) {
        fetchMarketData("binance", [e.target.value]);
      }
    });
  });

  document
    .getElementById("predict-btn")
    ?.addEventListener("click", startPrediction);

  document.getElementById("temperature").addEventListener("input", function () {
    document.getElementById("temperature-value").textContent = this.value;
  });

  document.getElementById("top-p").addEventListener("input", function () {
    document.getElementById("top-p-value").textContent = this.value;
  });

  document
    .getElementById("lookback")
    .addEventListener("input", updateSliderFromInputs);
  document
    .getElementById("pred-len")
    .addEventListener("input", updateSliderFromInputs);

  const collapseBtn = document.getElementById("collapse-panel-btn");
  const expandBtn = document.getElementById("expand-panel-btn");
  const mainContent = document.querySelector(".main-content");

  const resizeAllCharts = () => {
    if (!window.Plotly) return;
    document.querySelectorAll(".multi-chart-plot").forEach((el) => {
      Plotly.Plots.resize(el);
    });
  };

  if (collapseBtn && expandBtn && mainContent) {
    collapseBtn.addEventListener("click", () => {
      mainContent.classList.add("panel-collapsed");
      expandBtn.style.display = "inline-flex";
      setTimeout(resizeAllCharts, 60);
    });

    expandBtn.addEventListener("click", () => {
      mainContent.classList.remove("panel-collapsed");
      expandBtn.style.display = "none";
      setTimeout(resizeAllCharts, 60);
    });
  }
}
