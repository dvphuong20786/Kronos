# Hướng dẫn cài đặt, kiểm tra và chạy Kronos trên Windows

Thực hiện các lệnh dưới đây trong PowerShell, tại thư mục:

```powershell
cd D:\WORK\Kronos
```

## 1. Yêu cầu

- Windows 10/11.
- Python 3.11 được khuyến nghị. Script có thể dùng Python 3.14 nếu bộ PyTorch hiện hành hỗ trợ; Python 3.15 chưa được chọn tự động.
- Internet trong lần cài dependencies và lần đầu tải model từ Hugging Face.
- File dữ liệu CSV hoặc Feather có tối thiểu các cột `open`, `high`, `low`, `close`.

Tải Python 3.11: <https://www.python.org/downloads/release/python-3119/>

Khi cài Python, nên chọn **Add Python to PATH** và **Install launcher for all users**.

## 2. Cách nhanh: chạy các script có sẵn

### Cài đặt

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\01-install.ps1
```

Nếu chỉ sử dụng CPU:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\01-install.ps1 -CpuOnly
```

### Build/kiểm tra

Dự án Python không cần build như Java hoặc C#. Bước này kiểm tra import, compile bytecode, Web API và việc thu thập tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\02-build.ps1
```

Chạy bộ regression đầy đủ (sẽ tải model và có thể mất rất lâu nếu chỉ dùng CPU):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\02-build.ps1 -FullRegression
```

### Chạy Web UI

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\03-run.ps1
```

Không tự mở trình duyệt:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\03-run.ps1 -NoBrowser
```

Đổi port nếu cần, ví dụ:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\03-run.ps1 -Port 8080
```

Nhấn `Ctrl+C` trong PowerShell để dừng server.

Nếu server được chạy nền, dừng bằng:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\04-stop.ps1
```

## 3. Các lệnh tự gõ bằng tay

### Tạo môi trường và cài dependencies

```powershell
cd D:\WORK\Kronos
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt -r webui\requirements.txt pytest
New-Item -ItemType Directory -Path data -Force
```

