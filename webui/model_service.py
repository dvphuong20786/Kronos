import os
import sys
import threading
import pandas as pd

os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '300')
os.environ.setdefault('HF_HUB_ETAG_TIMEOUT', '60')

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data_service import load_data_file, align_timestamp_timezone
from chart_cache_service import create_prediction_chart, save_prediction_results

try:
    from model import Kronos, KronosTokenizer, KronosPredictor
    MODEL_AVAILABLE = True
except ImportError:
    MODEL_AVAILABLE = False
    print("Warning: Kronos model cannot be imported, will use simulated data for demonstration")

AVAILABLE_MODELS = {
    'kronos-mini': {
        'name': 'Kronos-mini',
        'model_id': 'NeoQuasar/Kronos-mini',
        'tokenizer_id': 'NeoQuasar/Kronos-Tokenizer-2k',
        'context_length': 2048,
        'params': '4.1M',
        'description': 'Lightweight model, suitable for fast prediction'
    },
    'kronos-small': {
        'name': 'Kronos-small',
        'model_id': 'NeoQuasar/Kronos-small',
        'tokenizer_id': 'NeoQuasar/Kronos-Tokenizer-base',
        'context_length': 512,
        'params': '24.7M',
        'description': 'Small model, balanced performance and speed'
    },
    'kronos-base': {
        'name': 'Kronos-base',
        'model_id': 'NeoQuasar/Kronos-base',
        'tokenizer_id': 'NeoQuasar/Kronos-Tokenizer-base',
        'context_length': 512,
        'params': '102.3M',
        'description': 'Base model, provides better prediction quality'
    }
}

tokenizer = None
model = None
predictor = None
current_model_key = 'kronos-mini'
model_load_lock = threading.Lock()


def get_current_model_key():
    return current_model_key


def get_predictor():
    return predictor


def load_kronos_model(model_key='kronos-small', device='cpu'):
    global tokenizer, model, predictor, current_model_key
    if not MODEL_AVAILABLE:
        return None, ('Kronos model library not available', 400)
    if model_key not in AVAILABLE_MODELS:
        return None, (f'Unsupported model: {model_key}', 400)

    model_config = AVAILABLE_MODELS[model_key]
    tokenizer = KronosTokenizer.from_pretrained(model_config['tokenizer_id'])
    model = Kronos.from_pretrained(model_config['model_id'])
    predictor = KronosPredictor(
        model,
        tokenizer,
        device=device,
        max_context=model_config['context_length']
    )
    current_model_key = model_key
    return model_config, None


def get_model_status_dict():
    if MODEL_AVAILABLE:
        if predictor is not None:
            return {
                'available': True,
                'loaded': True,
                'message': 'Kronos model loaded and available',
                'current_model': {
                    'name': predictor.model.__class__.__name__,
                    'device': str(next(predictor.model.parameters()).device)
                }
            }
        return {
            'available': True,
            'loaded': False,
            'message': 'Kronos model available but not loaded'
        }
    return {
        'available': False,
        'loaded': False,
        'message': 'Kronos model library not available, please install related dependencies'
    }


