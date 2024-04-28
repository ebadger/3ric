#include <math.h>
#include <vector>
#include <stdio.h>
#include <pico/stdlib.h>
#include <pico/multicore.h>
#include "DriveEmulator.h"
#include "sdcard.h"

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

const uint32_t _maskData    = 0b00000000000000000011111111000000;
//const uint32_t _maskAddress = 0b00000000001111000000000000000000; 
uint64_t _cycleCount = 0;
bool _testMode = false;

DriveEmulator *_driveEmulator = nullptr;
SDCard *_sdCard = nullptr;

void HandleCommunication(uint32_t bits, uint8_t address, bool fRW)
{
    uint32_t test_pattern[2] = {0x0F, 0xF0}; // test pattern
    uint32_t data = bits;
    uint32_t dataOut = 0;
    
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
            dataOut = (test_pattern[_cycleCount % 2] << GPIO_D0);
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

        bool fCCS = (bits & 1 << GPIO_CCS)  != 1;
        bool fDCS = (bits & 1 << GPIO_DCS)  != 1;
        bool fRW  = (bits & 1 << GPIO_RW)   != 0;
        _testMode = (bits & 1 << GPIO_TEST) != 0;

        addr = (addr >> GPIO_A0) & 0xF;

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
        gpio_set_dir_in_masked(_maskData);

        // add cycles on the clock fall to buy time?
        _driveEmulator->AddCycles(1);
        // get next data and start writing?
    }
}

void init_GPIO()
{
    for(int i = GPIO_FIRST; i <= GPIO_LAST; i++)
    {
        gpio_init(i);
        gpio_set_dir(i, GPIO_IN);
    }
}


void core1() 
{
    init_GPIO();
    gpio_set_irq_enabled_with_callback(
            GPIO_PHI2, 
            GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL, 
            true, 
            &gpio_callback);

    while(true)
    {
    }
}

int main(int , char **)
{
    _driveEmulator = new DriveEmulator();
    _sdCard = new SDCard();

    _sdCard->Init();
    _sdCard->Mount();

    //set_sys_clock_khz(250000, true);

    multicore_launch_core1(core1);

    while(true)
    {
    }

    return 0;
}
