#include "symbols.h"
#include <fstream>
#include <string>
#include <unordered_map>

using namespace std;

int DebugSymbols::_filecount = 0;

vector<SpanT>   DebugSymbols::_vecSpanTable;
vector<ModT>    DebugSymbols::_vecModTable;
vector<TypeT>   DebugSymbols::_vecTypeTable;
vector<ScopeT>  DebugSymbols::_vecScopeTable;
vector<SegT>    DebugSymbols::_vecSegTable;
vector<SymbolT> DebugSymbols::_vecSymTable;

unordered_map<uint32_t, LineT> DebugSymbols::_mapLineTable;
unordered_map < uint32_t, FileT> DebugSymbols::_mapFileTable;

unordered_map<uint32_t, SegT>  DebugSymbols::_mapSegTable;
unordered_map<uint32_t, SymbolT> DebugSymbols::_mapSymbolTable;
unordered_map<uint32_t, uint32_t> DebugSymbols::_mapAddressToSymbolId;
unordered_map<string, unordered_map<uint32_t, size_t>> DebugSymbols::_mapOffsetToListing;
unordered_map<uint32_t, string> DebugSymbols::_mapFileIdToName;
unordered_map<uint32_t, uint32_t> DebugSymbols::_mapLineToOffset;
unordered_map<uint32_t, uint32_t> DebugSymbols::_mapOffsetToLine;

void DebugSymbols::ParseIntoVector(string& s, vector<uint32_t>& vec)
{
	size_t pos = 0;

	if (s.length() == 0)
	{
		return;
	}

	do
	{
		size_t i = s.find_first_of('+', pos);
		string pair = s.substr(pos, i);
		int32_t val = stoi(pair.c_str());
		vec.push_back(val);

		pos = i + 1;
	} while (pos != 0);

	return;
}

void DebugSymbols::ParseInt(string& s, uint32_t& v, int base)
{
	if (s.length() > 0)
	{
		try
		{
			v = stoi(s.c_str(), nullptr, base);
		}
		catch(...)
		{
			v = 0;
		}
	}
	else
	{
		v = 0;
	}
}

