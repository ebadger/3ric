#include "pch.h"
#include <ctype.h>
#include <wchar.h>
#include "MainWindow.xaml.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif
#include <debugapi.h>

#include "MemoryWindow.xaml.h"

// https://github.com/microsoft/microsoft-ui-xaml/issues/6329

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Input;
using namespace Microsoft::UI::Xaml::Media;
using namespace Microsoft::UI::Xaml::Media::Imaging;
using namespace Microsoft::UI::Dispatching;
using namespace Microsoft::UI::Text;
using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::Storage;
using namespace winrt::Windows::Storage::Pickers;
using namespace winrt::Windows::Storage::Streams;
using namespace winrt::Windows::UI::Core;
using namespace winrt::Windows::Graphics::Imaging;
using namespace Badger6502Emulator;
using namespace Badger6502Emulator::implementation;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

#define TXCOUNT 38400 // Total pixels/2 (since we have 2 pixels per byte)
uint8_t vga_buffer[TXCOUNT];


uint16_t scanlines[] = {
0x0000, 0x0400, 0x0800, 0x0C00, 0x1000, 0x1400, 0x1800, 0x1C00,
0x0080, 0x0480, 0x0880, 0x0C80, 0x1080, 0x1480, 0x1880, 0x1C80,
0x0100, 0x0500, 0x0900, 0x0D00, 0x1100, 0x1500, 0x1900, 0x1D00,
0x0180, 0x0580, 0x0980, 0x0D80, 0x1180, 0x1580, 0x1980, 0x1D80,
0x0200, 0x0600, 0x0A00, 0x0E00, 0x1200, 0x1600, 0x1A00, 0x1E00,
0x0280, 0x0680, 0x0A80, 0x0E80, 0x1280, 0x1680, 0x1A80, 0x1E80,
0x0300, 0x0700, 0x0B00, 0x0F00, 0x1300, 0x1700, 0x1B00, 0x1F00,
0x0380, 0x0780, 0x0B80, 0x0F80, 0x1380, 0x1780, 0x1B80, 0x1F80,
0x0028, 0x0428, 0x0828, 0x0C28, 0x1028, 0x1428, 0x1828, 0x1C28,
0x00A8, 0x04A8, 0x08A8, 0x0CA8, 0x10A8, 0x14A8, 0x18A8, 0x1CA8,
0x0128, 0x0528, 0x0928, 0x0D28, 0x1128, 0x1528, 0x1928, 0x1D28,
0x01A8, 0x05A8, 0x09A8, 0x0DA8, 0x11A8, 0x15A8, 0x19A8, 0x1DA8,
0x0228, 0x0628, 0x0A28, 0x0E28, 0x1228, 0x1628, 0x1A28, 0x1E28,
0x02A8, 0x06A8, 0x0AA8, 0x0EA8, 0x12A8, 0x16A8, 0x1AA8, 0x1EA8,
0x0328, 0x0728, 0x0B28, 0x0F28, 0x1328, 0x1728, 0x1B28, 0x1F28,
0x03A8, 0x07A8, 0x0BA8, 0x0FA8, 0x13A8, 0x17A8, 0x1BA8, 0x1FA8,
0x0050, 0x0450, 0x0850, 0x0C50, 0x1050, 0x1450, 0x1850, 0x1C50,
0x00D0, 0x04D0, 0x08D0, 0x0CD0, 0x10D0, 0x14D0, 0x18D0, 0x1CD0,
0x0150, 0x0550, 0x0950, 0x0D50, 0x1150, 0x1550, 0x1950, 0x1D50,
0x01D0, 0x05D0, 0x09D0, 0x0DD0, 0x11D0, 0x15D0, 0x19D0, 0x1DD0,
0x0250, 0x0650, 0x0A50, 0x0E50, 0x1250, 0x1650, 0x1A50, 0x1E50,
0x02D0, 0x06D0, 0x0AD0, 0x0ED0, 0x12D0, 0x16D0, 0x1AD0, 0x1ED0,
0x0350, 0x0750, 0x0B50, 0x0F50, 0x1350, 0x1750, 0x1B50, 0x1F50,
0x03D0, 0x07D0, 0x0BD0, 0x0FD0, 0x13D0, 0x17D0, 0x1BD0, 0x1FD0 };

/*
eb_text_lsb:
        .byte $00,$80,$00,$80
        .byte $00,$80,$00,$80
        .byte $28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0
        .byte $50,$D0,$50,$D0
eb_text1_msb:
        .byte $04,$04,$05,$05
        .byte $06,$06,$07,$07
        .byte $04,$04,$05,$05
        .byte $06,$06,$07,$07
        .byte $04,$04,$05,$05
        .byte $06,$06,$07,$07

*/
    uint16_t textScanlines[] = {
    0x0000, 0x0080, 0x0100, 0x0180,
    0x0200, 0x0280, 0x0300, 0x0380,
    0x0028, 0x00A8, 0x0128, 0x01A8,
    0x0228, 0x02A8, 0x0328, 0x03A8,
    0x0050, 0x00D0, 0x0150, 0x01D0,
    0x0250, 0x02D0, 0x0350, 0x03D0};


namespace winrt::Badger6502Emulator::implementation
{

    VM MainWindow::_vm;

    CRITICAL_SECTION MainWindow::_cs;

    //bool MainWindow::_fHasSymbols = false;
    //bool MainWindow::_fHasListing = false;
    MainWindow::ExecutionState MainWindow::_executionState;
    string MainWindow::_sourceFilename;
    string MainWindow::_sourceContents;
    string MainWindow::_listingContents;
    wstring MainWindow::_wlistingContents;

