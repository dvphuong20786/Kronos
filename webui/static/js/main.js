// Global variables
      let currentDataFile = null;
      let currentDataInfo = null;
      let selectedDataFiles = [];
      let loadedDataInfos = {};
      let availableModels = [];
      let modelLoaded = false;

      // Initialize after page loads
      document.addEventListener("DOMContentLoaded", function () {
        initializeApp();
      });

      // Initialize application
      async function initializeApp() {
        console.log("🚀 Initializing Kronos Web UI...");

        // Set up event listeners and slider immediately
        setupEventListeners();
        initializeTimeSlider();

        // Load data file list and available models in parallel
        await Promise.all([
          loadAvailableModels(),
          updateModelStatus(),
          loadDataFiles(),
        ]);

        // Start loading Binance symbols and config in background (non-blocking)
        loadBinanceSymbols();
        loadConfigStatus();

        // Auto-load model on first visit if not loaded yet
        if (!modelLoaded && document.getElementById("model-select").value) {
          console.log("🔄 Auto loading model on first entry...");
          await loadModel();
        }

        console.log("✅ Application initialization completed");
      }

      // Load available models
      async function loadAvailableModels() {
        try {
          const response = await axios.get("/api/available-models");
          if (response.data.model_available) {
            availableModels = response.data.models;
            populateModelSelect();
            console.log(
              "✅ Available models loaded successfully:",
              availableModels,
            );
          } else {
            console.warn("⚠️ Kronos model library not available");
            showStatus("warning", "Không tìm thấy thư viện mô hình Kronos");
          }
        } catch (error) {
          console.error("❌ Failed to load available models:", error);
          showStatus("error", "Không tải được danh sách mô hình");
        }
      }

      let binanceSymbolList = [];

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

      // Populate model selection dropdown
      function populateModelSelect() {
        const modelSelect = document.getElementById("model-select");
        modelSelect.innerHTML =
          '<option value="">Vui lòng chọn mô hình</option>';

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

      async function fetchMarketData(market) {
        const buttonMap = {
          binance: "fetch-btc-btn",
          btcusdt: "fetch-btc-btn",
          "gold-paxg": "fetch-gold-btn",
          "gold-alpha": "fetch-gld-btn",
        };
        const button = document.getElementById(buttonMap[market]);
        const interval = document.getElementById("market-interval").value;
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
          showStatus(
            "info",
            `⏳ Đang tải dữ liệu ${pairLabel} (${interval}, ${rows} nến)...`,
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
          const response = await axios.post(
            "/api/fetch-market-data",
            requestData,
          );
          await loadDataFiles(true, response.data.file_path);
          showStatus(
            "success",
            `✅ Đã tải xong ${pairLabel} (${interval}, ${rows} nến)!`,
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

      // Load model
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
            console.log(
              "✅ Model loaded successfully:",
              response.data.model_info,
            );
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

      // Update model status
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
            showStatus("info", "Mô hình sẵn sàng nhưng chưa được tải", "model-status");
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

      function getSelectedFilePaths() {
        const checkboxes = document.querySelectorAll(
          ".data-file-checkbox:checked",
        );
        return Array.from(checkboxes).map((cb) => cb.value);
      }

      function syncSelectAllCheckbox() {
        const selectAll = document.getElementById("select-all-files");
        if (!selectAll) return;
        const allBoxes = document.querySelectorAll(".data-file-checkbox");
        const checkedBoxes = document.querySelectorAll(
          ".data-file-checkbox:checked",
        );
        selectAll.checked =
          allBoxes.length > 0 && allBoxes.length === checkedBoxes.length;
        selectAll.indeterminate =
          checkedBoxes.length > 0 && checkedBoxes.length < allBoxes.length;
      }

      function updatePredictButtonState() {
        const button = document.getElementById("predict-btn");
        const requirement = document.getElementById("predict-requirement");
        const hasData =
          selectedDataFiles.length > 0 || Boolean(currentDataFile);
        button.disabled = !hasData;

        if (modelLoaded && hasData) {
          requirement.textContent = `Sẵn sàng dự báo (${selectedDataFiles.length || 1} file đã chọn).`;
          requirement.style.color = "#2f855a";
        } else if (!modelLoaded && hasData) {
          requirement.textContent = `Đã chọn ${selectedDataFiles.length || 1} file. Bấm dự báo sẽ tự động tải mô hình nếu chưa tải.`;
          requirement.style.color = "#2f855a";
        } else if (!modelLoaded && !hasData) {
          requirement.textContent =
            "Cần tải mô hình và tick chọn file dữ liệu trước khi dự báo.";
          requirement.style.color = "#718096";
        } else {
          requirement.textContent =
            "Mô hình đã sẵn sàng. Hãy tick chọn file dữ liệu.";
          requirement.style.color = "#b7791f";
        }
      }

      // Load data file list
      async function loadDataFiles(
        preserveSelection = true,
        newlyFetchedPath = null,
      ) {
        try {
          const previousSelected = preserveSelection
            ? new Set(getSelectedFilePaths())
            : new Set();
          if (newlyFetchedPath) {
            previousSelected.add(newlyFetchedPath);
          }

          const response = await axios.get("/api/data-files");
          const dataFiles = response.data;

          const dataFileList = document.getElementById("data-file-list");
          dataFileList.innerHTML = "";

          if (!dataFiles || dataFiles.length === 0) {
            dataFileList.innerHTML =
              '<div style="padding: 8px; color: #718096; font-size: 13px">Chưa có file dữ liệu trong thư mục data</div>';
            return;
          }

          dataFiles.forEach((file) => {
            const label = document.createElement("label");
            label.className = "file-checkbox-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "data-file-checkbox";
            checkbox.value = file.path;
            checkbox.dataset.name = file.name;
            checkbox.checked = previousSelected.has(file.path);

            checkbox.addEventListener("change", () => {
              syncSelectAllCheckbox();
              loadData();
            });

            const span = document.createElement("span");
            span.textContent = `${file.name} (${file.size})`;

            label.appendChild(checkbox);
            label.appendChild(span);
            dataFileList.appendChild(label);
          });

          syncSelectAllCheckbox();
          console.log("✅ Data file list loaded successfully:", dataFiles);
        } catch (error) {
          console.error("❌ Failed to load data file list:", error);
          showStatus(
            "error",
            "Không tải được danh sách file dữ liệu",
            "data-status",
          );
        }
      }

      // Load data file(s)
      async function loadData() {
        const filePaths = getSelectedFilePaths();

        if (filePaths.length === 0) {
          selectedDataFiles = [];
          currentDataFile = null;
          currentDataInfo = null;
          document.getElementById("data-info").style.display = "none";
          showStatus(
            "info",
            "Chưa chọn file dữ liệu nào. Hãy tick chọn ít nhất 1 file.",
            "data-status",
          );
          updatePredictButtonState();
          return;
        }

        const fileNames = filePaths.map((p) => p.split(/[/\\]/).pop());
        const loadDataBtn = document.getElementById("load-data-btn");

        try {
          showLoading(true);
          if (loadDataBtn) loadDataBtn.disabled = true;
          showStatus(
            "info",
            `⏳ Đang nạp ${filePaths.length} file: ${fileNames.join(", ")}...`,
            "data-status",
          );

          const loadedSummary = [];
          for (const filePath of filePaths) {
            const fName = filePath.split(/[/\\]/).pop();
            const response = await axios.post("/api/load-data", {
              file_path: filePath,
            });
            if (response.data.success) {
              loadedDataInfos[filePath] = response.data.data_info;
              loadedSummary.push(
                `${fName} (${response.data.data_info.rows} nến)`,
              );
            } else {
              throw new Error(`${fName}: ${response.data.error}`);
            }
          }

          selectedDataFiles = filePaths;
          currentDataFile = filePaths[filePaths.length - 1];
          currentDataInfo = loadedDataInfos[currentDataFile];
          showDataInfo(currentDataInfo);

          showStatus(
            "success",
            `✅ Đã nạp thành công (${filePaths.length} file): ${loadedSummary.join(" | ")}`,
            "data-status",
          );

          updatePredictButtonState();
        } catch (error) {
          console.error("❌ Data loading failed:", error);
          showStatus(
            "error",
            `❌ Nạp dữ liệu thất bại: ${error.response?.data?.error || error.message}`,
            "data-status",
          );
        } finally {
          showLoading(false);
          if (loadDataBtn) loadDataBtn.disabled = false;
        }
      }

      // Display data information
      function showDataInfo(dataInfo) {
        document.getElementById("data-info").style.display = "block";
        document.getElementById("data-rows").textContent = dataInfo.rows;
        document.getElementById("data-cols").textContent =
          dataInfo.columns.length;
        document.getElementById("data-time-range").textContent =
          `${dataInfo.start_date} to ${dataInfo.end_date}`;
        document.getElementById("data-price-range").textContent =
          `${dataInfo.price_range.min.toFixed(4)} - ${dataInfo.price_range.max.toFixed(4)}`;
        document.getElementById("data-timeframe").textContent =
          dataInfo.timeframe;
        document.getElementById("data-prediction-cols").textContent =
          dataInfo.prediction_columns.join(", ");

        // Initialize time window slider
        initializeTimeWindowSlider(dataInfo);
      }

      // Time window slider related variables
      let sliderData = null;
      let isDragging = false;
      let currentHandle = null;

      // Initialize time window slider
      function initializeTimeSlider() {
        // Set up slider event listeners
        setupSliderEventListeners();
      }

      function getWindowConfig() {
        const lookback =
          parseInt(document.getElementById("lookback").value) || 400;
        const predLen = Math.max(
          1,
          Math.min(
            500,
            parseInt(document.getElementById("pred-len").value) || 120,
          ),
        );
        return { lookback, predLen, windowSize: lookback + predLen };
      }

      // Set up slider event listeners
      function setupSliderEventListeners() {
        const startHandle = document.getElementById("start-handle");
        const endHandle = document.getElementById("end-handle");
        const track = document.querySelector(".slider-track");

        // Start dragging
        startHandle.addEventListener("mousedown", (e) => {
          isDragging = true;
          currentHandle = "start";
          e.preventDefault();
        });

        endHandle.addEventListener("mousedown", (e) => {
          isDragging = true;
          currentHandle = "end";
          e.preventDefault();
        });

        // Dragging
        document.addEventListener("mousemove", (e) => {
          if (!isDragging) return;

          const rect = track.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percentage = Math.max(0, Math.min(1, x / rect.width));

          if (currentHandle === "start") {
            updateStartHandle(percentage);
          } else if (currentHandle === "end") {
            updateEndHandle(percentage);
          }

          updateSliderFromHandles();
        });

        // End dragging
        document.addEventListener("mouseup", () => {
          isDragging = false;
          currentHandle = null;
        });

        // Click track to set position directly
        track.addEventListener("click", (e) => {
          const rect = track.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percentage = Math.max(0, Math.min(1, x / rect.width));

          // Determine which handle is closer to the click position
          const startHandle = document.getElementById("start-handle");
          const endHandle = document.getElementById("end-handle");
          const startRect = startHandle.getBoundingClientRect();
          const endRect = endHandle.getBoundingClientRect();

          if (
            Math.abs(x - (startRect.left - rect.left)) <
            Math.abs(x - (endRect.left - rect.left))
          ) {
            updateStartHandle(percentage);
          } else {
            updateEndHandle(percentage);
          }

          updateSliderFromHandles();
        });
      }

      // Update start handle position
      function updateStartHandle(percentage) {
        const startHandle = document.getElementById("start-handle");
        const selection = document.getElementById("slider-selection");

        const { windowSize } = getWindowConfig();
        const totalRows = sliderData ? sliderData.totalRows : 1000;
        const windowPercentage = windowSize / totalRows;

        // Ensure start handle doesn't cause window to exceed data range
        if (percentage + windowPercentage > 1) {
          percentage = 1 - windowPercentage;
        }

        startHandle.style.left = percentage * 100 + "%";
        selection.style.left = percentage * 100 + "%";
        selection.style.width = windowPercentage * 100 + "%";

        // Automatically adjust end handle position to maintain fixed window size
        const endHandle = document.getElementById("end-handle");
        endHandle.style.left = (percentage + windowPercentage) * 100 + "%";
      }

      // Update end handle position
      function updateEndHandle(percentage) {
        const endHandle = document.getElementById("end-handle");
        const selection = document.getElementById("slider-selection");

        const { windowSize } = getWindowConfig();
        const totalRows = sliderData ? sliderData.totalRows : 1000;
        const windowPercentage = windowSize / totalRows;

        // Ensure end handle doesn't cause window to exceed data range
        if (percentage - windowPercentage < 0) {
          percentage = windowPercentage;
        }

        endHandle.style.left = percentage * 100 + "%";
        selection.style.left = (percentage - windowPercentage) * 100 + "%";
        selection.style.width = windowPercentage * 100 + "%";

        // Automatically adjust start handle position to maintain fixed window size
        const startHandle = document.getElementById("start-handle");
        startHandle.style.left = (percentage - windowPercentage) * 100 + "%";
      }

      // Update slider display based on handle positions
      function updateSliderFromHandles() {
        const startHandle = document.getElementById("start-handle");
        const endHandle = document.getElementById("end-handle");

        const startPercentage = parseFloat(startHandle.style.left) / 100;
        const endPercentage = parseFloat(endHandle.style.left) / 100;

        if (!sliderData) return;

        // Calculate selected time range
        const totalTime =
          sliderData.endDate.getTime() - sliderData.startDate.getTime();
        const startTime =
          sliderData.startDate.getTime() + totalTime * startPercentage;
        const endTime =
          sliderData.startDate.getTime() + totalTime * endPercentage;

        const startDate = new Date(startTime);
        const endDate = new Date(endTime);

        // Update display information
        document.getElementById("window-start").textContent =
          `Bắt đầu: ${startDate.toLocaleDateString("vi-VN")}`;
        document.getElementById("window-end").textContent =
          `Kết thúc: ${endDate.toLocaleDateString("vi-VN")}`;

        const { lookback, predLen, windowSize } = getWindowConfig();
        document.getElementById("window-size").textContent =
          `Cửa sổ: ${lookback} + ${predLen} = ${windowSize} nến`;
      }

      // Update slider based on input fields
      function updateSliderFromInputs() {
        if (!sliderData) return;

        const { lookback, predLen, windowSize } = getWindowConfig();

        // Calculate slider position
        const totalRows = sliderData.totalRows;

        if (windowSize > totalRows) {
          // If window size exceeds total data amount, show error
          showStatus(
            "error",
            `Không đủ dữ liệu: cần ít nhất ${windowSize} nến, hiện có ${totalRows}`,
          );
          return;
        }

        // Default to the newest possible 520-candle window, aligned right.
        const startPercentage = Math.max(0, 1 - windowSize / totalRows);
        const endPercentage = startPercentage + windowSize / totalRows;

        // Update handle positions
        updateStartHandle(startPercentage);
        updateEndHandle(endPercentage);

        // Update display information
        updateSliderFromHandles();
      }

      // Initialize time window slider
      function initializeTimeWindowSlider(dataInfo) {
        sliderData = {
          startDate: new Date(dataInfo.start_date),
          endDate: new Date(dataInfo.end_date),
          totalRows: dataInfo.rows,
          timeframe: dataInfo.timeframe,
        };

        // Set slider labels
        document.getElementById("min-label").textContent =
          dataInfo.start_date.split("T")[0];
        document.getElementById("max-label").textContent =
          dataInfo.end_date.split("T")[0];

        // Initialize slider position
        updateSliderFromInputs();
      }

      // Start prediction (supports 1 or multiple selected files)
      async function startPrediction() {
        const filesToPredict =
          selectedDataFiles.length > 0
            ? selectedDataFiles
            : currentDataFile
              ? [currentDataFile]
              : [];

        if (filesToPredict.length === 0) {
          showStatus(
            "error",
            "Vui lòng tick chọn và nạp ít nhất 1 file dữ liệu trước",
            "data-status",
          );
          return;
        }

        if (!modelLoaded) {
          await loadModel();
          if (!modelLoaded) {
            return;
          }
        }

        try {
          showLoading(true);
          document.getElementById("predict-btn").disabled = true;

          const lookback = parseInt(document.getElementById("lookback").value);
          const predLen = parseInt(document.getElementById("pred-len").value);
          const isFutureMode = document.getElementById("future-mode").checked;

          // Get selected percentage from time window slider
          const startHandle = document.getElementById("start-handle");
          const startPercentage =
            parseFloat(startHandle.style.left || "0") / 100;

          if (!isFutureMode && !sliderData) {
            showStatus(
              "error",
              "Thanh chọn thời gian chưa được khởi tạo",
              "data-status",
            );
            return;
          }

          // Get prediction quality parameters
          const temperature = parseFloat(
            document.getElementById("temperature").value,
          );
          const topP = parseFloat(document.getElementById("top-p").value);
          const sampleCount = parseInt(
            document.getElementById("sample-count").value,
          );

          const multiContainer = document.getElementById(
            "multi-results-container",
          );
          multiContainer.innerHTML = "";
          document.getElementById("chart").style.display = "none";
          document.getElementById("comparison-section").style.display = "none";

          let successCount = 0;
          for (let idx = 0; idx < filesToPredict.length; idx++) {
            const filePath = filesToPredict[idx];
            const fileName = filePath.split(/[/\\]/).pop();

            const requirement = document.getElementById("predict-requirement");
            requirement.textContent = `⏳ Đang dự báo (${idx + 1}/${filesToPredict.length}): ${fileName}...`;
            requirement.style.color = "#2b6cb0";

            let predictionParams = {
              file_path: filePath,
              lookback: lookback,
              pred_len: predLen,
              temperature: temperature,
              top_p: topP,
              sample_count: sampleCount,
            };

            if (!isFutureMode) {
              const fileInfo = loadedDataInfos[filePath] || currentDataInfo;
              if (fileInfo) {
                const fStart = new Date(fileInfo.start_date);
                const fEnd = new Date(fileInfo.end_date);
                const totalTime = fEnd.getTime() - fStart.getTime();
                const startTime =
                  fStart.getTime() + totalTime * startPercentage;
                const startDate = new Date(startTime);
                predictionParams.start_date = startDate
                  .toISOString()
                  .slice(0, 16);
              }
            }

            console.log(
              `🚀 Starting prediction (${idx + 1}/${filesToPredict.length}):`,
              predictionParams,
            );

            const response = await axios.post("/api/predict", predictionParams);

            if (response.data.success) {
              successCount++;
              renderPredictionCard(
                response.data,
                fileName,
                idx,
                filesToPredict.length,
              );
            } else {
              throw new Error(`${fileName}: ${response.data.error}`);
            }
          }

          showStatus(
            "success",
            `✅ Đã hoàn tất dự báo cho ${successCount}/${filesToPredict.length} file!`,
            "data-status",
          );
        } catch (error) {
          console.error("❌ Prediction failed:", error);
          showStatus(
            "error",
            `❌ Dự báo thất bại: ${error.response?.data?.error || error.message}`,
            "data-status",
          );
        } finally {
          showLoading(false);
          updatePredictButtonState();
        }
      }

      // Render a stacked prediction card for each file
      function renderPredictionCard(result, fileName, index, totalCount) {
        const multiContainer = document.getElementById(
          "multi-results-container",
        );

        const card = document.createElement("div");
        card.className = "multi-result-card";

        const chartDivId = `chart-item-${index}`;
        const predictions = result.prediction_results || [];
        const actuals = result.actual_data || [];
        const errorStats = getPredictionQuality(predictions, actuals);
        const hasActuals = actuals.length > 0;

        const minLen = hasActuals
          ? Math.min(predictions.length, actuals.length)
          : predictions.length;
        const fmt = (v) => (v === undefined ? "—" : v.toFixed(4));

        let rowsHtml = "";
        for (let i = minLen - 1; i >= 0; i--) {
          const pred = predictions[i];
          const act = actuals[i] || {};
          rowsHtml += `
            <tr>
              <td>${new Date(pred.timestamp).toLocaleString()}</td>
              <td>${fmt(act.open)}</td>
              <td>${pred.open.toFixed(4)}</td>
              <td>${fmt(act.high)}</td>
              <td>${pred.high.toFixed(4)}</td>
              <td>${fmt(act.low)}</td>
              <td>${pred.low.toFixed(4)}</td>
              <td>${fmt(act.close)}</td>
              <td>${pred.close.toFixed(4)}</td>
            </tr>
          `;
        }

        card.innerHTML = `
          <h3 class="result-file-title">📈 [${index + 1}/${totalCount}] File: ${fileName}</h3>
          <div id="${chartDivId}" class="multi-chart-plot" style="width: 100%; height: 600px;"></div>
          <div class="comparison-section" style="margin-top: 16px;">
            <h3>📊 Chi tiết kết quả & đối chiếu (${fileName})</h3>
            <div class="comparison-info">
              <p><strong>Loại dự báo:</strong> <span>${result.prediction_type}</span></p>
              <p><strong>Dữ liệu đối chiếu:</strong> <span>${hasActuals ? `${actuals.length} nến thực tế` : "Dự báo tương lai (chưa có nến thực tế)"}</span></p>
            </div>
            ${
              hasActuals
                ? `
            <div class="error-stats">
              <div class="error-stat">
                <h4>Sai số tuyệt đối trung bình</h4>
                <div class="value">${errorStats.mae.toFixed(4)}</div>
                <div class="unit">Đơn vị giá</div>
              </div>
              <div class="error-stat">
                <h4>Căn sai số bình phương trung bình</h4>
                <div class="value">${errorStats.rmse.toFixed(4)}</div>
                <div class="unit">Đơn vị giá</div>
              </div>
              <div class="error-stat">
                <h4>Sai số phần trăm tuyệt đối trung bình</h4>
                <div class="value">${errorStats.mape.toFixed(2)}</div>
                <div class="unit">%</div>
              </div>
            </div>`
                : ""
            }
            <div class="error-details">
              <h4>Chi tiết dữ liệu nến (Mới nhất lên đầu):</h4>
              <div style="max-height: 300px; overflow-y: auto">
                <table class="comparison-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Mở cửa thực tế</th>
                      <th>Mở cửa dự báo</th>
                      <th>Cao nhất thực tế</th>
                      <th>Cao nhất dự báo</th>
                      <th>Thấp nhất thực tế</th>
                      <th>Thấp nhất dự báo</th>
                      <th>Đóng cửa thực tế</th>
                      <th>Đóng cửa dự báo</th>
                    </tr>
                  </thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </div>
            </div>
          </div>
        `;

        multiContainer.appendChild(card);

        const chartData = JSON.parse(result.chart);
        if (chartData.layout) {
          chartData.layout.title = `${fileName} — ${chartData.layout.title || ""}`;
        }
        Plotly.newPlot(chartDivId, chartData.data, chartData.layout, {
          responsive: true,
        });
      }

      // Display comparison analysis
      function displayComparisonAnalysis(result) {
        document.getElementById("comparison-section").style.display = "block";

        // Update comparison information
        document.getElementById("prediction-type").textContent =
          result.prediction_type;
        document.getElementById("comparison-data").textContent =
          `${result.actual_data.length} actual data points`;

        // Calculate error statistics
        const errorStats = getPredictionQuality(
          result.prediction_results,
          result.actual_data,
        );

        // Display error statistics
        document.getElementById("mae").textContent = errorStats.mae.toFixed(4);
        document.getElementById("rmse").textContent =
          errorStats.rmse.toFixed(4);
        document.getElementById("mape").textContent =
          errorStats.mape.toFixed(2);

        // Fill comparison table
        fillComparisonTable(result.prediction_results, result.actual_data);
      }

      // Calculate prediction quality metrics
      function getPredictionQuality(predictions, actuals) {
        if (
          !predictions ||
          !actuals ||
          predictions.length === 0 ||
          actuals.length === 0
        ) {
          return { mae: 0, rmse: 0, mape: 0 };
        }

        const minLen = Math.min(predictions.length, actuals.length);
        let mae = 0,
          rmse = 0,
          mape = 0;

        for (let i = 0; i < minLen; i++) {
          const pred = predictions[i];
          const act = actuals[i];

          // Use closing price to calculate errors
          const error = Math.abs(pred.close - act.close);
          const percentError = (error / act.close) * 100;

          mae += error;
          rmse += error * error;
          mape += percentError;
        }

        mae /= minLen;
        rmse = Math.sqrt(rmse / minLen);
        mape /= minLen;

        return { mae, rmse, mape };
      }

      // Fill comparison table
      function fillComparisonTable(predictions, actuals) {
        const tbody = document.getElementById("comparison-tbody");
        tbody.innerHTML = "";

        const minLen =
          actuals.length > 0
            ? Math.min(predictions.length, actuals.length)
            : predictions.length;
        const fmt = (v) => (v === undefined ? "—" : v.toFixed(4));

        for (let i = minLen - 1; i >= 0; i--) {
          const pred = predictions[i];
          const act = actuals[i] || {};

          const row = document.createElement("tr");
          row.innerHTML = `
                    <td>${new Date(pred.timestamp).toLocaleString()}</td>
                    <td>${fmt(act.open)}</td>
                    <td>${pred.open.toFixed(4)}</td>
                    <td>${fmt(act.high)}</td>
                    <td>${pred.high.toFixed(4)}</td>
                    <td>${fmt(act.low)}</td>
                    <td>${pred.low.toFixed(4)}</td>
                    <td>${fmt(act.close)}</td>
                    <td>${pred.close.toFixed(4)}</td>
                `;
          tbody.appendChild(row);
        }
      }

      // Set up event listeners
      function setupEventListeners() {
        // Load model button (optional if commented out)
        document
          .getElementById("load-model-btn")
          ?.addEventListener("click", loadModel);

        // Auto load model when model or device selection changes
        document
          .getElementById("model-select")
          ?.addEventListener("change", () => {
            if (document.getElementById("model-select").value) {
              loadModel();
            }
          });
        document
          .getElementById("device-select")
          ?.addEventListener("change", () => {
            if (document.getElementById("model-select").value) {
              loadModel();
            }
          });

        // Load data button (optional if commented out)
        document
          .getElementById("load-data-btn")
          ?.addEventListener("click", loadData);

        // Select / deselect all data files
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

        // Auto fetch Binance data when candle interval changes
        document
          .getElementById("market-interval")
          ?.addEventListener("change", () => {
            if (document.getElementById("binance-symbol")?.value.trim()) {
              fetchMarketData("binance");
            }
          });

        // Prediction button
        document
          .getElementById("predict-btn")
          ?.addEventListener("click", startPrediction);

        // Prediction quality parameter sliders
        document
          .getElementById("temperature")
          .addEventListener("input", function () {
            document.getElementById("temperature-value").textContent =
              this.value;
          });

        document.getElementById("top-p").addEventListener("input", function () {
          document.getElementById("top-p-value").textContent = this.value;
        });

        // Update slider when lookback window size changes
        document
          .getElementById("lookback")
          .addEventListener("input", updateSliderFromInputs);
        document
          .getElementById("pred-len")
          .addEventListener("input", updateSliderFromInputs);

        // Toggle control panel collapse / expand
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

      // Display status information
      function showStatus(type, message, targetId = "model-status") {
        const statusDiv =
          document.getElementById(targetId) ||
          document.getElementById("model-status");
        if (!statusDiv) return;
        statusDiv.className = `status ${type}`;
        statusDiv.textContent = message;
        statusDiv.style.display = "block";
      }

      // Show/hide loading status
      function showLoading(show) {
        const loadingDiv = document.getElementById("loading");
        if (show) {
          loadingDiv.classList.add("show");
        } else {
          loadingDiv.classList.remove("show");
        }
      }
