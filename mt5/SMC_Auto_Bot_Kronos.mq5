//+------------------------------------------------------------------+
//|                                          SMC_Auto_Bot_Kronos.mq5 |
//|                                     Copyright 2026, Auto Gen     |
//|                                             https://www.mql5.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, Auto Gen"
#property link      "https://www.mql5.com"
#property version   "1.01-kronos"
//| Ban copy: them xuat du lieu CSV + bo loc tin hieu Kronos AI. |
//| File goc SMC_Auto_Bot.mq5 duoc giu nguyen, khong sua.        |

#include <Trade\Trade.mqh>
CTrade trade;

//--- Enumerations
enum ENUM_ASSET_TYPE {
    ASSET_AUTO = 0, // Tự động (VÀNG/FOREX)
    ASSET_MANUAL = 1 // Thủ công (Manual)
};

enum ENUM_ASSET_SELECT {
    SELECT_GOLD = 0, // VÀNG (XAUUSD)
    SELECT_FOREX = 1 // FOREX (Tiền tệ)
};

enum ENUM_TP_METHOD {
    TP_RR = 0, // Cố định R:R
    TP_SWING = 1 // Cấu trúc (Swing)
};

enum ENUM_BIAS {
    BIAS_NONE = 0,
    BIAS_BULLISH = 1,
    BIAS_BEARISH = -1
};

//--- Inputs
input group "Trading System & Dashboard"
input ENUM_ASSET_TYPE    InpAssetType     = ASSET_AUTO;      // Chế độ SL/TP
input ENUM_ASSET_SELECT  InpAssetSelect   = SELECT_GOLD;     // Loại tài sản
input double             InpRRRatio       = 1.4;             // Tỷ lệ Risk:Reward (Cố định R:R)
input ENUM_TP_METHOD     InpTPMethod      = TP_SWING;        // Phương pháp Chốt lời (TP)
input int                InpTPBuffer      = 10;              // Giảm TP Cấu trúc (Ticks) [Thủ công]
input int                InpSLBuffer      = 20;              // Khoảng đệm Stop Loss (Ticks) [Thủ công]
input double             InpLotSize       = 0.01;            // Khối lượng giao dịch (Lot cố định)

input group "Cấu trúc (Structure)"
input int                InpSwingLength   = 50;              // Số nến nhãn Đỉnh/Đáy (Swing Length)
input bool               InpUseInternalOB = false;           // Sử dụng OB Cấu trúc phụ (M15 Tắt, H1 Bật)
input bool               InpShowGraphics  = true;            // Hiển thị đồ họa (Vẽ Hộp OB)

input group "Kronos AI (loc tin hieu + xuat du lieu)"
input bool               InpUseKronosFilter = false;          // Bật bộ lọc Kronos (đọc file tín hiệu)
input string             InpKronosSignalFile = "kronos_signal.csv"; // File tín hiệu do Python ghi (MQL5/Files)
input bool               InpExportData      = false;          // Xuất nến ra CSV chuẩn Kronos mỗi nến mới
input int                InpExportBars      = 500;            // Số nến xuất ra (khớp lookback Kronos)
input string             InpExportFile      = "kronos_export.csv";   // File CSV xuất ra (MQL5/Files)

//--- Structs
struct SPivot {
    double currentLevel;
    double lastLevel;
    bool   crossed;
    datetime barTime;
    int    barIndex;
};

struct SOrderBlock {
    datetime barTime;
    double   barHigh;
    double   barLow;
    ENUM_BIAS bias;
    bool     mitigated;
    datetime mitigatedTime;
};

struct STrailing {
    double top;
    double bottom;
    datetime barTime;
    int barIndex;
};

//--- Global Variables
SPivot swingHigh, swingLow;
SPivot internalHigh, internalLow;
STrailing trailing;

SOrderBlock swingOBs[];
SOrderBlock internalOBs[];

bool historyProcessed = false;

ENUM_BIAS lastTrend = BIAS_NONE;
ENUM_BIAS internalTrend = BIAS_NONE;
int currentLeg = 0;
int internalLeg = 0;

