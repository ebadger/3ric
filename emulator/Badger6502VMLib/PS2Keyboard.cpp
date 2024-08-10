#include "ps2keyboard.h"
#define CYCLE_THRESHOLD   1000

PS2Keyboard::PS2Keyboard(VM* p)
{
	_vm = p;
}

void PS2Keyboard::Reset()
{
    _vecBits.clear();
    _lastcycle = 0;
}

void PS2Keyboard::SignalHardwareKey(bool down, uint32_t scancode)
{
    bool fDown = true;
    KeyEvent start = {};
    KeyEvent parity = {};
    KeyEvent stop = {};

    start.bit = 0;
    stop.bit = 1;
    int8_t p = 0;
    
    uint8_t sc = TranslateScancode(scancode);
    // queue up the bits
    if (!down)
    {
        // up flag
        uint8_t flag = 0xF0;

        _vecBits.push_back(start);

        for (int i = 0; i < 8; i++)
        {
            KeyEvent k;
            k.bit = flag & 1;
            p += k.bit;

            flag = flag >> 1;
            _vecBits.push_back(k);
        }

        p = (p % 2 == 0) ? 0 : 1;

        parity.bit = p;
        _vecBits.push_back(parity);
        _vecBits.push_back(stop);
    }

    p = 0;
    // write start bit
    _vecBits.push_back(start);

    // scancode
    for (int i = 0; i < 8; i++)
    {
        KeyEvent k;
        k.bit = sc & 1;
        p += k.bit;
        sc = sc >> 1;
        _vecBits.push_back(k);
    }

    p = (p % 2 == 0) ? 0 : 1;

    parity.bit = p;
    _vecBits.push_back(parity);
    _vecBits.push_back(stop);

}

void PS2Keyboard::ProcessKeys(uint32_t cycles)
{
    static bool fDown = true;

    if (_vecBits.size() == 0 && fDown == true)
    {
        return;
    }

#if 0
    if (_vm->GetCPU()->flags.bits.I == 1)
    {
        return;
    }
#endif

	if (cycles - _lastcycle > CYCLE_THRESHOLD)
	{
        _lastcycle = cycles;

        if (fDown)
        {
            KeyEvent k = *_vecBits.begin();
            _vm->GetPS2Keyboard()->ProcessRaw(k.bit);
            _vecBits.erase(_vecBits.begin());
        }
        /*
        else
        {
            uint8_t bit = _vm->ReadData(MM_VIA1_START + VIA::ORA_IRA);
            bit |= 0xC0; // ps2 clock and data up
            _vm->WriteData(MM_VIA1_START + VIA::ORA_IRA_2, bit); // via2 PORTA 7 bit 
            _vm->WriteData(MM_VIA1_START + VIA::ORA_IRA, bit); // via2 PORTA 7 bit
        }
        */
        fDown = !fDown;

	}
}

// send raw bits from hardware based on clock cycle
void PS2Keyboard::ProcessRaw(uint8_t bit)
{
    //uint8_t data = _vm->ReadData(MM_VIA1_START + VIA::ORA_IRA);
    //data &= 0x3F;  // bit 6 is low

    bit <<= 7;
    //data |= bit;

    _vm->WriteData(MM_VIA1_START + VIA::ORA_IRA_2, bit); // via2 PORTA 7 bit, 
    //_vm->WriteData(MM_VIA1_START + VIA::ORA_IRA, data); // via2 PORTA 7 bit, 
    _vm->GetVIA1()->SignalPin(VIA::CA2);
}

uint8_t PS2Keyboard::TranslateScancode(uint8_t sc)
{
    //https://www.vetra.com/scancodes.html
    uint8_t xlate[256] = { 0 };

    xlate[0x29] = 0x0E;
    xlate[0x02] = 0x16;
    xlate[0x03] = 0x1E;
    xlate[0x04] = 0x26;
    xlate[0x05] = 0x25;
    xlate[0x06] = 0x2E;
    xlate[0x07] = 0x36;
    xlate[0x08] = 0x3D;
    xlate[0x09] = 0x3E;
    xlate[0x0A] = 0x46;
    xlate[0x0B] = 0x45;
    xlate[0x0C] = 0x4E;
    xlate[0x0D] = 0x55;
    xlate[0x0E] = 0x66;
    xlate[0x0F] = 0x0D;
    xlate[0x10] = 0x15;
    xlate[0x11] = 0x1D;
    xlate[0x12] = 0x24;
    xlate[0x13] = 0x2D;
    xlate[0x14] = 0x2C;
    xlate[0x15] = 0x35;
    xlate[0x16] = 0x3C;
    xlate[0x17] = 0x43;
    xlate[0x18] = 0x44;
    xlate[0x19] = 0x4D;
    xlate[0x1A] = 0x54;
    xlate[0x1B] = 0x5B;
    xlate[0x3A] = 0x58;
    xlate[0x1E] = 0x1C;
    xlate[0x1F] = 0x1B;
    xlate[0x20] = 0x23;
    xlate[0x21] = 0x2B;
    xlate[0x22] = 0x34;
    xlate[0x23] = 0x33;
    xlate[0x24] = 0x3B;
    xlate[0x25] = 0x42;
    xlate[0x26] = 0x4B;
    xlate[0x27] = 0x4C;
    xlate[0x28] = 0x52;
    xlate[0x1C] = 0x5A;
    xlate[0x2A] = 0x12;
    xlate[0x2C] = 0x1A;
    xlate[0x2D] = 0x22;
    xlate[0x2E] = 0x21;
    xlate[0x2F] = 0x2A;
    xlate[0x30] = 0x32;
    xlate[0x31] = 0x31;
    xlate[0x32] = 0x3A;
    xlate[0x33] = 0x41;
    xlate[0x34] = 0x49;
    xlate[0x35] = 0x4A;
    xlate[0x36] = 0x59;
    xlate[0x1D] = 0x14;
    xlate[0x38] = 0x11;
    xlate[0x39] = 0x29;
    xlate[0x45] = 0x77;
    xlate[0x47] = 0x6C;
    xlate[0x4B] = 0x6B;
    xlate[0x4F] = 0x69;
    xlate[0x48] = 0x75;
    xlate[0x4C] = 0x73;
    xlate[0x50] = 0x72;
    xlate[0x52] = 0x70;
    xlate[0x37] = 0x7C;
    xlate[0x49] = 0x7D;
    xlate[0x4D] = 0x74;
    xlate[0x51] = 0x7A;
    xlate[0x53] = 0x71;
    xlate[0x4A] = 0x7B;
    xlate[0x4E] = 0x79;
    xlate[0x01] = 0x76;
    xlate[0x3B] = 0x05;
    xlate[0x3C] = 0x06;
    xlate[0x3D] = 0x04;
    xlate[0x3E] = 0x0C;
    xlate[0x3F] = 0x03;
    xlate[0x40] = 0x0B;
    xlate[0x41] = 0x83;
    xlate[0x42] = 0x0A;
    xlate[0x43] = 0x01;
    xlate[0x44] = 0x09;
    xlate[0x57] = 0x78;
    xlate[0x58] = 0x07;
    xlate[0x46] = 0x7E;
    xlate[0x2B] = 0x5D;

    return xlate[sc];
}