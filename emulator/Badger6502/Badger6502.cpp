// Badger6502.cpp : Defines the entry point for the application.
//

#include "framework.h"
#include "Badger6502.h"
#include "winuser.h"
#include "vm.h"
#include "symbols.h"
#include <vector>
#include <string>
#include <corecrt_wstring.h>
#include <CommCtrl.h>

using namespace std;

#define MAX_LOADSTRING 100

VM vm;
HWND _hWnd = nullptr;
HWND _hwndEdit = nullptr;
HWND _hwndDebug = nullptr;
HWND _hwndSource = nullptr;
HANDLE _hThread = INVALID_HANDLE_VALUE;
vector<uint8_t> _vecKeys;
CRITICAL_SECTION _cs;
CRITICAL_SECTION _csSource;
bool _fHasSymbols = false;
bool _fHasListing = false;

string _sourceFilename;
string _sourceContents;
string _listingContents;

LONG_PTR _wndProcEdit = NULL;

#define TXCOUNT 38400 // Total pixels/2 (since we have 2 pixels per byte)
uint8_t vga_buffer[TXCOUNT];

enum class ExecutionState
{
    Run      = 0,
    Running  = 1,
    Stop     = 2,
    Stopped  = 3,
    Stepping = 4,
    Reset    = 5,
    Quit     = 6
};

ExecutionState _executionState = ExecutionState::Stopped;

// Global Variables:
HINSTANCE _hInst;                                // current instance
WCHAR szTitle[MAX_LOADSTRING];                  // The title bar text
WCHAR szWindowClass[MAX_LOADSTRING];            // the main window class name

// Forward declarations of functions included in this code module:
ATOM                MyRegisterClass(HINSTANCE hInstance);
BOOL                InitInstance(HINSTANCE, int);
LRESULT CALLBACK    WndProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK    About(HWND, UINT, WPARAM, LPARAM);

LRESULT CALLBACK EditWndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
void UpdateExecutionState(ExecutionState state);

void HighlightSource()
{
    uint32_t line = 0;
    size_t o1 = 0;
    string filename;
    CPU* pCPU = vm.GetCPU();

    if (_listingContents.length() > 0)
    {

        if (DebugSymbols::AddressToSourceInfo(pCPU->PC, line, filename))
        {
            if (filename.length() > 0 && filename.compare(_sourceFilename) != 0)
            {
                _sourceFilename = filename;
            }
        }

        if (DebugSymbols::AddressToListingInfo(pCPU->PC, _sourceFilename, o1))
        {
            int outLength = GetWindowTextLength(_hwndSource);
            if (outLength == 0)
            {
                SendMessageA(_hwndSource, WM_SETTEXT, 0, (LPARAM)_listingContents.c_str());
            }

            SendMessageA(_hwndSource, EM_SETSEL, o1, o1);
            LRESULT line2 = SendMessageA(_hwndSource, EM_LINEFROMCHAR, o1, 0);

            LRESULT linestart = SendMessageA(_hwndSource, EM_LINEINDEX, (WPARAM)line2, 0);
            LRESULT lineend = SendMessageA(_hwndSource, EM_LINEINDEX, (WPARAM)line2 + 1, 0);
            LRESULT lineahead = SendMessageA(_hwndSource, EM_LINEINDEX, (WPARAM)line2 + 10, 0);

            SendMessageA(_hwndSource, WM_SETFOCUS, 0, 0);
            SendMessageA(_hwndSource, EM_SETSEL, lineahead, lineahead);
            SendMessageA(_hwndSource, EM_SCROLLCARET, 0, 0);
            SendMessageA(_hwndSource, EM_SETSEL, linestart, lineend - 2);
            SendMessageA(_hwndSource, EM_SCROLLCARET, 0, 0);
            SendMessageA(_hwndEdit, WM_SETFOCUS, 0, 0);
        }
        
    }

    DebugSymbols::AddressToSourceInfo(pCPU->PC, line, filename);
}

