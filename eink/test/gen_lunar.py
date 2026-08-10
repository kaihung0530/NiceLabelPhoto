"""從 lunardate 反推打包的農曆年表（不靠記憶手打）。
   每年一個 uint32：bit0-3 = 閏月(0=無)，bit4-15 = 12個月大小(1=30天)，bit16 = 閏月是否30天"""
import datetime, collections
from lunardate import LunarDate

Y0, Y1 = 1900, 2098                       # lunardate 的資料只到 2099，留一年餘裕
seen = collections.defaultdict(set)
d, end = datetime.date(1900,1,31), datetime.date(2100,2,1)
while d < end:
    l = LunarDate.from_solar_date(d.year, d.month, d.day)
    seen[(l.year, l.month, bool(l.isLeapMonth))].add(l.day)
    d += datetime.timedelta(days=1)

table = []
for y in range(Y0, Y1+1):
    leap = leapBig = bits = 0; total = 0
    for m in range(1, 13):
        days = len(seen[(y, m, False)])
        assert days in (29,30), (y,m,days)
        total += days
        if days == 30: bits |= (0x10000 >> m)
        if seen[(y, m, True)]:
            ld = len(seen[(y, m, True)]); assert ld in (29,30), (y,m,ld)
            leap, leapBig, total = m, (1 if ld==30 else 0), total+ld
    assert 353 <= total <= 385, (y, total)
    table.append((leapBig << 16) | bits | leap)

for y, lm in {2020:4, 2023:2, 2025:6, 2028:5, 2033:11}.items():
    got = table[y-Y0] & 0xf
    print(f"  {y} 閏月 = {got}  預期 {lm}  {'OK' if got==lm else '★不符'}")
print(f"  1900 那筆 = 0x{table[0]:05x}  (經典表的第一筆是 0x04bd8)")

with open("test/lunar_table.txt","w") as f:
    for i in range(0, len(table), 8):
        f.write("  " + ",".join(f"0x{v:05x}" for v in table[i:i+8]) + ",\n")
print(f"  產生 {len(table)} 筆（{Y0}-{Y1}），{len(table)*4} bytes")