    MainWindow::MainWindow()
    {
        InitializeComponent();

        InitializeCriticalSection(&_cs);

        ExtendsContentIntoTitleBar(true);
        SetTitleBar(TitleBar());
        InitVGA();

        for (uint8_t y = 0; y < 192; y++)
        {
            for (uint8_t x = 0; x < 40; x++)
            {
                pixelindex[scanlines[y] + x] = (x << 8 | y);
            }
        }

        UpdateExecutionState(ExecutionState::Stopped);

        _vecBreakPoints = single_threaded_observable_vector<Badger6502Emulator::BreakPointItem>();

        _hThread = CreateThread(
            nullptr,                   // default security attributes
            0,                      // use default stack size  
            staticVMThreadProc,            // thread function name
            (LPVOID)this,           // argument to thread function 
            0,                      // use default creation flags 
            nullptr);   // returns the thread identifier 

        Closed([this](IInspectable const&, WindowEventArgs const&)
            {
                Cleanup();
            });

        txtSerial().Loaded([this](IInspectable const&, RoutedEventArgs const&)
            {
                FocusManager::TryFocusAsync(txtSerial(), FocusState::Programmatic);
            });

        txtSerial().Paste([this](IInspectable const&, TextControlPasteEventArgs const& args) -> winrt::fire_and_forget
            {
                args.Handled(true);

                // Get content from the clipboard.
                auto dataPackageView = Windows::ApplicationModel::DataTransfer::Clipboard::GetContent();
                if (dataPackageView.Contains(Windows::ApplicationModel::DataTransfer::StandardDataFormats::Text()))
                {
                    try
                    {
                        auto text = co_await dataPackageView.GetTextAsync();

                        EnterCriticalSection(&_cs);
                        for (wchar_t w : text)
                        {
                            if (w == 10)
                            {
                                w = 13;
                            }
                            _vecKeys.push_back(w & 0xFF);
                        }
                        LeaveCriticalSection(&_cs);
                    }
                    catch (...)
                    {
                    }
                }
            });

        txtSerial().KeyDown([this](IInspectable const&, KeyRoutedEventArgs const& args)
            {
                if (ps2EmulationItem().IsChecked() || appleEmulationItem().IsChecked())
                {
                    return;
                }
                else
                {
                    BYTE keyboardState[256];
                    WCHAR wcChar[2];

                    GetKeyboardState(&keyboardState[0]);
                    int keys = ToAsciiEx((UINT)args.Key(), 0, keyboardState, (LPWORD)wcChar, 0, GetKeyboardLayout(GetCurrentThreadId()));

                    for (int i = 0; i < keys; i++)
                    {
                        EnterCriticalSection(&_cs);
                        _vecKeys.push_back(wcChar[i] & 0xFF);
                        LeaveCriticalSection(&_cs);
                    }
                }
                args.Handled(true);
            });

        txtSerial().KeyUp([this](IInspectable const&, KeyRoutedEventArgs const& args)
            {
                if (ps2EmulationItem().IsChecked())
                {
                    if (_executionState == ExecutionState::Running 
                     || _executionState == ExecutionState::StepOver)
                    {
                        EnterCriticalSection(&_cs);
                        _vm.GetPS2Keyboard()->SignalHardwareKey(false, args.KeyStatus().ScanCode);
                        LeaveCriticalSection(&_cs);
                    }
                }

                args.Handled(true);
            });

        RootGrid().PreviewKeyUp([this](IInspectable const&, KeyRoutedEventArgs const& args)
            {
                if (ps2EmulationItem().IsChecked())
                {
                    if (_executionState == ExecutionState::Running
                     || _executionState == ExecutionState::StepOver)
                    {
                        EnterCriticalSection(&_cs);
                        _vm.GetPS2Keyboard()->SignalHardwareKey(false, args.KeyStatus().ScanCode);
                        LeaveCriticalSection(&_cs);
                    }
                }
            });

        RootGrid().PreviewKeyDown([this](IInspectable const&, KeyRoutedEventArgs const& args)
            {

                if (ps2EmulationItem().IsChecked())
                {
                    if (_executionState == ExecutionState::Running
                     || _executionState == ExecutionState::StepOver)
                    {
                        EnterCriticalSection(&_cs);
                        _vm.GetPS2Keyboard()->SignalHardwareKey(true, args.KeyStatus().ScanCode);
                        LeaveCriticalSection(&_cs);
                    }
                }
                else if (appleEmulationItem().IsChecked())
                {
                    EnterCriticalSection(&_cs);
                    _vm.WriteData(0xC000, 0x80 | toupper((char)args.Key()));
                    LeaveCriticalSection(&_cs);
                }

                if (args.Key() == Windows::System::VirtualKey::Pause)
                {
                    if (_executionState == ExecutionState::Running) {
                        UpdateExecutionState(ExecutionState::Stop);
                        args.Handled(true);
                    }
                }
                else if (args.Key() == Windows::System::VirtualKey::F10)
                {
                    if (_executionState == ExecutionState::Stopped) {
                        UpdateExecutionState(ExecutionState::Stepping);
                        args.Handled(true);
                    }
                }
                else if (args.Key() == Windows::System::VirtualKey::F11)
                {
                    if (_executionState == ExecutionState::Stopped) {
                        UpdateExecutionState(ExecutionState::StepOver);
                        args.Handled(true);
                    }
                }
                else if (args.Key() == Windows::System::VirtualKey::F5)
                {
                    if (_executionState != ExecutionState::Running) {
                        UpdateExecutionState(ExecutionState::Run);
                        args.Handled(true);
                    }
                }
                else if (args.Key() == Windows::System::VirtualKey::F8)
                {
                    UpdateExecutionState(ExecutionState::Reset);
                }

                else if (args.Key() == Windows::System::VirtualKey::F1)
                {
                    _clockspeed /= 2;
                }
                else if (args.Key() == Windows::System::VirtualKey::F2)
                {
                    _clockspeed *= 2;
                }

            });

        txtSerial().GotFocus([this](IInspectable const&, RoutedEventArgs const&)
            {
                auto doc = txtSerial().Document();
                ITextCharacterFormat fmt = doc.GetDefaultCharacterFormat();
                fmt.ForegroundColor(Windows::UI::Colors::Green());
                doc.SetDefaultCharacterFormat(fmt);
            });

        txtSerial().LosingFocus([this](IInspectable const&, LosingFocusEventArgs const& )
            {
                //args.Handled(true);
            });

        txtSerial().LostFocus([this](IInspectable const&, RoutedEventArgs const&)
            {
                auto doc = txtSerial().Document();
                ITextCharacterFormat fmt = doc.GetDefaultCharacterFormat();
                fmt.ForegroundColor(Windows::UI::Colors::Green());
                doc.SetDefaultCharacterFormat(fmt);
            });

        txtSerial().CharacterReceived([this](IInspectable const&, CharacterReceivedRoutedEventArgs const& args)
            {
                EnterCriticalSection(&_cs);
                _vecKeys.push_back((uint8_t)args.Character());
                LeaveCriticalSection(&_cs);
                args.Handled(true);
            });

        miBreak().Click([this](IInspectable const&, RoutedEventArgs const&)
            {
                if (_executionState == ExecutionState::Running 
                 || _executionState == ExecutionState::StepOver)
                {
                    UpdateExecutionState(ExecutionState::Stop);
                }
            });

        miRun().Click([this](IInspectable const&, RoutedEventArgs const&)
            {
                if (_executionState != ExecutionState::Running)
                {
                    UpdateExecutionState(ExecutionState::Run);
                }
            });

        miStep().Click([this](IInspectable const&, RoutedEventArgs const&)
            {
                if (_executionState == ExecutionState::Stopped)
                {
                    UpdateExecutionState(ExecutionState::Stepping);
                }
            });

        miReset().Click([this](IInspectable const&, RoutedEventArgs const&)
            {
                UpdateExecutionState(ExecutionState::Stopped);
                _vm.GetCPU()->Reset();                
                _vm.GetPS2Keyboard()->Reset();
                _vm.Reset();
            });

        miInterrupt().Click([this](IInspectable const&, RoutedEventArgs const&)
            {
                _firenmi = miInterrupt().IsChecked();
            });

        miExit().Click([this](IInspectable const&, RoutedEventArgs const&)
            {
                Close();
                Cleanup();
            });

        stackBreakpoints().GotFocus([this](IInspectable const&, RoutedEventArgs const&)
            {
                //FocusManager::TryFocusAsync(txtBreakValue(), FocusState::Programmatic);
            });

        txtSource().GotFocus([this](IInspectable const&, RoutedEventArgs const&)
            {
                //FocusManager::TryFocusAsync(txtSerial(), FocusState::Programmatic);
            });

        txtDebug().GotFocus([this](IInspectable const&, RoutedEventArgs const&)
            {
                //FocusManager::TryFocusAsync(txtSerial(), FocusState::Programmatic);
            });

        // bugbug - have to check for pointer to detect if image is clicked
        // no way to hook keyboard events at window level and toplevel grid stops getting
        // key events if image is clicked

        imgVGA().PointerPressed([this](IInspectable const&, PointerRoutedEventArgs const& )
            {
                //FocusManager::TryFocusAsync(txtSerial(), FocusState::Programmatic);
                //args.Handled(true);
            });

        txtSymbols().TextChanged([this](IInspectable const&, RoutedEventArgs const&)
            {
                hstring txtSearch;
                wstring strResults;
                
                txtSymbols().Document().GetText(TextGetOptions::AdjustCrlf, txtSearch);
                DebugSymbols::SymbolSearch(txtSearch.c_str(), strResults);
                OutputDebugStringW(L"\r\nsearch:");
                OutputDebugStringW(txtSearch.c_str());


                txtSymbolResults().Document().SetText(TextSetOptions::None, strResults.c_str());
            });


        C0().IsChecked(true);

        auto windowNative{ this->try_as<::IWindowNative>() };
        winrt::check_bool(windowNative);
        HWND hWnd{ 0 };
        windowNative->get_WindowHandle(&hWnd);

        // Create a WINDOWPLACEMENT structure
        WINDOWPLACEMENT wp = {};
        wp.length = sizeof(WINDOWPLACEMENT);

        // Get the current window placement
        GetWindowPlacement(hWnd, &wp);

        // Set the show command to maximize
        wp.showCmd = SW_SHOWMAXIMIZED;

        // Set the new window placement
        SetWindowPlacement(hWnd, &wp);

        _timer = Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread().CreateTimer();
        _timer.Interval(std::chrono::milliseconds(16));

        _timer.Tick([&](auto const&, auto const&)
            {
                int page = _gfxPage;
                ProcessHires(page);
                ProcessText(page);
                //DrawText(page);
                RefreshVideo(page);
                _vgaBitmap[page].Invalidate();
                imgVGA().Source(_vgaBitmap[page]);
            });
        _timer.Start();
    }

    MainWindow::~MainWindow()
    {
        // bug : doesn't get called when clicking X button
        Cleanup();
    }

    void MainWindow::Cleanup()
    {
        _timer.Stop();
        UpdateExecutionState(ExecutionState::Quit);
        WaitForSingleObject(_hThread, INFINITE);

        DeleteCriticalSection(&_cs);

        DebugSymbols::Clear();
    }

    IAsyncAction MainWindow::clickSetRegister(IInspectable const&, RoutedEventArgs const&)
    {
        CPU* pCPU = _vm.GetCPU();
        dialogRegisters().PrimaryButtonText(L"OK");
        dialogRegisters().SecondaryButtonText(L"Cancel");
        auto result = co_await dialogRegisters().ShowAsync();

        if (result == ContentDialogResult::Primary)
        {
            wstring str;
            uint8_t bit = 0;

            str = txtPC().Text().c_str();
            ValidateAndAssignValue(str, pCPU->PC);

            str = txtSP().Text().c_str();
            ValidateAndAssignValue(str, pCPU->SP);

            str = txtA().Text().c_str();
            ValidateAndAssignValue(str, pCPU->A);

            str = txtX().Text().c_str();
            ValidateAndAssignValue(str, pCPU->X);

            str = txtY().Text().c_str();
            ValidateAndAssignValue(str, pCPU->Y);

            str = txtCarry().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.C = bit;
            }

            str = txtDecimal().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.D = bit;
            }

