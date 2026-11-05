#!/usr/bin/env python3
"""Download real OHLCV data and save it in Kronos-compatible CSV format.

Sources:
  - Binance public Spot Kline API (no API key required)
  - Alpha Vantage equities/ETFs and FX (API key required)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
BINANCE_URL = "https://data-api.binance.vision/api/v3/klines"
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
OUTPUT_COLUMNS = ["timestamps", "open", "high", "low", "close", "volume"]


def api_get(url: str, params: dict[str, Any], timeout: int = 60) -> Any:
    try:
        response = requests.get(url, params=params, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        raise RuntimeError(f"API request failed: {exc}") from exc
    except ValueError as exc:
        raise RuntimeError("API returned invalid JSON.") from exc


def parse_time(value: str | None) -> int | None:
    if not value:
        return None
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return int(timestamp.timestamp() * 1000)


def normalize_and_save(df: pd.DataFrame, output: Path) -> Path:
    missing = [column for column in OUTPUT_COLUMNS if column not in df.columns]
    if missing:
        raise RuntimeError(f"Missing output columns: {missing}")

    result = df[OUTPUT_COLUMNS].copy()
    result["timestamps"] = pd.to_datetime(result["timestamps"], utc=True)
    for column in ["open", "high", "low", "close", "volume"]:
        result[column] = pd.to_numeric(result[column], errors="coerce")
    result = result.dropna().drop_duplicates(subset=["timestamps"]).sort_values("timestamps")
    if result.empty:
        raise RuntimeError("No valid OHLCV rows were returned.")

    output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output, index=False, date_format="%Y-%m-%d %H:%M:%S%z")
    print(f"Saved {len(result)} rows: {output}")
    if len(result) < 520:
        print("WARNING: Kronos Web UI normally needs at least 520 rows.", file=sys.stderr)
    return output


def download_binance(args: argparse.Namespace) -> Path:
    requested = args.rows
    if requested < 1:
        raise RuntimeError("--rows must be greater than zero.")

    start_ms = parse_time(args.start)
    cursor_end = parse_time(args.end)
    all_rows: list[list[Any]] = []

    while len(all_rows) < requested:
        batch_size = min(1000, requested - len(all_rows))
        params: dict[str, Any] = {
            "symbol": args.symbol.upper(),
            "interval": args.interval,
            "limit": batch_size,
        }
        if start_ms is not None:
            params["startTime"] = start_ms
        if cursor_end is not None:
            params["endTime"] = cursor_end

        batch = api_get(BINANCE_URL, params)
        if not isinstance(batch, list):
            raise RuntimeError(f"Unexpected Binance response: {batch}")
        if not batch:
            break

        all_rows = batch + all_rows
        earliest_open = int(batch[0][0])
        next_end = earliest_open - 1
        if cursor_end == next_end or (start_ms is not None and earliest_open <= start_ms):
            break
        cursor_end = next_end
        time.sleep(0.1)

    # Keep the requested latest rows after backward pagination.
    all_rows = all_rows[-requested:]
    frame = pd.DataFrame(
        {
            "timestamps": [pd.to_datetime(row[0], unit="ms", utc=True) for row in all_rows],
            "open": [row[1] for row in all_rows],
            "high": [row[2] for row in all_rows],
            "low": [row[3] for row in all_rows],
            "close": [row[4] for row in all_rows],
            "volume": [row[5] for row in all_rows],
        }
    )
    output = args.output or DEFAULT_DATA_DIR / f"binance_{args.symbol.lower()}_{args.interval}.csv"
    return normalize_and_save(frame, Path(output))


def alpha_key(args: argparse.Namespace) -> str:
    key = args.api_key or os.environ.get("ALPHAVANTAGE_API_KEY")
    if not key:
        raise RuntimeError(
            "Alpha Vantage API key is missing. Set $env:ALPHAVANTAGE_API_KEY='YOUR_KEY' "
            "or pass --api-key YOUR_KEY."
        )
    return key


def alpha_error(payload: dict[str, Any]) -> None:
    for key in ("Error Message", "Information", "Note"):
        if key in payload:
            raise RuntimeError(f"Alpha Vantage: {payload[key]}")


def download_alpha_stock(args: argparse.Namespace) -> Path:
    interval = getattr(args, "interval", "daily")
    function = "TIME_SERIES_WEEKLY" if interval == "weekly" else "TIME_SERIES_DAILY"
    params = {
        "function": function,
        "symbol": args.symbol.upper(),
        "apikey": alpha_key(args),
    }
    if interval == "daily":
        params["outputsize"] = args.outputsize
    payload = api_get(ALPHA_VANTAGE_URL, params)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected Alpha Vantage response: {payload}")
    alpha_error(payload)
    series_key = "Weekly Time Series" if interval == "weekly" else "Time Series (Daily)"
    series = payload.get(series_key)
    if not series:
        raise RuntimeError(f"{series_key} not found in Alpha Vantage response: {payload}")

    rows = []
    for timestamp, values in series.items():
        rows.append(
            {
                "timestamps": timestamp,
                "open": values["1. open"],
                "high": values["2. high"],
                "low": values["3. low"],
                "close": values["4. close"],
                "volume": values.get("5. volume", 0),
            }
        )
    output = args.output or DEFAULT_DATA_DIR / f"alpha_{args.symbol.lower()}_{interval}.csv"
    return normalize_and_save(pd.DataFrame(rows), Path(output))


def download_alpha_fx(args: argparse.Namespace) -> Path:
    params = {
        "function": "FX_DAILY",
        "from_symbol": args.from_symbol.upper(),
        "to_symbol": args.to_symbol.upper(),
        "outputsize": args.outputsize,
        "apikey": alpha_key(args),
    }
    payload = api_get(ALPHA_VANTAGE_URL, params)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected Alpha Vantage response: {payload}")
    alpha_error(payload)
    series = payload.get("Time Series FX (Daily)")
    if not series:
        raise RuntimeError(f"FX daily series not found in Alpha Vantage response: {payload}")

    rows = []
    for timestamp, values in series.items():
        rows.append(
            {
                "timestamps": timestamp,
                "open": values["1. open"],
                "high": values["2. high"],
                "low": values["3. low"],
                "close": values["4. close"],
                "volume": 0,
            }
        )
    pair = f"{args.from_symbol.lower()}{args.to_symbol.lower()}"
    output = args.output or DEFAULT_DATA_DIR / f"alpha_{pair}_daily.csv"
    return normalize_and_save(pd.DataFrame(rows), Path(output))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="source", required=True)

    binance = subparsers.add_parser("binance", help="Download public Binance Spot candles")
    binance.add_argument("--symbol", default="BTCUSDT", help="Trading pair, e.g. BTCUSDT")
    binance.add_argument("--interval", default="1h", help="Kline interval, e.g. 5m, 1h, 1d")
    binance.add_argument("--rows", type=int, default=1000, help="Number of latest candles")
    binance.add_argument("--start", help="Optional UTC start date/time")
    binance.add_argument("--end", help="Optional UTC end date/time")
    binance.add_argument("--output", type=Path, help="Output CSV path")
    binance.set_defaults(handler=download_binance)

    stock = subparsers.add_parser("alpha-stock", help="Download Alpha Vantage daily stock/ETF OHLCV")
    stock.add_argument("--symbol", required=True, help="Ticker, e.g. IBM, AAPL, GLD, IAU")
    stock.add_argument("--interval", choices=["daily", "weekly"], default="daily")
    stock.add_argument("--outputsize", choices=["compact", "full"], default="full")
    stock.add_argument("--api-key", help="Prefer ALPHAVANTAGE_API_KEY instead")
    stock.add_argument("--output", type=Path, help="Output CSV path")
    stock.set_defaults(handler=download_alpha_stock)

    forex = subparsers.add_parser("alpha-fx", help="Download Alpha Vantage daily Forex OHLC")
    forex.add_argument("--from-symbol", required=True, help="Base currency, e.g. EUR")
    forex.add_argument("--to-symbol", required=True, help="Quote currency, e.g. USD")
    forex.add_argument("--outputsize", choices=["compact", "full"], default="full")
    forex.add_argument("--api-key", help="Prefer ALPHAVANTAGE_API_KEY instead")
    forex.add_argument("--output", type=Path, help="Output CSV path")
    forex.set_defaults(handler=download_alpha_fx)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.handler(args)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

