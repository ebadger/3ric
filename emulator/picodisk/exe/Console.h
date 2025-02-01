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

	void InputByte(uint8_t byte);	
	bool GetOutputByte(uint8_t *b);
	bool GetOutputByteLocal(uint8_t *b);
	void PrintOut(const char *format, ...);
	void AddCommand(Command *c);
	void ProcessInput();
    bool HasOutput() { return _vecBufLocal.size() > 0; }
private:
	void ProcessLine();
	void ProcessCommand();

	std::vector<char>                 _vecBufIn;
	std::vector<char>                 _vecBufOut;
	std::vector<char>                 _vecBufLocal;

	std::vector<std::string>		  _params;
	std::map<std::string, Command *>  _commands;
};