"""
Backtest kiểu "walk-forward" cho Kronos.

Ý tưởng:
    Dữ liệu:  |---- lookback (400) ----|-- pred_len (120) --|
    Lần 1:    [lịch sử để dự báo      ][so với giá thật     ]
    Lần 2:    dịch sang phải `step` nến rồi làm lại, ...

Mỗi lần (gọi là 1 "cửa sổ") tính:
    - Đúng hướng: giá đóng cửa nến cuối dự báo cao/thấp hơn giá đóng cửa
      nến cuối lịch sử có cùng chiều với thực tế hay không.
    - MAPE: sai số % trung bình của giá close dự báo so với giá thật (120 nến).
    - Tỉ lệ nằm trong vùng: % nến thật có close nằm trong [low, high] dự báo.

Model phải được tải trước (qua /api/load-model) - file này chỉ dùng lại predictor.
"""
import os
import re
import json
import datetime
import pandas as pd

from data_service import load_data_file
import model_service

# Thư mục lưu các kết quả backtest người dùng bấm "Lưu"
BACKTEST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backtest_results')


def _direction(start_price, end_price):
    """Trả về 'up', 'down' hoặc 'flat'."""
    if end_price > start_price:
        return 'up'
    if end_price < start_price:
        return 'down'
    return 'flat'


def run_backtest(data):
    """
    Chạy backtest trên 1 file dữ liệu.
    Trả về (kết_quả, None) nếu thành công, hoặc (None, (thông_báo_lỗi, http_status)).
    """
    predictor = model_service.get_predictor()
    if predictor is None:
        return None, ('Chưa tải mô hình. Hãy chọn model và bấm "Tải mô hình" trước.', 400)

    file_path = data.get('file_path')
    if not file_path:
        return None, ('Chưa chọn file dữ liệu.', 400)

    lookback = int(data.get('lookback', 400))
    pred_len = int(data.get('pred_len', 48))
    step = int(data.get('step', pred_len))
    max_windows = int(data.get('max_windows', 500))
    temperature = float(data.get('temperature', 0.8))
    top_p = float(data.get('top_p', 0.9))
    sample_count = int(data.get('sample_count', 1))

    if lookback < 50 or lookback > 2048:
        return None, ('Số nến lịch sử phải từ 50 đến 2048.', 400)
    if pred_len < 1 or pred_len > 500:
        return None, ('Số nến dự báo phải từ 1 đến 500.', 400)
    if step < 1:
        return None, ('Bước trượt phải >= 1.', 400)
    if max_windows < 1 or max_windows > 5000:
        return None, ('Số lần backtest phải từ 1 đến 5000.', 400)
    if temperature < 0.1 or temperature > 2.0:
        return None, ('Độ ngẫu nhiên (T) phải từ 0.1 đến 2.0.', 400)
    if top_p < 0.1 or top_p > 1.0:
        return None, ('Tham số top_p phải từ 0.1 đến 1.0.', 400)
    if sample_count < 1 or sample_count > 5:
        return None, ('Số mẫu dự báo phải từ 1 đến 5.', 400)

    df, error = load_data_file(file_path)
    if error:
        return None, (error, 400)

    total_needed = lookback + pred_len
    if len(df) < total_needed:
        return None, (f'Dữ liệu chỉ có {len(df)} nến, cần ít nhất {total_needed} nến.', 400)

    feature_cols = ['open', 'high', 'low', 'close']
    if 'volume' in df.columns:
        feature_cols.append('volume')

    # Liệt kê vị trí bắt đầu của mọi cửa sổ, rồi chỉ giữ `max_windows` cửa sổ GẦN NHẤT
    # (dữ liệu gần đây có ý nghĩa hơn và giới hạn thời gian chạy trên CPU).
    window_starts = list(range(0, len(df) - total_needed + 1, step))
    window_starts = window_starts[-max_windows:]

    windows = []
    for start in window_starts:
        history = df.iloc[start:start + lookback]
        actual = df.iloc[start + lookback:start + total_needed]

        pred_df = predictor.predict(
            df=history[feature_cols],
            x_timestamp=history['timestamps'],
            y_timestamp=actual['timestamps'],
            pred_len=pred_len,
            T=temperature,
            top_p=top_p,
            sample_count=sample_count
        )

        last_history_close = float(history['close'].iloc[-1])
        pred_close = pred_df['close'].to_numpy(dtype=float)
        actual_close = actual['close'].to_numpy(dtype=float)

        pred_dir = _direction(last_history_close, pred_close[-1])
        actual_dir = _direction(last_history_close, actual_close[-1])

        mape = float((abs(pred_close - actual_close) / actual_close).mean() * 100)

        inside = (actual_close >= pred_df['low'].to_numpy(dtype=float)) & \
                 (actual_close <= pred_df['high'].to_numpy(dtype=float))
        inside_pct = float(inside.mean() * 100)

        windows.append({
            'index': len(windows) + 1,
            'history_start': history['timestamps'].iloc[0].isoformat(),
            'forecast_start': actual['timestamps'].iloc[0].isoformat(),
            'forecast_end': actual['timestamps'].iloc[-1].isoformat(),
            'last_history_close': last_history_close,
            'pred_end_close': float(pred_close[-1]),
            'actual_end_close': float(actual_close[-1]),
            'pred_change_pct': (pred_close[-1] / last_history_close - 1) * 100,
            'actual_change_pct': (actual_close[-1] / last_history_close - 1) * 100,
            'pred_direction': pred_dir,
            'actual_direction': actual_dir,
            'direction_correct': pred_dir == actual_dir,
            'mape': mape,
            'inside_range_pct': inside_pct,
            # Dữ liệu để frontend vẽ đoạn dự báo
            'timestamps': [t.isoformat() for t in actual['timestamps']],
            'pred_close': pred_close.tolist(),
        })

    correct = sum(1 for w in windows if w['direction_correct'])
    summary = {
        'windows': len(windows),
        'correct': correct,
        'wrong': len(windows) - correct,
        'accuracy_pct': correct / len(windows) * 100 if windows else 0,
        'avg_mape': sum(w['mape'] for w in windows) / len(windows) if windows else 0,
        'avg_inside_range_pct': sum(w['inside_range_pct'] for w in windows) / len(windows) if windows else 0,
        'lookback': lookback,
        'pred_len': pred_len,
        'step': step,
        'temperature': temperature,
        'top_p': top_p,
        'sample_count': sample_count,
        # Thiết bị đang chạy model: 'cpu' hoặc 'cuda:0'
        'device': str(next(predictor.model.parameters()).device),
    }

    # Giá thật để vẽ nền: từ đầu cửa sổ đầu tiên đến hết cửa sổ cuối cùng
    first = window_starts[0]
    last = window_starts[-1] + total_needed
    price_slice = df.iloc[first:last]
    actual_series = {
        'timestamps': [t.isoformat() for t in price_slice['timestamps']],
        'close': price_slice['close'].astype(float).tolist(),
    }

    return {
        'success': True,
        'summary': summary,
        'windows': windows,
        'actual_series': actual_series,
    }, None



