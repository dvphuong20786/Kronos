"""
Cau noi Kronos <-> MT5 cho SMC_Auto_Bot_Kronos.mq5.

Luong chay (1 vong):
    1. EA tren MT5 xuat nen ra `kronos_export.csv` (MQL5/Files).
    2. Script nay doc CSV -> chay model Kronos -> so sanh huong du bao.
    3. Ghi file tin hieu `kronos_signal.csv` de EA doc va loc lenh.

Chay thu 1 vong:
    cd F:\\WORK\\Kronos\\webui
    ..\\.venv\\Scripts\\python.exe ..\\mt5\\kronos_mt5_bridge.py --once

Chay lap lai moi 60 giay:
    ..\\.venv\\Scripts\\python.exe ..\\mt5\\kronos_mt5_bridge.py --loop 60
"""
import argparse
import os
import sys
import time

import pandas as pd

# Cho phep import data_service / model_service tu thu muc webui.
WEBUI_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'webui')
sys.path.insert(0, WEBUI_DIR)

from data_service import load_data_file
import model_service

# Thu muc MQL5/Files cua terminal dang dung (doi lai neu khac may).
DEFAULT_MT5_FILES = (
    r'C:\Users\dvphu\AppData\Roaming\MetaQuotes\Terminal'
    r'\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Files'
)


def _direction(start_price, end_price):
    if end_price > start_price:
        return 'BULLISH'
    if end_price < start_price:
        return 'BEARISH'
    return 'NONE'


def run_once(export_csv, signal_csv, lookback=400, pred_len=48,
             temperature=0.8, top_p=0.9, sample_count=1):
    df, error = load_data_file(export_csv)
    if error:
        print(f'[bridge] khong doc duoc CSV: {error}')
        return False
    if len(df) < lookback:
        print(f'[bridge] CSV chi co {len(df)} nen, can >= {lookback}.')
        return False

    predictor = model_service.get_predictor()
    if predictor is None:
        print('[bridge] model chua duoc tai.')
        return False

    history = df.iloc[-lookback:]
    feature_cols = ['open', 'high', 'low', 'close']
    if 'volume' in df.columns:
        feature_cols.append('volume')

    # Tao truc thoi gian tuong lai theo timeframe suy ra tu du lieu.
    freq = (history['timestamps'].iloc[-1] - history['timestamps'].iloc[-2])
    y_timestamp = pd.date_range(
        start=history['timestamps'].iloc[-1] + freq,
        periods=pred_len, freq=freq,
    )

    pred_df = predictor.predict(
        df=history[feature_cols],
        x_timestamp=history['timestamps'],
        y_timestamp=y_timestamp,
        pred_len=pred_len,
        T=temperature,
        top_p=top_p,
        sample_count=sample_count,
        verbose=False,
    )

    last_close = float(history['close'].iloc[-1])
    pred_close = pred_df['close'].to_numpy(dtype=float)
    bias = _direction(last_close, pred_close[-1])

    # Do tin cay don gian: % nen du bao dong y huong voi nen cuoi.
    closes = pred_close - last_close
    agree = float((closes > 0).mean()) if bias == 'BULLISH' else float((closes < 0).mean())
    if bias == 'NONE':
        agree = 0.5

    with open(signal_csv, 'w', encoding='ascii') as f:
        f.write('bias,conf\n')
        f.write(f'{bias},{agree:.3f}\n')

    print(f'[bridge] last_close={last_close} pred_close={pred_close[-1]:.2f} '
          f'bias={bias} conf={agree:.3f} -> {signal_csv}')
    return True


def main():
    parser = argparse.ArgumentParser(description='Kronos <-> MT5 bridge')
    parser.add_argument('--mt5-files', default=DEFAULT_MT5_FILES)
    parser.add_argument('--export-name', default='kronos_export.csv')
    parser.add_argument('--signal-name', default='kronos_signal.csv')
    parser.add_argument('--model', default='kronos-small')
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--lookback', type=int, default=400)
    parser.add_argument('--pred-len', type=int, default=48)
    parser.add_argument('--loop', type=int, default=0,
                        help='So giay lap lai, 0 = chay 1 lan roi dung')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()

    export_csv = os.path.join(args.mt5_files, args.export_name)
    signal_csv = os.path.join(args.mt5_files, args.signal_name)

    print(f'[bridge] tai model {args.model} tren {args.device}...')
    _, error = model_service.load_kronos_model(args.model, args.device)
    if error:
        print(f'[bridge] loi tai model: {error[0]}')
        return 1

    interval = 0 if args.once else args.loop
    while True:
        run_once(export_csv, signal_csv,
                 lookback=args.lookback, pred_len=args.pred_len)
        if interval <= 0:
            break
        time.sleep(interval)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
