#include <math.h>
#include <vector>
#include <stdio.h>
#include <pico/stdlib.h>
#include <pico/multicore.h>
#include "DriveEmulator.h"
#include "sdcard.h"
#include "console.h"
#include "hardware/uart.h"
#include "hardware/gpio.h"


// UART0 TX and RX pins
const uint UART_TX_PIN = 0;
const uint UART_RX_PIN = 1;

// D0-D7 : GPIO 6-13    - Data bus
// DCS   : GPIO 14      - Drive chip select
// PHI2  : GPIO 15      - PHI2
// RW    : GPIO 16      - R/W
// CCS   : GPIO 17      - Communication chip select
// A0-A4 : GPIO 18-21   - Address lines

#define GPIO_FIRST   6
#define GPIO_D0      6
#define GPIO_D1      7
#define GPIO_D2      8
#define GPIO_D3      9
#define GPIO_D4      10
#define GPIO_D5      11
#define GPIO_D6      12
#define GPIO_D7      13

#define GPIO_DCS     14
#define GPIO_PHI2    15
#define GPIO_RW      16
#define GPIO_CCS     17
#define GPIO_A0      18
#define GPIO_A1      19
#define GPIO_A2      20
#define GPIO_A3      21
#define GPIO_TEST    22
#define GPIO_LAST    22
#define GPIO_LED     25

uint32_t _maskData    = 0;
//const uint32_t _maskAddress = 0b00000000001111000000000000000000; 
uint64_t _cycleCount = 0;
bool _testMode = false;

DriveEmulator *_driveEmulator = nullptr;
SDCard *_sdCard = nullptr;
Console *_console = nullptr;

void init_uart(uint baudrate) {
    // Initialize UART0
    uart_init(uart0, baudrate);

    // Set the TX and RX pins by using the function gpio_set_function
    gpio_set_function(UART_TX_PIN, GPIO_FUNC_UART);
    gpio_set_function(UART_RX_PIN, GPIO_FUNC_UART);
}

void HandleCommunication(uint32_t bits, uint8_t address, bool fRW)
{
    uint32_t test_pattern[2] = {0x0F, 0xF0}; // test pattern
    uint32_t data = bits;
    uint32_t dataOut = 0;
    
    _console->PrintOut("addr=%02x\n", address);

    if (fRW) // read
    {
        // CPU reading, so output
        gpio_set_dir_out_masked(_maskData);
        
        switch(address)
        {
            case 0:
                // for now just output a test pattern
                // output from conole buffer
                gpio_put_masked(_maskData, (test_pattern[_cycleCount % 2] << GPIO_D0));
                break;
            case 1:
                // address 1 == byte count in pico buffer
                gpio_put_masked(_maskData, (test_pattern[_cycleCount % 2] << GPIO_D0));
                break;
            case 15:  // read back cached value
                break;
        }
    }
    else
    {
        // CPU writing, set direction and read
        gpio_set_dir_in_masked(_maskData);
        data = (data >> GPIO_D0) & 0xFF;

        switch(address)
        {
            case 0:
                // read byte from the CPU for communication
                break;
            case 1:
                // control byte?
                break;
            case 15:    // cache the data and feed it back when read on this address
                break;
        }
    }
}

void HandleDrive(uint32_t bits, uint8_t address, bool fRW)
{
    uint32_t test_pattern[2] = {0xAA, 0x55}; // test pattern
    uint32_t data = bits;
    uint32_t dataOut = 0;

    if (fRW) // read
    {
        // CPU reading, so output
        gpio_set_dir_out_masked(_maskData);

        if(_testMode)
        {
            dataOut = test_pattern[_cycleCount % 2];
        }
        else
        {
            uint8_t readbyte = _driveEmulator->Read(address);
            dataOut = readbyte;
        }

        // for now just output a test pattern
        gpio_put_masked(_maskData, dataOut << GPIO_D0);
    }
    else
    {
        // CPU writing, set direction and read
        gpio_set_dir_in_masked(_maskData);
        data = (data >> GPIO_D0) & 0xFF;
        _driveEmulator->Write(address, data);
    }
}

