#include <math.h>
#include <vector>
#include <stdio.h>
#include <pico/stdlib.h>
#include <pico/multicore.h>
#include "DriveEmulator.h"
#include "sdcard.h"
#include "console.h"
#include <hardware/uart.h>
#include <hardware/gpio.h>
#include <hardware/pio.h>
#include "ccsctrl.pio.h"
#include "ccsdata.pio.h"

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
#define GPIO_LAST    21
#define GPIO_OE      22
#define GPIO_LED     25
#define GPIO_PHIO    26
#define GPIO_PHIO2   27
#define GPIO_SLOW    28

#define BIT_DCS      1
#define BIT_PHI2     2
#define BIT_RW       4
#define BIT_CCS      8

#define IS_DCS(_X)  ((_X & BIT_DCS)  == BIT_DCS)
#define IS_PHI2(_X) ((_X & BIT_PHI2) == BIT_PHI2)
#define IS_RW(_X)   ((_X & BIT_RW)   == BIT_RW)
#define IS_CCS(_X)  ((_X & BIT_CCS)  == BIT_CCS)

PIO _pio = pio0;

uint32_t _sm_addr;
uint32_t _sm_data;

uint32_t _maskData    = 0;
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
    uint8_t b = 0;

#if 0
    _console->PrintOut("addr=%02x\n", address);