int AutoSLTicks, AutoTPTicks;
double pointValue, tickSize;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    pointValue = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
    tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);

    if (InpAssetType == ASSET_MANUAL) {
        AutoSLTicks = InpSLBuffer;
        AutoTPTicks = InpTPBuffer;
    } else {
        GetAutoBuffers(InpAssetSelect, Period(), AutoSLTicks, AutoTPTicks);
    }

    swingHigh.crossed = true;
    swingLow.crossed = true;
    internalHigh.crossed = true;
    internalLow.crossed = true;

    return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Get Auto Buffers based on Asset and Timeframe                    |
//+------------------------------------------------------------------+
void GetAutoBuffers(ENUM_ASSET_SELECT asset, ENUM_TIMEFRAMES tf, int &sl, int &tp)
{
    sl = 40; tp = 20;
    if (asset == SELECT_GOLD) {
        if (tf == PERIOD_M15) { sl = 65; tp = 25; }
        else if (tf == PERIOD_M30) { sl = 80; tp = 35; }
        else if (tf == PERIOD_H1) { sl = 100; tp = 45; }
        else if (tf == PERIOD_H4) { sl = 175; tp = 90; }
        else { sl = 100; tp = 45; }
    } else {
        if (tf == PERIOD_M15) { sl = 25; tp = 12; }
        else if (tf == PERIOD_M30) { sl = 30; tp = 17; }
        else if (tf == PERIOD_H1) { sl = 40; tp = 25; }
        else if (tf == PERIOD_H4) { sl = 75; tp = 40; }
        else { sl = 40; tp = 25; }
    }
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
    if (!historyProcessed) {
        int totalBars = iBars(_Symbol, _Period);
        if (totalBars > InpSwingLength) { 
            int limit = MathMin(totalBars - InpSwingLength - 1, 1500); 
            for(int i = limit; i >= 1; i--) {
                EvaluateStructure(i);
                double ask = iHigh(_Symbol, _Period, i);
                double bid = iLow(_Symbol, _Period, i);
                for(int j = ArraySize(swingOBs) - 1; j >= 0; j--) {
                    if (!swingOBs[j].mitigated) {
                        if (swingOBs[j].bias == BIAS_BULLISH && bid <= swingOBs[j].barHigh) {
                            swingOBs[j].mitigated = true;
                            swingOBs[j].mitigatedTime = iTime(_Symbol, _Period, i);
                            
                            // Simulate Trade History
                            double sl = swingOBs[j].barLow - AutoSLTicks * tickSize;
                            double tp = InpTPMethod == TP_RR ? swingOBs[j].barHigh + (swingOBs[j].barHigh - sl) * InpRRRatio : swingOBs[j].barHigh + AutoTPTicks * tickSize;
                            bool isWin = iHigh(_Symbol, _Period, i) >= tp;
                            AddStat(isWin, (tp - swingOBs[j].barHigh)/pointValue, isWin ? InpRRRatio : -1.0);
                            
                            string n = "HistTrade_" + IntegerToString(iTime(_Symbol, _Period, i));
                            ObjectCreate(0, n, OBJ_ARROW_BUY, 0, iTime(_Symbol, _Period, i), swingOBs[j].barHigh);
                            ObjectSetInteger(0, n, OBJPROP_COLOR, clrLime);
                        }
                        if (swingOBs[j].bias == BIAS_BEARISH && ask >= swingOBs[j].barLow) {
                            swingOBs[j].mitigated = true;
                            swingOBs[j].mitigatedTime = iTime(_Symbol, _Period, i);
                            
                            // Simulate Trade History
                            double sl = swingOBs[j].barHigh + AutoSLTicks * tickSize;
                            double tp = InpTPMethod == TP_RR ? swingOBs[j].barLow - (sl - swingOBs[j].barLow) * InpRRRatio : swingOBs[j].barLow - AutoTPTicks * tickSize;
                            bool isWin = iLow(_Symbol, _Period, i) <= tp;
                            AddStat(isWin, (swingOBs[j].barLow - tp)/pointValue, isWin ? InpRRRatio : -1.0);
                            
                            string n = "HistTrade_" + IntegerToString(iTime(_Symbol, _Period, i));
                            ObjectCreate(0, n, OBJ_ARROW_SELL, 0, iTime(_Symbol, _Period, i), swingOBs[j].barLow);
                            ObjectSetInteger(0, n, OBJPROP_COLOR, clrRed);
                        }
                    }
                }
            }
            historyProcessed = true;
            if (InpShowGraphics) {
                DrawOrderBlocks();
                DrawDashboard();
                ChartRedraw();
            }
            Print("--- SMC INITIALIZATION COMPLETE ---");
            Print("Total OBs detected in history: ", ArraySize(swingOBs));
        } else {
            return; // Wait for data to load
        }
    }

    // Cập nhật cấu trúc khi có nến mới
    static datetime lastBarTime = 0;
    datetime currentBarTime = iTime(_Symbol, _Period, 0);
    
    if (currentBarTime != lastBarTime && historyProcessed) {
        // Evaluate historical bars up to the previous completed bar
        int shift = 1; 
        EvaluateStructure(shift);
        lastBarTime = currentBarTime;
        // Kronos: xuat du lieu CSV moi khi co nen moi (neu bat InpExportData)
        if(InpExportData)
            ExportKronosData();
    }

    // Check Open Trades (Exit Logic handles by MT5 SL/TP but we can monitor)
    ManageTrades();

    // Check Entry Logic
    if (PositionsTotal() == 0) {
        CheckEntry();
    }

    if (InpShowGraphics) {
        DrawOrderBlocks();
    }
}