bool DebugSymbols::LoadDebugFile(const char* szFileName)
{
	//Clear();

	struct stat results = { 0 };
	if (stat(szFileName, &results) == 0)
	{
		ifstream data(szFileName, ios::in);

		if (data.is_open()) {

			_filecount++;

			std::string line;
			while (std::getline(data, line)) {
				// using printf() in all tests for consistency
				
				size_t delim = line.find_first_of('\x09', 0);
				string tag = line.substr(0, delim);
				string info = line.substr(delim + 1);

				vector<string> vecTokens;
				unordered_map<string, string> mapPairs;

				size_t pos = 0;

				do
				{
					size_t i = info.find_first_of(',', pos);
					string pair = info.substr(pos, i - pos);
					vecTokens.push_back(pair);

					pos = i + 1;
				} while (pos != 0);

				for (string &s : vecTokens)
				{
					size_t p = s.find_first_of('=', 0);
					string key = s.substr(0, p);
					string value = s.substr(p + 1);

					if (value.front() == '"') {
						value.erase(0, 1); // erase the first character
						value.erase(value.size() - 1); // erase the last character
					}

					mapPairs[key] = value;
				}

				if (tag.compare("file") == 0)
				{
					FileT ft = { 0 };
					strcpy_s(ft.filename, _countof(ft.filename), mapPairs["name"].c_str());
					ParseInt(mapPairs["id"], ft.id, 10);
					ParseInt(mapPairs["mod"], ft.mod, 10);
					ParseInt(mapPairs["mtime"], ft.mtime, 16);
					ParseInt(mapPairs["size"], ft.size, 10);

					ft.id |= (_filecount << 24);
					ft.mod |= (_filecount << 24);

					_mapFileTable[ft.id] = ft;

					_mapFileIdToName[ft.id] = ft.filename;
				}
				else if (tag.compare("line") == 0)
				{
					LineT lt = { 0 };
					ParseInt(mapPairs["id"], lt.id, 10);
					ParseInt(mapPairs["file"], lt.file, 10);
					ParseInt(mapPairs["line"], lt.line, 10);
					ParseInt(mapPairs["span"], lt.span, 10);

                    lt.id |= (_filecount << 24);
					lt.file |= (_filecount << 24);
					lt.span |= (_filecount << 24);

					_mapLineTable[lt.id] = lt;
				}
				else if (tag.compare("span") == 0)
				{
					SpanT st = { 0 };
					ParseInt(mapPairs["id"], st.id, 10);
					ParseInt(mapPairs["seg"], st.seg, 10);
					ParseInt(mapPairs["size"], st.size, 10);
					ParseInt(mapPairs["start"], st.start, 10);
					ParseInt(mapPairs["type"], st.type, 10);

					st.id |= (_filecount << 24);
					st.seg |= (_filecount << 24);

					_vecSpanTable.push_back(st);
				}
				else if (tag.compare("sym") == 0)
				{
					SymbolT syt = { 0 };
					strcpy_s(syt.addrsize, _countof(syt.addrsize), mapPairs["addrsize"].c_str());
					strcpy_s(syt.name, _countof(syt.name), mapPairs["name"].c_str());
					strcpy_s(syt.type, _countof(syt.type), mapPairs["type"].c_str());
					ParseIntoVector(mapPairs["ref"], syt.ref);

					ParseInt(mapPairs["id"], syt.id, 10);
					ParseInt(mapPairs["def"], syt.def , 10);
					ParseInt(mapPairs["scope"], syt.scope, 10);
					ParseInt(mapPairs["seg"], syt.seg , 10);
					ParseInt(mapPairs["size"], syt.size, 10);
					ParseInt(mapPairs["val"], syt.val, 16);

					syt.id |= (_filecount << 24);
					syt.def |= (_filecount << 24);
					syt.scope |= (_filecount << 24);
					syt.seg |= (_filecount << 24);

					_mapSymbolTable[syt.id] = syt;
					_mapAddressToSymbolId[syt.val] = syt.id;
					_vecSymTable.push_back(syt);
				}
				else if (tag.compare("type") == 0)
				{
					TypeT tt = { 0 };
					ParseInt(mapPairs["id"], tt.id, 10);
					strcpy_s(tt.val, _countof(tt.val), mapPairs["val"].c_str());

					tt.id |= (_filecount << 24);

					_vecTypeTable.push_back(tt);
				}
				else if (tag.compare("scope") == 0)
				{
					ScopeT st = { 0 };
					ParseInt(mapPairs["id"], st.id, 10);
					ParseInt(mapPairs["mod"], st.mod, 10);
					ParseInt(mapPairs["size"], st.size, 10);

					strcpy_s(st.name, _countof(st.name), mapPairs["name"].c_str());
					
					ParseIntoVector(mapPairs["span"], st.span);

					st.id |= (_filecount << 24);
					st.mod |= (_filecount << 24);
					
					_vecScopeTable.push_back(st);
				}
				else if (tag.compare("seg") == 0)
				{
					SegT st = { 0 };
					ParseInt(mapPairs["id"], st.id, 10);
					strcpy_s(st.name, _countof(st.name), mapPairs["name"].c_str());
					ParseInt(mapPairs["start"], st.start, 16);		
					ParseInt(mapPairs["size"], st.size, 16);
					st.id |= (_filecount << 24);
					_vecSegTable.push_back(st);
					_mapSegTable[st.id] = st;
				}
			}

			data.close();
		}

		return true;
	}

	return false;
}

bool DebugSymbols::AddressToListingInfo(uint16_t address, string & file, size_t & listoffset)
{
	listoffset = 0;

	for ( auto &p : _mapSegTable)
	{
		uint16_t adjusted = address - p.second.start;
		if (_mapOffsetToListing[file][adjusted])
		{
			listoffset = _mapOffsetToListing[file][adjusted];
			return true;
		}
	}

	return false;
}

bool DebugSymbols::AddressToSourceInfo(uint16_t address, uint32_t & line, string & file)
{
	if (_mapAddressToSymbolId[address])
	{
		uint32_t id = _mapAddressToSymbolId[address];
		SymbolT st = _mapSymbolTable[id];

		LineT lt = _mapLineTable[st.def];
		line = lt.line;

		FileT ft = _mapFileTable[lt.file];
		file = ft.filename;
	
		return true;
	}

	return false;
}

void DebugSymbols::Clear()
{
	_mapSymbolTable.clear();
	_mapLineTable.clear();
	_mapFileTable.clear();
	_vecSpanTable.clear();
	_vecModTable.clear();
	_mapSegTable.clear();
	_vecTypeTable.clear();
	_vecScopeTable.clear();
	_mapAddressToSymbolId.clear();
	_mapFileIdToName.clear();
	_mapLineToOffset.clear();
	_mapOffsetToLine.clear();
	_mapOffsetToListing.clear();
}

