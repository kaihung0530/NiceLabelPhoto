#pragma once
#include <string>
#include <cstdint>
#define PROGMEM
#define pgm_read_dword(p) (*(p))
struct String : std::string {
  String(){} String(const char* s):std::string(s){} String(const std::string& s):std::string(s){}
  String(int v):std::string(std::to_string(v)){}
  int length() const { return (int)size(); }
};
