import os
import sys
import warnings
import traceback
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS

sys.dont_write_bytecode = True
os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '300')
os.environ.setdefault('HF_HUB_ETAG_TIMEOUT', '60')
warnings.filterwarnings('ignore')

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model_service import (
    MODEL_AVAILABLE,
    AVAILABLE_MODELS,
    model_load_lock,
    load_kronos_model,
    get_model_status_dict,
    execute_prediction,
)
from data_service import (
    market_data_lock,
    load_data_file,
    build_data_info,
    fetch_binance_symbols,
    download_market_dataset,
)
from chart_cache_service import (
    load_data_files,
    load_cached_prediction,
)
from backtest_service import run_backtest, save_backtest, list_saved_backtests, load_saved_backtest

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)


@app.route('/')
def index():
    """Home page"""
    return render_template('index.html')


@app.route('/favicon.ico')
def favicon():
    return '', 204


@app.route('/api/data-files')
def get_data_files():
    """Get available data file list"""
    model_key = request.args.get('model_key')
    return jsonify(load_data_files(model_key))


@app.route('/api/config-status')
def get_config_status():
    """Report credential availability without exposing secret values."""
    return jsonify({
        'alpha_vantage_configured': bool(os.environ.get('ALPHAVANTAGE_API_KEY'))
    })


@app.route('/api/binance-symbols')
def get_binance_symbols():
    """Return active Binance Spot USDT pairs for the searchable combobox."""
    try:
        symbols = fetch_binance_symbols()
        return jsonify({
            'success': True,
            'count': len(symbols),
            'symbols': symbols
        })
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'error': f'Không tải được danh sách Binance: {exc}'}), 502


@app.route('/api/fetch-market-data', methods=['POST'])
def fetch_market_data():
    """Download a predefined real-market dataset and make it available to the UI."""
    if not market_data_lock.acquire(blocking=False):
        return jsonify({'error': 'Một tác vụ tải dữ liệu khác đang chạy.'}), 409

    try:
        payload = request.get_json(silent=True) or {}
        result, err = download_market_dataset(payload)
        if err:
            return jsonify({'error': err[0]}), err[1]
        return jsonify(result)
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'error': f'Tải dữ liệu thị trường thất bại: {exc}'}), 500
    finally:
        market_data_lock.release()


@app.route('/api/load-data', methods=['POST'])
def load_data():
    """Load data file"""
    try:
        data = request.get_json()
        file_path = data.get('file_path')
        model_key = data.get('model_key')

        if not file_path:
            return jsonify({'error': 'File path cannot be empty'}), 400

        df, error = load_data_file(file_path)
        if error:
            return jsonify({'error': error}), 400

        return jsonify({
            'success': True,
            'data_info': build_data_info(df),
            'cached_prediction': load_cached_prediction(file_path, model_key),
            'message': f'Đã nạp dữ liệu thành công: {len(df)} nến'
        })
    except Exception as e:
        return jsonify({'error': f'Failed to load data: {str(e)}'}), 500


@app.route('/api/predict', methods=['POST'])
def predict():
    """Perform prediction"""
    try:
        data = request.get_json() or {}
        result, err = execute_prediction(data)
        if err:
            return jsonify({'error': err[0]}), err[1]
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'Prediction failed: {str(e)}'}), 500


@app.route('/api/load-model', methods=['POST'])
def load_model():
    """Load Kronos model"""
    if not model_load_lock.acquire(blocking=False):
        return jsonify({'error': 'Another model download is already running. Please wait for it to finish.'}), 409

    try:
        data = request.get_json()
        model_key = data.get('model_key', 'kronos-small')
        device = data.get('device', 'cpu')

        model_config, err = load_kronos_model(model_key, device)
        if err:
            return jsonify({'error': err[0]}), err[1]

        return jsonify({
            'success': True,
            'message': f'Đã tải mô hình {model_config["name"]} ({model_config["params"]}) trên {device}',
            'model_info': {
                'name': model_config['name'],
                'params': model_config['params'],
                'context_length': model_config['context_length'],
                'description': model_config['description']
            }
        })
    except Exception as e:
        traceback.print_exc()
        error_text = str(e)
        if 'timed out' in error_text.lower() or 'timeout' in error_text.lower():
            error_text += ' Try Kronos-mini first and check the connection to Hugging Face.'
        return jsonify({'error': f'Model loading failed: {error_text}'}), 500
    finally:
        model_load_lock.release()


@app.route('/api/available-models')
def get_available_models():
    """Get available model list"""
    return jsonify({
        'models': AVAILABLE_MODELS,
        'model_available': MODEL_AVAILABLE
    })


@app.route('/api/model-status')
def get_model_status():
    """Get model status"""
    return jsonify(get_model_status_dict())


@app.route('/backtest')
def backtest_page():
    """Trang backtest walk-forward"""
    return render_template('backtest.html')


@app.route('/api/backtest', methods=['POST'])
def backtest():
    """Chạy backtest: dự báo lặp lại từng cửa sổ và so với giá thật"""
    if not model_load_lock.acquire(blocking=False):
        return jsonify({'error': 'Đang có tác vụ tải mô hình/backtest khác chạy, vui lòng chờ.'}), 409
    try:
        data = request.get_json() or {}
        result, err = run_backtest(data)
        if err:
            return jsonify({'error': err[0]}), err[1]
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Backtest thất bại: {str(e)}'}), 500
    finally:
        model_load_lock.release()


@app.route('/api/backtest/save', methods=['POST'])
def backtest_save():
    """Lưu kết quả backtest vừa chạy"""
    result, err = save_backtest(request.get_json() or {})
    if err:
        return jsonify({'error': err[0]}), err[1]
    return jsonify(result)


@app.route('/api/backtest/saved')
def backtest_saved_list():
    """Danh sách kết quả backtest đã lưu"""
    return jsonify(list_saved_backtests())


@app.route('/api/backtest/saved/<save_id>')
def backtest_saved_get(save_id):
    """Xem lại 1 kết quả backtest đã lưu"""
    record, err = load_saved_backtest(save_id)
    if err:
        return jsonify({'error': err[0]}), err[1]
    return jsonify(record)


if __name__ == '__main__':
    print("Starting Kronos Web UI...")
    print(f"Model availability: {MODEL_AVAILABLE}")
    if MODEL_AVAILABLE:
        print("Tip: You can load Kronos model through /api/load-model endpoint")
    else:
        print("Tip: Will use simulated data for demonstration")

    server_port = int(os.environ.get('KRONOS_PORT', '7071'))
    app.run(debug=False, host='127.0.0.1', port=server_port)
