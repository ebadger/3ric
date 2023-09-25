#pragma once

#pragma push_macro("GetCurrentTime")
#undef GetCurrentTime

#include "MainWindow.g.h"
#include "vm.h"
#include "symbols.h"
#include <vector>
#include <string>
#include <locale>
#include <codecvt>
#include "BreakPointItem.h"
#include "ResizeBorder.h"
#include "MappedFile.h"
#include "sdcard.h"

using namespace std;

#ifndef _SILENCE_CXX17_CODECVT_HEADER_DEPRECATION_WARNING
#define _SILENCE_CXX17_CODECVT_HEADER_DEPRECATION_WARNING
#endif

#pragma pop_macro("GetCurrentTime")

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Input;
using namespace Microsoft::UI::Xaml::Media::Imaging;
using namespace Microsoft::UI::Dispatching;
using namespace Microsoft::UI::Text;
using namespace Windows::Foundation;
using namespace winrt::Windows::Graphics::Imaging;
using namespace winrt::Windows::Storage::Streams;

namespace winrt::Badger6502Emulator::implementation
{

    struct MainWindow : MainWindowT<MainWindow>
    {
        MainWindow();
        ~MainWindow();
        void Cleanup();

        int32_t MyProperty();
        void MyProperty(int32_t value);

        Windows::Foundation::Collections::IObservableVector<Badger6502Emulator::BreakPointItem> BreakPoints();

        struct QueueItem
        {
            uint16_t address;
            uint8_t data;
        };

        enum ExecutionState
        {
            Run = 0,
            Running = 1,
            Stop = 2,
            Stopped = 3,
            Stepping = 4,
            Reset = 5,
            Quit = 6
        };

        //void myButton_Click(Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
        HANDLE _hThread = INVALID_HANDLE_VALUE;

        static VM _vm;
        static vector<uint8_t> _vecKeys;
        static vector<QueueItem> _vecHires1;
        static vector<QueueItem> _vecHires2;
        static vector<QueueItem> _vecText1;
        static vector<QueueItem> _vecText2;

        static CRITICAL_SECTION _cs;
        static CRITICAL_SECTION _csSource;
        static CRITICAL_SECTION _csEdit;
        static CRITICAL_SECTION _csDebug;
        static CRITICAL_SECTION _csPixelOp;
        static CRITICAL_SECTION _csPS2;
        static CRITICAL_SECTION _csBreakpoints;
        static CRITICAL_SECTION _csHires1;
        static CRITICAL_SECTION _csHires2;
        static CRITICAL_SECTION _csText1;
        static CRITICAL_SECTION _csText2;

        static bool _fHasSymbols;
        static bool _fHasListing;
        static ExecutionState _executionState;

        static string _sourceFilename;
        static string _sourceContents;
        static string _listingContents;
        static wstring _wlistingContents;
        static Microsoft::UI::Dispatching::DispatcherQueue *_pQueue;

        Microsoft::UI::Xaml::Media::Imaging::WriteableBitmap _vgaBitmap = {nullptr};
        Microsoft::UI::Xaml::Media::Imaging::WriteableBitmap _vgaBitmapTextMode = { nullptr };
        uint32_t* _pixelBuffer = nullptr;
        uint32_t* _pixelBufferTextMode = nullptr;

        static DWORD staticVMThreadProc(LPVOID);
        DWORD VMThreadProc();
        void UpdateMenuByState();
        void UpdateExecutionState(ExecutionState state);
        void HighlightSource();
        bool ValidateAndAssignValue(wstring const&, uint8_t &);
        bool ValidateAndAssignValue(wstring const&, uint16_t &);
        bool ValidateAndAssignBit(wstring const& str, uint8_t& val);
        bool IsValidNumber(wstring const& hstr, bool *isHex);
        bool EvaluateBreakpoint(CPU *pCPU, uint16_t addr, uint8_t datas);
        void SetSourceContents();

        void InitVGA();
        void ProcessPixelOps();
        void PlotPixel(uint16_t row, uint16_t col, uint8_t color);
        void draw_hires_line_color_apple(uint8_t y, uint8_t* pHires);
        void draw_hires_line_eb6502(uint8_t y, uint8_t* pHires);
        void draw_text_eb6502(uint8_t* pText);
        void ProcessHires1();
        void ProcessHires2();
        void ProcessText1();
        void ProcessText2();
        void RefreshVideo();
        void DrawText();

        Windows::Foundation::IAsyncAction clickSetRegister(IInspectable const& sender, RoutedEventArgs const& e);
        void clickMemory(IInspectable const& sender, RoutedEventArgs const& e);
        void dialogRegisters_Opened(IInspectable const& sender, ContentDialogOpenedEventArgs const& e);
        IAsyncAction btnAddBreakpoint_Click(IInspectable const& sender, RoutedEventArgs const& args);
        void btnRemoveBreakpoint_Click(IInspectable const& sender, RoutedEventArgs const& args);
        void txtBreakValue_changed(IInspectable const& sender, TextChangedEventArgs const& args);
        void miLoadROM_Click(IInspectable const& sender, RoutedEventArgs const& args);
        void miLoadRAM_Click(IInspectable const& sender, RoutedEventArgs const& args);
        void miLoadROMDISK_Click(IInspectable const& sender, RoutedEventArgs const& args);        
        void clock_OnClicked(IInspectable const& sender, RoutedEventArgs const& args);

        Windows::Foundation::Collections::IObservableVector<Badger6502Emulator::BreakPointItem> _vecBreakPoints;
        std::vector<BreakPointItem*> _vecBreakPointsFast;

        MappedFile _fontFile;
        SDCard _sdcard;

        uint8_t _countBreakPoints = 0;
        uint32_t _clockspeed = 0;
        double _freqActual = 0.0;
        bool _firenmi = false;
        //int _vidMode = 1;

        int _gfxPage = 0;
        int _textMode = 0;
        int _font = 0;

        uint8_t _hires1[0x2000];
        uint8_t _hires2[0x2000];
        uint8_t _text1[0x400];
        uint8_t _text2[0x400];
        bool _textDirty = false;

        uint16_t pixelindex[0x2000] = { 0 };
    };
}

namespace winrt::Badger6502Emulator::factory_implementation
{
    struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
    {
    };
}