            str = txtInterrupts().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.I = bit;
            }

            str = txtNegative().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.N = bit;
            }

            str = txtOverflow().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.V = bit;
            }

            str = txtZero().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.Z = bit;
            }

            str = txtBrk().Text();
            if (ValidateAndAssignBit(str, bit))
            {
                pCPU->flags.bits.B = bit;
            }
        }
    }

    void MainWindow::clickMemory(IInspectable const&, RoutedEventArgs const&)
    {
        Window w = make<MemoryWindow>();
        w.Activate();
    }

    bool MainWindow::ValidateAndAssignBit(wstring const& str, uint8_t& val)
    {
        if (str.length() != 1)
        {
            return false;
        }

        if (str[0] == L'0')
        {
            val = 0;
            return true;
        }
        else if (str[0] == L'1')
        {
            val = 1;
            return true;
        }

        return false;
    }

    bool MainWindow::ValidateAndAssignValue(wstring const& str, uint8_t& val)
    {
        bool isHex = false;

        if (!IsValidNumber(str, &isHex))
        {
            return false;
        }

        if (isHex)
        {
            val = (uint8_t)wcstol(&(str.c_str())[1], nullptr, 16);
        }
        else
        {
            val = (uint8_t)wcstol(str.c_str(), nullptr, 10);
        }

        return true;
    }

    bool MainWindow::ValidateAndAssignValue(wstring const& str, uint16_t& val)
    {
        bool isHex = false;

        if (!IsValidNumber(str, &isHex))
        {
            return false;
        }

        if (isHex)
        {
            val = (uint16_t)wcstol(&(str.c_str())[1], nullptr, 16);
        }
        else
        {
            val = (uint16_t)wcstol(str.c_str(), nullptr, 10);
        }

        return true;
    }

    void MainWindow::dialogRegisters_Opened(IInspectable const&, ContentDialogOpenedEventArgs const&)
    {
        WCHAR wcText[255];
        CPU* pCPU = _vm.GetCPU();

        swprintf_s(wcText, _countof(wcText), L"$%04x", pCPU->PC);
        txtPC().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"$%04x", pCPU->SP);
        txtSP().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"$%02x", pCPU->A);
        txtA().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"$%02x", pCPU->X);
        txtX().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"$%02x", pCPU->Y);
        txtY().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.C);
        txtCarry().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.D);
        txtDecimal().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.I);
        txtInterrupts().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.N);
        txtNegative().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.V);
        txtOverflow().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.Z);
        txtZero().Text(wcText);

        swprintf_s(wcText, _countof(wcText), L"%d", pCPU->flags.bits.B);
        txtBrk().Text(wcText);

    }

    void MainWindow::UpdateExecutionState(ExecutionState state)
    {
        _executionState = state;
        UpdateMenuByState();

        switch (state)
        {
        case ExecutionState::Reset:
        case ExecutionState::Run:
        case ExecutionState::Running:
        case ExecutionState::StepOver:
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    txtTitle().Text(L"Badger6502 - Running");
                    Microsoft::UI::Xaml::Media::SolidColorBrush sb(winrt::Windows::UI::Colors::DarkGreen());
                    TitleBar().Background(sb);
                });

            break;
        case ExecutionState::Stepping:
        case ExecutionState::Stopped:
        case ExecutionState::Stop:
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    Windows::UI::Color highlight({ 255, 0, 128, 0 });

                    txtTitle().Text(L"Badger6502 - Stopped");
                    Microsoft::UI::Xaml::Media::SolidColorBrush sb(winrt::Windows::UI::Colors::DarkRed());
                    TitleBar().Background(sb);
                });
            break;
        }

    }

    void MainWindow::UpdateMenuByState()
    {
        switch (_executionState)
        {
        case ExecutionState::Run:
        case ExecutionState::Running:
        case ExecutionState::Reset:
        case ExecutionState::StepOver:
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]()
                {
                    miRun().IsEnabled(false);
                    miStep().IsEnabled(false);
                    miBreak().IsEnabled(true);
                    miRegister().IsEnabled(false);
                });

            break;

        case ExecutionState::Stop:
        case ExecutionState::Stopped:
        case ExecutionState::Stepping:
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]()
                {
                    miRun().IsEnabled(true);
                    miStep().IsEnabled(true);
                    miBreak().IsEnabled(false);
                    miRegister().IsEnabled(true);
                });

            break;
        }
    }

    int32_t MainWindow::MyProperty()
    {
        throw hresult_not_implemented();
    }

    Windows::Foundation::Collections::IObservableVector<Badger6502Emulator::BreakPointItem> MainWindow::BreakPoints()
    {
        return _vecBreakPoints;
    }

    void MainWindow::MyProperty(int32_t /* value */)
    {
        throw hresult_not_implemented();
    }

    DWORD MainWindow::staticVMThreadProc(LPVOID p)
    {
        MainWindow* pThis = (MainWindow*)p;
        return pThis->VMThreadProc();
    }

    DWORD MainWindow::VMThreadProc()
    {
        CPU* pCPU = _vm.GetCPU();
        DWORD dwTicks = 0;
        DWORD dwDebugLines = 0;
        wstring strDebug;
        wstring strEdit;
        wstring strReg;
        bool fEditPending = false;
        bool fDebugPending = false;
        uint32_t cycles = 0;
        uint32_t totalcycles = 0;
        uint32_t profcycles = 0;
        double proftime;
        double textModeTime;
        int32_t callDepth = 0;

        LARGE_INTEGER freq = { 0 };
        LARGE_INTEGER count = { 0 };
        LARGE_INTEGER lastCount = { 0 };

        winrt::init_apartment();

        QueryPerformanceFrequency(&freq);


        DispatcherQueue().TryEnqueue(
            DispatcherQueuePriority::Low,
            [&]() {
                // bug: setting read only on richeditcontrol causes crash
                txtDebug().IsReadOnly(true);
                txtSource().IsReadOnly(true);
            });

        _vm.CallbackReceiveChar = [&](uint8_t byte) -> void {
            byte;

            WCHAR text[2] = { 0 };

            if (byte == 10)
            {
                return;
            }

            text[0] = (char)byte;
            EnterCriticalSection(&_cs);

            if (byte == 8 && strEdit.length() > 0)
            {
                strEdit.erase(strEdit.end() - 1);
            }
            else
            {
                strEdit += text;
            }

            if (strEdit.length() > 0x4000)
            {
                strEdit = strEdit.substr(0x3000);
            }

            LeaveCriticalSection(&_cs);

            if (!fEditPending)
            {
                fEditPending = true;
                DispatcherQueue().TryEnqueue(
                    DispatcherQueuePriority::Low,
                    [&]() {
                        //txtSerial().IsReadOnly(false);
                        auto doc = txtSerial().Document();
                        ITextCharacterFormat fmt = doc.GetDefaultCharacterFormat();
                        fmt.ForegroundColor(Windows::UI::Colors::Green());
                        doc.SetDefaultCharacterFormat(fmt);

                        EnterCriticalSection(&_cs);
                        auto sel = doc.Selection();
                        doc.SetText(TextSetOptions::None, strEdit.c_str());
                        sel.SetRange((int32_t)strEdit.length(), (int32_t)strEdit.length());
                        LeaveCriticalSection(&_cs);

                        sel.ScrollIntoView(PointOptions::Start);
                        //txtSerial().IsReadOnly(true);
                        fEditPending = false;
                        return;
                    });
            }

            return;
        };

        _vm.CallbackDebugString = [&](char* str) -> void {
            // get the current selection
            WCHAR wcBuf[255];
            swprintf_s(wcBuf, _countof(wcBuf), L"%S", str);

            EnterCriticalSection(&_cs);

            if (dwDebugLines++ % 1500 == 0)
            {
                strDebug = L"";
            }
            strDebug.append(wcBuf);

            LeaveCriticalSection(&_cs);

            if (!fDebugPending)
            {
                fDebugPending = true;

                DispatcherQueue().TryEnqueue(
                    DispatcherQueuePriority::Low,
                    [&]() {                        
                        txtDebug().IsReadOnly(false);
                        EnterCriticalSection(&_cs);
                        txtDebug().Document().SetText(TextSetOptions::None, strDebug);
                        txtDebug().Document().Selection().SetRange((int32_t)strDebug.length(), (int32_t)strDebug.length());
                        LeaveCriticalSection(&_cs);
                        txtDebug().Document().Selection().ScrollIntoView(PointOptions::Start);
                        txtDebug().IsReadOnly(true);
                        fDebugPending = false;
                        return;
                    });
            }
        };

        //			CallbackSetSoftSwitches(_graphics, _page2, _mixed, _lores);

        _vm.CallbackSetSoftSwitches = [&](uint16_t address, bool graphics, bool page2, bool mixed, bool lores) -> void {

            if (address >= 0xC050 && address <= 0xC057)
            {
                bool queued = DispatcherQueue().TryEnqueue(
                    DispatcherQueuePriority::Low,
                    [&, graphics, page2, mixed, lores]() {
                        _gfxPage = page2 ? 1 : 0;
                        _textMode = graphics ? 0 : 1;
                        _mixed = mixed ? 1 : 0;
                        _lores = lores ? 1 : 0;

                        //ClearVGA();
                        //RefreshVideo();
                    });

                if (!queued)
                {
                    __debugbreak();
                }
            }
            else if (address >= 0xC0E0 && address <= 0xC0EF)
            {
                // disk
                _vm.GetDriveEmulator()->AddCycles(_cycles - _lastCycle);
                _lastCycle = _cycles;
            }
        };

        _vm.CallbackSetMode = [&](uint8_t flags) -> void {
            bool queued = DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&, flags]() {
                    //_gfxPage = !!(flags & 0x40);
                    //_textMode = ((flags & 0x80) == 0);
                    _font = flags & 0x3F;

                    //RefreshVideo();
                });

            if (!queued)
            {
                __debugbreak();
            }
        };

        _vm.CallbackText1 = [&](uint16_t address, uint8_t byte) -> void {

            EnterCriticalSection(&_cs);
            QueueItem i;
            i.address = address;
            i.data = byte;
            _mapText[0][address] = i;
            LeaveCriticalSection(&_cs);

            /*
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    ProcessText1();
                });
            */
        };

        _vm.CallbackText2 = [&](uint16_t address, uint8_t byte) -> void {

            EnterCriticalSection(&_cs);
            QueueItem i;
            i.address = address;
            i.data = byte;
            _mapText[1][address] = i;
            LeaveCriticalSection(&_cs);

            /*
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    ProcessText2();
                });
            */
        };

        _vm.CallbackHires1 = [&](uint16_t address, uint8_t byte) -> void {

            EnterCriticalSection(&_cs);

            QueueItem i;
            i.address = address;
            i.data = byte;
            _mapHires[0][address] = i;
            //_vecHires1.push_back(i);

            LeaveCriticalSection(&_cs);

            /*
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    ProcessHires1();
                });
             */
        };

        
        _vm.CallbackHires2 = [&](uint16_t address, uint8_t byte) -> void
        {
            EnterCriticalSection(&_cs);

            QueueItem i;
            i.address = address;
            i.data = byte;
            _mapHires[1][address] = i;
            LeaveCriticalSection(&_cs);

            /*
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    ProcessHires2();
                });
            */
        };

        _vm.CallbackReadMemory = [&](uint16_t address) -> void
        {
            if (_countBreakPoints > 0) // todo: make thread safe
            {
                EnterCriticalSection(&_cs);

                if (_countBreakPoints > 0 && EvaluateBreakpoint(pCPU, address, 0, true))
                {
                    UpdateExecutionState(ExecutionState::Stopped);
                    strDebug.clear();
                    dwDebugLines = 0;
                    pCPU->DumpHistory();
                    pCPU->SetOutput(true);
                    _wlistingContents = _vm.Disassemble();
                }
                LeaveCriticalSection(&_cs);
            }
        };

        _vm.CallbackWriteMemory = [&](uint16_t address, uint8_t byte) -> void
        {
            if (address == MM_VIA1_START + VIA::ORA_IRA_2
                || address == MM_VIA1_START + VIA::ORA_IRA)
            {
                // SD Card
                uint8_t reg = _vm.GetVIA1()->ReadRegister(VIA::ORA_IRA);

                _sdcard.SetCS(reg & 0x10);
                _sdcard.SetMOSI(reg & 0x4);
                _sdcard.SetSCK(reg & 0x8);

                if (_sdcard.GetMISO())
                {
                    reg |= 0x2;
                }
                else
                {
                    reg = reg & (uint8_t)~2;
                }

                _vm.GetVIA1()->WriteRegister(VIA::ORA_IRA, reg);

            }
#if 0
            if (pCPU->PC >= 0xF800 && pCPU->PC < 0xFF00)
            {
                UpdateExecutionState(ExecutionState::Stopped);
                EnterCriticalSection(&_csDebug);
                strDebug.clear();
                dwDebugLines = 0;
                LeaveCriticalSection(&_csDebug);
                pCPU->DumpHistory();
                pCPU->SetOutput(true);
                _wlistingContents = _vm.Disassemble();
            }
#endif
            if (_countBreakPoints > 0) // todo: make thread safe
            {
                EnterCriticalSection(&_cs);
                
                if (_countBreakPoints > 0  && EvaluateBreakpoint(pCPU, address, byte, false))
                {
                    UpdateExecutionState(ExecutionState::Stopped);
                    strDebug.clear();
                    dwDebugLines = 0;
                    pCPU->DumpHistory();
                    pCPU->SetOutput(true);
                    _wlistingContents = _vm.Disassemble();
                }
                LeaveCriticalSection(&_cs);
            }
        };
        
        _vm.CallbackLoadFile = [&](std::string& filename, std::vector<uint8_t>& bytes, uint8_t& code) -> void
        {
            std::string path = "c:\\eb6502\\targets\\";
            path.append(filename);

            FILE* f = nullptr;
            errno_t e = fopen_s(&f, path.c_str(), "rb");
            code = (uint8_t)e;

            if (e != 0 || !f)
            {
                return;
            }

            while (!feof(f))
            {
                uint8_t b = (uint8_t)fgetc(f);
                bytes.push_back(b);
            }

            fclose(f);
        };

        _vm.CallbackSaveFile = [&](std::string& filename, std::vector<uint8_t>& bytes, uint8_t& code) -> void
        {
            std::string path = "c:\\eb6502\\targets\\";
            path.append(filename);

            FILE* f = nullptr;
            errno_t e = fopen_s(&f, path.c_str(), "wb");
            code = (uint8_t)e;

            if (e != 0 || !f)
            {
                return;
            }

            for (uint8_t b : bytes)
            {
                fputc((int)b, f);
            }

            fflush(f);
            fclose(f);
        };

