#pragma once
#include "stdint.h"
#include <vector>
#include <string>
#include <unordered_map>

using namespace std;

#define MAX_PATH 260
//sym	id=111,name="WOZMON",addrsize=absolute,size=1,scope=0,def=500,ref=5894,val=0xFF00,seg=14,type=lab
struct SymbolT
{
	uint32_t id;
	char name[32];
	char addrsize[32];
	uint32_t size;
	uint32_t scope;
	uint32_t def;
	vector<uint32_t> ref;
	uint32_t val;
	uint32_t seg;
	char type[16];
};

//line	id=500,file=35,line=878,span=4789

struct LineT
{
	uint32_t id;
	uint32_t file;
	uint32_t line;
	uint32_t span;
};

//file	id=35,name="badger6502_extra.s",size=22085,mtime=0x61CA8E1D,mod=0

struct FileT
{
	uint32_t id;
	char filename[MAX_PATH];
	uint32_t size;
	uint32_t mtime;
	uint32_t mod;
};

//span	id=4789,seg=14,start=0,size=1

struct SpanT
{
	uint32_t id;
	uint32_t seg;
	uint32_t start;
	uint32_t size;
	uint32_t type;
};

//mod	id=0,name="badger6502.o",file=0
 
struct ModT
{
	uint32_t id;
	char name[MAX_PATH];
};

//seg	id=14,name="WOZ",start=0x00FF00,size=0x00F1,addrsize=absolute,type=ro,oname="tmp/badger6502.bin",ooffs=32512
struct SegT
{
	uint32_t id;
	char name[64];
	uint32_t start;
	uint32_t size;
	uint32_t addrsize;
	uint32_t type;
	char oname[MAX_PATH];
	uint32_t ooffs;
};

struct TypeT
{
	uint32_t id;
	char val[32];
};

struct ScopeT
{
	uint32_t id;
	char name[64];
	uint32_t mod;
	uint32_t size;
	vector<uint32_t> span;
};

class DebugSymbols
{
public:
	static bool LoadDebugFile(const char* szFileName);
	static void LoadSourceFile(string szFileName, string & contents);
	static bool LoadListingFile(string szFileName, string& contents);

	static bool AddressToSourceInfo(uint16_t address, uint32_t & line, string & file);
	static bool AddressToListingInfo(uint16_t address, string & filename, size_t& listoffset);
	static bool AddressToSymbols(uint16_t address, SymbolT **ppSym);
	static bool AddressToSymbol(uint16_t address, const char* type, wstring& name, const wchar_t *wzFormat, uint16_t data, uint32_t &size);
	static uint32_t LineFromOffset(uint32_t offset);
	static uint32_t OffsetFromLine(uint32_t line);

	static void SymbolSearch(wstring symbol, wstring& results);

	static void Clear();

private:

	static void ParseIntoVector(string& s, vector<uint32_t>& vec);
	static void ParseInt(string& s, uint32_t& v, int base);

	static int _filecount;

	static vector<SpanT>   _vecSpanTable;
	static vector<ModT>    _vecModTable;
	static vector<TypeT>   _vecTypeTable;
	static vector<ScopeT>  _vecScopeTable;
	static vector<SegT>    _vecSegTable;
	static vector<SymbolT> _vecSymTable;

	static unordered_map<uint32_t, LineT>   _mapLineTable;
	static unordered_map < uint32_t, FileT>   _mapFileTable;

	static unordered_map<uint32_t, SegT>  _mapSegTable;
	static unordered_map<uint32_t, SymbolT> _mapSymbolTable;
	static unordered_map<uint32_t, uint32_t> _mapAddressToSymbolId;
	static unordered_map<string, unordered_map<uint32_t, size_t>> _mapOffsetToListing;
	static unordered_map<uint32_t, string> _mapFileIdToName;
	static unordered_map<uint32_t, uint32_t> _mapLineToOffset;
	static unordered_map<uint32_t, uint32_t> _mapOffsetToLine;

};