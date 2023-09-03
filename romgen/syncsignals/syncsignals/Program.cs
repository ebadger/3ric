using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.IO;
using System.Runtime.CompilerServices;
using System.Diagnostics;

namespace eepromgen2
{
    internal class Program
    {
        const byte FLAG_HRESET = 1 << 0;
        const byte FLAG_VRESET = 1 << 1;
        const byte FLAG_HSYNC = 1 << 2;
        const byte FLAG_VSYNC = 1 << 3;
        const byte FLAG_DISPLAY = 1 << 4;

        static void Main(string[] args)
        {

            /*
             *
                General timing
                Screen refresh rate	60 Hz
                Vertical refresh	31.46875 kHz
                Pixel freq.	25.175 MHz

                Horizontal timing (line) (evenly divisible by 16)
                Polarity of horizontal sync pulse is negative.
                Scanline part	Pixels	Time [µs]            DIV16
                Visible area	640     25.422045680238      40
                Front porch	     16	     0.63555114200596     1
                Sync pulse	     96	     3.8133068520357      6
                Back porch	     48      1.9066534260179      3
                Whole line	    800     31.777557100298      50

                Vertical timing (frame)
                Polarity of vertical sync pulse is negative.
                Frame part	Lines	    Time [ms]
                Visible area	480	    15.253227408143
                Front porch	     10	    0.31777557100298
                Sync pulse	      2	    0.063555114200596
                Back porch	     33	    1.0486593843098
                Whole frame	    525	    16.683217477656
             */

            FileStream fsSignals = new FileStream("signals.dat", FileMode.Create);
            BinaryWriter bwSignals = new BinaryWriter(fsSignals);

            //https://pdf1.alldatasheet.com/datasheet-pdf/view/46516/SST/SST39SF040.html
            byte[] mem = new byte[0x80000]; // 512KB eeprom

            for (int i = 0; i < 0x80000; i++)
            {
                mem[i] = FLAG_VSYNC | FLAG_HSYNC;
                if (i % 10 < 5)
                {
                    mem[i] |= FLAG_HRESET;
                }

                if (i % 32 != 0)
                {
                    mem[i] |= FLAG_VRESET;
                }
            }

            for (int y = 0; y < 8192; y++)
            {
                for (int x = 0; x < 64; x++)
                {
                    int addr = x | (y << 6);
                    byte val = FLAG_HRESET | FLAG_VRESET | FLAG_HSYNC | FLAG_VSYNC;

                    // set reset flags - if reset is low, corresponding counter is reset
                    if (x > 48)
                    {
                        val &= unchecked((byte)~FLAG_HRESET);
                    }

                    if (y > 524 && x > 48)
                    {
                        val &= unchecked((byte)~FLAG_VRESET);
                    }

                    // visible flag - flag is on when we should output
                    // support 320x200 resolution - native VGA is 480 lines - 
                    // don't display the first 40 lines or the last 40 lines

                    if (x >= 0 && x < 40 && y < 432 && y > 31)
                    {
                        val |= FLAG_DISPLAY;
                    }

                    // sync pulses, stay high and pulse low
                    if (x > 40 && x < 47)
                    {
                        val &= unchecked((byte)~FLAG_HSYNC);
                    }

                    if (y > 489 && y < 492)
                    {
                        val &= unchecked((byte)~FLAG_VSYNC);
                    }


                    mem[addr] = val;

                   
                    //Console.WriteLine("x:{0},y:{1}, 0x{2:X2}", x, y, addr);
                }
            }
            for (int i = 0; i < 0x80000; i++)
            {
                bwSignals.Write(mem[i]);
            }

            bwSignals.Flush();
            fsSignals.Close();
        }
    }
}
