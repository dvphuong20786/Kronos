import os
import re
import sys
import json
import datetime
import threading
from types import SimpleNamespace
import pandas as pd
import requests

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from scripts.download_market_data import download_alpha_stock, download_binance
except ImportError:
    download_alpha_stock = None
    download_binance = None

market_data_lock = threading.Lock()
binance_symbols_cache = {'symbols': [], 'loaded_at': None}


def load_data_file(file_path):
    """Load data file"""
    try:
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path)
        elif file_path.endswith('.feather'):
            df = pd.read_feather(file_path)
        else:
            return None, "Unsupported file format"

        required_cols = ['open', 'high', 'low', 'close']
        if not all(col in df.columns for col in required_cols):
            return None, f"Missing required columns: {required_cols}"

        if 'timestamps' in df.columns:
            df['timestamps'] = pd.to_datetime(df['timestamps'])
        elif 'timestamp' in df.columns:
            df['timestamps'] = pd.to_datetime(df['timestamp'])
        elif 'date' in df.columns:
            df['timestamps'] = pd.to_datetime(df['date'])
        else:
            df['timestamps'] = pd.date_range(start='2024-01-01', periods=len(df), freq='1H')

        for col in ['open', 'high', 'low', 'close']:
            df[col] = pd.to_numeric(df[col], errors='coerce')

        if 'volume' in df.columns:
            df['volume'] = pd.to_numeric(df['volume'], errors='coerce')

        if 'amount' in df.columns:
            df['amount'] = pd.to_numeric(df['amount'], errors='coerce')

        df = df.dropna()
        return df, None

    except Exception as e:
        return None, f"Failed to load file: {str(e)}"


def align_timestamp_timezone(value, timestamp_series):
    """Align a request timestamp with the timezone used by a pandas Series."""
    timestamp = pd.to_datetime(value)
    series_timezone = timestamp_series.dt.tz
    if series_timezone is not None:
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize(series_timezone)
        else:
            timestamp = timestamp.tz_convert(series_timezone)
    elif timestamp.tzinfo is not None:
        timestamp = timestamp.tz_localize(None)
    return timestamp


def detect_timeframe(df):
    if len(df) < 2:
        return "Unknown"

    time_diffs = []
    for i in range(1, min(10, len(df))):
        diff = df['timestamps'].iloc[i] - df['timestamps'].iloc[i - 1]
        time_diffs.append(diff)

    if not time_diffs:
        return "Unknown"

    avg_diff = sum(time_diffs, pd.Timedelta(0)) / len(time_diffs)

    if avg_diff < pd.Timedelta(minutes=1):
        return f"{avg_diff.total_seconds():.0f} seconds"
    elif avg_diff < pd.Timedelta(hours=1):
        return f"{avg_diff.total_seconds() / 60:.0f} minutes"
    elif avg_diff < pd.Timedelta(days=1):
        return f"{avg_diff.total_seconds() / 3600:.0f} hours"
    else:
        return f"{avg_diff.days} days"


def build_data_info(df):
    return {
        'rows': len(df),
        'columns': list(df.columns),
        'start_date': df['timestamps'].min().isoformat() if 'timestamps' in df.columns else 'N/A',
        'end_date': df['timestamps'].max().isoformat() if 'timestamps' in df.columns else 'N/A',
        'price_range': {
            'min': float(df[['open', 'high', 'low', 'close']].min().min()),
            'max': float(df[['open', 'high', 'low', 'close']].max().max())
        },
        'prediction_columns': ['open', 'high', 'low', 'close'] + (['volume'] if 'volume' in df.columns else []),
        'timeframe': detect_timeframe(df)
    }


def fetch_binance_symbols():
    now = datetime.datetime.now(datetime.timezone.utc)
    loaded_at = binance_symbols_cache['loaded_at']
    cache_is_fresh = loaded_at and (now - loaded_at).total_seconds() < 3600
    if not cache_is_fresh:
        response = requests.get(
            'https://data-api.binance.vision/api/v3/exchangeInfo',
            timeout=30
        )
        response.raise_for_status()
        exchange_info = response.json()
        symbols = [
            {
                'symbol': item['symbol'],
                'base_asset': item['baseAsset'],
                'quote_asset': item['quoteAsset']
            }
            for item in exchange_info.get('symbols', [])
            if item.get('status') == 'TRADING'
            and item.get('isSpotTradingAllowed', False)
            and item.get('quoteAsset') == 'USDT'
        ]
        symbols.sort(key=lambda item: item['symbol'])
        binance_symbols_cache['symbols'] = symbols
        binance_symbols_cache['loaded_at'] = now

    return binance_symbols_cache['symbols']