DWORD WINAPI VMThread(LPVOID)
{
    CPU* pCPU = vm.GetCPU();
    ULONGLONG dwTicks = 0;
    DWORD dwDebugLines = 0;
   
    vm.CallbackReceiveChar = [](uint8_t byte) -> void {
        byte;

        char text[2] = { 0 };
        text[0] = (char)byte;

        HideCaret(_hwndEdit);
        // get the current selection
        DWORD StartPos, EndPos;
        SendMessage(_hwndEdit, EM_GETSEL, reinterpret_cast<WPARAM>(&StartPos), reinterpret_cast<WPARAM>(&EndPos));

        // move the caret to the end of the text
        int outLength = GetWindowTextLength(_hwndEdit);
        SendMessage(_hwndEdit, EM_SETSEL, outLength, outLength);

        // insert the text at the new caret position
        SendMessageA(_hwndEdit, EM_REPLACESEL, FALSE , reinterpret_cast<LPARAM>(text));
        ShowCaret(_hwndEdit);

        return;
    };

    vm.CallbackDebugString = [&dwDebugLines](char* str) -> void {
        // get the current selection
        str;
        
        if (dwDebugLines++ % 500 == 0)
        {
            // move the caret to the end of the text
            int outLength = GetWindowTextLength(_hwndDebug) / 2;
            SendMessage(_hwndDebug, EM_SETSEL, 0, outLength);

            // insert the text at the new caret position
            SendMessageA(_hwndDebug, EM_REPLACESEL, FALSE, reinterpret_cast<LPARAM>(L""));
        }

        DWORD StartPos, EndPos;
        SendMessage(_hwndDebug, EM_GETSEL, reinterpret_cast<WPARAM>(&StartPos), reinterpret_cast<WPARAM>(&EndPos));

        // move the caret to the end of the text
        int outLength = GetWindowTextLength(_hwndDebug);
        SendMessage(_hwndDebug, EM_SETSEL, outLength, outLength);

        // insert the text at the new caret position
        SendMessageA(_hwndDebug, EM_REPLACESEL, FALSE, reinterpret_cast<LPARAM>(str));
        
        };

    //if (vm.LoadBinaryFile("c:\\6502_65C02_functional_tests\\6502_functional_test.bin", 0))
    if (vm.LoadBinaryFile("c:\\eb6502\\targets\\badger6502.bin", 0x8000))
    {
        _fHasSymbols = DebugSymbols::LoadDebugFile("c:\\eb6502\\targets\\badger6502.dbg");
        _fHasListing = DebugSymbols::LoadListingFile("c:\\eb6502\\targets\\badger6502.lst", _listingContents);

        pCPU->Reset();

        HighlightSource();

        while (true)
        {
           
#if 0
            if (pCPU->PC == 0xA0A6)
            {
                UpdateExecutionState(ExecutionState::Stop);
            }
#endif

            switch (_executionState)
            {
            case ExecutionState::Stopped:
                Sleep(50);
                continue;

            case ExecutionState::Reset:
                pCPU->Reset();
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

            case ExecutionState::Quit:
                return 0;
            }


            pCPU->Step();

            if (_executionState == ExecutionState::Stopped)
            {
                HighlightSource();
            }

            EnterCriticalSection(&_cs);
            while (_vecKeys.size() > 0 && GetTickCount64() - dwTicks > 0)
            {
                uint8_t key = _vecKeys[0];

                if (true == vm.SimulateSerialKey(key))
                {
                    _vecKeys.erase(_vecKeys.begin());
                    dwTicks = GetTickCount64();
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

void UpdateMenuByState()
{
    HMENU hMenu = GetMenu(_hWnd);//LoadMenu(_hInst, MAKEINTRESOURCE(IDC_BADGER6502));

    //HMENU hMenu = GetSubMenu(hResMenu, 0);

    switch (_executionState)
    {
    case ExecutionState::Run:
    case ExecutionState::Running:
    case ExecutionState::Reset:
        EnableMenuItem(hMenu, ID_EXEC_RUN, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
        EnableMenuItem(hMenu, ID_EXEC_STEP, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
        EnableMenuItem(hMenu, ID_EXEC_BREAK, MF_BYCOMMAND | MF_ENABLED);
        break;

    case ExecutionState::Stop:
    case ExecutionState::Stopped:
    case ExecutionState::Stepping:
        EnableMenuItem(hMenu, ID_EXEC_RUN, MF_BYCOMMAND | MF_ENABLED);
        EnableMenuItem(hMenu, ID_EXEC_STEP, MF_BYCOMMAND | MF_ENABLED);
        EnableMenuItem(hMenu, ID_EXEC_BREAK, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
        break;

    }
}

void UpdateExecutionState(ExecutionState state)
{
    _executionState = state;
    UpdateMenuByState();
    
    switch (state)
    {
    case ExecutionState::Reset:
    case ExecutionState::Run:
    case ExecutionState::Running:
        SetWindowText(_hWnd, L"Badger6502 - Running");
        break;
    case ExecutionState::Stepping:
    case ExecutionState::Stopped:
    case ExecutionState::Stop:
        SetWindowText(_hWnd, L"Badger6502 - Stopped");
        break;
    }
}

int APIENTRY wWinMain(_In_ HINSTANCE hInstance,
                     _In_opt_ HINSTANCE hPrevInstance,
                     _In_ LPWSTR    lpCmdLine,
                     _In_ int       nCmdShow)
{
    UNREFERENCED_PARAMETER(hPrevInstance);
    UNREFERENCED_PARAMETER(lpCmdLine);

    InitializeCriticalSection(&_cs);
    InitializeCriticalSection(&_csSource);

    UpdateExecutionState(ExecutionState::Stopped);

    _hThread = CreateThread(
        nullptr,                   // default security attributes
        0,                      // use default stack size  
        VMThread,            // thread function name
        nullptr,          // argument to thread function 
        0,                      // use default creation flags 
        nullptr);   // returns the thread identifier 

    // Initialize global strings
    LoadStringW(hInstance, IDS_APP_TITLE, szTitle, MAX_LOADSTRING);
    LoadStringW(hInstance, IDC_BADGER6502, szWindowClass, MAX_LOADSTRING);
    MyRegisterClass(hInstance);

    // Perform application initialization:
    if (!InitInstance (hInstance, nCmdShow))
    {
        return FALSE;
    }

    
    HACCEL hAccelTable = LoadAccelerators(hInstance, MAKEINTRESOURCE(IDC_BADGER6502));

    MSG msg;

    // Main message loop:
    while (GetMessage(&msg, nullptr, 0, 0))
    {
        if (!TranslateAccelerator(msg.hwnd, hAccelTable, &msg))
        {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }
    UpdateExecutionState(ExecutionState::Quit);
    if (_hThread)
    {
        WaitForSingleObject(_hThread, INFINITE);
    }

    DeleteCriticalSection(&_cs);
    DeleteCriticalSection(&_csSource);
    DebugSymbols::Clear();

    return (int) msg.wParam;
}



//
//  FUNCTION: MyRegisterClass()
//
//  PURPOSE: Registers the window class.
//
ATOM MyRegisterClass(HINSTANCE hInstance)
{
    WNDCLASSEXW wcex;

    wcex.cbSize = sizeof(WNDCLASSEX);

    wcex.style          = CS_HREDRAW | CS_VREDRAW;
    wcex.lpfnWndProc    = WndProc;
    wcex.cbClsExtra     = 0;
    wcex.cbWndExtra     = 0;
    wcex.hInstance      = hInstance;
    wcex.hIcon          = LoadIcon(hInstance, MAKEINTRESOURCE(IDI_BADGER6502));
    wcex.hCursor        = LoadCursor(nullptr, IDC_ARROW);
    wcex.hbrBackground  = (HBRUSH)(COLOR_WINDOW+1);
    wcex.lpszMenuName   = MAKEINTRESOURCEW(IDC_BADGER6502);
    wcex.lpszClassName  = szWindowClass;
    wcex.hIconSm        = LoadIcon(wcex.hInstance, MAKEINTRESOURCE(IDI_SMALL));

    return RegisterClassExW(&wcex);
}

void CreateEdit(HWND parent)
{
    _hwndEdit = CreateWindowEx(
        0, L"EDIT",     // predefined class 
        NULL,           // no window title 
        WS_CHILD | WS_VISIBLE | WS_VSCROLL |
        ES_LEFT | ES_MULTILINE | ES_AUTOVSCROLL,
        0, 0, 0, 0,     // set size in WM_SIZE message 
        parent,         // parent window 
        (HMENU)ID_ACIA, // edit control ID 
        (HINSTANCE)GetWindowLongPtr(parent, GWLP_HINSTANCE),
        NULL);        // pointer not needed     

    _wndProcEdit = SetWindowLongPtr(_hwndEdit, -4,(LONG_PTR)&EditWndProc);

    _hwndDebug = CreateWindowEx(
        0, L"EDIT",     // predefined class 
        NULL,           // no window title 
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_READONLY |
        ES_LEFT | ES_MULTILINE | ES_AUTOVSCROLL,
        0, 0, 0, 0,     // set size in WM_SIZE message 
        parent,         // parent window 
        (HMENU)ID_ACIA + 1, // edit control ID 
        (HINSTANCE)GetWindowLongPtr(parent, GWLP_HINSTANCE),
        NULL);        // pointer not needed     

    _hwndSource = CreateWindowEx(
        0, L"EDIT",     // predefined class 
        NULL,           // no window title 
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | WS_HSCROLL | ES_READONLY |
        ES_LEFT | ES_MULTILINE | ES_AUTOVSCROLL,
        0, 0, 0, 0,     // set size in WM_SIZE message 
        parent,         // parent window 
        (HMENU)ID_ACIA + 1, // edit control ID 
        (HINSTANCE)GetWindowLongPtr(parent, GWLP_HINSTANCE),
        NULL);        // pointer not needed     

        SendMessage(_hwndSource, EM_SETENDOFLINE, EC_ENDOFLINE_LF, 0);
        SendMessage(_hwndSource, EM_FMTLINES, FALSE, 0);


}
//
//   FUNCTION: InitInstance(HINSTANCE, int)
//
//   PURPOSE: Saves instance handle and creates main window
//
//   COMMENTS:
//
//        In this function, we save the instance handle in a global variable and
//        create and display the main program window.
//
BOOL InitInstance(HINSTANCE hInstance, int nCmdShow)
{
   _hInst = hInstance; // Store instance handle in our global variable

   _hWnd = CreateWindowW(szWindowClass, szTitle, WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT, 0, CW_USEDEFAULT, 0, nullptr, nullptr, hInstance, nullptr);

   if (!_hWnd)
   {
      return FALSE;
   }

   ShowWindow(_hWnd, nCmdShow);
   UpdateWindow(_hWnd);

   return TRUE;
}

LRESULT CALLBACK EditWndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message)
    {
    case WM_KEYDOWN:
        if (_executionState != ExecutionState::Running)
        {
            if (wParam == VK_F5)
            {
                UpdateExecutionState(ExecutionState::Run);
            }
            else if (wParam == VK_F11)
            {
                UpdateExecutionState(ExecutionState::Stepping);
            }
        }
        else
        {
            if (wParam == VK_PAUSE)
            {
                UpdateExecutionState(ExecutionState::Stop);
            }
        }
        return 0;

    case WM_KEYUP:

        return 0;

    case WM_CHAR:
        EnterCriticalSection(&_cs);
        _vecKeys.push_back((uint8_t)wParam);
        LeaveCriticalSection(&_cs);
        return 0;

    case WM_PASTE:
        if (!IsClipboardFormatAvailable(CF_TEXT))
            return 0;
        if (!OpenClipboard(_hwndEdit))
            return 0;

        HGLOBAL hglb = GetClipboardData(CF_TEXT);
        if (hglb != NULL)
        {
            LPVOID lpv = GlobalLock(hglb);
            char* str = (char *)lpv;

            if (str != NULL)
            {
                // Call the application-defined ReplaceSelection 
                // function to insert the text and repaint the 
                // window. 

                EnterCriticalSection(&_cs);
                while (*(char *)str)
                {
                    uint8_t v = *(uint8_t*)str;
                    if (v == '\n')
                    {
                        v = '\r';
                    }

                    _vecKeys.push_back(v);
                    str++;
                }
                LeaveCriticalSection(&_cs);
                GlobalUnlock(hglb);
            }
        }
        CloseClipboard();
        return 0;
    }
    return CallWindowProc((WNDPROC)_wndProcEdit, hWnd, message, wParam, lParam);
}

//
//  FUNCTION: WndProc(HWND, UINT, WPARAM, LPARAM)
//
//  PURPOSE: Processes messages for the main window.
//
//  WM_COMMAND  - process the application menu
//  WM_PAINT    - Paint the main window
//  WM_DESTROY  - post a quit message and return
//
//
LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message)
    {
    case WM_CREATE:
        CreateEdit(hWnd);
        break;
    case WM_COMMAND:
        {
            int wmId = LOWORD(wParam);
            // Parse the menu selections:
            switch (wmId)
            {
            case ID_EXEC_BREAK:
                UpdateExecutionState(ExecutionState::Stop);
                break;
            
            case ID_EXEC_STEP:
                UpdateExecutionState(ExecutionState::Stepping);
                break;

            case ID_EXEC_RUN:
                UpdateExecutionState(ExecutionState::Run);
                break;

            case ID_EXEC_RESET:
                UpdateExecutionState(ExecutionState::Reset);
                SetWindowText(_hwndDebug, nullptr);
                SetWindowText(_hwndEdit, nullptr);
                break;

            case ID_FILE_CLEAR:
                SetWindowText(_hwndDebug, nullptr);
                SetWindowText(_hwndEdit, nullptr);
                break;

            case IDM_ABOUT:
                DialogBox(_hInst, MAKEINTRESOURCE(IDD_ABOUTBOX), hWnd, About);
                break;
            case IDM_EXIT:
                DestroyWindow(hWnd);
                break;
            default:
                return DefWindowProc(hWnd, message, wParam, lParam);
            }
        }
        break;
    case WM_SETFOCUS:
        SetFocus(_hwndEdit);
        return 0;

    case WM_SIZE:
        // Make the edit control the size of the window's client area. 

        // left pane
        MoveWindow(_hwndEdit,
            0, 0,                  // starting x- and y-coordinates 
            LOWORD(lParam) / 2,    // width of client area 
            HIWORD(lParam),        // height of client area 
            TRUE);                 // repaint window 

        // right hand pane

        // top quadrant 
        MoveWindow(_hwndSource,
            LOWORD(lParam) / 2, 0,                  // starting x- and y-coordinates 
            LOWORD(lParam) - LOWORD(lParam) / 2,    // width of client area 
            (HIWORD(lParam) / 4) * 3,               // height of client area 
            TRUE);                                  // repaint window 

        //bottom quadrant
        MoveWindow(_hwndDebug,
            LOWORD(lParam) / 2, (HIWORD(lParam) / 4) * 3, // starting x- and y-coordinates 
            LOWORD(lParam) - LOWORD(lParam) / 2,          // width of client area 
            HIWORD(lParam) - (HIWORD(lParam) / 4) * 3,    // height of client area 
            TRUE);                                        // repaint window 

        return 0;

    case WM_PAINT:
        {
        }
        break;
    case WM_DESTROY:
        PostQuitMessage(0);
        break;

    default:
        return DefWindowProc(hWnd, message, wParam, lParam);
    }
    return 0;
}

// Message handler for about box.
INT_PTR CALLBACK About(HWND hDlg, UINT message, WPARAM wParam, LPARAM lParam)
{
    UNREFERENCED_PARAMETER(lParam);
    switch (message)
    {
    case WM_INITDIALOG:
        return (INT_PTR)TRUE;

    case WM_COMMAND:
        if (LOWORD(wParam) == IDOK || LOWORD(wParam) == IDCANCEL)
        {
            EndDialog(hDlg, LOWORD(wParam));
            return (INT_PTR)TRUE;
        }
        break;
    }
    return (INT_PTR)FALSE;
}