# ---------- Lưu / xem lại kết quả backtest ----------

def save_backtest(data):
    """
    Lưu 1 kết quả backtest (frontend gửi lên nguyên kết quả vừa chạy + tên file, model).
    Tên file lưu: bt_<thời gian>_<cặp>_<khung>_<model>_<thiết bị>.json
        ví dụ: bt_20261106_192000_btcusdt_4h_kronos-mini_cpu.json
    """
    result = data.get('result')
    if not result or 'summary' not in result:
        return None, ('Không có kết quả backtest để lưu.', 400)

    summary = result['summary']
    data_file = os.path.basename(data.get('file_path', ''))
    model_key = data.get('model_key', '')
    device = summary.get('device', 'cpu').split(':')[0]  # 'cuda:0' -> 'cuda'

    # Tên file dữ liệu dạng "btcusdt_4h_061126-1851.csv" hoặc "binance_paxgusdt_8h.csv"
    # -> tách ra cặp (btcusdt) và khung nến (4h)
    match = re.match(r'^(?:binance_)?([a-z0-9]+)_(\d+[smhdwM]|weekly|daily)', data_file, re.IGNORECASE)
    symbol = match.group(1).upper() if match else ''
    interval = match.group(2) if match else ''

    os.makedirs(BACKTEST_DIR, exist_ok=True)
    now = datetime.datetime.now()
    name_parts = [now.strftime('%Y%m%d_%H%M%S'), symbol.lower(), interval, model_key, device]
    save_id = 'bt_' + '_'.join(p for p in name_parts if p)
    save_id = re.sub(r'[^A-Za-z0-9_.-]', '_', save_id)

    record = {
        'id': save_id,
        'saved_at': now.isoformat(timespec='seconds'),
        'data_file': data_file,
        'symbol': symbol,
        'interval': interval,
        'model_key': model_key,
        'device': device,
        'lookback': summary.get('lookback'),
        'pred_len': summary.get('pred_len'),
        'step': summary.get('step'),
        'temperature': summary.get('temperature'),
        'top_p': summary.get('top_p'),
        'sample_count': summary.get('sample_count'),
        'result': result,
    }
    with open(os.path.join(BACKTEST_DIR, f'{save_id}.json'), 'w', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False)

    return {'success': True, 'id': save_id}, None


def list_saved_backtests():
    """Danh sách kết quả đã lưu (mới nhất lên đầu), chỉ trả thông tin tóm tắt."""
    if not os.path.exists(BACKTEST_DIR):
        return []

    items = []
    for fname in sorted(os.listdir(BACKTEST_DIR), reverse=True):
        if not fname.endswith('.json'):
            continue
        try:
            with open(os.path.join(BACKTEST_DIR, fname), 'r', encoding='utf-8') as f:
                record = json.load(f)
        except Exception:
            continue
        summary = record['result']['summary']
        items.append({
            'id': record['id'],
            'saved_at': record['saved_at'],
            'data_file': record['data_file'],
            'model_key': record['model_key'],
            # Các trường dưới đây chỉ có ở bản lưu mới -> dùng .get cho bản lưu cũ
            'symbol': record.get('symbol', ''),
            'interval': record.get('interval', ''),
            'device': record.get('device', ''),
            'lookback': record.get('lookback', summary.get('lookback')),
            'pred_len': record.get('pred_len', summary.get('pred_len')),
            'windows': summary['windows'],
            'accuracy_pct': summary['accuracy_pct'],
        })
    return items


def load_saved_backtest(save_id):
    """Đọc lại 1 kết quả đã lưu theo id."""
    # Chỉ cho phép id bắt đầu bằng bt_YYYYmmdd_HHMMSS và chỉ gồm ký tự an toàn
    # (không có / \ ..) để tránh đọc file ngoài thư mục
    if not re.fullmatch(r'bt_\d{8}_\d{6}[A-Za-z0-9_-]*', save_id or ''):
        return None, ('Mã kết quả không hợp lệ.', 400)
    path = os.path.join(BACKTEST_DIR, f'{save_id}.json')
    if not os.path.exists(path):
        return None, ('Không tìm thấy kết quả đã lưu.', 404)
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f), None