void __not_in_flash_func(gpio_callback)(uint gpio, uint32_t events) 
{
    if (events & GPIO_IRQ_EDGE_RISE)
    {
        _cycleCount++;
        uint32_t bits = gpio_get_all();
        uint32_t addr = bits;
        uint32_t data = bits;

        bool fCCS = !((bits & 1 << GPIO_CCS)  != 0);
        bool fDCS = !((bits & 1 << GPIO_DCS)  != 0);
        bool fRW  =   (bits & 1 << GPIO_RW)   != 0;
        _testMode =   (bits & 1 << GPIO_TEST) != 0;

        addr = (addr >> GPIO_A0) & 0xF;

        _console->PrintOut("gpio_callback: CCS:%d, DCS:%d, RW:%d, T:%d, addr=%x, all=%08x\n",
                    fCCS ? 1 : 0,
                    fDCS ? 1 : 0,
                    fRW ? 1 : 0,
                    _testMode ? 1 : 0,
                    addr,
                    bits);

        if (fCCS)
        {
            HandleCommunication(data, addr, fRW);
        }
        else if (fDCS)
        {
            HandleDrive(data, addr, fRW);
        }
    }
    else if (events & GPIO_IRQ_EDGE_FALL)
    {
        // stop driving data?
        // gpio_set_dir_in_masked(_maskData);

        // add cycles on the clock fall to buy time?
        _driveEmulator->AddCycles(1);
        // get next data and start writing?
    }
}

void init_GPIO()
{
    for(int i = GPIO_D0; i <= GPIO_D7; i++)
    {
        _maskData |= (1 << i);
    }

    gpio_init(GPIO_LED);
    gpio_set_dir(GPIO_LED, GPIO_OUT);

    for(int i = GPIO_FIRST; i <= GPIO_LAST; i++)
    {
        gpio_init(i);
        gpio_set_dir(i, GPIO_IN);
    }

    gpio_set_irq_enabled_with_callback(
        GPIO_PHI2, 
        GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL, 
        true, 
        &gpio_callback);
}

void init_console()
{
    _console->AddCommand(
    new Command(std::string("echo"), 
    [&](std::vector<std::string>& params) -> void
    {
        for(int i = 0; i < params.size(); i++)
        {
            _console->PrintOut("echo: %s\n", params[i].c_str());
        }
    }));

    _console->AddCommand(
    new Command(std::string("dir"), 
    [&](std::vector<std::string>& params) -> void
    {
        std::vector<std::string> vecFiles;
        _sdCard->GetFilesInDirectory("\\", vecFiles);

        for (std::string s : vecFiles)
        {
            _console->PrintOut("%s\n", s.c_str());
        }
    }));

    _console->AddCommand(
    new Command(std::string("load"), 
    [&](std::vector<std::string>& params) -> void
    {
        if (params.size() != 2)
        {
            _console->PrintOut("usage: load [filename]\n");
            return;
        }

        if (_driveEmulator->GetActiveDisk()->InsertDisk(params[1].c_str()))
        {
            _console->PrintOut("WOZ2 disk image loaded\n");
        }
        else
        {
            _console->PrintOut("WOZ2 disk image load failed\n");
        }
    }));

    _console->AddCommand(
    new Command(std::string("diskinfo"), 
    [&](std::vector<std::string>& params) -> void
    {
        InfoChunkData *pData = _driveEmulator->GetActiveDisk()->GetFile()->GetInfoChunkData();

        if(pData)
        {
            _console->PrintOut("Version: %d\nCreator: %s\nCompat HW: %d\nReq RAM: %d\n", 
                    pData->Version,
                    pData->Creator,
                    pData->CompatibleHardware,
                    pData->RequiredRAM);
        }
        else 
        {
            _console->PrintOut("No disk loaded in active drive\n");
        }
    }));

}

void core1() 
{
    init_GPIO();

    uint32_t counter = 0;
    while(true)
    {
    }
}

int main()
{
    uint32_t counter = 0;
    bool ledon = false;

    stdio_init_all();

    multicore_launch_core1(core1);

    _driveEmulator = new DriveEmulator();
    _sdCard = new SDCard();
    _console = new Console();

    _sdCard->Init();
    _sdCard->Mount();

    init_console();
    //set_sys_clock_khz(250000, true);

    while(true)
    {
        uint8_t c = 0;
        int ch = getchar_timeout_us(0);
        if (ch != PICO_ERROR_TIMEOUT) {
            // There is a character available to read
            // Process the character
            _console->InputByte((uint8_t)ch);
            printf("%c", ch);
        }        

        if (_console->GetOutputByte(&c))
        {
            printf("%c", c);
        }
    }

    return 0;
}
