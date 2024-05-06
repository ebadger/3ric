#include "Console.h"
#include <stdarg.h>

Console::Console()
{
}

Console::~Console()
{
}

bool 
Console::InputByte(uint8_t b)
{
	if (_bufIn.size() > 0x100)
	{
		// cap the inputbuffer
		return false;
	}

	if (b == '\r' || b == '\n')
	{
		ProcessInput();
	}
	else
	{
		_bufIn.insert(_bufIn.end(), b);
	}

	return true;
}

bool
Console::ProcessInput()
{
	bool inQuote = false;
	std::string p;

	_params.clear();

	for (int i = 0; i < _bufIn.size(); i++)
	{
		bool bQuote = _bufIn[i] == '\"';

		if (bQuote)
		{
			inQuote = !inQuote;
		}
		
		if ((_bufIn[i] == ' ' && !inQuote) || i == _bufIn.size() - 1)
		{
			if (i == _bufIn.size() - 1 && !bQuote)
			{
				p += _bufIn[i];
			}

			if (p.size() > 0)
			{
				_params.insert(_params.end(), p);
				p.clear();
			}
		}
		else if (!bQuote)
		{
			p += _bufIn[i];
		}
	}

	_bufIn.clear();

	printf("\r\n");
	for (int i = 0; i < _params.size(); i++)
	{
		PrintOut("argv[%d] = %s\r\n", i, _params[i].c_str());
	}

	if (_params.size() > 0)
	{
		ProcessCommand();
	}

	return true;
}

bool 
Console::GetOutputByte(uint8_t *byte)
{
	if (_bufOut.size() > 0)
	{
		*byte = _bufOut[0];
		_bufOut = &_bufOut.c_str()[1];

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

	_bufOut.append(buf);	
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