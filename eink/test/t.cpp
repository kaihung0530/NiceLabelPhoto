#include <cstdio>
#include <string>
using String = std::string;
struct DayCell { unsigned char count; String t1,t2; bool hot1,hot2; };
DayCell gDays[32];
const char* CONT_PREFIX = "> ";
int gYear=2026,gMonth=8;
int daysInMonth(int y,int m){static int d[]={31,28,31,30,31,30,31,31,30,31,30,31};
  if(m==2&&((y%4==0&&y%100!=0)||y%400==0))return 29; return d[m-1];}
void addToDay(int d,const String& label,bool hot){
  if(d<1||d>31)return; DayCell&c=gDays[d];
  if(c.count==0){c.t1=label;c.hot1=hot;} else if(c.count==1){c.t2=label;c.hot2=hot;}
  c.count++;}
struct Ev{int day,endDay;String time,title;};
int main(){
  // 直接餵上一步 Apps Script 實際輸出的六筆資料
  Ev evs[] = {
    {0,3,"","上月延續的專案"},
    {10,10,"18:00","晚班"},
    {18,20,"","自動化展"},
    {18,18,"09:30","週會"},
    {18,18,"14:00","客戶來訪"},
    {30,31,"","月底盤點"},
  };
  int dim=daysInMonth(gYear,gMonth);
  for(auto&e:evs){
    int d0=e.day, d1=e.endDay;
    bool fromLastMonth=(d0<1);
    if(d1<d0)d1=d0; if(d0<1)d0=1; if(d1>dim)d1=dim;
    if(d0>dim||d1<1)continue;
    String base=e.title, tm=e.time;
    for(int d=d0;d<=d1;d++){
      bool isStart=(d==d0&&!fromLastMonth);
      String label=isStart?((tm.size()?tm+" ":"")+base):(String(CONT_PREFIX)+base);
      addToDay(d,label,false);
    }
  }
  for(int d=1;d<=dim;d++){ if(!gDays[d].count)continue;
    printf("%2d/%-2d count=%d | %-26s | %-20s", gMonth,d,gDays[d].count,
           gDays[d].t1.c_str(), gDays[d].t2.c_str());
    if(gDays[d].count>2) printf(" +%d",gDays[d].count-2);
    printf("\n"); }
  return 0;
}
