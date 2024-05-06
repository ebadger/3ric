// Console.cpp : This file contains the 'main' function. Program execution begins and ends there.
//

#include <iostream>
#include <conio.h>

#include "Console.h"

Console _console;

int main()
{
    bool running = true;
    uint8_t c = 0;

    _console.AddCommand(
        new Command(std::string("dir"), 
        [&](std::vector<std::string>& params) -> void
        {
            _console.PrintOut("COMMAND: dir, argc=%d\r\n", params.size());
        }));

    _console.AddCommand(
        new Command(std::string("cd"),
            [&](std::vector<std::string>& params) -> void
            {
                _console.PrintOut("COMMAND: dir, argc=%d\r\n", params.size());
            }));

    while (running)
    {
        if (_kbhit())
        {
            int key = _getch();
            _console.InputByte(key);
            printf("%c", key);
        }

        if (_console.GetOutputByte(&c))
        {
            printf("%c", c);
        }
    }
}
