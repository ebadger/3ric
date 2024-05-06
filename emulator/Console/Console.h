#pragma once
#include <stdint.h>
#include <vector>
#include <string>
#include <functional>
#include <map>

class Command
{
public:
	Command()
	{
	}

	Command(const std::string &text, 
			const std::function<void(std::vector<std::string>&)> &func)
	{
		_callback = func;
		_command = text;
	}

	Command(const Command& other)
	{
		_callback = other._callback;
		_command = other._command;
	}

	const char * GetText()
	{
		return _command.c_str();
	}

	void Execute(std::vector<std::string>& params)
	{
		_callback(params);
	}

private:

	std::string _command = "";
	std::function<void(std::vector<std::string> &)> _callback = nullptr;
};

class Console
{
public:
	Console();
	~Console();

	bool InputByte(uint8_t byte);	
	bool GetOutputByte(uint8_t *b);
	void PrintOut(const char *format, ...);
	void AddCommand(Command *c);

private:
	bool ProcessInput();
	void ProcessCommand();

	std::vector<uint8_t>			  _bufIn;
	std::string						  _bufOut;
	std::vector<std::string>		  _params;
	std::map<std::string, Command *>  _commands;
};