#pragma once

#include "SymbolWindow.g.h"

namespace winrt::Badger6502Emulator::implementation
{
    struct SymbolWindow : SymbolWindowT<SymbolWindow>
    {
        SymbolWindow();

        int32_t MyProperty();
        void MyProperty(int32_t value);

        void myButton_Click(Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
    };
}

namespace winrt::Badger6502Emulator::factory_implementation
{
    struct SymbolWindow : SymbolWindowT<SymbolWindow, implementation::SymbolWindow>
    {
    };
}