#if 0
        _vm.CallbackWriteVideo = [&](uint16_t address, uint8_t data) -> void {
            // 320x240x16
            // 2bpp
            // 16 bit video memory address
            // yyyyyyyy xxxxxxxx  8 bits each for y and x
            // bbbyyyyy xxxxxxxx  top 3 bits of Y are PB0 through PB2 on VIA2
            // Y is divided into 32 line blocks,  bank must be set correctly writing
            // no need to worry about banking here
            // for this function, address is already precalculated
            // as such, top 8 bits are y and bottom 8 bits are x
            // since is 4bpp, each address contains two columns
            // so multiply by 2

            uint16_t col = (address & 0xFF) << 1;
            uint16_t row = (address >> 8);

            EnterCriticalSection(&_csPixelOp);

            PixelOp p;
            p.row = row;
            p.col = col;
            p.color = data & 0x0F;
            _vecPixelOps.push_back(p);

            p.col++;
            p.color = data >> 4;
            _vecPixelOps.push_back(p);

            LeaveCriticalSection(&_csPixelOp);

            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Low,
                [&]() {
                    ProcessPixelOps();
                });
        };
#endif

        WCHAR dir[MAX_PATH] = {};
        GetCurrentDirectoryW(MAX_PATH, (LPWSTR)dir);
        
        _sdcard.LoadImageFile(L"\\3ric\\emulator\\data\\sd.001");

        uint32_t retval = _fontFile.MapFile(L"\\3ric\\emulator\\data\\fontrom.dat");
        if (retval != 0)
        {
            __debugbreak();
        }

        //if (vm.LoadBinaryFile("c:\\6502_65C02_functional_tests\\6502_functional_test.bin", 0))
        if (_vm.LoadBinaryFile("\\3ric\\emulator\\data\\badger6502.bin", 0x0000))
        {
            memcpy(_vm.GetBasicRom(), &_vm.GetData()[0x9000], sizeof(uint8_t) * 0x3000);

            _vm.LoadRomDiskFile("\\3ric\\emulator\\data\\loderun.bin");

            // load Loderunner into RAM
            //memcpy(&_vm.GetData()[0x800], &_vm.GetRomDisk()[0], sizeof(uint8_t) * 0xB600);


            _fHasSymbols = DebugSymbols::LoadDebugFile("\\3ric\\emulator\\data\\badger6502.dbg");
            DebugSymbols::LoadDebugFile("\\3ric\\emulator\\data\\loderun.dbg");

            //_vm.LoadBinaryFile("c:\\eb6502\\targets\\breakout_0803.bin", 0x4000);
            //_vm.LoadBinaryFile("c:\\eb6502\\targets\\gomoku.bin", 0x4000);

            // temporarily write a fcopyat directory entry
            //_vm.LoadBinaryFile("c:\\eb6502\\targets\\fatentry.bin", 0xA000);
            
            std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> converter;
#ifdef _USE_LISTING
            _fHasListing = DebugSymbols::LoadListingFile("c:\\eb6502\\targets\\badger6502.lst", _listingContents);

            _wlistingContents = converter.from_bytes(_listingContents);
#else 
            _fHasListing = true;
            _wlistingContents = _vm.Disassemble();

#endif
            pCPU->Reset();

            HighlightSource();

            proftime = 0.0;
            textModeTime = 0.0;

            while (true)
            {
                QueryPerformanceCounter(&count);
                double time = ((count.QuadPart - lastCount.QuadPart) / (double)freq.QuadPart);

                if (cycles > 0 && _clockspeed > 0)
                {
                    if ((cycles / (double)_clockspeed) > time)
                    {
                        continue;
                    }
                }

                proftime += time;
                textModeTime += time;

                profcycles += cycles;
                if (proftime >= .75)
                {
                    _freqActual = profcycles / proftime;

                    if (_executionState == ExecutionState::Running
                     || _executionState == ExecutionState::StepOver)
                    {
                        DispatcherQueue().TryEnqueue(
                            DispatcherQueuePriority::Low,
                            [&]() {
                                WCHAR buf[255];
                                swprintf_s(buf, _countof(buf), L"Badger6502 - Running (%f MHz)", _freqActual / 1000000.0);
                                txtTitle().Text(buf);
                                Microsoft::UI::Xaml::Media::SolidColorBrush sb(winrt::Windows::UI::Colors::DarkGreen());
                                TitleBar().Background(sb);
                            });

                    }

                    profcycles = 0;
                    proftime = 0;
                }

                /*
                if (textModeTime >= .16)
                {
                    if (_executionState == ExecutionState::Running
                        || _executionState == ExecutionState::StepOver)
                    {
                        if (_textMode == 1 || _mixed == 1 || (_textMode == 0 && _lores == 1))
                        {
                            DispatcherQueue().TryEnqueue(
                                DispatcherQueuePriority::Low,
                                [&]() {
                                    if (_textMode == 1 || _mixed == 1 || _lores == 1)
                                    {
                                        DrawText();
                                    }
                                });
                        }
                    }
                    textModeTime = 0.0;
                }
                */
                lastCount = count;
                cycles = 0;


                switch (_executionState)
                {
                case ExecutionState::Stopped:
                    Sleep(50);
                    continue;

                case ExecutionState::Reset:
                    pCPU->Reset();
                    _vm.Reset();
                    totalcycles = 0;
                    _sourceFilename = "";
                    // fall through

                case ExecutionState::Run:
                    UpdateExecutionState(ExecutionState::Running);
                    pCPU->SetOutput(false);
                    break;

                case ExecutionState::Stop:
                    UpdateExecutionState(ExecutionState::Stopped);
                    pCPU->SetOutput(true);
                    break;

                case ExecutionState::Stepping:
                    UpdateExecutionState(ExecutionState::Stopped);
                    pCPU->SetOutput(true);
                    break;

                case ExecutionState::StepOver:
                    UpdateExecutionState(ExecutionState::StepOver);
                    pCPU->SetOutput(true);
                    break;

                case ExecutionState::Quit:
                    return 0;
                }

                cycles += pCPU->Step();
                _cycles += cycles;

                totalcycles += cycles;


                for (uint32_t i = 0; i < cycles; i++)
                {
                    _vm.GetVIA1()->Tick();
                    _vm.GetVIA2()->Tick();

                    //bool isInInterrupt = pCPU->flags.bits.I;
                    //if (!isInInterrupt)

                }

                EnterCriticalSection(&_cs);
                _vm.GetPS2Keyboard()->ProcessKeys(totalcycles);
                LeaveCriticalSection(&_cs);

#if 0
                /* DEBUGGING TOOLS*/

                if (pCPU->PC >= 0xC800 && pCPU->_OpCode == JSR_ABS)
                {
                    WCHAR buf[255];
                    swprintf_s(buf, _countof(buf), L"JSR: 0x%04x\r\n", pCPU->PC);
                    OutputDebugString(buf);
                }

                /*DEBUGGING TOOLS OFF*/
#endif
                if (_executionState == ExecutionState::StepOver)
                {
                    if (pCPU->_OpCode == JSR_ABS)
                    {
                        callDepth++;
                    }

                    if (pCPU->_OpCode == RTS_STACK)
                    {
                        callDepth--;

                        if (callDepth < 1)
                        {
                            callDepth = 0;
                            UpdateExecutionState(ExecutionState::Stopped);
                        }
                    }
                }

                EnterCriticalSection(&_cs);
                if (_countBreakPoints > 0 && EvaluateBreakpoint(pCPU, 0, 0, true))
                {
                    UpdateExecutionState(ExecutionState::Stopped);
                    strDebug.clear();
                    dwDebugLines = 0;
                    pCPU->DumpHistory();
                    pCPU->SetOutput(true);
                    _wlistingContents = _vm.Disassemble();
                }
                LeaveCriticalSection(&_cs);

                if (_executionState == ExecutionState::Stopped)
                {
                    HighlightSource();
                }



                /* Serial keys */
                EnterCriticalSection(&_cs);
                while (_vecKeys.size() > 0 && totalcycles - dwTicks > 25000) // && GetTickCount() - dwTicks > 0)
                {
                    uint8_t key = _vecKeys[0];

                    if (true == _vm.SimulateSerialKey(key))
                    {
                        _vecKeys.erase(_vecKeys.begin());
                        //dwTicks = GetTickCount();
                        dwTicks = totalcycles;
                    }
                    else
                    {
                        break;
                    }
                }
                LeaveCriticalSection(&_cs);

            }
        }

        return 0;
    }

    void MainWindow::RefreshVideo(int page)
    {
        //EnterCriticalSection(&_cs);

        if (_textMode == 0)
        {
            if (_lores == 0)
            {
                for (uint8_t y = 0; y <= 192; y++)
                {
                    //draw_hires_line_eb6502(y, pHiRes);
                    draw_hires_line_color_apple(page, y);
                }
            }
            else
            {
                draw_lores_line_color_apple(page);
            }

            if (_mixed)
            {
                draw_text_eb6502(page);
            }
        }
        else 
        {
            draw_text_eb6502(page);
        }
        //LeaveCriticalSection(&_cs);

        //_vgaBitmap[_gfxPage].Invalidate();
    }

    void MainWindow::SetSourceContents()
    {
        DispatcherQueue().TryEnqueue(
            DispatcherQueuePriority::Normal,
            [&]() {
                return;
            });
    }

    void MainWindow::HighlightSource()
    {
        uint32_t line = 0;
        //size_t o1 = 0;
        uint32_t offset = 0;
        string filename;
        CPU* pCPU = _vm.GetCPU();


        if (DebugSymbols::AddressToSourceInfo(pCPU->PC, line, filename))
        {
            if (filename.length() > 0 && filename.compare(_sourceFilename) != 0)
            {
                _sourceFilename = filename;
                SetSourceContents();
            }
        }


        if (_vm.OffsetFromAddress(pCPU->PC, offset))
        {
            DispatcherQueue().TryEnqueue(
                DispatcherQueuePriority::Normal,
                [&]() {
                    txtSource().IsReadOnly(false);

                    uint16_t PC = _vm.GetCPU()->PC;

                    uint32_t o1 = 0;
                    uint32_t o2 = 0;
                    uint32_t o3 = 0;

                    uint32_t oscroll = 0;
                    uint32_t window = 2000;
                    uint32_t l1 = 0;
                    uint32_t l2 = _vm.GetLineFromAddress(PC);
                    uint32_t l3 = l2 + window;

                    l1 = (l2 > window) ? (l2 - window) : 0;

                    o1 = _vm.GetOffsetFromLine(l1);
                    o2 = _vm.GetOffsetFromLine(l2);
                    o3 = _vm.GetOffsetFromLine(l3);
                    oscroll = _vm.GetOffsetFromLine(l2 + 15);

                    //bugbug - RichEditBox doesn't render large quantities of text correctly
                    //have to clip to a subset to get end of control to render correctly
                    //https://github.com/microsoft/microsoft-ui-xaml/issues/1842

                    EnterCriticalSection(&_cs);
                    //_wlistingContents = _vm.Disassemble();
                    wstring w2 = _wlistingContents.substr(o1, o3 - o1);
                    //wstring w2 = _wlistingContents;
                    LeaveCriticalSection(&_cs);
                    Windows::UI::Color highlight({ 255, 0, 128, 0 });

                    auto doc = txtSource().Document();
                    doc.SetText(TextSetOptions::None, w2.c_str());

                    auto range2 = doc.GetRange(oscroll - o1, oscroll - o1);
                    range2.ScrollIntoView(PointOptions::None);

                    auto range = doc.GetRange((int32_t)_vm.GetOffsetFromLine(l2) - o1, (int32_t)_vm.GetOffsetFromLine(l2+1) - o1);
                    //range.Expand(TextRangeUnit::Line);
                    range.CharacterFormat().BackgroundColor(highlight);

                    txtSource().IsReadOnly(true);

                    return;
                });
        }


    }

    void MainWindow::InitVGA()
    {
        _vgaBitmap[0] = WriteableBitmap(320, 384);
        _vgaBitmap[1] = WriteableBitmap(320, 384);
        _pixelBuffer[0] = (uint32_t*)_vgaBitmap[0].PixelBuffer().data();
        _pixelBuffer[1] = (uint32_t*)_vgaBitmap[1].PixelBuffer().data();

        //_vgaBitmapTextMode = WriteableBitmap(320, 400);
        //_pixelBufferTextMode = (uint32_t*)_vgaBitmapTextMode.PixelBuffer().data();

        imgVGA().Source(_vgaBitmap[_gfxPage]);
        ClearVGA();
    }

    void MainWindow::ClearVGA()
    {
        // clear display
        for (uint16_t y = 0; y < 384; y++)
        {
            for (uint16_t x = 0; x < 320; x++)
            {
                PlotPixel(_gfxPage, y, x, 0);
            }
        }
        _vgaBitmap[_gfxPage].Invalidate();
    }

    void MainWindow::draw_text_eb6502(int page)
    {
        uint32_t startrow = 0;
        if (_mixed && !_textMode)
        {
            startrow = 320;
        }

        for (uint32_t x = 0; x < 40; x++)
        {
            for (uint32_t y = startrow; y < 384; y++)
            {                
                //uint32_t addr = ((y/16) * 40) + x
                uint32_t addr = textScanlines[y/16] + x;
                uint8_t curr = _text[page][addr];


                uint32_t fontaddr = 0;
                uint8_t line = y % 16;

                fontaddr = curr | (line << 8) | (_font << 12);
                
                // get data from font
                uint8_t bytes = _fontFile.GetData(fontaddr);
                int bit = 0;
                for (int i = 7; i >=0 ; i--)
                {
                    if (bytes & (1<<i))
                    {
                        _pixelBuffer[page][(x * 8) + bit + (y * 320)] = 0xFFFFFFFF;
                    }
                    else
                    {
                        _pixelBuffer[page][(x * 8) + bit + (y * 320)] = 0xFF000000;
                    }
                    bit++;
                }
            }

        }
    }

    void MainWindow::draw_hires_line_eb6502(int page, uint8_t y)
    {
        for (uint16_t x = 0; x < 40; x++)
        {
            //uint16_t laddr = (y * 40) + x;
            uint16_t laddr = scanlines[y] + x;
            uint8_t curr = _hires[page][laddr];

            for (uint8_t i = 0; i < 7; i++)
            {
                uint8_t bit = (curr >> i) & 1;

                if (bit)
                {
                    PlotPixel(page, y, (x * 7) + i /*(7 - i)*/, 0xFF);
                }
                else
                {
                    PlotPixel(page, y, (x * 7) + i /*(7 - i)*/, 0x00);
                }
            }
        }
    }

    void MainWindow::draw_hires_line_color_apple(int page, uint8_t y)
    {
        uint8_t pallete = 0;
        uint8_t prevbit = 0;
        uint8_t color = 0;
        uint16_t ya = y * 2;

   //                                Violet  Green           Cyan Red 
        uint8_t colors[2][4] = { {0x0, 0x5, 0x2, 0xF}, {0x0, 0x6, 0x1, 0xF} };
        uint16_t countPixel = 0;

        for (uint16_t x = 0; x < 40; x++)
        {
            uint16_t laddr = scanlines[y] + x;
            uint8_t curr = _hires[page][laddr];

            pallete = curr >> 7;

            // pallete bit, odd bit, last bit, bit
            // 16 combinations for color output

            for (uint8_t i = 0; i < 7; i++)    
            {
                uint8_t bit = (curr >> i) & 1;
                uint8_t odd = (x + i) % 2;
                uint8_t index = 0;

                if (odd)
                {
                    index = bit << 1 | prevbit;
                }
                else
                {
                    index = prevbit << 1 | bit;
                }

                color = colors[pallete][index];
                uint16_t pixel = (uint16_t)(((float)countPixel / 280.0f) * 320);
                countPixel++;
                uint16_t nextpixel = (uint16_t)(((float)countPixel / 280.0f) * 320);

                PlotPixel(page, ya, pixel, color, true);
                if (nextpixel - pixel > 1)
                {
                    PlotPixel(page, ya, pixel+1, color, true);
                }

                //PlotPixel(ya+1, countPixel++, color);

                prevbit = bit;
            }
        }
    }

    void MainWindow::draw_lores_line_color_apple(int page)
    {
        uint8_t index = 0;
        uint32_t color = 0;
        uint32_t endy = 384;

        if (_mixed == 1)
        {
            endy = 320;
        }

        for (uint32_t x = 0; x < 40; x++)
        {
            for (uint32_t y = 0; y < endy; y++)
            {
                uint32_t addr = textScanlines[y / 16] + x;
                uint8_t curr = _text[page][addr];

                if ((y & 8) == 0)
                {
                    index = curr & 0xF;
                }
                else
                {
                    index = curr >> 4;
                }

                switch (index)
                {
                case 0: // black
                    color = 0xFF000000;
                    break;
                case 1: // magenta
                    color = 0xFF901740;
                    break;
                case 2: // dark blue
                    color = 0xFF402CA5;
                    break;
                case 3: // purple
                    color = 0xFFD043E5;
                    break;
                case 4: // dark green
                    color = 0xFF006940;
                    break;
                case 5: // Grey #1
                    color = 0xFF808080;
                    break;
                case 6: // medium blue
                    color = 0xFF2F95E5;
                    break;
                case 7: // light blue
                    color = 0xFFBFABFF;
                    break;
                case 8: // brown
                    color = 0xFF405400;
                    break;
                case 9: // orange
                    color = 0xFFD06A1A;
                    break;
                case 10: // grey #2
                    color = 0xFF808080;
                    break;
                case 11: // pink
                    color = 0xFFFF96BF;
                    break;
                case 12: // green
                    color = 0xFF2FBC1A;
                    break;
                case 13: // yellow
                    color = 0xFFBFD35A;
                    break;
                case 14: // aqua
                    color = 0xFF6FE8BF;
                    break;
                case 15: // white
                    color = 0xFFFFFFFF;
                    break;
                }

                for (int i = 0 ; i < 8; i++)
                {
                    _pixelBuffer[page][(x * 8) + i + (y * 320)] = color;
                }
            }

        }
    }

    void MainWindow::ProcessPixelOps()
    {
#if 0
        EnterCriticalSection(&_csPixelOp);

        while (_vecPixelOps.size() > 0)
        {
            PixelOp p = *_vecPixelOps.begin();
            _vecPixelOps.erase(_vecPixelOps.begin());
            
            PlotPixel(p.row, p.col, p.color);
        }

        _vgaBitmap.Invalidate();

        LeaveCriticalSection(&_csPixelOp);
#endif
    }

    void MainWindow::PlotPixel(int page, uint16_t row, uint16_t col, uint8_t color, bool twice)
    {
        uint32_t newcolor; // = 0xFF000000;
        uint32_t intensity = 0xFF;

        uint32_t rowmax = 384;

        const uint32_t colorarray[16] = 
        { 
            0xFF000000, // 0 - black
            0xFFEA5D15, // 1 - orange
            0xFF43C300, // 2 - green
            0x00000000, // 3
            0x00000000, // 4
            0xFFB63DFF, // 5 - violet
            0xFF10A4E3, // 6 - cyan
            0x00000000, // 7
            0x00000000, // 8
            0x00000000, // 9
            0x00000000, // 10
            0x00000000, // 11
            0x00000000, // 12
            0x00000000, // 13
            0x00000000, // 14
            0xFFFFFFFF, // 15 - White
        };

        if (_mixed && !_textMode)
        {
            rowmax = 336;
        }

        if (row >= rowmax || col >= 320)
        {
            return;
        }

        newcolor = colorarray[color & 0xF];

        if (color & 4)
        {
            newcolor |= intensity;
        }

        if (color & 2)
        {
            newcolor |= (intensity << 8);
        }

        if (color & 1)
        {
            newcolor |= (intensity << 16);
        }
        
        _pixelBuffer[page][col + (row * 320)] = newcolor;
        if (twice)
        {
            _pixelBuffer[page][col + ((row+1) * 320)] = newcolor;
        }
    }

    IAsyncAction MainWindow::btnAddBreakpoint_Click(IInspectable const& sender, RoutedEventArgs const& args)
    {
        wstring str;
        wstring str2;

        uint16_t i16;
        uint16_t i16_2;
        uint8_t i8 = 0;
        WCHAR wcText[64];

        dialogBreakpoints().PrimaryButtonText(L"OK");
        dialogBreakpoints().IsPrimaryButtonEnabled(false);

        dialogBreakpoints().SecondaryButtonText(L"Cancel");
        txtBreakValue().Text(L"");
        
        FocusManager::TryFocusAsync(txtBreakValue(), FocusState::Programmatic);
        auto result = co_await dialogBreakpoints().ShowAsync();

        if (result == ContentDialogResult::Primary)
        {

            Badger6502Emulator::BreakPointItem bp;
            str = txtBreakValue().Text().c_str();
            str2 = txtBreakValue2().Text().c_str();

            ValidateAndAssignValue(str, i16);
            ValidateAndAssignValue(str2, i16_2);

            switch (comboBreak().SelectedIndex())
            {
            case 0: // PC
                bp.Data(i16);
                bp.RangeStart(i16);
                bp.RangeEnd(i16_2);
                bp.Target(BreakPointTarget::PC);
                swprintf_s(wcText, _countof(wcText), L"PC == $%04X", i16);

                break;
            case 1: // SP
                bp.Data(i16);
                bp.Target(BreakPointTarget::SP);
                swprintf_s(wcText, _countof(wcText), L"SP == $%04X", i16);

                break;
            case 2: // A
                ValidateAndAssignValue(str, i8);

                bp.Data(i8);
                bp.Target(BreakPointTarget::A);
                swprintf_s(wcText, _countof(wcText), L" A == $%02X", i8);

                break;
            case 3: // X
                bp.Data(i8);
                bp.Target(BreakPointTarget::X);
                swprintf_s(wcText, _countof(wcText), L" X == $%02X", i8);
                break;
            case 4: // Y
                bp.Data(i8);
                bp.Target(BreakPointTarget::Y);
                swprintf_s(wcText, _countof(wcText), L" Y == $%02X", i8);
                break;
            case 5: // OpCode
                bp.Data(i8);
                bp.Target(BreakPointTarget::OpCode);
                swprintf_s(wcText, _countof(wcText), L" OpCode == $%02X", i8);
                break;
            case 6: // Memory Write
                bp.Data(i16);
                bp.RangeStart(i16);
                bp.RangeEnd(i16_2);
                bp.Target(BreakPointTarget::MemoryWrite);
                swprintf_s(wcText, _countof(wcText), L" MemoryWrite to $%04X-$%04X", i16, i16_2);
                break;
            case 7: // jump range
                bp.RangeStart(i16);
                bp.RangeEnd(i16_2);
                bp.Target(BreakPointTarget::JsrRange);
                swprintf_s(wcText, _countof(wcText), L" JumpRange $%04X-$%04X", i16,i16_2);
            case 8:
                bp.Data(i16);
                bp.Target(BreakPointTarget::Address);
                swprintf_s(wcText, _countof(wcText), L" Address $%04X-$%04X", i16, i16_2);
                break;
            }

            bp.Content(box_value(wcText));

            EnterCriticalSection(&_cs);
            BreakPoints().Append(bp);
            BreakPointItem* rawbp = winrt::get_self<BreakPointItem>(bp);
            _vecBreakPointsFast.push_back(rawbp);
            _countBreakPoints++;
            LeaveCriticalSection(&_cs);
        }
    }

    void MainWindow::btnRemoveBreakpoint_Click(IInspectable const&, RoutedEventArgs const&)
    {
        int index = listBreakPoints().SelectedIndex();

        if (index >= 0)
        {
            EnterCriticalSection(&_cs);
            _vecBreakPoints.RemoveAt(index);
            _vecBreakPointsFast.erase(_vecBreakPointsFast.begin() + index);
            _countBreakPoints--;
            LeaveCriticalSection(&_cs);
        }
    }

    void MainWindow::txtBreakValue_changed(IInspectable const&, TextChangedEventArgs const&)
    {
        wstring str;
        str = txtBreakValue().Text();

        if (IsValidNumber(str, nullptr))
        {
            dialogBreakpoints().IsPrimaryButtonEnabled(true);
        }
        else
        {
            dialogBreakpoints().IsPrimaryButtonEnabled(false);
        }
    }

    void MainWindow::txtBreakValue2_changed(IInspectable const&, TextChangedEventArgs const&)
    {
        wstring str;
        str = txtBreakValue().Text();

        if (IsValidNumber(str, nullptr))
        {
            dialogBreakpoints().IsPrimaryButtonEnabled(true);
        }
        else
        {
            dialogBreakpoints().IsPrimaryButtonEnabled(false);
        }
    }


    bool MainWindow::IsValidNumber(wstring const& str, bool* pHex)
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

    bool MainWindow::EvaluateBreakpoint(CPU* pCPU, uint16_t addr, uint8_t data, bool read)
    {
        for (uint32_t i = 0; i < _countBreakPoints; i++)
        {
            //BreakPointItem* bp = winrt::get_self<BreakPointItem>(_vecBreakPoints.GetAt(i));
            BreakPointItem* bp = _vecBreakPointsFast[i];
            if (bp->EvaluateBreakpoint(pCPU, addr, data, read))
            {
                return true;
            }
        }
        return false;
    }

    std::string MainWindow::GetDiskImage()
    {
        PWSTR pszFileName = nullptr;
        PWSTR pszFilePath = nullptr;
        IShellItem* pItem = nullptr;
        IFileOpenDialog* pFileOpen = nullptr;
        DWORD dwFlags = 0;
        std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> conv;
        string filename;

        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Create the FileOpenDialog object.
        hr = CoCreateInstance(CLSID_FileOpenDialog, NULL, CLSCTX_ALL, IID_IFileOpenDialog, reinterpret_cast<void**>(&pFileOpen));
        if (FAILED(hr))
        {
            goto exit;
        }

        // Before setting, always get the options first in order 
        // not to override existing options.
        hr = pFileOpen->GetOptions(&dwFlags);
        if (FAILED(hr))
        {
            goto exit;
        }
        // In this case, get shell items only for file system items.
        hr = pFileOpen->SetOptions(dwFlags | FOS_FILEMUSTEXIST);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Show the Open dialog box.
        hr = pFileOpen->Show(NULL);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pFileOpen->GetResult(&pItem);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pItem->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &pszFileName);
        if (FAILED(hr))
        {
            goto exit;
        }

        filename = conv.to_bytes(pszFileName);

    exit:

        if (pszFilePath)
        {
            CoTaskMemFree(pszFilePath);
        }

        if (pszFileName)
        {
            CoTaskMemFree(pszFileName);
        }

        if (pItem)
        {
            pItem->Release();
        }

        if (pFileOpen)
        {
            pFileOpen->Release();
        }

        CoUninitialize();

        return filename;
    }

    void MainWindow::miLoadROM_Click(IInspectable const&, RoutedEventArgs const&)
    {
        PWSTR pszFileName = nullptr;
        PWSTR pszFilePath = nullptr;
        IShellItem* pItem = nullptr;
        IFileOpenDialog* pFileOpen = nullptr;
        DWORD dwFlags = 0;
        std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> conv;
        string filename;

        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Create the FileOpenDialog object.
        hr = CoCreateInstance(CLSID_FileOpenDialog, NULL, CLSCTX_ALL, IID_IFileOpenDialog, reinterpret_cast<void**>(&pFileOpen));
        if (FAILED(hr))
        {
            goto exit;
        }

        // Before setting, always get the options first in order 
        // not to override existing options.
        hr = pFileOpen->GetOptions(&dwFlags);
        if (FAILED(hr))
        {
            goto exit;
        }
        // In this case, get shell items only for file system items.
        hr = pFileOpen->SetOptions(dwFlags | FOS_FILEMUSTEXIST);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Show the Open dialog box.
        hr = pFileOpen->Show(NULL);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pFileOpen->GetResult(&pItem);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pItem->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &pszFileName);
        if (FAILED(hr))
        {
            goto exit;
        }

        filename = conv.to_bytes(pszFileName);

        if (_vm.LoadBinaryFile(filename.c_str()))
        {
            string dbg;
            string lst;

            UpdateExecutionState(ExecutionState::Stopped);

            size_t offset = filename.find_last_of('.');
            dbg = filename.substr(0, offset) + ".woz";
            lst = filename.substr(0, offset) + ".lst";

            DebugSymbols::Clear();
            _listingContents.clear();

            _fHasSymbols = DebugSymbols::LoadDebugFile(dbg.c_str());

#ifdef USE_LISTING
            _fHasListing = DebugSymbols::LoadListingFile(lst.c_str(), _listingContents);
            _wlistingContents = conv.from_bytes(_listingContents);
#else
            _fHasListing = true;
            _wlistingContents = _vm.Disassemble();
#endif

            SetSourceContents();

            _vm.GetCPU()->Reset();
        }
    exit:

        if (pszFilePath)
        {
            CoTaskMemFree(pszFilePath);
        }

        if (pszFileName)
        {
            CoTaskMemFree(pszFileName);
        }

        if (pItem)
        {
            pItem->Release();
        }

        if (pFileOpen)
        {
            pFileOpen->Release();
        }

        CoUninitialize();
    }

    void MainWindow::miLoadRAM_Click(IInspectable const&, RoutedEventArgs const&)
    {
        IAsyncOperation<ContentDialogResult> asyncOp;
        PWSTR pszFileName = nullptr;
        PWSTR pszFilePath = nullptr;
        IShellItem* pItem = nullptr;
        IFileOpenDialog* pFileOpen = nullptr;
        DWORD dwFlags = 0;
        std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> conv;
        string filename;

        // Create a new ContentDialog
        ContentDialog dialog;

        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Create the FileOpenDialog object.
        hr = CoCreateInstance(CLSID_FileOpenDialog, NULL, CLSCTX_ALL, IID_IFileOpenDialog, reinterpret_cast<void**>(&pFileOpen));
        if (FAILED(hr))
        {
            goto exit;
        }

        // Before setting, always get the options first in order 
        // not to override existing options.
        hr = pFileOpen->GetOptions(&dwFlags);
        if (FAILED(hr))
        {
            goto exit;
        }
        // In this case, get shell items only for file system items.
        hr = pFileOpen->SetOptions(dwFlags | FOS_FILEMUSTEXIST);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Show the Open dialog box.
        hr = pFileOpen->Show(NULL);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pFileOpen->GetResult(&pItem);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pItem->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &pszFileName);
        if (FAILED(hr))
        {
            goto exit;
        }

        filename = conv.to_bytes(pszFileName);

        if (_vm.LoadBinaryFile(filename.c_str(), 0x4000))
        {
            string dbg;
            string lst;

            UpdateExecutionState(ExecutionState::Stopped);

            size_t offset = filename.find_last_of('.');
            dbg = filename.substr(0, offset) + ".dbg";
            lst = filename.substr(0, offset) + ".lst";

            //DebugSymbols::Clear();
            //_listingContents.clear();

            _fHasSymbols = DebugSymbols::LoadDebugFile(dbg.c_str());

            _fHasListing = true;
            _wlistingContents = _vm.Disassemble();

            SetSourceContents();

            _vm.GetCPU()->Reset();
        }

    exit:

        if (pszFilePath)
        {
            CoTaskMemFree(pszFilePath);
        }

        if (pszFileName)
        {
            CoTaskMemFree(pszFileName);
        }

        if (pItem)
        {
            pItem->Release();
        }

        if (pFileOpen)
        {
            pFileOpen->Release();
        }

        CoUninitialize();
    }


    void MainWindow::miLoadROMDISK_Click(IInspectable const&, RoutedEventArgs const&)
    {
        PWSTR pszFileName = nullptr;
        PWSTR pszFilePath = nullptr;
        IShellItem* pItem = nullptr;
        IFileOpenDialog* pFileOpen = nullptr;
        DWORD dwFlags = 0;
        std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> conv;
        string filename;

        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Create the FileOpenDialog object.
        hr = CoCreateInstance(CLSID_FileOpenDialog, NULL, CLSCTX_ALL, IID_IFileOpenDialog, reinterpret_cast<void**>(&pFileOpen));
        if (FAILED(hr))
        {
            goto exit;
        }

        // Before setting, always get the options first in order 
        // not to override existing options.
        hr = pFileOpen->GetOptions(&dwFlags);
        if (FAILED(hr))
        {
            goto exit;
        }
        // In this case, get shell items only for file system items.
        hr = pFileOpen->SetOptions(dwFlags | FOS_FILEMUSTEXIST);
        if (FAILED(hr))
        {
            goto exit;
        }

        // Show the Open dialog box.
        hr = pFileOpen->Show(NULL);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pFileOpen->GetResult(&pItem);
        if (FAILED(hr))
        {
            goto exit;
        }

        hr = pItem->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &pszFileName);
        if (FAILED(hr))
        {
            goto exit;
        }

        filename = conv.to_bytes(pszFileName);

        if (_vm.LoadRomDiskFile(filename.c_str()))
        {
            string dbg;
            string lst;

            UpdateExecutionState(ExecutionState::Stopped);

            size_t offset = filename.find_last_of('.');
            dbg = filename.substr(0, offset) + ".dbg";
            lst = filename.substr(0, offset) + ".lst";

            //DebugSymbols::Clear();
            //_listingContents.clear();

            _fHasSymbols = DebugSymbols::LoadDebugFile(dbg.c_str());

            _fHasListing = true;
            _wlistingContents = _vm.Disassemble();

            SetSourceContents();

            _vm.GetCPU()->Reset();
        }

    exit:

        if (pszFilePath)
        {
            CoTaskMemFree(pszFilePath);
        }

        if (pszFileName)
        {
            CoTaskMemFree(pszFileName);
        }

        if (pItem)
        {
            pItem->Release();
        }

        if (pFileOpen)
        {
            pFileOpen->Release();
        }

        CoUninitialize();
    }

    void MainWindow::clock_OnClicked(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto item = sender.as<MenuFlyoutItem>();
        wchar_t w = item.Name().c_str()[1];

        switch (w)
        {
        case L'0':
            _clockspeed = 0;
            break;
        case L'1':
            _clockspeed = 1024000;
            break;
        case L'A':
            _clockspeed = 1573437;
            break;
        case L'3':
            _clockspeed = 3000000;
            break;
        }
    }

    void MainWindow::disk1Insert_OnClicked(IInspectable const& , RoutedEventArgs const&)
    {
        bool inserted = false;

        WozDisk* pDisk = _vm.GetDriveEmulator()->GetDisk(0);
        if (pDisk->IsDiskPresent())
        {
            pDisk->RemoveDisk();
        }

        std::string f = GetDiskImage();

        if (f.size() > 0)
        {
            inserted = pDisk->InsertDisk(f.c_str());
        }

        if (inserted)
        {
            WCHAR wcBuf[MAX_PATH];
            size_t pos = f.find_last_of('\\');
            if (pos > 0)
            {
                f = f.substr(pos+1);
            }

            swprintf_s(wcBuf, _countof(wcBuf), L"Disk 1 (%S)", f.c_str());
            menuDisk1Title().Text(wcBuf);
        }
        else
        {
            menuDisk1Title().Text(L"Disk 1 (Empty)");
        }
    }

    void MainWindow::disk1Remove_OnClicked(IInspectable const& , RoutedEventArgs const& )
    {
        WozDisk* pDisk = _vm.GetDriveEmulator()->GetDisk(0);
        if (pDisk->IsDiskPresent())
        {
            pDisk->RemoveDisk();
            menuDisk1Title().Text(L"Disk 1 (Empty)");
        }
    }

    void MainWindow::disk2Insert_OnClicked(IInspectable const& , RoutedEventArgs const& )
    {
        bool inserted = false;

        WozDisk* pDisk = _vm.GetDriveEmulator()->GetDisk(1);
        if (pDisk->IsDiskPresent())
        {
            pDisk->RemoveDisk();
        }

        std::string f = GetDiskImage();

        if (f.size() > 0)
        {
            inserted = pDisk->InsertDisk(f.c_str());
        }

        if (inserted)
        {
            WCHAR wcBuf[MAX_PATH];
            size_t pos = f.find_last_of('\\');
            if (pos > 0)
            {
                f = f.substr(pos+1);
            }

            swprintf_s(wcBuf, _countof(wcBuf), L"Disk 2 (%S)", f.c_str());
            menuDisk2Title().Text(wcBuf);
        }
        else
        {
            menuDisk2Title().Text(L"Disk 2 (Empty)");
        }
    }
    void MainWindow::disk2Remove_OnClicked(IInspectable const& , RoutedEventArgs const& )
    {
        WozDisk* pDisk = _vm.GetDriveEmulator()->GetDisk(1);
        if (pDisk->IsDiskPresent())
        {
            pDisk->RemoveDisk();
            menuDisk2Title().Text(L"Disk 2 (Empty)");
        }
    }