//+------------------------------------------------------------------+
//| Evaluate Structure Logic (runs on bar close)                     |
//+------------------------------------------------------------------+
void EvaluateStructure(int shift)
{
    //--- SWING STRUCTURE ---
    int legStatus = Leg(InpSwingLength, shift);
    
    bool newPivot = false, pivotLow = false, pivotHigh = false;
    if (legStatus != currentLeg && legStatus != 0) {
        newPivot = true;
        if (legStatus == 1) pivotLow = true;
        else if (legStatus == -1) pivotHigh = true;
        currentLeg = legStatus;
    }

    if (newPivot) {
        if (pivotLow) {
            swingLow.lastLevel = swingLow.currentLevel;
            swingLow.currentLevel = iLow(_Symbol, _Period, shift + InpSwingLength);
            swingLow.crossed = false;
            swingLow.barTime = iTime(_Symbol, _Period, shift + InpSwingLength);
            swingLow.barIndex = shift + InpSwingLength;
            
            trailing.bottom = swingLow.currentLevel;
            trailing.barTime = swingLow.barTime;
            trailing.barIndex = swingLow.barIndex;
        } else if (pivotHigh) {
            swingHigh.lastLevel = swingHigh.currentLevel;
            swingHigh.currentLevel = iHigh(_Symbol, _Period, shift + InpSwingLength);
            swingHigh.crossed = false;
            swingHigh.barTime = iTime(_Symbol, _Period, shift + InpSwingLength);
            swingHigh.barIndex = shift + InpSwingLength;

            trailing.top = swingHigh.currentLevel;
            trailing.barTime = swingHigh.barTime;
            trailing.barIndex = swingHigh.barIndex;
        }
    }

    // BOS & CHoCH Detection
    double close = iClose(_Symbol, _Period, shift);
    bool bullishBOS = false, bearishBOS = false;
    bool bullishCHoCH = false, bearishCHoCH = false;

    if (!swingHigh.crossed && close > swingHigh.currentLevel) {
        if (lastTrend == BIAS_BEARISH) {
            bullishCHoCH = true;
            lastTrend = BIAS_BULLISH;
        } else {
            bullishBOS = true;
        }
        swingHigh.crossed = true;
    }

    if (!swingLow.crossed && close < swingLow.currentLevel) {
        if (lastTrend == BIAS_BULLISH) {
            bearishCHoCH = true;
            lastTrend = BIAS_BEARISH;
        } else {
            bearishBOS = true;
        }
        swingLow.crossed = true;
    }

    if (bullishBOS || bearishBOS || bullishCHoCH || bearishCHoCH) {
        DetectOrderBlocks(bullishBOS, bearishBOS, bullishCHoCH, bearishCHoCH, swingOBs, shift);
    }
}

