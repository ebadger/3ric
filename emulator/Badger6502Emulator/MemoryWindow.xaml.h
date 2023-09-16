#pragma once

#include "MemoryWindow.g.h"

using namespace std;

namespace winrt::Badger6502Emulator::implementation
{
    struct MemoryWindow : MemoryWindowT<MemoryWindow>
    {
        MemoryWindow();

        int32_t MyProperty();
        void MyProperty(int32_t value);

        bool IsValidNumber(wstring const& hstr, bool* isHex);
        void RefreshView();

        Microsoft::UI::Dispatching::DispatcherQueueTimer _timer = { nullptr };
        Microsoft::UI::Windowing::AppWindow _appWindow = { nullptr };

    };
}

namespace winrt::Badger6502Emulator::factory_implementation
{
    struct MemoryWindow : MemoryWindowT<MemoryWindow, implementation::MemoryWindow>
    {
    };
}
