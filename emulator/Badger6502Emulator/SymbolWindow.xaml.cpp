#include "pch.h"
#include "SymbolWindow.xaml.h"
#if __has_include("SymbolWindow.g.cpp")
#include "SymbolWindow.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Text;
using namespace Microsoft::UI::Dispatching;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Windowing;
using namespace Windows::Graphics;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace winrt::Badger6502Emulator::implementation
{
    SymbolWindow::SymbolWindow()
    {
        InitializeComponent();
    }

    int32_t SymbolWindow::MyProperty()
    {
        throw hresult_not_implemented();
    }

    void SymbolWindow::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }

    void SymbolWindow::myButton_Click(IInspectable const&, RoutedEventArgs const&)
    {
        myButton().Content(box_value(L"Clicked"));
    }
}