//+------------------------------------------------------------------+
//| Stats Variables                                                  |
//+------------------------------------------------------------------+
int stat_wins = 0;
int stat_losses = 0;
double stat_pips = 0;
double stat_rr = 0;

void AddStat(bool isWin, double pip, double rr) {
    if (isWin) stat_wins++;
    else stat_losses++;
    stat_pips += pip;
    stat_rr += rr;
}

//+------------------------------------------------------------------+
//| Find Leg (Swing)                                                 |
//+------------------------------------------------------------------+
int Leg(int size, int shift)
{
    static int legState = 0;
    
    double high_size = iHigh(_Symbol, _Period, shift + size);
    int highest_idx = iHighest(_Symbol, _Period, MODE_HIGH, size, shift);
    double highest_val = iHigh(_Symbol, _Period, highest_idx);
    bool newLegHigh = (high_size > highest_val);

    double low_size = iLow(_Symbol, _Period, shift + size);
    int lowest_idx = iLowest(_Symbol, _Period, MODE_LOW, size, shift);
    double lowest_val = iLow(_Symbol, _Period, lowest_idx);
    bool newLegLow = (low_size < lowest_val);

    if (newLegHigh) legState = -1; // Bearish Leg
    else if (newLegLow) legState = 1; // Bullish Leg

    return legState;
}

//+------------------------------------------------------------------+
//| Detect Order Blocks                                              |
//+------------------------------------------------------------------+
void DetectOrderBlocks(bool bBOS, bool brBOS, bool bCHoCH, bool brCHoCH, SOrderBlock &obs[], int shift)
{
    // Pine Script uses ta.lowestbars(length) which scans the last InpSwingLength bars from the breakout
    if (bBOS || bCHoCH) {
        // Bullish break: look for the lowest candle in the last 'InpSwingLength' bars
        int lowestIdx = iLowest(_Symbol, _Period, MODE_LOW, InpSwingLength, shift);
        if (lowestIdx != -1) {
            int size = ArraySize(obs);
            ArrayResize(obs, size + 1);
            obs[size].barTime = iTime(_Symbol, _Period, lowestIdx);
            obs[size].barHigh = iHigh(_Symbol, _Period, lowestIdx);
            obs[size].barLow = iLow(_Symbol, _Period, lowestIdx);
            obs[size].bias = BIAS_BULLISH;
            obs[size].mitigated = false;
        }
    }

    if (brBOS || brCHoCH) {
        // Bearish break: look for the highest candle in the last 'InpSwingLength' bars
        int highestIdx = iHighest(_Symbol, _Period, MODE_HIGH, InpSwingLength, shift);
        if (highestIdx != -1) {
            int size = ArraySize(obs);
            ArrayResize(obs, size + 1);
            obs[size].barTime = iTime(_Symbol, _Period, highestIdx);
            obs[size].barHigh = iHigh(_Symbol, _Period, highestIdx);
            obs[size].barLow = iLow(_Symbol, _Period, highestIdx);
            obs[size].bias = BIAS_BEARISH;
            obs[size].mitigated = false;
        }
    }
}