#endif

    if (fRW) // read
    {
        // CPU reading, so output
        gpio_set_dir_out_masked(_maskData);
        
        switch(address)
        {
            case 0:
                // output from conole buffer
                if (!_console->GetOutputByte(&b))
                {
                    b = 0;
                }

                dataOut = b;
                gpio_put_masked(_maskData, dataOut << GPIO_D0);
                break;
            case 1:
                // for now just output a test pattern
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
        for(int i = 0; i < 2; i++)
        {
            data = gpio_get_all();  
        }   

        data = (data >> GPIO_D0) & 0xFF;

        printf("addr=%02x, data=%02x\n", address, data);
        switch(address)
        {
            case 0:
                // read byte from the CPU for communication
                _console->InputByte(data);
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
    uint32_t data = bits;
    uint32_t dataOut = 0;

    if (fRW) // read
    {
        // CPU reading, so output
        gpio_set_dir_out_masked(_maskData);

        uint8_t readbyte = _driveEmulator->Read(address);
        dataOut = readbyte;

        // for now just output a test pattern
        gpio_put_masked(_maskData, dataOut << GPIO_D0);
    }
    else
    {
        // CPU writing, set direction and read
        gpio_set_dir_in_masked(_maskData);
        
        for(int i = 0; i < 2; i++)
        {
            data = gpio_get_all();  
        }

        data = (data >> GPIO_D0) & 0xFF;
        _driveEmulator->Write(address, data);
    }
}

void __not_in_flash_func(phi2_handler)(uint32_t bits, bool fRise) 
{
    if (fRise)
    {
        //gpio_put(GPIO_PHIO, true);

        _cycleCount++;
        uint32_t addr = bits;
        uint32_t data = bits;

        bool fDCS = (bits & 0x80000000) == 0;
        bool fCCS = (bits & 0x20000000) == 0;
        bool fRW  = (bits & 0x10000000) != 0;

        addr = (bits >> 24) & 0xF;

/*
        _console->PrintOut("gpio_callback: CCS:%d, DCS:%d, RW:%d, T:%d, addr=%x, all=%08x\n",
                    fCCS ? 1 : 0,
                    fDCS ? 1 : 0,
                    fRW ? 1 : 0,
                    _testMode ? 1 : 0,
                    addr,
                    bits);
*/
        if (fCCS)
        {
//            gpio_put(GPIO_OE, true);
            //HandleCommunication(data, addr, fRW);
        }
        else if (fDCS)
        {
//            gpio_put(GPIO_OE, true);
            //HandleDrive(data, addr, fRW);
        }
        else
        {
 //           gpio_put(GPIO_OE, false);
        }

        //gpio_put(GPIO_PHIO2, true);
    }
    else
    {
        //gpio_put(GPIO_PHIO, false);

        // stop driving data?
        // gpio_set_dir_in_masked(_maskData);
 //       gpio_put(GPIO_OE, false);

        // add cycles on the clock fall to buy time?
        //_driveEmulator->AddCycles(1);
        // get next data and start writing?
        //gpio_put(GPIO_PHIO2, false);
    }
}

void init_GPIO()
{
/*
    for(int i = GPIO_D0; i <= GPIO_D7; i++)
    {
        _maskData |= (1 << i);
    }
*/
    gpio_init(GPIO_LED);
    gpio_set_dir(GPIO_LED, GPIO_OUT);

    gpio_init(GPIO_SLOW);
    gpio_set_dir(GPIO_SLOW, GPIO_IN);

    for(int i = GPIO_FIRST; i <= GPIO_LAST; i++)
    {
        gpio_init(i);
        gpio_set_dir(i, GPIO_IN);
        gpio_pull_down(i);
    }

    gpio_init(GPIO_OE);
    gpio_set_dir(GPIO_OE, GPIO_OUT);
    gpio_put(GPIO_OE, false);
    
    gpio_init(GPIO_PHIO);
    gpio_set_dir(GPIO_PHIO, GPIO_OUT);
    gpio_put(GPIO_PHIO, false);
    
    gpio_init(GPIO_PHIO2);
    gpio_set_dir(GPIO_PHIO2, GPIO_OUT);
    gpio_put(GPIO_PHIO2, false);

/*
    gpio_set_irq_enabled_with_callback(
        GPIO_PHI2, 
        GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL, 
        true, 
        &gpio_callback);
*/
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
        _console->PrintOut("params=%d\n", params.size());

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


void init_dma()
{
    // for comms with the CLI

    // set up a DMA channel that automatically writes from the data.pio ISR into 
    // a console circular RAM buffer.  Use the trick with a 2nd channel to trigger 
    // a reset?
    
    // for the console, maybe we don't need a DMA channel for output.
    // instead have the CPU just write to the tx fifo for the data.pio.
    // fifo is 24 bytes, which is probably enough buffer.
    // for disk emulation, this may need to work differently.
}

void init_PIO()
{
    _sm_addr = pio_claim_unused_sm(_pio, true);
    uint offset = pio_add_program(_pio, &ccsctrl_program);  
    ccsctrl_program_init(_pio, _sm_addr, offset, GPIO_DCS);

    _sm_data = pio_claim_unused_sm(_pio, true);
    offset = pio_add_program(_pio, &ccsdata_program);  
    ccsdata_program_init(_pio, _sm_data, offset, GPIO_D0);

    pio_set_sm_mask_enabled(_pio, (1 << _sm_addr | 1 << _sm_data), true);
}

void __not_in_flash_func(core1)() 
{
    uint8_t   addr = 0;
    uint32_t  outval = 0;
    bool      fOn = true;
    BYTE      b = 0;
    uint32_t  value2 = 0;
    uint32_t  deviceMask = BIT_DCS | BIT_CCS;

    init_GPIO();
    init_PIO();

    while(true)
    {
        uint32_t value = pio_sm_get_blocking(_pio, _sm_addr);
        uint8_t addr;

        if (!IS_PHI2(value))
        {
            continue;
        }

        if ((value & deviceMask) == deviceMask)
        {
            //neither device is active
            pio_sm_clear_fifos(_pio, _sm_data);
            continue;
        }

        addr =  ((value >> 4) & 0xF);

        if (IS_RW(value))
        {
            switch(addr)
            {
                case 0:
                    b = 0;
                    _console->GetOutputByte(&b);
                    pio_sm_put(_pio, _sm_data, (uint32_t)b);            
                    break;
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                case 10:
                case 11:
                case 12:
                case 13:
                case 14:
                case 15:
                    pio_sm_put(_pio, _sm_data, (uint32_t)outval);            
                    outval++;
                    break;
            }
        }
        else
        {
            value2 = pio_sm_get_blocking(_pio, _sm_data);
            // write
            switch(addr)
            {
                case 0:
                    if (value2 != 0)
                    {
                        _console->InputByte((uint8_t)value2);
                    }
/*
                    printf("%08x: %08x, addr=%x, dcs=%d, ccs=%d, rw=%d, phi2=%d\n", 
                        value2, 
                        value, 
                        addr, 
                        BIT_DCS(value), 
                        BIT_CCS(value), 
                        BIT_RW(value), 
                        BIT_PHI2(value));
*/
                    break;
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                case 10:
                case 11:
                case 12:
                case 13:
                case 14:
                case 15:
                    break;

                }
        }

#if 0
        printf("%d: %08x, addr=%x, dcs=%d, ccs=%d, rw=%d, phi2=%d\n", 
            outval, value, addr, BIT_DCS(value), BIT_CCS(value), BIT_RW(value), BIT_PHI2(value));
#endif
    }
}

int __not_in_flash_func(main)()
{
    bool fOn = false;
    uint32_t counter = 0;
    bool ledon = false;

    set_sys_clock_khz(270000, true);

    stdio_init_all();

    _driveEmulator = new DriveEmulator();
    _sdCard = new SDCard();
    _console = new Console();

    _sdCard->Init();
    _sdCard->Mount();

    multicore_launch_core1(core1);

    init_console();

    while(true)
    {
/*
        if (_console->GetOutputByte(&c))
        {
            printf("%c", c);
        }
*/
        uint8_t c = 0;
        int ch = getchar_timeout_us(0);
        if (ch != PICO_ERROR_TIMEOUT) {
            // There is a character available to read
            // Process the character
            _console->InputByte((uint8_t)ch);
            printf("%c", ch);
        }        

        if (counter % 1000 == 0)
        {
            _console->ProcessInput();
        }

        if(counter++ % 1000000 == 0)
        {
            gpio_put(GPIO_LED, fOn);
            fOn = !fOn;
        }
    }

    return 0;
}
