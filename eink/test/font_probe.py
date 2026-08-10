"""解析 u8g2 字型二進位，查某個字有沒有被收進去（不靠檔頭註解自我宣稱）"""
import sys

def load_array(path, name):
    src = open(path, encoding='latin-1').read()
    i = src.index(f"u8g2_font_{name}[")
    declared = int(src[src.index("[",i)+1 : src.index("]",i)])
    p = src.index("=", i) + 1
    out = bytearray()
    while True:
        q = src.find('"', p)                      # 逐段掃字面值，不能用 index(';')
        if q < 0: break                           # —— 字面值裡本身就含 ; 字元
        between = src[p:q]
        if ';' in between: break                  # 已經離開這個陣列
        r, lit = q+1, []
        while src[r] != '"':                      # 找未被跳脫的收尾引號
            if src[r] == '\\': lit.append(src[r]); r += 1
            lit.append(src[r]); r += 1
        out += "".join(lit).encode('latin-1').decode('unicode_escape').encode('latin-1')
        p = r + 1
    return bytes(out), declared

def w(b, o): return (b[o] << 8) | b[o+1]

HDR = 23                                          # U8G2_FONT_DATA_STRUCT_SIZE

def glyph_exists(f, cp):
    """照抄 u8g2_font_get_glyph_data 的 unicode 分支：
       lookup table 是 4 bytes 一組 (offset, max_encoding)，offset 要累加。"""
    if w(f, 21) == 0: return False
    p   = HDR + w(f, 21)                          # 別忘了跳過 23 bytes 檔頭
    lut = p
    while True:
        p += w(f, lut)                            # 累加，不是直接指定
        e  = w(f, lut+2)
        lut += 4
        if not (e < cp) or lut + 4 > len(f): break
    while p + 2 < len(f):
        enc = w(f, p)
        if enc == 0 or f[p+2] == 0: return False
        if enc == cp: return True
        p += f[p+2]
    return False

for name in ("trad16", "trad14"):
    f, declared = load_array(sys.argv[1], name)
    ok = "OK" if len(f)+1 == declared or len(f) == declared else f"★ 宣告 {declared}"
    print(f"\n{name}: 解出 {len(f)} bytes（宣告 {declared}）{ok}  "
          f"ascent={f[13]} 字高={f[10]}")
    tests = "日一二三四五六七八九十月年更新初廿正閏冬臘測試自動化設備展參"
    miss = "".join(c for c in tests if not glyph_exists(f, ord(c)))
    print(f"  農曆會用到的 初廿正閏七八九十 -> "
          f"{'全部都有 ✓' if not set('初廿正閏七八九十') & set(miss) else '缺 '+''.join(set('初廿正閏七八九十')&set(miss))}")
    print(f"  缺字：{miss if miss else '（無）'}")
    syms = [("↳",0x21B3), ("‧",0x2027), ("·",0xB7), ("～",0xFF5E), ("…",0x2026), ("★",0x2605)]
    print("  符號：" + "  ".join(f"{s} {'有' if glyph_exists(f,c) else '缺'}" for s,c in syms))
