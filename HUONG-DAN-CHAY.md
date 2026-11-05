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

