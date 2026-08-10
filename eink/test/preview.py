# 依 .ino 的實際常數重算版面並輸出 SVG（字型近似，看比例與擠不擠用）
W,H = 800,480
HEAD_H, DOW_H = 42, 26
TITLE_TOP, MS, YS = 2, 4, 3
EVENT_LINES, DATE_BAND_H, EVENT_TOP, EVENT_LINE_H = 3, 20, 34, 16
startDow, dim, weeks = 6, 31, 6                  # 2026/8：1號週六
gridY = HEAD_H+DOW_H; gridH = H-gridY; cellW = W//7; cellH = gridH//weeks
titleBase = TITLE_TOP + 8*MS
monX = 16 + 6*MS - MS + 2

print(f"格高 cellH = {cellH}px")
print(f"  日期橫條   y+1 .. y+{DATE_BAND_H}")
last = EVENT_TOP + (EVENT_LINES-1)*EVENT_LINE_H
for k in range(EVENT_LINES):
    b = EVENT_TOP + k*EVENT_LINE_H
    print(f"  行程第{k+1}行  基線 y+{b}，字身 y+{b-13} .. y+{b}，色條 y+{b-11} .. y+{b+1}")
print(f"  最後一行底部 y+{last+1}，格線在 y+{cellH} -> 餘裕 {cellH-(last+1)}px")
print(f"  日期橫條底部 y+{DATE_BAND_H} vs 第1行字頂 y+{EVENT_TOP-13} -> 間距 {EVENT_TOP-13-DATE_BAND_H}px")
INK, FRAME = 14, 18
print("\n  筆劃(14px) vs 字身外框(18px)：")
for k in range(EVENT_LINES):
    b = EVENT_TOP + k*EVENT_LINE_H
    print(f"    第{k+1}行 筆劃 y+{b-INK+1}..y+{b}   外框 y+{b-FRAME+3}..y+{b+3}")
print(f"    -> 筆劃互不重疊（行距 {EVENT_LINE_H} >= 14）；外框重疊 {FRAME-EVENT_LINE_H}px，"
      f"所以必須用透明模式，否則下一行會蓋掉上一行底部 {FRAME-EVENT_LINE_H}px")
assert EVENT_LINE_H >= INK, "行距小於筆劃高度，字會真的疊在一起"
assert last+1 < cellH, "三行塞不下！"
assert EVENT_TOP-13 > DATE_BAND_H, "第一行會壓到日期"

EV = {4:[("09:00 BLC會議",0),("14:00 參展會議",0),("16:00 產品討論",0)],
      5:[("09:00 T&T會議",0),("14:00 Barten…",0)], 7:[("14:00 支援 2…",0)],
      12:[("測試HF811",0)], 13:[("列印軟體安裝",0)],
      18:[("自動化設備展",0),("09:30 週會",0),("14:00 客戶來訪",0)],
      19:[("> 自動化設…",0),("18:00 [SOTI…",0)], 20:[("> 自動化設…",0)]}
MORE={18:1}; TODAY=7
import csv
try:   # 農曆標籤來自 test/lunar_test 的輸出，沒產過就先跳過，不影響版面檢查
    LUNAR={int(r[0][8:]):r[5] for r in csv.reader(open('test/cpp_out.csv')) if r[0].startswith('2026-08')}
except FileNotFoundError:
    LUNAR={}; print("  (跳過農曆：先跑 g++ -O2 -I test -o test/lunar_test test/lunar_test.cpp && test/lunar_test > test/cpp_out.csv)")
if LUNAR: print("  農曆 2026/8:", " ".join(f"{k}={v}" for k,v in sorted(LUNAR.items())[:6]), "...")
f='font-family="Noto Sans CJK TC, DejaVu Sans, sans-serif"'
s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
   f'<rect width="{W}" height="{H}" fill="#fff"/>',
   f'<text x="16" y="{titleBase}" {f} font-size="34" font-weight="bold">8</text>',
   f'<text x="{monX}" y="{titleBase-2}" {f} font-size="16" font-weight="bold">月</text>',
   f'<text x="{monX+32}" y="{titleBase}" {f} font-size="24" font-weight="bold">2026</text>',
   f'<text x="{W-16}" y="{titleBase-2}" {f} font-size="14" fill="#c00" text-anchor="end">更新 08:31</text>',
   f'<rect x="0" y="{HEAD_H-4}" width="{W}" height="3" fill="#000"/>']
for i,d in enumerate("日一二三四五六"):
    s.append(f'<text x="{i*cellW+9}" y="{HEAD_H+18}" {f} font-size="16" font-weight="bold" '
             f'fill="{"#c00" if i==0 else "#000"}">{d}</text>')
for w in range(weeks):
    for d in range(7):
        n=w*7+d-startDow+1; x=d*cellW; y=gridY+w*cellH
        s.append(f'<rect x="{x}" y="{y}" width="{cellW+1}" height="{cellH+1}" fill="none" stroke="#000"/>')
        if not (1<=n<=dim): continue
        nc = "#c00" if d==0 else "#000"; nb=y+DATE_BAND_H-4
        if n==TODAY:
            s.append(f'<rect x="{x+1}" y="{y+1}" width="{cellW-1}" height="{DATE_BAND_H}" fill="#c00"/>'); nc="#fff"
        s.append(f'<text x="{x+8}" y="{nb}" {f} font-size="16" font-weight="bold" fill="{nc}">{n}</text>')
        dnW = 9*len(str(n))+1
        s.append(f'<text x="{x+8+dnW+5}" y="{nb}" {f} font-size="14" fill="{nc}">{LUNAR.get(n,"")}</text>')
        if n in MORE:
            s.append(f'<text x="{x+cellW-9}" y="{nb}" {f} font-size="14" font-weight="bold" text-anchor="end">+{MORE[n]}</text>')
        for k,(t,hot) in enumerate(EV.get(n,[])[:EVENT_LINES]):
            by=y+EVENT_TOP+k*EVENT_LINE_H; col="#c00" if hot else "#000"
            s.append(f'<rect x="{x+7}" y="{by-11}" width="3" height="12" fill="{col}"/>')
            s.append(f'<text x="{x+14}" y="{by}" {f} font-size="14" font-weight="bold" fill="{col}">{t}</text>')
s.append('</svg>')
open("preview.svg","w").write("\n".join(s))
print("\npreview.svg 已更新")
