#include "Console.h"
#include <stdarg.h>

Console::Console()
{
}

Console::~Console()
{
}

void 
Console::InputByte(uint8_t b)
{
	if (b & 0x80)
	{
		_vecBufIn.push_back(b & 0x7F);
	}
	else
	{
		_vecBufIn.push_back(toupper(b));
	}
}

void
Console::ProcessInput()
{
	for (char c : _vecBufIn)
	{
		if (c == '\n' || c == '\r')
		{
			ProcessLine();
			return;
		}
	}
}

void 
Console::ProcessLine()
{
	bool inQuote = false;

	std::string p;

	_params.clear();

	while( _vecBufIn.size() != 0)
	{
		char c = _vecBufIn.front();
		_vecBufIn.erase(_vecBufIn.begin());
		
		bool bQuote = (c == '\"');
        bool bLF = (c == '\n');
		bool bCR = (c == '\r');
		bool bSpace = (c == ' ');
		bool bEOL = (bLF || bCR);

		if (bQuote)
		{
			inQuote = !inQuote;
		}
		
		if ((bSpace && !inQuote) || bEOL)
		{
			if (!bQuote && !bEOL && !bSpace)
			{
				p += c;
			}

			if (p.size() > 0)
			{
				_params.insert(_params.end(), p);
				p.clear();
			}
		}
		else if (!bQuote && !bSpace)
		{
			p += c;
		}
	}

	PrintOut("\r");

#if 0
	for (int i = 0; i < _params.size(); i++)
	{
		PrintOut("argv[%d] = %s, len=%d, p[0]=%d\r", i, _params[i].c_str(), _params[i].size(), _params[i].c_str()[0]);
	}
#endif

	if (_params.size() > 0)
	{
		ProcessCommand();
	}
}

bool 
Console::GetOutputByte(uint8_t *byte)
{
	if (_vecBufOut.size() > 0)
	{
		*byte = _vecBufOut.front();
		_vecBufOut.erase(_vecBufOut.begin());

		return true;
	}

	return false;
}

bool 
Console::GetOutputByteLocal(uint8_t *byte)
{
	if (!_vecBufLocal.empty())
	{
		*byte = _vecBufLocal.front();
		_vecBufLocal.erase(_vecBufLocal.begin());
		return true;
	}

	*byte = 0;
	return false;
}

void
Console::PrintOut(const char *format, ...)
{
	char buf[1024] = {};
	va_list args;
	va_start(args, format);
	vsprintf(buf, format, args);
	va_end(args);

	//printf(buf); // temp - print to stdout

	char *p = &buf[0];
	while(*p)
	{
		_vecBufOut.push_back(toupper(*p));
		_vecBufLocal.push_back(toupper(*p));

		if (*p == '\n')
		{
			_vecBufLocal.push_back('\r');
		}

		p++;
	}
}

void
Console::ProcessCommand()
{
	if (_commands[_params[0].c_str()])
	{
		_commands[_params[0].c_str()]->Execute(_params);
	}
}

void
Console::AddCommand(Command *command)
{
	_commands[command->GetText()] = command;
}