#include <cstdio>
#include <string>
using String = std::string;
const int EVENT_LINES = 3;
struct DayCell { unsigned char count; String t[EVENT_LINES]; bool hot[EVENT_LINES]; };
DayCell gDays[32];
const char* CONT_PREFIX = "> ";
int gYear=2026, gMonth=8;
int daysInMonth(int y,int m){static int d[]={31,28,31,30,31,30,31,31,30,31,30,31};
  if(m==2&&((y%4==0&&y%100!=0)||y%400==0))return 29; return d[m-1];}
void addToDay(int d,const String& label,bool hot){
  if(d<1||d>31)return; DayCell&c=gDays[d];
  if(c.count<EVENT_LINES){ c.t[c.count]=label; c.hot[c.count]=hot; }
  c.count++;}
struct Ev{int day,endDay;String time,title;};
int main(){
  for(int i=0;i<32;i++){ gDays[i].count=0;
    for(int k=0;k<EVENT_LINES;k++){ gDays[i].t[k]=""; gDays[i].hot[k]=false; } }
  Ev evs[] = {                       // 照片上 8/4 有三筆、8/18 有三筆
    {4,4,"09:00","BLC會議"}, {4,4,"14:00","參展會議"}, {4,4,"16:00","第三筆"},
    {18,20,"","自動化設備展"}, {18,18,"09:30","週會"}, {18,18,"14:00","客戶來訪"},
    {18,18,"16:00","第四筆會被收成+1"},
    {19,19,"18:00","[SOTI] 教育訓練"},
  };
  int dim=daysInMonth(gYear,gMonth);
  for(auto&e:evs){
    int d0=e.day,d1=e.endDay; bool fromLast=(d0<1);
    if(d1<d0)d1=d0; if(d0<1)d0=1; if(d1>dim)d1=dim;
    if(d0>dim||d1<1)continue;
    for(int d=d0;d<=d1;d++){
      bool isStart=(d==d0&&!fromLast);
      addToDay(d, isStart?((e.time.size()?e.time+" ":"")+e.title):(String(CONT_PREFIX)+e.title), false);
    }
  }
  for(int d=1;d<=dim;d++){ if(!gDays[d].count)continue;
    printf("8/%-2d count=%d\n",d,gDays[d].count);
    for(int k=0;k<EVENT_LINES&&k<gDays[d].count;k++) printf("        %s\n",gDays[d].t[k].c_str());
    if(gDays[d].count>EVENT_LINES) printf("        +%d\n",gDays[d].count-EVENT_LINES); }
  return 0;
}
