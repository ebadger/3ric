// Emscripten/WebAssembly bridge for the 3ric Apple-II-clone 65C02 VM core.
//
// Exposes a JS-friendly wrapper (WebVM) over the existing C++ emulator. The
// blocking CPU::Run()/VM::Run() loops are intentionally NOT used; instead the
// browser drives execution cooperatively via run(maxSteps) from
// requestAnimationFrame so the tab stays responsive.
//
// Video is rendered here (not in JS) by porting the host renderer from
// Badger6502Emulator/MainWindow.xaml.cpp: draw_hires_line_color_apple,
// draw_lores_line_color_apple, draw_text_eb6502 and PlotPixel. Each frame the
// bridge reads video RAM directly out of VM::GetData() plus the tracked
// soft-switch mode flags, fills a 320x384 ARGB buffer with the exact host
// palette/fringe logic, then converts it to RGBA8888 for canvas putImageData.
//
// Keyboard uses the Apple-II memory-mapped path: keyDown() writes
// $C000 = 0x80 | ascii (strobe set); the core clears the strobe when the
// program touches $C010 (web-guarded in VM::DoSoftSwitches).

// vm.h transitively includes cpu.h, via.h, ps2keyboard.h and DriveEmulator.h.
#include "vm.h"

// SD-card SPI mock (emulator/MockMicroSD). Its pch.h has an additive web branch
// that pulls in web_compat.h + the in-memory sparse sector backing.
#include "SDCard.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace emscripten;

// Framebuffer dimensions (matches the host WriteableBitmap: 320x384).
static const int FB_W = 320;
static const int FB_H = 384;

