"""解 u8g2 的 RLE 點陣，量出「真正的筆劃」上下界（不是填充框）"""
import sys
sys.path.insert(0,'test')
from font_probe import load_array, w, HDR
from glyph_bbx import Bits, glyph_ptr

def ink(f, cp):
    g = glyph_ptr(f, cp)
    if g is None: return None
    b0, b1 = f[2], f[3]
    r = Bits(f, g)
    W_, H_ = r.get(f[4]), r.get(f[5])
    X_, Y_ = r.sgn(f[6]), r.sgn(f[7])
    r.sgn(f[8])                                   # delta_x，用不到
    if W_ == 0 or H_ == 0: return None
    grid = [[0]*W_ for _ in range(H_)]
    cx = cy = 0
    def put(n, val):                              # 照 u8g2_font_decode_len 逐列填
        nonlocal cx, cy
        for _ in range(n):
            if cy < H_ and cx < W_ and val: grid[cy][cx] = 1
            cx += 1
            if cx >= W_: cx = 0; cy += 1
    while True:
        a, bb = r.get(b0), r.get(b1)
        while True:
            put(a, 0); put(bb, 1)
            if r.get(1) == 0: break
        if cy >= H_: break
    rows = [i for i,row in enumerate(grid) if any(row)]
    if not rows: return None
    # 框內第 i 列 -> 基線以上 (Y_+H_-i) px
    return (Y_ + H_ - rows[0], Y_ + H_ - rows[-1] - 1)   # (筆劃頂, 筆劃底) 相對基線

f,_ = load_array(sys.argv[1], "trad14")
chars = "自動化設備展測試會議參列印軟體安裝支援初一二三四五六七八九十廿正閏月0123456789:[]TSOIBLC"
top = -99; bot = 99; th=[]; bh=[]
for c in chars:
    r = ink(f, ord(c))
    if not r: continue
    t, b = r
    th.append((t,c)); bh.append((b,c))
    top = max(top, t); bot = min(bot, b)
print(f"trad14 真正的筆劃（{len(th)} 個實際會用到的字）：")
print(f"  最高到基線上方 {top}px（{max(th)[1]}），最低到基線 {'下方' if bot<0 else '上方'} {abs(bot)}px（{min(bh)[1]}）")
print(f"  => 筆劃總高 {top-bot}px（填充框是 20px）")
for lh in (15,16,17,18):
    gap = lh - (top - bot)
    print(f"  EVENT_LINE_H = {lh} -> {'筆劃相距 %dpx ✓' % gap if gap>0 else '筆劃重疊 %dpx ★' % -gap}")
print(f"\n  版面檢查（EVENT_TOP=34, EVENT_LINE_H=16, DATE_BAND_H=20, cellH=68）：")
for k in range(3):
    base = 34 + 16*k
    print(f"    第{k+1}行 基線 y+{base} -> 筆劃 y+{base-top} .. y+{base-bot}")
print(f"    日期橫條底 y+20 vs 第1行筆劃頂 y+{34-top} -> {34-top-20}px")
print(f"    第3行筆劃底 y+{34+32-bot} vs 格線 y+68 -> {68-(34+32-bot)}px")
