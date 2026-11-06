// Data file list, file loading, and time window slider
let sliderData = null;
let isDragging = false;
let currentHandle = null;

async function loadDataFiles(
  preserveSelection = true,
  newlyFetchedPaths = null,
) {
  try {
    const previousSelected = preserveSelection
      ? new Set(getSelectedFilePaths())
      : new Set();
    if (newlyFetchedPaths) {
      if (Array.isArray(newlyFetchedPaths)) {
        newlyFetchedPaths.forEach((p) => previousSelected.add(p));
      } else {
        previousSelected.add(newlyFetchedPaths);
      }
    }

    const modelKey =
      document.getElementById("model-select")?.value || "kronos-mini";
    const response = await axios.get("/api/data-files", {
      params: { model_key: modelKey },
    });
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
      span.textContent = `${file.name} (${file.size})${file.has_prediction ? " 📈" : ""}`;
      if (file.has_prediction) {
        span.title = "Đã có kết quả dự báo lưu sẵn";
      }

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

async function loadData() {
  const filePaths = getSelectedFilePaths();
  const multiContainer = document.getElementById("multi-results-container");
  const multiDetailsContainer = document.getElementById(
    "multi-details-container",
  );

  if (filePaths.length === 0) {
    selectedDataFiles = [];
    currentDataFile = null;
    currentDataInfo = null;
    document.getElementById("data-info").style.display = "none";
    if (multiContainer) multiContainer.innerHTML = "";
    if (multiDetailsContainer) multiDetailsContainer.innerHTML = "";
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

    const modelKey =
      document.getElementById("model-select")?.value || "kronos-mini";
    const loadedSummary = [];
    const cachedItems = [];
    for (const filePath of filePaths) {
      const fName = filePath.split(/[/\\]/).pop();
      const response = await axios.post("/api/load-data", {
        file_path: filePath,
        model_key: modelKey,
      });
      if (response.data.success) {
        loadedDataInfos[filePath] = response.data.data_info;
        const cachedPred = response.data.cached_prediction;
        loadedSummary.push(
          `${fName} (${response.data.data_info.rows} nến${cachedPred ? " - đã khôi phục biểu đồ" : ""})`,
        );
        if (cachedPred) {
          cachedItems.push({ fileName: fName, data: cachedPred });
        }
      } else {
        throw new Error(`${fName}: ${response.data.error}`);
      }
    }

    selectedDataFiles = filePaths;
    currentDataFile = filePaths[filePaths.length - 1];
    currentDataInfo = loadedDataInfos[currentDataFile];
    showDataInfo(currentDataInfo);

    if (multiContainer) multiContainer.innerHTML = "";
    if (multiDetailsContainer) multiDetailsContainer.innerHTML = "";
    if (cachedItems.length > 0) {
      cachedItems.forEach((item, idx) => {
        renderPredictionCard(item.data, item.fileName, idx, cachedItems.length);
      });
    }

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

function showDataInfo(dataInfo) {
  document.getElementById("data-info").style.display = "block";
  document.getElementById("data-rows").textContent = dataInfo.rows;
  document.getElementById("data-cols").textContent = dataInfo.columns.length;
  document.getElementById("data-time-range").textContent =
    `${dataInfo.start_date} to ${dataInfo.end_date}`;
  document.getElementById("data-price-range").textContent =
    `${dataInfo.price_range.min.toFixed(4)} - ${dataInfo.price_range.max.toFixed(4)}`;
  document.getElementById("data-timeframe").textContent = dataInfo.timeframe;
  document.getElementById("data-prediction-cols").textContent =
    dataInfo.prediction_columns.join(", ");

  initializeTimeWindowSlider(dataInfo);
}

function initializeTimeSlider() {
  setupSliderEventListeners();
}

function getWindowConfig() {
  const lookback = parseInt(document.getElementById("lookback").value) || 400;
  const predLen = Math.max(
    1,
    Math.min(500, parseInt(document.getElementById("pred-len").value) || 120),
  );
  return { lookback, predLen, windowSize: lookback + predLen };
}

function setupSliderEventListeners() {
  const startHandle = document.getElementById("start-handle");
  const endHandle = document.getElementById("end-handle");
  const track = document.querySelector(".slider-track");

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

  document.addEventListener("mouseup", () => {
    isDragging = false;
    currentHandle = null;
  });

  track.addEventListener("click", (e) => {
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));

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

function updateStartHandle(percentage) {
  const startHandle = document.getElementById("start-handle");
  const selection = document.getElementById("slider-selection");

  const { windowSize } = getWindowConfig();
  const totalRows = sliderData ? sliderData.totalRows : 1000;
  const windowPercentage = windowSize / totalRows;

  if (percentage + windowPercentage > 1) {
    percentage = 1 - windowPercentage;
  }

  startHandle.style.left = percentage * 100 + "%";
  selection.style.left = percentage * 100 + "%";
  selection.style.width = windowPercentage * 100 + "%";

  const endHandle = document.getElementById("end-handle");
  endHandle.style.left = (percentage + windowPercentage) * 100 + "%";
}

function updateEndHandle(percentage) {
  const endHandle = document.getElementById("end-handle");
  const selection = document.getElementById("slider-selection");

  const { windowSize } = getWindowConfig();
  const totalRows = sliderData ? sliderData.totalRows : 1000;
  const windowPercentage = windowSize / totalRows;

  if (percentage - windowPercentage < 0) {
    percentage = windowPercentage;
  }

  endHandle.style.left = percentage * 100 + "%";
  selection.style.left = (percentage - windowPercentage) * 100 + "%";
  selection.style.width = windowPercentage * 100 + "%";

  const startHandle = document.getElementById("start-handle");
  startHandle.style.left = (percentage - windowPercentage) * 100 + "%";
}

function updateSliderFromHandles() {
  const startHandle = document.getElementById("start-handle");
  const endHandle = document.getElementById("end-handle");

  const startPercentage = parseFloat(startHandle.style.left) / 100;
  const endPercentage = parseFloat(endHandle.style.left) / 100;

  if (!sliderData) return;

  const totalTime =
    sliderData.endDate.getTime() - sliderData.startDate.getTime();
  const startTime =
    sliderData.startDate.getTime() + totalTime * startPercentage;
  const endTime = sliderData.startDate.getTime() + totalTime * endPercentage;

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  document.getElementById("window-start").textContent =
    `Bắt đầu: ${startDate.toLocaleDateString("vi-VN")}`;
  document.getElementById("window-end").textContent =
    `Kết thúc: ${endDate.toLocaleDateString("vi-VN")}`;

  const { lookback, predLen, windowSize } = getWindowConfig();
  document.getElementById("window-size").textContent =
    `Cửa sổ: ${lookback} + ${predLen} = ${windowSize} nến`;
}

function updateSliderFromInputs() {
  if (!sliderData) return;

  const { windowSize } = getWindowConfig();
  const totalRows = sliderData.totalRows;

  if (windowSize > totalRows) {
    showStatus(
      "error",
      `Không đủ dữ liệu: cần ít nhất ${windowSize} nến, hiện có ${totalRows}`,
    );
    return;
  }

  const startPercentage = Math.max(0, 1 - windowSize / totalRows);
  const endPercentage = startPercentage + windowSize / totalRows;

  updateStartHandle(startPercentage);
  updateEndHandle(endPercentage);
  updateSliderFromHandles();
}

function initializeTimeWindowSlider(dataInfo) {
  sliderData = {
    startDate: new Date(dataInfo.start_date),
    endDate: new Date(dataInfo.end_date),
    totalRows: dataInfo.rows,
    timeframe: dataInfo.timeframe,
  };

  document.getElementById("min-label").textContent =
    dataInfo.start_date.split("T")[0];
  document.getElementById("max-label").textContent =
    dataInfo.end_date.split("T")[0];

  updateSliderFromInputs();
}