// Apple II hi-res scanline base offsets (interleaved), 192 entries.
// Copied verbatim from MainWindow.xaml.cpp.
static const uint16_t kScanlines[192] = {
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

// Text/lo-res row base offsets, 24 entries. Copied verbatim.
static const uint16_t kTextScanlines[24] = {
    0x0000, 0x0080, 0x0100, 0x0180,
    0x0200, 0x0280, 0x0300, 0x0380,
    0x0028, 0x00A8, 0x0128, 0x01A8,
    0x0228, 0x02A8, 0x0328, 0x03A8,
    0x0050, 0x00D0, 0x0150, 0x01D0,
    0x0250, 0x02D0, 0x0350, 0x03D0 };

class WebVM
{
public:
    WebVM()
    {
        _vm = new VM(false);
        _argb.assign((size_t)FB_W * FB_H, 0xFF000000u);
        _rgba.assign((size_t)FB_W * FB_H * 4, 0);
        _fontRom.assign(0x80000, 0);

        // Serial transmit from the 6502 -> collect bytes for an optional JS log.
        _vm->CallbackReceiveChar = [this](uint8_t c) { _out.push_back((char)c); };

        // Track display mode exactly like the host MainWindow does. The core
        // updates _graphics/_page2/_mixed/_lores then calls this with the fresh
        // values; we only latch them for the documented display range.
        _vm->CallbackSetSoftSwitches =
            [this](uint16_t address, bool graphics, bool page2, bool mixed, bool lores) {
                if (address >= 0xC050 && address <= 0xC057)
                {
                    _gfxPage  = page2 ? 1 : 0;
                    _textMode = graphics ? 0 : 1;
                    _mixed    = mixed ? 1 : 0;
                    _lores    = lores ? 1 : 0;
                }
                else if (address >= 0xC0E0 && address <= 0xC0EF)
                {
                    // Advance the Disk II emulator by the cycles elapsed since
                    // the previous disk access (mirrors the host).
                    _vm->GetDriveEmulator()->AddCycles((uint32_t)(_cycles - _lastDiskCycle));
                    _lastDiskCycle = _cycles;
                }
            };

        // Character generator / font bank selection ($C300 control writes).
        _vm->CallbackSetMode = [this](uint8_t flags) { _font = flags & 0x3F; };

        // Bit-banged SPI micro-SD card, wired exactly like the host
        // (MainWindow.xaml.cpp): every CPU write to the VIA1 port-A register
        // ($C201 = ORA_IRA, $C20F = ORA_IRA_2) clocks the SD state machine.
        // CS=bit4, SCK=bit3, MOSI=bit2, MISO=bit1. The MISO result is folded
        // back into the register so the next read of the port returns it.
        _vm->CallbackWriteMemory = [this](uint16_t address, uint8_t /*byte*/) {
            if (address == (uint16_t)(MM_VIA1_START + (uint16_t)VIA::ORA_IRA)
                || address == (uint16_t)(MM_VIA1_START + (uint16_t)VIA::ORA_IRA_2))
            {
                uint8_t reg = _vm->GetVIA1()->ReadRegister(VIA::ORA_IRA);

                _sd.SetCS(reg & 0x10);
                _sd.SetMOSI(reg & 0x04);
                _sd.SetSCK(reg & 0x08);

                if (_sd.GetMISO())
                    reg |= 0x02;
                else
                    reg &= (uint8_t)~0x02;

                _vm->GetVIA1()->WriteRegister(VIA::ORA_IRA, reg);
            }
        };
    }

    ~WebVM() { delete _vm; }

    // --- lifecycle ---------------------------------------------------------

    void reset() { _vm->Reset(); }

    // --- loaders -----------------------------------------------------------

    // Bulk-load bytes into the 64KB address space starting at offset. Mirrors
    // VM::LoadBinaryFile(name, offset): writes straight into GetData(), capped
    // at the 64KB window so the reset vector ($FFFC) + ROM/OS ($D000-$FFFF) and
    // BASIC bank ($9000-$BFFF) come from the 512KB ROM image's first 64KB.
    void loadData(int offset, val bytes)
    {
        std::vector<uint8_t> v = convertJSArrayToNumberVector<uint8_t>(bytes);
        uint8_t* data = _vm->GetData();
        for (size_t i = 0; i < v.size(); i++)
        {
            int a = offset + (int)i;
            if (a < 0 || a > 0xFFFF) break;
            data[a] = v[i];
        }
    }

    // Seed the BASIC ROM bank from the freshly loaded image ($9000, 0x3000).
    void seedBasicRom()
    {
        memcpy(_vm->GetBasicRom(), &_vm->GetData()[0x9000], 0x3000);
    }

    // Load the 512KB font ROM (fontrom.dat) used by the text renderer.
    void loadFont(val bytes)
    {
        std::vector<uint8_t> v = convertJSArrayToNumberVector<uint8_t>(bytes);
        size_t n = v.size() > _fontRom.size() ? _fontRom.size() : v.size();
        if (n) memcpy(_fontRom.data(), v.data(), n);
    }

    // Load the micro-SD card image in the compact "SDSP" sparse format produced
    // by web/make_sd_sparse.py (the raw image is a 2GB, mostly-zero FAT32 disk).
    // Returns true on success. Safe to call before or after reset; the SD
    // handshake works without it, only sector reads need the image.
    bool loadSD(val bytes)
    {
        std::vector<uint8_t> v = convertJSArrayToNumberVector<uint8_t>(bytes);
        if (v.empty()) return false;
        return _sd.LoadSparseImage(v.data(), (uint32_t)v.size());
    }

    // Number of SD sector reads/writes the guest has issued. Proves the ROM's
    // FAT32 driver reached the card (used by test_sd.cjs).
    int sdReadCount() { return (int)_sd.GetSectorAccessCount(); }

    // --- Disk II (5.25" floppy) emulation ----------------------------------

    // Insert a .woz disk image into drive 0 or 1, mirroring the host's
    // disk{1,2}Insert handlers (MainWindow.xaml.cpp): RemoveDisk() if one is
    // present, then InsertDisk(). WozLib's loader (WozFile::OpenFile) reads
    // through a FILE*, so the bytes are first written to Emscripten's in-memory
    // filesystem (MEMFS) and opened by path. Returns true once a disk is
    // present. Boot it from the monitor with "C600G" (the Disk II boot ROM is
    // at $C600) or from BASIC with "PR#6".
    bool insertDisk(int drive, val bytes)
    {
        if (drive < 0 || drive > 1) return false;

        std::vector<uint8_t> v = convertJSArrayToNumberVector<uint8_t>(bytes);
        if (v.empty()) return false;

        char path[32];
        snprintf(path, sizeof(path), "/disk%d.woz", drive);

        FILE* f = fopen(path, "wb");
        if (!f) return false;
        size_t wrote = fwrite(v.data(), 1, v.size(), f);
        fclose(f);
        if (wrote != v.size()) return false;

        WozDisk* disk = _vm->GetDriveEmulator()->GetDisk((uint8_t)drive);
        if (disk->IsDiskPresent()) disk->RemoveDisk();
        return disk->InsertDisk(path);
    }

    // Eject the disk in drive 0 or 1.
    void removeDisk(int drive)
    {
        if (drive < 0 || drive > 1) return;
        WozDisk* disk = _vm->GetDriveEmulator()->GetDisk((uint8_t)drive);
        if (disk->IsDiskPresent()) disk->RemoveDisk();
    }

    // True if a disk is currently inserted in drive 0 or 1.
    bool diskPresent(int drive)
    {
        if (drive < 0 || drive > 1) return false;
        return _vm->GetDriveEmulator()->GetDisk((uint8_t)drive)->IsDiskPresent();
    }

    // --- execution ---------------------------------------------------------

    // Execute up to maxSteps instructions, ticking both VIAs once per CPU cycle
    // so timer NMIs (delivered synchronously from VIA::Tick) fire. Mirrors the
    // host run loop, which always Steps and never honours waitForInterrupt.
    int run(int maxSteps)
    {
        CPU* cpu  = _vm->GetCPU();
        VIA* via1 = _vm->GetVIA1();
        VIA* via2 = _vm->GetVIA2();
        int cycles = 0;
        for (int i = 0; i < maxSteps; i++)
        {
            uint8_t c = cpu->Step();
            cycles += c;
            _cycles += c;
            for (uint8_t k = 0; k < c; k++)
            {
                via1->Tick();
                via2->Tick();
            }
            _vm->GetPS2Keyboard()->ProcessKeys((uint32_t)_cycles);
        }
        return cycles;
    }

    bool waiting() { return _vm->GetCPU()->waitForInterrupt; }

    // --- keyboard ----------------------------------------------------------

    // Apple-II monitor/BASIC input: make $C000 read back ascii|0x80 (strobe set)
    // until the program touches $C010. Uppercased to match the host + BASIC.
    void keyDown(int ascii)
    {
        _vm->WriteData(0xC000, (uint8_t)(0x80 | toupper(ascii & 0x7F)));
    }

    // --- direct memory access ---------------------------------------------

    void poke(int addr, int value) { _vm->GetData()[addr & 0xFFFF] = (uint8_t)(value & 0xFF); }
    int  peek(int addr)            { return _vm->GetData()[addr & 0xFFFF]; }

    // Bus-level access that runs through the full memory map (soft switches,
    // ACIA/VIA, Disk II, language-card banking). Use this to drive
    // memory-mapped devices the way the CPU would.
    int  readBus(int addr)            { return _vm->ReadData((uint16_t)(addr & 0xFFFF)); }
    void writeBus(int addr, int value) { _vm->WriteData((uint16_t)(addr & 0xFFFF), (uint8_t)(value & 0xFF)); }

    // Set the program counter (e.g. to launch a freshly loaded program).
    void setPC(int addr) { _vm->GetCPU()->PC = (uint16_t)(addr & 0xFFFF); }

    // --- serial log (optional) --------------------------------------------

    std::string drainOutput()
    {
        std::string s = _out;
        _out.clear();
        return s;
    }

    // --- CPU state ---------------------------------------------------------

    int pc()     { return _vm->GetCPU()->PC; }
    int sp()     { return _vm->GetCPU()->SP; }
    int regA()   { return _vm->GetCPU()->A; }
    int regX()   { return _vm->GetCPU()->X; }
    int regY()   { return _vm->GetCPU()->Y; }
    int status() { return _vm->GetCPU()->flags.reg; }

    // --- mode state (debug/inspection) ------------------------------------

    int gfxPage()  { return _gfxPage; }
    int textMode() { return _textMode; }
    int mixed()    { return _mixed; }
    int lores()    { return _lores; }
    int font()     { return _font; }

    // --- video -------------------------------------------------------------

    int frameWidth()  { return FB_W; }
    int frameHeight() { return FB_H; }

    // Render the current frame into the RGBA buffer and return a typed-memory
    // view over it. A fresh view is returned each call because memory growth can
    // detach previously handed-out views.
    val renderFrame()
    {
        int page = _gfxPage;

        if (_textMode == 0)
        {
            if (_lores == 0)
            {
                for (int y = 0; y < 192; y++)
                    draw_hires_line_color_apple(page, (uint8_t)y);
            }
            else
            {
                draw_lores_line_color_apple(page);
            }

            if (_mixed)
                draw_text_eb6502(page);
        }
        else
        {
            draw_text_eb6502(page);
        }

        // ARGB (0xAARRGGBB) -> RGBA8888 bytes for canvas ImageData.
        const uint32_t* src = _argb.data();
        uint8_t* dst = _rgba.data();
        const size_t n = (size_t)FB_W * FB_H;
        for (size_t i = 0; i < n; i++)
        {
            uint32_t v = src[i];
            dst[i * 4 + 0] = (uint8_t)((v >> 16) & 0xFF); // R
            dst[i * 4 + 1] = (uint8_t)((v >> 8) & 0xFF);  // G
            dst[i * 4 + 2] = (uint8_t)(v & 0xFF);         // B
            dst[i * 4 + 3] = (uint8_t)((v >> 24) & 0xFF); // A
        }

        return val(typed_memory_view(_rgba.size(), _rgba.data()));
    }

private:
    // Video RAM accessors. Hires page 1 = $2000, page 2 = $4000; text/lores
    // page 1 = $400, page 2 = $800. These regions are always plain RAM.
    inline uint8_t hiresByte(int page, uint16_t laddr)
    {
        return _vm->GetData()[0x2000 + page * 0x2000 + laddr];
    }
    inline uint8_t textByte(int page, uint16_t addr)
    {
        return _vm->GetData()[0x400 + page * 0x400 + addr];
    }

    // Ported from MainWindow::PlotPixel. color is a 4-bit Apple hi-res color
    // index; base palette plus per-bit intensity yields a 0xAARRGGBB value.
    void plotPixel(uint16_t row, uint16_t col, uint8_t color, bool twice)
    {
        static const uint32_t colorarray[16] = {
            0xFF000000, 0xFFEA5D15, 0xFF43C300, 0x00000000,
            0x00000000, 0xFFB63DFF, 0xFF10A4E3, 0x00000000,
            0x00000000, 0x00000000, 0x00000000, 0x00000000,
            0x00000000, 0x00000000, 0x00000000, 0xFFFFFFFF };

        uint32_t rowmax = 384;
        if (_mixed && !_textMode)
            rowmax = 336;

        if (row >= rowmax || col >= 320)
            return;

        uint32_t newcolor = colorarray[color & 0xF];
        const uint32_t intensity = 0xFF;
        if (color & 4) newcolor |= intensity;
        if (color & 2) newcolor |= (intensity << 8);
        if (color & 1) newcolor |= (intensity << 16);

        _argb[col + (size_t)row * 320] = newcolor;
        if (twice)
            _argb[col + ((size_t)row + 1) * 320] = newcolor;
    }

    // Ported from MainWindow::draw_hires_line_color_apple.
    void draw_hires_line_color_apple(int page, uint8_t y)
    {
        uint8_t pallete = 0;
        uint8_t prevbit = 0;
        uint8_t color = 0;
        uint16_t ya = (uint16_t)(y * 2);

        const uint8_t colors[2][4] = { {0x0, 0x5, 0x2, 0xF}, {0x0, 0x6, 0x1, 0xF} };
        uint16_t countPixel = 0;

        for (uint16_t x = 0; x < 40; x++)
        {
            uint16_t laddr = kScanlines[y] + x;
            uint8_t curr = hiresByte(page, laddr);

            pallete = curr >> 7;

            for (uint8_t i = 0; i < 7; i++)
            {
                uint8_t bit = (curr >> i) & 1;
                uint8_t odd = (x + i) % 2;
                uint8_t index = odd ? (uint8_t)(bit << 1 | prevbit)
                                    : (uint8_t)(prevbit << 1 | bit);

                color = colors[pallete][index];
                uint16_t pixel = (uint16_t)(((float)countPixel / 280.0f) * 320);
                countPixel++;
                uint16_t nextpixel = (uint16_t)(((float)countPixel / 280.0f) * 320);

                plotPixel(ya, pixel, color, true);
                if (nextpixel - pixel > 1)
                    plotPixel(ya, pixel + 1, color, true);

                prevbit = bit;
            }
        }
    }

    // Ported from MainWindow::draw_lores_line_color_apple.
    void draw_lores_line_color_apple(int page)
    {
        static const uint32_t loresColors[16] = {
            0xFF000000, 0xFF901740, 0xFF402CA5, 0xFFD043E5,
            0xFF006940, 0xFF808080, 0xFF2F95E5, 0xFFBFABFF,
            0xFF405400, 0xFFD06A1A, 0xFF808080, 0xFFFF96BF,
            0xFF2FBC1A, 0xFFBFD35A, 0xFF6FE8BF, 0xFFFFFFFF };

        uint32_t endy = 384;
        if (_mixed == 1)
            endy = 320;

        for (uint32_t x = 0; x < 40; x++)
        {
            for (uint32_t y = 0; y < endy; y++)
            {
                uint32_t addr = kTextScanlines[y / 16] + x;
                uint8_t curr = textByte(page, (uint16_t)addr);

                uint8_t index = ((y & 8) == 0) ? (curr & 0xF) : (curr >> 4);
                uint32_t color = loresColors[index];

                for (int i = 0; i < 8; i++)
                    _argb[(x * 8) + i + ((size_t)y * 320)] = color;
            }
        }
    }

    // Ported from MainWindow::draw_text_eb6502.
    void draw_text_eb6502(int page)
    {
        uint32_t startrow = 0;
        if (_mixed && !_textMode)
            startrow = 320;

        for (uint32_t x = 0; x < 40; x++)
        {
            for (uint32_t y = startrow; y < 384; y++)
            {
                uint32_t addr = kTextScanlines[y / 16] + x;
                uint8_t curr = textByte(page, (uint16_t)addr);

                uint8_t line = (uint8_t)(y % 16);
                uint32_t fontaddr = curr | (line << 8) | (_font << 12);
                uint8_t bytes = (fontaddr < _fontRom.size()) ? _fontRom[fontaddr] : 0;

                int bit = 0;
                for (int i = 7; i >= 0; i--)
                {
                    _argb[(x * 8) + bit + ((size_t)y * 320)] =
                        (bytes & (1 << i)) ? 0xFFFFFFFFu : 0xFF000000u;
                    bit++;
                }
            }
        }
    }

    VM*                   _vm = nullptr;
    std::string           _out;
    std::vector<uint32_t> _argb;     // 0xAARRGGBB working buffer (host format)
    std::vector<uint8_t>  _rgba;     // RGBA8888 for canvas ImageData
    std::vector<uint8_t>  _fontRom;  // fontrom.dat (512KB)

    // Display mode flags, mirroring the host members (defaults: hi-res page 1).
    int _gfxPage  = 0;
    int _textMode = 0;
    int _mixed    = 0;
    int _lores    = 0;
    int _font     = 0;

    uint64_t _cycles        = 0;
    uint64_t _lastDiskCycle = 0;

    SDCard _sd;     // bit-banged SPI micro-SD card (sparse-backed image)
};

EMSCRIPTEN_BINDINGS(badger6502)
{
    class_<WebVM>("WebVM")
        .constructor<>()
        .function("reset",        &WebVM::reset)
        .function("loadData",     &WebVM::loadData)
        .function("seedBasicRom", &WebVM::seedBasicRom)
        .function("loadFont",     &WebVM::loadFont)
        .function("loadSD",       &WebVM::loadSD)
        .function("sdReadCount",  &WebVM::sdReadCount)
        .function("insertDisk",   &WebVM::insertDisk)
        .function("removeDisk",   &WebVM::removeDisk)
        .function("diskPresent",  &WebVM::diskPresent)
        .function("run",          &WebVM::run)
        .function("waiting",      &WebVM::waiting)
        .function("keyDown",      &WebVM::keyDown)
        .function("poke",         &WebVM::poke)
        .function("peek",         &WebVM::peek)
        .function("readBus",      &WebVM::readBus)
        .function("writeBus",     &WebVM::writeBus)
        .function("setPC",        &WebVM::setPC)
        .function("drainOutput",  &WebVM::drainOutput)
        .function("pc",           &WebVM::pc)
        .function("sp",           &WebVM::sp)
        .function("regA",         &WebVM::regA)
        .function("regX",         &WebVM::regX)
        .function("regY",         &WebVM::regY)
        .function("status",       &WebVM::status)
        .function("gfxPage",      &WebVM::gfxPage)
        .function("textMode",     &WebVM::textMode)
        .function("mixed",        &WebVM::mixed)
        .function("lores",        &WebVM::lores)
        .function("font",         &WebVM::font)
        .function("frameWidth",   &WebVM::frameWidth)
        .function("frameHeight",  &WebVM::frameHeight)
        .function("renderFrame",  &WebVM::renderFrame);
}