void DebugSymbols::LoadSourceFile(string filename, string & contents)
{
	contents = "";
	struct stat results = { 0 };
	if (stat(filename.c_str(), &results) == 0)
	{
		ifstream data(filename.c_str(), ios::in);

		if (data.is_open()) {

			std::string line;
			std::string text;
			while (getline(data, line))
			{
				line += "\r\n";
				contents += line;
			}
		}
	}
}

bool DebugSymbols::LoadListingFile(string filename, string& contents)
{
	contents = "";
	struct stat results = { 0 };
	size_t bytes = 0;
	string lastfile = "";
	uint32_t lastid = 0;
	uint32_t linenum = 0;

	if (stat(filename.c_str(), &results) == 0)
	{
		ifstream data(filename.c_str(), ios::in);

		if (data.is_open()) {

			std::string line;
			std::string text;
			while (getline(data, line))
			{
				linenum++;
				uint32_t num = 0;
				// read offset
				string offset = line.substr(0, 6);
				
				if (line.substr(0, 5).compare("File=") == 0)
				{
					string sub = line.substr(5);
					ParseInt(sub, lastid, 0x10);
					if (lastid > 0)
					{
						lastfile = _mapFileIdToName[lastid - 1];
					}
				}
				else
				{
	 				ParseInt(offset, num, 0x10);
					_mapOffsetToListing[lastfile][num] = bytes;
					_mapOffsetToLine[(uint32_t)bytes] = linenum;
					_mapLineToOffset[linenum] = (uint32_t)bytes;
				}

				line += "\r";

				bytes += line.length();
				contents += line;
			}

			return true;
		}
	}

	return false;
}

uint32_t DebugSymbols::LineFromOffset(uint32_t offset)
{
	return _mapOffsetToLine[offset];
}

uint32_t DebugSymbols::OffsetFromLine(uint32_t line) 
{
	return _mapLineToOffset[line];
}

bool DebugSymbols::AddressToSymbols(uint16_t address, SymbolT **ppSym)
{
	SymbolT* pSym = nullptr;
	SegT* pSeg = nullptr;

	uint32_t id = 0;
	if (_mapAddressToSymbolId.find(address) == _mapAddressToSymbolId.end())
	{
		return false;
	}

	id = _mapAddressToSymbolId[address];

	pSym = &_mapSymbolTable[id];

	pSeg = &_mapSegTable[pSym->seg];

	if (address >= pSeg->start && address <= pSeg->start + pSeg->size)
	{
		*ppSym = pSym;
	}
	else
	{
		return false;
	}

	return true;
}

bool DebugSymbols::AddressToSymbol(uint16_t address, const char* type, wstring& name, const wchar_t *wzFormat, uint16_t data, uint32_t &size)
{
	SymbolT* pSym = nullptr;
	SegT* pSeg = nullptr;
	wchar_t wcName[255];

	swprintf_s(wcName, _countof(wcName), wzFormat, data);
	name = wcName;

	uint32_t id = 0;
	if (_mapAddressToSymbolId.find(address) == _mapAddressToSymbolId.end())
	{
		return false;
	}

	id = _mapAddressToSymbolId[address];

	pSym = &_mapSymbolTable[id];

	pSeg = &_mapSegTable[pSym->seg];

	if (address >= pSeg->start && address <= pSeg->start + pSeg->size)
	{
		if (!type || strcmp(type, pSym->type) == 0)
		{
			swprintf_s(wcName, _countof(wcName), L"%S", pSym->name);
			name = wcName;
			size = pSym->size;
		}
	}
	else
	{
		return false;
	}

	return true;

}

void DebugSymbols::SymbolSearch(wstring symbol, wstring& results)
{
	wchar_t wcResult[256] = { 0 };
	char szSearch[256] = { 0 };
	int matches = 0;

	sprintf_s(szSearch, _countof(szSearch), "%S", symbol.c_str());

	for (SymbolT &sym : _vecSymTable)
	{
		if (strcmp("lab", sym.type) == 0)
		{
			size_t cmplen = strnlen_s(szSearch, _countof(szSearch));
			if (_strnicmp(szSearch, sym.name, cmplen) == 0)
			{
				swprintf_s(wcResult, _countof(wcResult), L"%04x %04x %S\r\n", sym.val, sym.size, sym.name);
				results.append(wcResult);

				if (++matches == 50)
				{
					break;
				}
			}
		}
	}
}