#include "Lunar_host.h"
#include <cstdio>
int main(){
  for (int y=2020; y<=2060; y++)
   for (int m=1; m<=12; m++){
    static const int dm[]={31,28,31,30,31,30,31,31,30,31,30,31};
    int n = dm[m-1]; if (m==2 && ((y%4==0&&y%100!=0)||y%400==0)) n=29;
    for (int d=1; d<=n; d++){
      Lunar l = toLunar(y,m,d);
      printf("%04d-%02d-%02d,%d,%d,%d,%d,%s\n", y,m,d, l.year,l.month,l.day,(int)l.leap,
             lunarLabel(y,m,d).c_str());
    }
   }
  return 0;
}
