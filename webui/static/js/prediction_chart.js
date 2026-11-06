// Prediction execution, multi-chart grid rendering, and detail comparison cards
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

    const startHandle = document.getElementById("start-handle");
    const startPercentage = parseFloat(startHandle.style.left || "0") / 100;

    if (!isFutureMode && !sliderData) {
      showStatus(
        "error",
        "Thanh chọn thời gian chưa được khởi tạo",
        "data-status",
      );
      return;
    }

    const temperature = parseFloat(
      document.getElementById("temperature").value,
    );
    const topP = parseFloat(document.getElementById("top-p").value);
    const sampleCount = parseInt(
      document.getElementById("sample-count").value,
    );

    const multiContainer = document.getElementById("multi-results-container");
    multiContainer.innerHTML = "";
    const multiDetailsContainer = document.getElementById(
      "multi-details-container",
    );
    if (multiDetailsContainer) multiDetailsContainer.innerHTML = "";
    document.getElementById("chart").style.display = "none";
    document.getElementById("comparison-section").style.display = "none";

    let successCount = 0;
    for (let idx = 0; idx < filesToPredict.length; idx++) {
      const filePath = filesToPredict[idx];
      const fileName = filePath.split(/[/\\]/).pop();

      const requirement = document.getElementById("predict-requirement");
      requirement.textContent = `⏳ Đang dự báo (${idx + 1}/${filesToPredict.length}): ${fileName}...`;
      requirement.style.color = "#2b6cb0";

      const modelKey =
        document.getElementById("model-select")?.value || "kronos-mini";
      let predictionParams = {
        file_path: filePath,
        model_key: modelKey,
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
          const startTime = fStart.getTime() + totalTime * startPercentage;
          const startDate = new Date(startTime);
          predictionParams.start_date = startDate.toISOString().slice(0, 16);
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
      `✅ Đã hoàn tất và lưu dự báo cho ${successCount}/${filesToPredict.length} file!`,
      "data-status",
    );
    await loadDataFiles();
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

function renderPredictionCard(result, fileName, index, totalCount) {
  const multiContainer = document.getElementById("multi-results-container");

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
    <div id="${chartDivId}" class="multi-chart-plot" style="width: 100%; height: 380px;"></div>
  `;

  multiContainer.appendChild(card);

  const detailsContainer = document.getElementById("multi-details-container");
  if (detailsContainer) {
    const detailCard = document.createElement("div");
    detailCard.className = "comparison-section";
    detailCard.innerHTML = `
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
    `;
    detailsContainer.appendChild(detailCard);
  }

  const chartData = JSON.parse(result.chart);
  if (chartData.layout) {
    delete chartData.layout.title;
    delete chartData.layout.height;
    delete chartData.layout.width;
    chartData.layout.autosize = true;
    chartData.layout.legend = {
      orientation: "h",
      yanchor: "top",
      y: -0.18,
      xanchor: "center",
      x: 0.5,
    };
    chartData.layout.margin = { t: 10, r: 10, b: 65, l: 45 };
  }
  Plotly.newPlot(chartDivId, chartData.data, chartData.layout, {
    responsive: true,
  });
  setTimeout(() => {
    document.querySelectorAll(".multi-chart-plot").forEach((el) => {
      if (window.Plotly) Plotly.Plots.resize(el);
    });
  }, 50);
}

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