Nếu PowerShell không cho chạy `Activate.ps1`, không cần activate; có thể dùng trực tiếp:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r webui\requirements.txt pytest
```

### Kiểm tra/build thủ công

```powershell
.\.venv\Scripts\python.exe -c "import torch, flask, pandas; from model import Kronos, KronosTokenizer, KronosPredictor; print('Imports OK'); print('PyTorch:', torch.__version__); print('CUDA:', torch.cuda.is_available())"
.\.venv\Scripts\python.exe -m compileall -q model webui examples
.\.venv\Scripts\python.exe -m pytest tests --collect-only -q
```

Regression đầy đủ, tùy chọn và chạy lâu trên CPU:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

### Chạy thủ công

```powershell
cd D:\WORK\Kronos\webui
$env:KRONOS_PORT = 7071
..\.venv\Scripts\python.exe app.py
```

## 4. Chuẩn bị dữ liệu

Đặt CSV/Feather vào:

```text
D:\WORK\Kronos\data
```

Ví dụ CSV:

```csv
timestamps,open,high,low,close,volume
2026-01-01 09:00:00,100,105,99,103,12000
2026-01-01 10:00:00,103,108,102,107,15000
```

Nên có ít nhất 520 dòng vì giao diện mặc định dùng 400 nến lịch sử và 120 nến dự báo/đối chiếu. `volume` và cột thời gian là tùy chọn; nếu không có thời gian, chương trình tự sinh mốc thời gian theo giờ.

## 5. Chọn cấu hình trên giao diện

Máy hiện tại đang dùng **PyTorch CPU-only** (`torch 2.15.0+cpu`) và không có CUDA trong môi trường Kronos. Khi mở Web UI, chọn theo đúng thứ tự sau:

1. **Model**: chọn `Kronos-mini (4.1M)` để chạy thử nhanh và ít tốn RAM nhất.
2. **Device / Computing device**: bắt buộc chọn `CPU`.
3. Bấm **Load model** và chờ thông báo tải model thành công.
4. **Data file**: chọn file CSV hoặc Feather đã đặt trong `D:\WORK\Kronos\data`.
5. Chọn cửa sổ dữ liệu; cấu hình mặc định là 400 nến lịch sử và 120 nến dự báo/đối chiếu.
6. Bấm **Start prediction / Predict**.

Cấu hình chất lượng dự báo nên dùng lúc đầu:

| Thiết lập | Giá trị khuyến nghị |
|---|---:|
| Model | `Kronos-mini` |
| Device | `CPU` |
| Temperature | `1.0` |
| Top P | `0.9` |
| Sample count | `1` |
| Historical/lookback | `400` |
| Prediction length | `120` |

Không chọn các mục sau với cấu hình hiện tại:

- Không chọn `CUDA`: bản PyTorch hiện tại không được biên dịch với CUDA; nếu chọn sẽ báo `Torch not compiled with CUDA enabled`.
- Không chọn `MPS`: MPS chỉ dành cho máy Mac dùng Apple Silicon.
- Chưa nên chọn `Kronos-base`: model lớn, tải lâu và dự báo chậm trên CPU.
- `Kronos-small` có thể sử dụng sau khi đã chạy ổn với `Kronos-mini`, nhưng sẽ chậm hơn.

Trạng thái đúng sau khi tải model:

```json
{
  "available": true,
  "loaded": true,
  "device": "cpu"
}
```

Nếu giao diện báo lỗi 500 sau khi bấm tải model, kiểm tra lại **Device = CPU**, sau đó tải lại trang và chọn `Kronos-mini`.

## 6. Các đường dẫn local

- Web UI: <http://localhost:7071>
- Trạng thái model: <http://localhost:7071/api/model-status>
- Danh sách model: <http://localhost:7071/api/available-models>
- Danh sách file dữ liệu: <http://localhost:7071/api/data-files>

Model được tải từ Hugging Face trong lần đầu bấm tải model trên giao diện. Với máy không có NVIDIA GPU, chọn `CPU` và `Kronos-mini` để thử trước.

## 7. Xử lý lỗi thường gặp

- `No suitable Python`: cài Python 3.11 rồi mở lại PowerShell.
- `ModuleNotFoundError`: chạy lại script `01-install.ps1`.
- Không thấy file dữ liệu: kiểm tra file nằm trực tiếp trong `D:\WORK\Kronos\data` và có đuôi `.csv` hoặc `.feather`.
- Port đang được dùng: chạy script với port khác, ví dụ `.\scripts\03-run.ps1 -Port 8080`.
- Tải model thất bại: kiểm tra Internet và quyền truy cập Hugging Face.
- Nếu tải `Kronos-base` bị timeout, thử `Kronos-mini` trước. Script đã đặt thời gian chờ tải là 300 giây và cài `hf_xet` để tải model hiệu quả hơn.

## 8. Tải dữ liệu thị trường thật

Công cụ `scripts/download_market_data.py` chuẩn hóa dữ liệu thành các cột Kronos và lưu trực tiếp vào thư mục `data`.

### Crypto từ Binance — không cần API key

Tải 1.000 nến BTC/USDT khung 1 giờ:

```powershell
cd D:\WORK\Kronos
.\.venv\Scripts\python.exe .\scripts\download_market_data.py binance --symbol BTCUSDT --interval 1h --rows 1000
```

Ví dụ khác:

```powershell
.\.venv\Scripts\python.exe .\scripts\download_market_data.py binance --symbol ETHUSDT --interval 15m --rows 2000
.\.venv\Scripts\python.exe .\scripts\download_market_data.py binance --symbol BNBUSDT --interval 1d --rows 1000
```

Trên Web UI, nhập cặp giao dịch vào ô **Binance pair**, ví dụ:

- `BTCUSDT`
- `ETHUSDT`
- `BNBUSDT`
- `SOLUSDT`
- `XRPUSDT`
- `PAXGUSDT`

Sau đó chọn khung thời gian, số nến và bấm **Download Binance Pair**.

Ô **Binance pair** là combobox có tìm kiếm. Danh sách được tải từ Binance `exchangeInfo`, chỉ gồm các cặp Spot đang giao dịch với đồng định giá `USDT`. Gõ một phần tên như `ETH`, `SOL` hoặc `DOGE`, sau đó chọn cặp trong danh sách gợi ý.

### Dọn Python cache

Các file `.pyc` và thư mục `__pycache__` chỉ là cache tăng tốc import, không phải mã nguồn hay dữ liệu dự báo. Các script đã đặt `PYTHONDONTWRITEBYTECODE=1` để hạn chế tạo lại. Có thể dọn thủ công bằng:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\05-clean-cache.ps1
```

