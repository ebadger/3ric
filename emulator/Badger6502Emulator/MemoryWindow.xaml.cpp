#include "pch.h"
#include "MemoryWindow.xaml.h"
#if __has_include("MemoryWindow.g.cpp")
#include "MemoryWindow.g.cpp"
#endif
#include "MainWindow.xaml.h"
#include <ctype.h>

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
    MemoryWindow::MemoryWindow()
    {
        InitializeComponent();
        
        ExtendsContentIntoTitleBar(true);
        SetTitleBar(TitleBar());
  
        // Retrieve the window handle (HWND) of the current WinUI 3 window.
        auto windowNative{ this->try_as<::IWindowNative>() };
        winrt::check_bool(windowNative);
        HWND hWnd{ 0 };
        windowNative->get_WindowHandle(&hWnd);
        
        Microsoft::UI::WindowId windowId = Microsoft::UI::GetWindowIdFromWindow(hWnd);
        _appWindow = Microsoft::UI::Windowing::AppWindow::GetFromWindowId(windowId);

        _appWindow.Resize({ 660,350 });

        txtAddress().TextChanged([this](IInspectable const&, RoutedEventArgs const&)
            {
                RefreshView();
            });
        

        _timer = this->DispatcherQueue().CreateTimer();
        _timer.IsRepeating(true);
        _timer.Interval(TimeSpan(100));
        _timer.Start();

        _timer.Tick([this](IInspectable const&, IInspectable const&)
            {
                RefreshView();
            });

        txtAddress().Document().SetText(TextSetOptions::None,L"$0000");
    }

    void MemoryWindow::RefreshView()
    {
        hstring hstrAddress;
        bool ishex = false;

        txtAddress().Document().GetText(TextGetOptions::AdjustCrlf, hstrAddress);
        if (IsValidNumber(hstrAddress.c_str(), &ishex) && ishex)
        {
            wchar_t wcLine[255];
            wstring memout;
            wstring memascii;

            uint16_t addr = (uint16_t)wcstol(&(hstrAddress.c_str())[1], nullptr, 16);
            uint8_t* pData = implementation::MainWindow::_vm.GetData();

            for (int y = 0; y < 16; y++)
            {
                swprintf_s(wcLine, _countof(wcLine), L"$%04X: ", addr);
                memout.append(wcLine);
                memascii.append(wcLine);

                for (int x = 0; x < 16; x++)
                {
                    swprintf_s(wcLine, _countof(wcLine), L"$%02X ", pData[addr]);
                    memout.append(wcLine);

                    int c = pData[addr];
                    if (isprint(c) == 0)
                    {
                        c = '.';
                    }

                    swprintf_s(wcLine, _countof(wcLine), L"%c ", pData[addr]);
                    memascii.append(wcLine);

                    addr++;
                }

                memout.append(L"\r\n");
                memascii.append(L"\r\n");
            }

            txtMemory().Document().SetText(TextSetOptions::None, memout.c_str());
            txtMemoryAscii().Document().SetText(TextSetOptions::None, memascii.c_str());
        }

    }

    bool MemoryWindow::IsValidNumber(wstring const& str, bool* pHex)
    {
        bool isHex = false;
        int i = 0;

        if (pHex)
        {
            *pHex = false;
        }

        for (wchar_t w1 : str)
        {
            wchar_t w = towupper(w1);
            if (i == 0 && w == L'$')
            {
                isHex = true;
                if (pHex)
                {
                    *pHex = true;
                }
            }

            if (i > 0)
            {
                if (w < L'0' || w > L'9')
                {
                    if (isHex)
                    {
                        if (w < L'A' || w > L'F')
                        {
                            return false;
                        }
                    }
                    else
                    {
                        return false;
                    }
                }
            }
            i++;
        }

        if ((isHex && i > 1) || (!isHex && i > 0))
        {
            return true;
        }

        return false;
    }
    int32_t MemoryWindow::MyProperty()
    {
        throw hresult_not_implemented();
    }

    void MemoryWindow::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }

}
