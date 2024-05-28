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
#include <hardware/vreg.h>
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

#define GPIO_READY   0
#define GPIO_TIMING  1

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

#define IS_NOT_DEVICE(_X) ((_X & (BIT_CCS | BIT_DCS)) == (BIT_CCS | BIT_DCS))
PIO _pio = pio0;

uint32_t _sm_addr;
uint32_t _sm_data;

uint32_t _maskData    = 0;
uint32_t _cycleCount = 0;
uint32_t _cycleProcessed = 0;

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

inline void 
__not_in_flash_func(HandleCommunication)(uint32_t value, uint8_t addr, uint8_t data, bool rw)
{
    uint8_t b = 0;

    if (rw)
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
                pio_sm_put(_pio, _sm_data, (uint32_t)addr);            
                break;
        }
    }
    else
    {
/*
        printf("%08x: %08x, addr=%x, dcs=%d, ccs=%d, rw=%d, phi2=%d\n", 
            value2, 
            value, 
            addr, 
            IS_DCS(value), 
            IS_CCS(value), 
            IS_RW(value), 
            IS_PHI2(value));           
*/ 
        // write
        switch(addr)
        {
            case 0:
                if (data != 0)
                {
                    _console->InputByte(data);
                }

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
}

void init_GPIO()
{
/*
    for(int i = GPIO_D0; i <= GPIO_D7; i++)
    {
        _maskData |= (1 << i);
    }
*/
    gpio_init(GPIO_READY);
    gpio_set_dir(GPIO_READY, GPIO_OUT);
    gpio_put(GPIO_READY, true);

    gpio_init(GPIO_TIMING);
    gpio_set_dir(GPIO_TIMING, GPIO_OUT);
    gpio_put(GPIO_TIMING, false);

    gpio_init(GPIO_LED);
    gpio_set_dir(GPIO_LED, GPIO_OUT);

    gpio_init(GPIO_SLOW);
    gpio_set_dir(GPIO_SLOW, GPIO_IN);


    for(int i = GPIO_FIRST; i <= GPIO_LAST; i++)
    {
        gpio_init(i);
        gpio_set_dir(i, GPIO_IN);
        //gpio_pull_down(i);
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
        GPIO_IRQ_EDGE_RISE, 
        true, 
        &gpio_callback);
*/
}

void init_console()
{
    _console->AddCommand(
    new Command(std::string("ECHO"), 
    [&](std::vector<std::string>& params) -> void
    {
        for(int i = 0; i < params.size(); i++)
        {
            _console->PrintOut("echo: %s\n", params[i].c_str());
        }
    }));

    _console->AddCommand(
    new Command(std::string("DIR"), 
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
    new Command(std::string("LOAD"), 
    [&](std::vector<std::string>& params) -> void
    {
        _console->PrintOut("params=%d\n", params.size());

        if (params.size() != 2)
        {
            _console->PrintOut("usage: load [filename]\n");
            return;
        }

        _driveEmulator->GetActiveDisk()->RemoveDisk();
        
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
    new Command(std::string("DISKINFO"), 
    [&](std::vector<std::string>& params) -> void
    {
        InfoChunkData *pData = _driveEmulator->GetActiveDisk()->GetFile()->GetInfoChunkData();

        if(pData)
        {
            _console->PrintOut("Version: %d\nCreator: %s\nCompat HW: %d\nReq RAM: %d\nLargest Track: %d\n", 
                    pData->Version,
                    pData->Creator,
                    pData->CompatibleHardware,
                    pData->RequiredRAM,
                    pData->LargestTrack);
            
        }
        else 
        {
            _console->PrintOut("No disk loaded in active drive\n");
        }
    }));

    _console->AddCommand(
    new Command(std::string("RUN"), 
    [&](std::vector<std::string>& params) -> void
    {
            _console->PrintOut("%cJ C600\n", 
                    0x84);
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
/*
    int dma_channel = dma_claim_unused_channel(true);
    dma_channel_config channel_cfg = dma_channel_get_default_config(dma_channel);

    channel_config_set_transfer_data_size(&channel_cfg, DMA_SIZE_8);
    channel_config_set_read_increment(&channel_cfg, false);
    channel_config_set_dreq(&channel_cfg, DREQ_PIO0_TX0); // Use the appropriate DREQ for your PIO

    dma_channel_configure(dma_channel, &channel_cfg, &pio->txf[_sm_data], ddsBuffer, DDS_BUFFER_SIZE, false);
*/
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

void 
__not_in_flash_func(core1)() 
{
    uint8_t   addr = 0;
    uint32_t  outval = 0;
    bool      fOn = true;
    BYTE      b = 0;
    uint32_t  deviceMask = BIT_DCS | BIT_CCS;
    uint32_t value = 0;
    uint32_t data = 0;
    bool rw = true;
    bool phi = false;
    uint32_t lastCycle = _cycleCount;

    init_PIO();

    while(true)
    {        
        value = pio_sm_get_blocking(_pio, _sm_addr);
        addr =  ((value >> 4) & 0xF);

        if(!IS_DCS(value))
        {
            if (IS_RW(value))
            {
                if (addr == 0xC && !DriveEmulator::_Q7)
                {
                    pio_sm_put(_pio, _sm_data, DriveEmulator::_shiftRegister);
                    _driveEmulator->Read(addr);
                }
                else
                {                    
                    pio_sm_put(_pio, _sm_data, _driveEmulator->Read(addr)); 
                }
            }
            else
            {
                data = pio_sm_get(_pio, _sm_data);
                _driveEmulator->Write(addr, data);
            }
        } 
        else if (!IS_CCS(value))
        {
            if (IS_RW(value))
            {
                uint8_t b = 0;
                _console->GetOutputByte(&b);
                pio_sm_put(_pio, _sm_data, (uint32_t)b);            
            }
            else
            {
                data = pio_sm_get(_pio, _sm_data);
                if (data != 0)
                {
                    _console->InputByte(data);
                }
            }
        }
        else
        {
            //neither device is active
            //pio_sm_drain_rx_fifo(_pio, _sm_data);           
            pio_sm_get(_pio, _sm_data);
            pio_sm_get(_pio, _sm_data);

            //pio_sm_clear_fifos(_pio, _sm_addr);
            //pio_sm_clear_fifos(_pio, _sm_data);

            //_driveEmulator->AddCycles(1);
        }

        _cycleCount++;

        //pio_sm_clear_fifos(_pio, _sm_addr);

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
    std::string outstring = "";
    uint32_t cycleAvg = 0;
    uint32_t cycleSamples = 0;
    uint32_t cycleMin = 0x7FFFFFFF;
    uint32_t cycleMax = 0;
    uint32_t cycleDeduct = 0;

    bool phi = false;

    stdio_init_all();

    vreg_set_voltage(VREG_VOLTAGE_1_30);
    sleep_ms(1000);
    set_sys_clock_pll(1600000000, 4, 1);

    init_GPIO();

    _driveEmulator = new DriveEmulator();
    _sdCard = new SDCard();
    _console = new Console();

    _sdCard->Init();
    _sdCard->Mount();

    multicore_launch_core1(core1);

    init_console();

    _cycleProcessed = _cycleCount;

    while(true)
    {
        if(counter++ % 50000 == 0)
        {
            uint8_t b = 0;

            if(_console->HasOutput())
            {
                gpio_put(GPIO_READY, false);
                while (_console->GetOutputByteLocal(&b))
                {
                    if (b)
                    {
                        outstring += b;
                    }
                }

                if(outstring.size() > 0)
                {
                    printf(outstring.c_str());
                    outstring = "";
                }

                gpio_put(GPIO_READY, true);
            }


            uint8_t c = 0;
            int ch = getchar_timeout_us(0);
            if (ch != PICO_ERROR_TIMEOUT) {
                // There is a character available to read
                // Process the character
                _console->InputByte((uint8_t)ch);
                printf("%c", ch);
            }        

            _console->ProcessInput(); 
        }

        if(counter % 2000000 == 0)
        {
            gpio_put(GPIO_LED, fOn);
            fOn = !fOn;
        }

        uint32_t cycles = _cycleCount - _cycleProcessed;

        if(cycles >= 4)
        {
            gpio_put(GPIO_TIMING, true);
            _driveEmulator->AddCycles(cycles);
            _cycleProcessed += cycles;
            gpio_put(GPIO_TIMING, false);
        }
/*
            if (cycles < cycleMin)
            {
                cycleMin = cycles;
            }

            if(cycles > cycleMax)
            {
                cycleMax = cycles;
            }

            cycleAvg += cycles;
            cycleSamples++;
*/
        

/*
        if(cycleSamples == 50000000)
        {
            _console->PrintOut("Avg:%d,Min:%d,Max:%d\n", 
                        cycleAvg / cycleSamples,
                        cycleMin,
                        cycleMax);
            cycleAvg = 0;
            cycleSamples = 0;
            cycleMin = 0x7FFFFFFF;
            cycleMax = 0;
        }
*/

    }

    return 0;
}