def remove_old_market_files(data_dir, prefix_key, new_filepath):
    """Remove older CSV files (and their cached predictions) for the same symbol & interval."""
    new_basename = os.path.basename(new_filepath)
    results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prediction_results')
    pattern = re.compile(rf'^(?:binance_)?{re.escape(prefix_key)}(?:_\d{{6}}(?:[_-]\d{{4}})?)?\.csv$', re.IGNORECASE)

    for fname in os.listdir(data_dir):
        if fname == new_basename or not fname.endswith('.csv'):
            continue
        if pattern.match(fname):
            old_path = os.path.join(data_dir, fname)
            try:
                os.remove(old_path)
            except Exception as e:
                print(f"Could not remove old data file {old_path}: {e}")

            if os.path.exists(results_dir):
                safe_base = re.sub(r'[^a-zA-Z0-9_.-]', '_', fname)
                for cfile in os.listdir(results_dir):
                    if cfile.endswith(f'_{safe_base}.json') or cfile == f'cache_{safe_base}.json':
                        try:
                            os.remove(os.path.join(results_dir, cfile))
                        except Exception:
                            pass
                        continue

                    # File kết quả dạng prediction_<thời gian>.json không chứa tên CSV trong tên file,
                    # tên CSV nằm trong trường 'file_path' bên trong JSON -> phải mở ra để so.
                    if cfile.startswith('prediction_') and cfile.endswith('.json'):
                        cache_path = os.path.join(results_dir, cfile)
                        try:
                            with open(cache_path, 'r', encoding='utf-8') as f:
                                saved_file_path = json.load(f).get('file_path', '')
                        except Exception:
                            continue
                        if os.path.basename(saved_file_path) == fname:
                            try:
                                os.remove(cache_path)
                            except Exception as e:
                                print(f"Could not remove old prediction {cache_path}: {e}")


def download_market_dataset(payload):
    market = payload.get('market')
    interval = payload.get('interval', '1h')
    rows = int(payload.get('rows', 2000))
    allowed_intervals = {
        '1s', '1m', '3m', '5m', '15m', '30m',
        '1h', '2h', '4h', '6h', '8h', '12h',
        '1d', '3d', '1w', '1M'
    }
    if interval not in allowed_intervals:
        return None, (f'Khung thời gian không được hỗ trợ: {interval}', 400)
    if rows < 520 or rows > 50000:
        return None, ('Số nến phải từ 520 đến 50000.', 400)

    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    os.makedirs(data_dir, exist_ok=True)

    date_tag = datetime.datetime.now().strftime('%d%m%y-%H%M')
    if market in {'binance', 'btcusdt'}:
        symbol = str(payload.get('symbol', 'BTCUSDT')).strip().upper()
        if not re.fullmatch(r'[A-Z0-9]{5,20}', symbol):
            return None, ('Mã Binance không hợp lệ. Ví dụ: BTCUSDT, ETHUSDT, SOLUSDT.', 400)
        prefix_key = f'{symbol.lower()}_{interval}'
        output = os.path.join(data_dir, f'{prefix_key}_{date_tag}.csv')
        args = SimpleNamespace(
            symbol=symbol, interval=interval, rows=rows,
            start=None, end=None, output=output
        )
        download_binance(args)
        display_name = f'{symbol} - Binance - {interval}'
    elif market == 'gold-paxg':
        prefix_key = f'paxgusdt_{interval}'
        output = os.path.join(data_dir, f'{prefix_key}_{date_tag}.csv')
        args = SimpleNamespace(
            symbol='PAXGUSDT', interval=interval, rows=rows,
            start=None, end=None, output=output
        )
        download_binance(args)
        display_name = f'Gold proxy PAXGUSDT - Binance - {interval}'
    elif market == 'gold-alpha':
        api_key = payload.get('api_key') or os.environ.get('ALPHAVANTAGE_API_KEY')
        if not api_key:
            return None, ('Missing Alpha Vantage API key. Paste the key in the Gold API Key field.', 400)
        prefix_key = 'gld_weekly'
        output = os.path.join(data_dir, f'{prefix_key}_{date_tag}.csv')
        args = SimpleNamespace(
            symbol='GLD', interval='weekly', outputsize='full', api_key=api_key, output=output
        )
        download_alpha_stock(args)
        display_name = 'Gold ETF GLD - Alpha Vantage - weekly (ETF share price, not gold/oz)'
    else:
        return None, (f'Unsupported market: {market}', 400)

    frame, error = load_data_file(output)
    if error:
        raise RuntimeError(error)

    remove_old_market_files(data_dir, prefix_key, output)

    return {
        'success': True,
        'market': market,
        'name': display_name,
        'file_path': output,
        'rows': len(frame),
        'message': f'Đã tải {display_name}: {len(frame)} nến'
    }, None