//+------------------------------------------------------------------+
//| Entry Logic                                                      |
//+------------------------------------------------------------------+
void CheckEntry()
{
    double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

    for(int i = ArraySize(swingOBs) - 1; i >= 0; i--) {
        if (!swingOBs[i].mitigated) {
            // Check Mitigation
            if (swingOBs[i].bias == BIAS_BULLISH && bid <= swingOBs[i].barLow) {
                swingOBs[i].mitigated = true;
                swingOBs[i].mitigatedTime = TimeCurrent();
                continue;
            }
            if (swingOBs[i].bias == BIAS_BEARISH && ask >= swingOBs[i].barHigh) {
                swingOBs[i].mitigated = true;
                swingOBs[i].mitigatedTime = TimeCurrent();
                continue;
            }

            // Entry logic
            if (swingOBs[i].bias == BIAS_BULLISH && bid <= swingOBs[i].barHigh && bid >= swingOBs[i].barLow) {
                // Kronos filter: chi Buy khi AI dong y huong len
                if(InpUseKronosFilter && ReadKronosSignal() != BIAS_BULLISH)
                    continue;
                double entryPx = swingOBs[i].barHigh;
                double sl = swingOBs[i].barLow - pointValue * AutoSLTicks;
                double tp = 0;
                
                if (InpTPMethod == TP_RR) {
                    tp = entryPx + (entryPx - sl) * InpRRRatio;
                } else {
                    int highestIdx = iHighest(_Symbol, _Period, MODE_HIGH, InpSwingLength, 1);
                    double structTp = iHigh(_Symbol, _Period, highestIdx) - pointValue * AutoTPTicks;
                    tp = structTp > entryPx ? structTp : entryPx + (entryPx - sl) * InpRRRatio;
                }
                
                trade.Buy(InpLotSize, _Symbol, ask, sl, tp, "SMC BUY OB");
                swingOBs[i].mitigated = true;
                break;
            }

            if (swingOBs[i].bias == BIAS_BEARISH && ask >= swingOBs[i].barLow && ask <= swingOBs[i].barHigh) {
                // Kronos filter: chi Sell khi AI dong y huong xuong
                if(InpUseKronosFilter && ReadKronosSignal() != BIAS_BEARISH)
                    continue;
                double entryPx = swingOBs[i].barLow;
                double sl = swingOBs[i].barHigh + pointValue * AutoSLTicks;
                double tp = 0;

                if (InpTPMethod == TP_RR) {
                    tp = entryPx - (sl - entryPx) * InpRRRatio;
                } else {
                    int lowestIdx = iLowest(_Symbol, _Period, MODE_LOW, InpSwingLength, 1);
                    double structTp = iLow(_Symbol, _Period, lowestIdx) + pointValue * AutoTPTicks;
                    tp = structTp < entryPx ? structTp : entryPx - (sl - entryPx) * InpRRRatio;
                }

                trade.Sell(InpLotSize, _Symbol, bid, sl, tp, "SMC SELL OB");
                swingOBs[i].mitigated = true;
                break;
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Draw Order Blocks on Chart                                       |
//+------------------------------------------------------------------+
void DrawOrderBlocks()
{
    datetime currentTime = iTime(_Symbol, _Period, 0) + PeriodSeconds(_Period);
    for(int i = 0; i < ArraySize(swingOBs); i++) {
        string objName = "SMC_OB_" + IntegerToString(swingOBs[i].barTime);
        
        color obColor = swingOBs[i].bias == BIAS_BULLISH ? clrDarkGreen : clrDarkRed;
        datetime endT = swingOBs[i].mitigated ? swingOBs[i].mitigatedTime : currentTime;

        if (ObjectFind(0, objName) < 0) {
            ObjectCreate(0, objName, OBJ_RECTANGLE, 0, swingOBs[i].barTime, swingOBs[i].barHigh, endT, swingOBs[i].barLow);
            ObjectSetInteger(0, objName, OBJPROP_COLOR, obColor);
            ObjectSetInteger(0, objName, OBJPROP_FILL, true);
            ObjectSetInteger(0, objName, OBJPROP_BACK, true);
            ObjectSetInteger(0, objName, OBJPROP_HIDDEN, false);
        } else {
            if (!swingOBs[i].mitigated) {
                ObjectSetInteger(0, objName, OBJPROP_TIME, 1, endT);
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Draw Dashboard                                                   |
//+------------------------------------------------------------------+
void DrawDashboard() {
    string dName = "SMC_Dashboard_";
    int x = 20;
    int y = 20;
    int lineSpacing = 20;
    
    string t1 = "--- SMC Auto Bot ---";
    string t2 = "Total Trades: " + IntegerToString(stat_wins + stat_losses);
    string t3 = "Win: " + IntegerToString(stat_wins) + " | Loss: " + IntegerToString(stat_losses);
    double wr = (stat_wins + stat_losses) > 0 ? (double)stat_wins / (stat_wins + stat_losses) * 100.0 : 0;
    string t4 = "Win Rate: " + DoubleToString(wr, 1) + "%";
    string t5 = "Profit: " + DoubleToString(stat_rr, 2) + " R";
    
    DrawLabel(dName + "1", t1, x, y, clrYellow, 10); y += lineSpacing;
    DrawLabel(dName + "2", t2, x, y, clrWhite, 10); y += lineSpacing;
    DrawLabel(dName + "3", t3, x, y, clrAqua, 10); y += lineSpacing;
    DrawLabel(dName + "4", t4, x, y, clrLime, 10); y += lineSpacing;
    DrawLabel(dName + "5", t5, x, y, stat_rr >= 0 ? clrLime : clrRed, 10);
}

void DrawLabel(string name, string text, int x, int y, color c, int size) {
    if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
    ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
    ObjectSetString(0, name, OBJPROP_TEXT, text);
    ObjectSetString(0, name, OBJPROP_FONT, "Arial");
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE, size);
    ObjectSetInteger(0, name, OBJPROP_COLOR, c);
    ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

//+------------------------------------------------------------------+
//| Manage Trades (Placeholder if manual management needed)          |
//+------------------------------------------------------------------+
void ManageTrades()
{
    // In MT5, TP and SL are sent to the broker directly.
    // The broker will close the trade when hit.
    // If we wanted to trail stops or partial close, we'd do it here.
}
//+------------------------------------------------------------------+
//| Kronos: xuat nen ra CSV dung dinh dang Kronos predict            |
//| columns: timestamps,open,high,low,close,volume                   |
//| File nam trong MQL5/Files (vd: kronos_export.csv)                |
//+------------------------------------------------------------------+
void ExportKronosData()
{
    int bars = MathMin(InpExportBars, iBars(_Symbol, _Period) - 1);
    if(bars < 50)
    {
        Print("Kronos export: khong du nen (", bars, ")");
        return;
    }
    int handle = FileOpen(InpExportFile, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
    if(handle == INVALID_HANDLE)
    {
        Print("Kronos export: khong mo duoc file ", InpExportFile);
        return;
    }
    FileWrite(handle, "timestamps", "open", "high", "low", "close", "volume");
    // Ghi tu nen cu nhat -> nen moi nhat (bo nen dang chay shift=0)
    for(int i = bars; i >= 1; i--)
    {
        string ts = TimeToString(iTime(_Symbol, _Period, i), TIME_DATE | TIME_MINUTES | TIME_SECONDS);
        FileWrite(handle, ts,
                  DoubleToString(iOpen(_Symbol, _Period, i), _Digits),
                  DoubleToString(iHigh(_Symbol, _Period, i), _Digits),
                  DoubleToString(iLow(_Symbol, _Period, i), _Digits),
                  DoubleToString(iClose(_Symbol, _Period, i), _Digits),
                  IntegerToString(iVolume(_Symbol, _Period, i)));
    }
    FileClose(handle);
    Print("Kronos export: da ghi ", bars, " nen ra ", InpExportFile);
}

//+------------------------------------------------------------------+
//| Kronos: doc file tin hieu do Python ghi                          |
//| Dinh dang file: bias,conf                                       |
//|   dong 2: BULLISH|BEARISH|NONE,0.0-1.0                           |
//| Tra ve ENUM_BIAS. Khong co file = BIAS_NONE (khong loc).         |
//+------------------------------------------------------------------+
ENUM_BIAS ReadKronosSignal()
{
    int handle = FileOpen(InpKronosSignalFile, FILE_READ | FILE_CSV | FILE_ANSI, ',');
    if(handle == INVALID_HANDLE)
        return BIAS_NONE; // chua co tin hieu -> giu hanh vi goc
    string biasStr = "";
    if(!FileIsEnding(handle))
        biasStr = FileReadString(handle); // tieu de hoac gia tri
    // Neu dong dau la tieu de thi doc dong tiep theo
    if(biasStr == "bias" && !FileIsEnding(handle))
        biasStr = FileReadString(handle);
    FileClose(handle);
    StringToUpper(biasStr);
    StringTrimLeft(biasStr);
    StringTrimRight(biasStr);
    if(biasStr == "BULLISH" || biasStr == "UP" || biasStr == "BUY" || biasStr == "1")
        return BIAS_BULLISH;
    if(biasStr == "BEARISH" || biasStr == "DOWN" || biasStr == "SELL" || biasStr == "-1")
        return BIAS_BEARISH;
    return BIAS_NONE;
}