### Cổ phiếu và ETF từ Alpha Vantage

Đăng ký API key tại <https://www.alphavantage.co/support/#api-key>, sau đó đặt key cho cửa sổ PowerShell hiện tại:

```powershell
$env:ALPHAVANTAGE_API_KEY = 'API_KEY_CUA_BAN'
```

Để lưu key bền vững cho tài khoản Windows mà không ghi vào source code:

```powershell
[Environment]::SetEnvironmentVariable('ALPHAVANTAGE_API_KEY', 'API_KEY_CUA_BAN', 'User')
```

Script `03-run.ps1` tự đọc biến môi trường cấp người dùng này khi khởi động Kronos. API trạng thái chỉ cho biết key đã được cấu hình hay chưa, không trả giá trị key về trình duyệt.

Tải cổ phiếu:

```powershell
.\.venv\Scripts\python.exe .\scripts\download_market_data.py alpha-stock --symbol AAPL
.\.venv\Scripts\python.exe .\scripts\download_market_data.py alpha-stock --symbol IBM
```

Vàng: API lịch sử vàng trực tiếp của Alpha Vantage không cung cấp đầy đủ OHLCV cho Kronos. Dùng ETF vàng làm dữ liệu đại diện:

```powershell
.\.venv\Scripts\python.exe .\scripts\download_market_data.py alpha-stock --symbol GLD
.\.venv\Scripts\python.exe .\scripts\download_market_data.py alpha-stock --symbol IAU
```

Để lấy lịch sử đủ dài bằng tài khoản miễn phí, ưu tiên nến tuần:

```powershell
.\.venv\Scripts\python.exe .\scripts\download_market_data.py alpha-stock --symbol GLD --interval weekly
```

Trên Web UI, có thể dán key vào ô **Alpha Vantage API key for Gold** rồi bấm **Download Gold GLD**. Key chỉ được dùng trong request tải dữ liệu và không được lưu vào dự án.

### Phân biệt giá vàng PAXG và GLD

- `PAXGUSDT` trên Binance là token được bảo chứng bằng vàng và được định giá theo USDT. Nó phù hợp khi muốn chuỗi giá gần với vàng theo USD và có các khung `5m`, `15m`, `1h`, `4h`, `1d`, `1w`.
- `GLD` là giá của một chứng chỉ ETF vàng, không phải giá một ounce vàng. Vì vậy mức giá GLD thấp hơn nhiều so với giá vàng/ounce là bình thường.
- Trên Web UI có thể chọn khung thời gian và số lượng từ 520 đến 50.000 nến trước khi tải. Binance trả tối đa 1.000 nến trong mỗi request; công cụ tự phân trang để lấy đủ số lượng đã chọn nếu lịch sử của cặp giao dịch có sẵn.
- Cửa sổ dự báo mặc định luôn nằm sát bên phải. Phần đầu dùng 400 nến làm lịch sử đầu vào; phần sau là số nến dự báo/đối chiếu do người dùng chọn từ 1 đến 500. Tổng độ rộng cửa sổ là `400 + số nến dự báo`.

Forex:

```powershell
.\.venv\Scripts\python.exe .\scripts\download_market_data.py alpha-fx --from-symbol EUR --to-symbol USD
```

Alpha Vantage daily `compact` thường chỉ có 100 dòng. Kronos cần ít nhất 520 dòng; dữ liệu tuần GLD thường phù hợp hơn vì endpoint tuần trả lịch sử dài. Sau khi tải xong, làm mới Web UI để file mới xuất hiện.

- lấy key api
https://www.alphavantage.co/support/#api-key

## 9. Backtest (trang `/backtest`)

Mở: <http://localhost:7071/backtest>

Cách hoạt động (walk-forward): lấy 400 nến lịch sử, dự báo 120 nến kế tiếp, so với 120 nến thật, dịch sang phải `Bước trượt` nến rồi lặp lại. Chỉ chạy `Số lần tối đa` lần gần nhất.

Chỉ số:

- **Tỉ lệ đúng hướng**: giá đóng cửa ở nến cuối của phần dự báo cao hơn hay thấp hơn nến cuối của phần lịch sử, và có cùng chiều với thực tế không.
- **MAPE**: sai số % trung bình của giá close trong 120 nến.
- **Trong vùng High-Low**: % nến thật có giá close nằm trong khoảng low–high dự báo.

