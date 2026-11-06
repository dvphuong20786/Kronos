// Global variables & shared UI helpers
let currentDataFile = null;
let currentDataInfo = null;
let selectedDataFiles = [];
let loadedDataInfos = {};
let availableModels = [];
let modelLoaded = false;

function getSelectedFilePaths() {
  const checkboxes = document.querySelectorAll(".data-file-checkbox:checked");
  return Array.from(checkboxes).map((cb) => cb.value);
}

function syncSelectAllCheckbox() {
  const selectAll = document.getElementById("select-all-files");
  if (!selectAll) return;
  const allBoxes = document.querySelectorAll(".data-file-checkbox");
  const checkedBoxes = document.querySelectorAll(".data-file-checkbox:checked");
  selectAll.checked =
    allBoxes.length > 0 && allBoxes.length === checkedBoxes.length;
  selectAll.indeterminate =
    checkedBoxes.length > 0 && checkedBoxes.length < allBoxes.length;
}

function updatePredictButtonState() {
  const button = document.getElementById("predict-btn");
  const requirement = document.getElementById("predict-requirement");
  const hasData = selectedDataFiles.length > 0 || Boolean(currentDataFile);
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

function showStatus(type, message, targetId = "model-status") {
  const statusDiv =
    document.getElementById(targetId) ||
    document.getElementById("model-status");
  if (!statusDiv) return;
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = "block";
}

function showLoading(show) {
  const loadingDiv = document.getElementById("loading");
  if (show) {
    loadingDiv.classList.add("show");
  } else {
    loadingDiv.classList.remove("show");
  }
}

