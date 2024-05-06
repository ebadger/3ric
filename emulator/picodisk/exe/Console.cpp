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
	_bufIn[_bufInEnd++] = b;
}

void
Console::ProcessInput()
{
	uint8_t bufInLine = _bufInPos;
	while(bufInLine != _bufInEnd)
	{
		uint8_t c = _bufIn[bufInLine++];
		if(c == '\n' || c == '\r')
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

	while( _bufInPos != _bufInEnd)
	{
		uint8_t c = _bufIn[_bufInPos];
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

		_bufInPos++;

		while((c == '\n' || c == '\r') && _bufInPos != _bufInEnd)
		{
			_bufIn[_bufInPos] = ' ';
			// skip line endings
			c = _bufIn[_bufInPos++];
		}
	}

	PrintOut("\n");

	for (int i = 0; i < _params.size(); i++)
	{
		PrintOut("argv[%d] = %s, len=%d, p[0]=%d\n", i, _params[i].c_str(), _params[i].size(), _params[i].c_str()[0]);
	}

	if (_params.size() > 0)
	{
		ProcessCommand();
	}
}

bool 
Console::GetOutputByte(uint8_t *byte)
{
	if (_bufPos != _bufEnd)
	{
		*byte = _bufOut[_bufPos++];
		return true;
	}

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

	printf(buf); // temp - print to stdout

	char *p = &buf[0];
	while(*p)
	{
		_bufOut[_bufEnd++] = *p;
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