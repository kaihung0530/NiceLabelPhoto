"""解出每個字的實際邊界框，驗證 EVENT_LINE_H 會不會讓筆劃真的疊到"""
import sys
sys.path.insert(0,'test')
from font_probe import load_array, w, HDR, glyph_exists

class Bits:
    def __init__(s, b, p): s.b, s.p, s.bit = b, p, 0
    def get(s, n):
        v = 0
        for i in range(n):
            v |= ((s.b[s.p] >> s.bit) & 1) << i
            s.bit += 1
            if s.bit == 8: s.bit = 0; s.p += 1
        return v
    def sgn(s, n): return s.get(n) - (1 << (n-1))

def glyph_ptr(f, cp):
    p = HDR + w(f,21); lut = p
    while True:
        p += w(f,lut); e = w(f,lut+2); lut += 4
        if not (e < cp) or lut+4 > len(f): break
    while p+2 < len(f):
        enc = w(f,p)
        if enc == 0 or f[p+2] == 0: return None
        if enc == cp: return p+3
        p += f[p+2]
    return None

def bbx(f, cp):
    g = glyph_ptr(f, cp)
    if g is None: return None
    bw,bh,bx,by,bd = f[4],f[5],f[6],f[7],f[8]
    r = Bits(f, g)
    W_,H_ = r.get(bw), r.get(bh)
    X_,Y_ = r.sgn(bx), r.sgn(by)
    return W_,H_,X_,Y_

f,_ = load_array(sys.argv[1], "trad14")
chars = "自動化設備展測試會議參列印軟體安裝支援初一二三四五六七八九十廿正閏月0123456789:[]TSOI"
top = bot = None; worst=[]
for c in chars:
    r = bbx(f, ord(c))
    if not r: continue
    W_,H_,X_,Y_ = r
    asc, desc = Y_+H_, Y_          # 基線以上的高度 / 底部（負=在基線下）
    worst.append((asc, -desc, c))
    top = asc if top is None else max(top, asc)
    bot = desc if bot is None else min(bot, desc)
ink = top - bot
print(f"trad14 實測（{len(worst)} 個實際會用到的字）：")
print(f"  基線以上最高 = {top}px，基線以下最深 = {-bot}px，總墨水高 = {ink}px")
print(f"  最高的字：{sorted(worst, reverse=True)[:3]}")
print(f"  最深的字：{sorted(worst, key=lambda t:-t[1])[:3]}")
for lh in (15, 16, 17, 18):
    print(f"  EVENT_LINE_H = {lh} -> {'重疊 %dpx ★' % (ink-lh) if ink > lh else '不重疊 ✓ (餘 %dpx)' % (lh-ink)}")

f16,_ = load_array(sys.argv[1], "trad16")
r = bbx(f16, ord("月"))
print(f"\ntrad16「月」bbx = {r}（寬,高,x,y）")
r = bbx(f16, ord("8")) if glyph_exists(f16, ord("8")) else None