Biểu đồ: đường xám là giá thật; mỗi đoạn xanh là một lần dự báo đúng hướng, đoạn đỏ là sai hướng.

Thời gian: khoảng 11 giây mỗi lần với Kronos-mini trên CPU (đo trên BTC 4h).

File liên quan:

- `webui/backtest_service.py`: logic backtest (hàm `run_backtest`).
- `webui/app.py`: route `/backtest` (trang) và `/api/backtest` (API).
- `webui/templates/backtest.html`, `webui/static/js/backtest.js`, `webui/static/css/backtest.css`: giao diện.

## 10. Nhật ký thay đổi

- 05/11: `scripts/01-install.ps1`: sửa lỗi dò Python dừng khi máy không có 3.11 (do `$ErrorActionPreference = 'Stop'`).
- 06/11: `webui/data_service.py` (`remove_old_market_files`): khi tải dữ liệu mới, xóa thêm kết quả dạng `prediction_<thời gian>.json` có `file_path` trỏ tới file CSV cũ. Trước đây các file này bị sót, nên file mới hiện biểu tượng 📈 nhưng đó là dự báo của dữ liệu cũ. Đã xóa tay 2 file kết quả bị sót.
- 06/11: thêm trang Backtest (mục 9).
- 06/11: thêm nút chuyển nhanh "🧪 Backtest →" trên thanh tiêu đề Bảng điều khiển của trang chính.
- 06/11: trang Backtest thêm **💾 Lưu kết quả** (bật sau khi chạy xong) và **Kết quả đã lưu + 📂 Xem lại**. File lưu ở `webui/backtest_results/bt_<thời gian>.json` (gồm tên file dữ liệu, model, toàn bộ kết quả). Xem lại không cần tải model. Code: `save_backtest`, `list_saved_backtests`, `load_saved_backtest` trong `webui/backtest_service.py`; API `/api/backtest/save`, `/api/backtest/saved`, `/api/backtest/saved/<id>`.

Dự kiến (chưa làm): hiện tiến độ từng lần khi backtest chạy lâu; nút xóa kết quả đã lưu.

- 06/11: bản lưu backtest ghi thêm cặp, khung nến, model, thiết bị, lookback/pred_len/step. Tên file: `bt_<thời gian>_<cặp>_<khung>_<model>_<thiết bị>.json` (ví dụ `bt_20261106_192000_btcusdt_4h_kronos-mini_cpu.json`). Cặp/khung được tách từ tên file dữ liệu.
- 06/11: trang Backtest nâng `Số lần tối đa` lên mặc định `500`, tối đa `5000`; đồng thời bổ sung đầy đủ 3 thông số dự báo giống trang chính: `Độ ngẫu nhiên dự báo (T)` (0.1–2.0, mặc định 0.8), `Tham số lấy mẫu (top_p)` (0.1–1.0, mặc định 0.9), và `Số mẫu dự báo` (1–5, mặc định 1).
- 06/11: trang Backtest ẩn nút "Tải mô hình"; tự động nạp mô hình ngay khi mở trang (hoặc khi thay đổi dropdown mô hình / thiết bị), đồng bộ cơ chế tự động với trang dự đoán chính.
- 06/11: chuyển giá trị mặc định của `Số nến dự báo` và `Bước trượt` thành `48` nến (thay vì 120 nến) trên cả giao diện Dự đoán chính lẫn trang Backtest. Cửa sổ thời gian mặc định thành `400 + 48 = 448 nến`.
- 06/11: đồng bộ khung thông báo trạng thái mô hình trên trang Backtest giống hệt trang chính (dùng thẻ `<div class="status success/info/error">` với nền màu, viền và câu thông báo chi tiết: `✅ Đã tải mô hình Kronos... trên CUDA`).

### Về GPU NVIDIA (Đã cài đặt thành công 06/11)

- Card: GeForce GTX 1650 Max-Q, 4 GB. Driver 621.14 (CUDA 12.x/13.x).
- PyTorch trong `.venv` đã được nâng cấp lên `torch 2.6.0+cu124` (CUDA Available: True).
- Toàn bộ thư viện và cache đều được cài đặt trên ổ `F:`.
- Đã có thể chọn `CUDA` trên cả giao diện Web chính và trang Backtest.
