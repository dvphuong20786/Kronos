import os
import re
import json
import datetime
import pandas as pd
import plotly.graph_objects as go
import plotly.utils

from data_service import load_data_file, align_timestamp_timezone
import model_service


def has_cached_prediction(file_name, model_key=None):
    """Quickly check if a data file has a saved prediction result for the given model."""
    try:
        results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prediction_results')
        if not os.path.exists(results_dir):
            return False
        mkey = (model_key or model_service.get_current_model_key() or 'kronos-mini').strip().lower()
        safe_mkey = re.sub(r'[^a-zA-Z0-9_.-]', '_', mkey)
        safe_base = re.sub(r'[^a-zA-Z0-9_.-]', '_', file_name)
        if os.path.exists(os.path.join(results_dir, f'cache_{safe_mkey}_{safe_base}.json')):
            return True
        if mkey == 'kronos-mini' and os.path.exists(os.path.join(results_dir, f'cache_{safe_base}.json')):
            return True
        stripped_current = re.sub(r'_\d{6}(?:[_-]\d{4})?(?=\.csv$)', '', file_name)
        for fname in os.listdir(results_dir):
            if fname.startswith('prediction_') and fname.endswith('.json'):
                try:
                    with open(os.path.join(results_dir, fname), 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    saved_mkey = (data.get('model_key') or data.get('prediction_params', {}).get('model_key') or 'kronos-mini').strip().lower()
                    if saved_mkey != mkey:
                        continue
                    saved_base = os.path.basename(data.get('file_path', ''))
                    if saved_base == file_name or saved_base == f'binance_{stripped_current}':
                        return True
                except Exception:
                    continue
        return False
    except Exception:
        return False


def load_data_files(model_key=None):
    """Scan data directory and return available data files"""
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    data_files = []

    if os.path.exists(data_dir):
        for file in sorted(os.listdir(data_dir)):
            if file.endswith(('.csv', '.feather')):
                file_path = os.path.join(data_dir, file)
                file_size = os.path.getsize(file_path)
                data_files.append({
                    'name': file,
                    'path': file_path,
                    'size': f"{file_size / 1024:.1f} KB" if file_size < 1024 * 1024 else f"{file_size / (1024 * 1024):.1f} MB",
                    'has_prediction': has_cached_prediction(file, model_key)
                })

    return data_files


def save_prediction_results(file_path, prediction_type, prediction_results, actual_data, input_data, prediction_params, chart_json=None, model_key=None):
    """Save prediction results to file"""
    try:
        results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prediction_results')
        os.makedirs(results_dir, exist_ok=True)

        mkey = (model_key or model_service.get_current_model_key() or 'kronos-mini').strip().lower()

        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'prediction_{timestamp}.json'
        filepath = os.path.join(results_dir, filename)

        save_data = {
            'timestamp': datetime.datetime.now().isoformat(),
            'file_path': file_path,
            'model_key': mkey,
            'prediction_type': prediction_type,
            'prediction_params': prediction_params,
            'chart': chart_json,
            'input_data_summary': {
                'rows': len(input_data),
                'columns': list(input_data.columns),
                'price_range': {
                    'open': {'min': float(input_data['open'].min()), 'max': float(input_data['open'].max())},
                    'high': {'min': float(input_data['high'].min()), 'max': float(input_data['high'].max())},
                    'low': {'min': float(input_data['low'].min()), 'max': float(input_data['low'].max())},
                    'close': {'min': float(input_data['close'].min()), 'max': float(input_data['close'].max())}
                },
                'last_values': {
                    'open': float(input_data['open'].iloc[-1]),
                    'high': float(input_data['high'].iloc[-1]),
                    'low': float(input_data['low'].iloc[-1]),
                    'close': float(input_data['close'].iloc[-1])
                }
            },
            'prediction_results': prediction_results,
            'actual_data': actual_data,
            'analysis': {}
        }

        if actual_data and len(actual_data) > 0:
            if len(prediction_results) > 0 and len(actual_data) > 0:
                last_pred = prediction_results[0]
                first_actual = actual_data[0]

                save_data['analysis']['continuity'] = {
                    'last_prediction': {
                        'open': last_pred['open'],
                        'high': last_pred['high'],
                        'low': last_pred['low'],
                        'close': last_pred['close']
                    },
                    'first_actual': {
                        'open': first_actual['open'],
                        'high': first_actual['high'],
                        'low': first_actual['low'],
                        'close': first_actual['close']
                    },
                    'gaps': {
                        'open_gap': abs(last_pred['open'] - first_actual['open']),
                        'high_gap': abs(last_pred['high'] - first_actual['high']),
                        'low_gap': abs(last_pred['low'] - first_actual['low']),
                        'close_gap': abs(last_pred['close'] - first_actual['close'])
                    },
                    'gap_percentages': {
                        'open_gap_pct': (abs(last_pred['open'] - first_actual['open']) / first_actual['open']) * 100,
                        'high_gap_pct': (abs(last_pred['high'] - first_actual['high']) / first_actual['high']) * 100,
                        'low_gap_pct': (abs(last_pred['low'] - first_actual['low']) / first_actual['low']) * 100,
                        'close_gap_pct': (abs(last_pred['close'] - first_actual['close']) / first_actual['close']) * 100
                    }
                }

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(save_data, f, indent=2, ensure_ascii=False)

        if file_path:
            base_name = os.path.basename(file_path)
            safe_mkey = re.sub(r'[^a-zA-Z0-9_.-]', '_', mkey)
            safe_base = re.sub(r'[^a-zA-Z0-9_.-]', '_', base_name)
            cache_filepath = os.path.join(results_dir, f'cache_{safe_mkey}_{safe_base}.json')
            with open(cache_filepath, 'w', encoding='utf-8') as cf:
                json.dump(save_data, cf, indent=2, ensure_ascii=False)

        print(f"Prediction results saved to: {filepath}")
        return filepath

    except Exception as e:
        print(f"Failed to save prediction results: {e}")
        return None


def create_prediction_chart(df, pred_df, lookback, pred_len, actual_df=None, historical_start_idx=0):
    """Create prediction chart"""
    if historical_start_idx + lookback + pred_len <= len(df):
        historical_df = df.iloc[historical_start_idx:historical_start_idx + lookback]
    else:
        available_lookback = min(lookback, len(df) - historical_start_idx)
        historical_df = df.iloc[historical_start_idx:historical_start_idx + available_lookback]

    fig = go.Figure()

    fig.add_trace(go.Candlestick(
        x=historical_df['timestamps'] if 'timestamps' in historical_df.columns else historical_df.index,
        open=historical_df['open'],
        high=historical_df['high'],
        low=historical_df['low'],
        close=historical_df['close'],
        name='Historical Data (400 data points)',
        increasing_line_color='#26A69A',
        decreasing_line_color='#EF5350'
    ))

    if pred_df is not None and len(pred_df) > 0:
        if 'timestamps' in df.columns and len(historical_df) > 0:
            last_timestamp = historical_df['timestamps'].iloc[-1]
            time_diff = df['timestamps'].iloc[1] - df['timestamps'].iloc[0] if len(df) > 1 else pd.Timedelta(hours=1)
            pred_timestamps = pd.date_range(
                start=last_timestamp + time_diff,
                periods=len(pred_df),
                freq=time_diff
            )
        else:
            pred_timestamps = range(len(historical_df), len(historical_df) + len(pred_df))

        fig.add_trace(go.Candlestick(
            x=pred_timestamps,
            open=pred_df['open'],
            high=pred_df['high'],
            low=pred_df['low'],
            close=pred_df['close'],
            name='Prediction Data (120 data points)',
            increasing_line_color='#66BB6A',
            decreasing_line_color='#FF7043'
        ))

    if actual_df is not None and len(actual_df) > 0:
        if 'timestamps' in df.columns:
            if 'pred_timestamps' in locals():
                actual_timestamps = pred_timestamps
            else:
                if len(historical_df) > 0:
                    last_timestamp = historical_df['timestamps'].iloc[-1]
                    time_diff = df['timestamps'].iloc[1] - df['timestamps'].iloc[0] if len(df) > 1 else pd.Timedelta(hours=1)
                    actual_timestamps = pd.date_range(
                        start=last_timestamp + time_diff,
                        periods=len(actual_df),
                        freq=time_diff
                    )
                else:
                    actual_timestamps = range(len(historical_df), len(historical_df) + len(actual_df))
        else:
            actual_timestamps = range(len(historical_df), len(historical_df) + len(actual_df))

        fig.add_trace(go.Candlestick(
            x=actual_timestamps,
            open=actual_df['open'],
            high=actual_df['high'],
            low=actual_df['low'],
            close=actual_df['close'],
            name='Actual Data (120 data points)',
            increasing_line_color='#FF9800',
            decreasing_line_color='#F44336'
        ))

    fig.update_layout(
        title='Kronos Financial Prediction Results - 400 Historical Points + 120 Prediction Points vs 120 Actual Points',
        xaxis_title='Time',
        yaxis_title='Price',
        template='plotly_white',
        height=600,
        showlegend=True
    )

    if 'timestamps' in historical_df.columns:
        all_timestamps = []
        if len(historical_df) > 0:
            all_timestamps.extend(historical_df['timestamps'])
        if 'pred_timestamps' in locals():
            all_timestamps.extend(pred_timestamps)
        if 'actual_timestamps' in locals():
            all_timestamps.extend(actual_timestamps)

        if all_timestamps:
            all_timestamps = sorted(all_timestamps)
            fig.update_xaxes(
                range=[all_timestamps[0], all_timestamps[-1]],
                rangeslider_visible=False,
                type='date'
            )

    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def load_cached_prediction(file_path, model_key=None):
    """Load the most recent saved prediction result for a given data file and model, regenerating chart if needed."""
    try:
        if not file_path:
            return None
        results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prediction_results')
        if not os.path.exists(results_dir):
            return None

        mkey = (model_key or model_service.get_current_model_key() or 'kronos-mini').strip().lower()
        safe_mkey = re.sub(r'[^a-zA-Z0-9_.-]', '_', mkey)
        base_name = os.path.basename(file_path)
        safe_base = re.sub(r'[^a-zA-Z0-9_.-]', '_', base_name)
        cache_filepath = os.path.join(results_dir, f'cache_{safe_mkey}_{safe_base}.json')
        legacy_cache_filepath = os.path.join(results_dir, f'cache_{safe_base}.json')

        saved = None
        if os.path.exists(cache_filepath):
            with open(cache_filepath, 'r', encoding='utf-8') as f:
                saved = json.load(f)
        elif mkey == 'kronos-mini' and os.path.exists(legacy_cache_filepath):
            with open(legacy_cache_filepath, 'r', encoding='utf-8') as f:
                saved = json.load(f)
        else:
            legacy_alt = f'binance_{base_name}' if not base_name.startswith('binance_') else base_name
            candidates = sorted(
                [f for f in os.listdir(results_dir) if f.startswith('prediction_') and f.endswith('.json')],
                reverse=True
            )
            for fname in candidates:
                fpath = os.path.join(results_dir, fname)
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    saved_mkey = (data.get('model_key') or data.get('prediction_params', {}).get('model_key') or 'kronos-mini').strip().lower()
                    if saved_mkey != mkey:
                        continue
                    saved_base = os.path.basename(data.get('file_path', ''))
                    stripped_current = re.sub(r'_\d{6}(?:[_-]\d{4})?(?=\.csv$)', '', base_name)
                    if saved_base == base_name or saved_base == legacy_alt or saved_base == f'binance_{stripped_current}':
                        saved = data
                        break
                except Exception:
                    continue

        if not saved or not saved.get('prediction_results'):
            return None

        chart_json = saved.get('chart')
        if not chart_json and os.path.exists(file_path):
            df, err = load_data_file(file_path)
            if df is not None and not err:
                params = saved.get('prediction_params', {})
                lookback = int(params.get('lookback', 400))
                pred_len = int(params.get('pred_len', len(saved['prediction_results'])))
                pred_df = pd.DataFrame(saved['prediction_results'])
                actual_data = saved.get('actual_data', [])
                actual_df = pd.DataFrame(actual_data) if actual_data else None
                start_date = params.get('start_date', 'latest')
                if start_date and start_date != 'latest':
                    start_dt = align_timestamp_timezone(start_date, df['timestamps'])
                    mask = df['timestamps'] >= start_dt
                    historical_start_idx = df[mask].index[0] if len(df[mask]) > 0 else max(0, len(df) - lookback)
                else:
                    historical_start_idx = max(0, len(df) - lookback)
                chart_json = create_prediction_chart(df, pred_df, lookback, pred_len, actual_df, historical_start_idx)

        if not chart_json:
            return None

        return {
            'success': True,
            'cached': True,
            'saved_at': saved.get('timestamp'),
            'prediction_type': saved.get('prediction_type', 'Kronos model prediction'),
            'chart': chart_json,
            'prediction_results': saved.get('prediction_results', []),
            'actual_data': saved.get('actual_data', []),
            'has_comparison': len(saved.get('actual_data', [])) > 0
        }
    except Exception as e:
        print(f"Failed to load cached prediction: {e}")
        return None