#if 0
    void MainWindow::myButton_Click(IInspectable const&, RoutedEventArgs const&)
    {
        myButton().Content(box_value(L"Clicked"));
    }
#endif

    void MainWindow::ProcessHires(int page)
    {
        if (false == TryEnterCriticalSection(&_cs))
        {
            return;
        }

        for (auto pItem : _mapHires[page])
        {
            _hires[page][pItem.second.address] = pItem.second.data;

            //uint8_t y = pixelindex[pItem.second.address] & 0xFF;
        }

        _mapHires[page].clear();
        LeaveCriticalSection(&_cs);
    }

    void MainWindow::DrawText(int page)
    {
        if (_textDirty[page])
        {
            _textDirty[page] = false;

            if (_lores && (!_textMode || _mixed))
            {
                draw_lores_line_color_apple(page);
            }

            if (_mixed || _textMode)
            {
                draw_text_eb6502(page);
            } 
        }
    }

    void MainWindow::ProcessText(int page)
    {   
        /*
        if (_textMode == 0 && _mixed == 0 && _lores == 0)
        {
            return;
        }
        */

        if (false == TryEnterCriticalSection(&_cs))
        {
            return;
        }

        for (auto pItem : _mapText[page])
        {
            _text[page][pItem.second.address] = pItem.second.data;
            _textDirty[page] = true;
        }
        _mapText[page].clear();
        LeaveCriticalSection(&_cs);
    }
}