def execute_prediction(data):
    file_path = data.get('file_path')
    model_key = data.get('model_key') or current_model_key
    lookback = int(data.get('lookback', 400))
    pred_len = int(data.get('pred_len', 48))
    if lookback < 50 or lookback > 2048:
        return None, ('Số nến lịch sử phải từ 50 đến 2048.', 400)
    if pred_len < 1 or pred_len > 500:
        return None, ('Số nến dự báo phải từ 1 đến 500.', 400)

    temperature = float(data.get('temperature', 1.0))
    top_p = float(data.get('top_p', 0.9))
    sample_count = int(data.get('sample_count', 1))

    if not file_path:
        return None, ('File path cannot be empty', 400)

    df, error = load_data_file(file_path)
    if error:
        return None, (error, 400)

    if len(df) < lookback:
        return None, (f'Insufficient data length, need at least {lookback} rows', 400)

    if MODEL_AVAILABLE and predictor is not None:
        try:
            required_cols = ['open', 'high', 'low', 'close']
            if 'volume' in df.columns:
                required_cols.append('volume')

            start_date = data.get('start_date')

            if start_date:
                start_dt = align_timestamp_timezone(start_date, df['timestamps'])
                mask = df['timestamps'] >= start_dt
                time_range_df = df[mask]

                if len(time_range_df) < lookback + pred_len:
                    return None, (
                        f'Insufficient data from start time {start_dt.strftime("%Y-%m-%d %H:%M")}, need at least {lookback + pred_len} data points, currently only {len(time_range_df)} available',
                        400
                    )

                x_df = time_range_df.iloc[:lookback][required_cols]
                x_timestamp = time_range_df.iloc[:lookback]['timestamps']
                y_timestamp = time_range_df.iloc[lookback:lookback + pred_len]['timestamps']

                start_timestamp = time_range_df['timestamps'].iloc[0]
                end_timestamp = time_range_df['timestamps'].iloc[lookback + pred_len - 1]
                time_span = end_timestamp - start_timestamp

                prediction_type = f"Kronos model prediction (within selected window: first {lookback} data points for prediction, last {pred_len} data points for comparison, time span: {time_span})"
            else:
                x_df = df.iloc[-lookback:][required_cols]
                x_timestamp = df.iloc[-lookback:]['timestamps']
                time_diff = df['timestamps'].iloc[1] - df['timestamps'].iloc[0]
                y_timestamp = pd.Series(pd.date_range(
                    start=df['timestamps'].iloc[-1] + time_diff,
                    periods=pred_len,
                    freq=time_diff
                ), name='timestamps')
                prediction_type = "Kronos model prediction (future forecast from latest data)"

            if isinstance(x_timestamp, pd.DatetimeIndex):
                x_timestamp = pd.Series(x_timestamp, name='timestamps')
            if isinstance(y_timestamp, pd.DatetimeIndex):
                y_timestamp = pd.Series(y_timestamp, name='timestamps')

            pred_df = predictor.predict(
                df=x_df,
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=pred_len,
                T=temperature,
                top_p=top_p,
                sample_count=sample_count
            )
        except Exception as e:
            return None, (f'Mô hình Kronos dự báo thất bại: {str(e)}', 500)
    else:
        return None, ('Chưa tải mô hình Kronos. Vui lòng tải mô hình trước.', 400)

    actual_data = []
    actual_df = None

    if start_date:
        start_dt = align_timestamp_timezone(start_date, df['timestamps'])
        mask = df['timestamps'] >= start_dt
        time_range_df = df[mask]

        if len(time_range_df) >= lookback + pred_len:
            actual_df = time_range_df.iloc[lookback:lookback + pred_len]
            for _, row in actual_df.iterrows():
                actual_data.append({
                    'timestamp': row['timestamps'].isoformat(),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': float(row['volume']) if 'volume' in row else 0,
                    'amount': float(row['amount']) if 'amount' in row else 0
                })

    if start_date:
        start_dt = align_timestamp_timezone(start_date, df['timestamps'])
        mask = df['timestamps'] >= start_dt
        historical_start_idx = df[mask].index[0] if len(df[mask]) > 0 else 0
    else:
        historical_start_idx = len(df) - lookback

    chart_json = create_prediction_chart(df, pred_df, lookback, pred_len, actual_df, historical_start_idx)

    if 'timestamps' in df.columns:
        if start_date:
            start_dt = align_timestamp_timezone(start_date, df['timestamps'])
            mask = df['timestamps'] >= start_dt
            time_range_df = df[mask]

            if len(time_range_df) >= lookback:
                last_timestamp = time_range_df['timestamps'].iloc[lookback - 1]
                time_diff = df['timestamps'].iloc[1] - df['timestamps'].iloc[0]
                future_timestamps = pd.date_range(
                    start=last_timestamp + time_diff,
                    periods=pred_len,
                    freq=time_diff
                )
            else:
                future_timestamps = []
        else:
            last_timestamp = df['timestamps'].iloc[-1]
            time_diff = df['timestamps'].iloc[1] - df['timestamps'].iloc[0]
            future_timestamps = pd.date_range(
                start=last_timestamp + time_diff,
                periods=pred_len,
                freq=time_diff
            )
    else:
        future_timestamps = range(len(df), len(df) + pred_len)

    prediction_results = []
    for i, (_, row) in enumerate(pred_df.iterrows()):
        prediction_results.append({
            'timestamp': future_timestamps[i].isoformat() if i < len(future_timestamps) else f"T{i}",
            'open': float(row['open']),
            'high': float(row['high']),
            'low': float(row['low']),
            'close': float(row['close']),
            'volume': float(row['volume']) if 'volume' in row else 0,
            'amount': float(row['amount']) if 'amount' in row else 0
        })

    try:
        save_prediction_results(
            file_path=file_path,
            prediction_type=prediction_type,
            prediction_results=prediction_results,
            actual_data=actual_data,
            input_data=x_df,
            prediction_params={
                'model_key': model_key,
                'lookback': lookback,
                'pred_len': pred_len,
                'temperature': temperature,
                'top_p': top_p,
                'sample_count': sample_count,
                'start_date': start_date if start_date else 'latest'
            },
            chart_json=chart_json,
            model_key=model_key
        )
    except Exception as e:
        print(f"Failed to save prediction results: {e}")

    return {
        'success': True,
        'prediction_type': prediction_type,
        'chart': chart_json,
        'prediction_results': prediction_results,
        'actual_data': actual_data,
        'has_comparison': len(actual_data) > 0,
        'message': f'Dự báo hoàn tất: {pred_len} nến' + (f', đối chiếu với {len(actual_data)} nến thực tế' if len(actual_data) > 0 else '')
    }, None
