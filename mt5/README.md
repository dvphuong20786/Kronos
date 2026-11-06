# Tich hop SMC Bot (MT5) voi Kronos (Python)

## File trong thu muc nay

| File | Ghi chu |
|---|---|
| `SMC_Auto_Bot_Kronos.mq5` | Ban copy cua `SMC_Auto_Bot.mq5` goc + 2 chuc nang Kronos. File goc giu nguyen. |
| `kronos_mt5_bridge.py` | Script Python: doc CSV do EA xuat -> chay Kronos -> ghi file tin hieu. |

## Thay doi trong ban copy (so voi file goc)

1. Input moi `InpExportData` / `InpExportBars` / `InpExportFile`: moi nen moi,
   EA ghi N nen gan nhat ra `MQL5/Files/kronos_export.csv` dung dinh dang Kronos
   (`timestamps,open,high,low,close,volume`).
2. Input moi `InpUseKronosFilter` / `InpKronosSignalFile`: truoc khi Buy/Sell theo
   Order Block, EA doc `MQL5/Files/kronos_signal.csv` (do Python ghi). Chi vao lenh
   khi huong AI trung huong SMC. Khong co file = giu hanh vi goc.
3. Mac dinh ca 2 chuc nang deu TAT (`false`) nen bot chay y nhu ban goc.

## Luong du lieu (tra loi: MT5 sinh du lieu, khong can file co truoc)

```text
MT5 (EA)  --kronos_export.csv-->  Python (Kronos predict)
MT5 (EA)  <--kronos_signal.csv--  Python (ghi bias,conf)
```

- Nen dung: MT5 la nguon su that, tu sinh CSV moi nen moi. Khong can chuan bi
  file truoc. File CSV trong `F:\\WORK\\Kronos\\data` chi dung cho backtest offline.
- Truong hop duy nhat can file truoc: chay backtest trong Web UI (chon file),
  khong lien quan toi bot live.

## Cac buoc chay

1. Copy `SMC_Auto_Bot_Kronos.mq5` vao thu muc Experts tren MT5 (cung cho voi file goc),
   mo MetaEditor (F4) nhan Compile (F7).
2. Gan EA len chart, bat `InpExportData = true`, chay vai nen de co file
   `MQL5/Files/kronos_export.csv`.
3. Chay cau noi (1 lan de thu):
   ```powershell
   cd F:\WORK\Kronos\webui
   ..\.venv\Scripts\python.exe ..\mt5\kronos_mt5_bridge.py --once
   ```
4. Khi thay file `kronos_signal.csv` xuat hien, bat `InpUseKronosFilter = true`
   tren EA de loc lenh theo AI.
