using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.IO;
using System.Runtime.CompilerServices;
using System.Diagnostics;

// bit  9 is graphics mode
// bit 10 is graphics page

namespace videoaddress
{
    internal class Program
    {
        const int ROMSIZE = 0x80000;  // 39sf040

        static ushort [] _scanLines= {
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

        
        static string toBinaryString(ushort num)
        {
            StringBuilder binstring = new StringBuilder("0000000000000000");
            for(int i = 0; i < 16; i++)
            {
                ushort bit = 1;
                bit <<= i;
                if((bit & num) != 0)
                {
                    binstring[15 - i] = '1';
                }
            }

            return binstring.ToString();
        }
        static void dumpbin()
        {
            int idx = 0;
            for (ushort y = 0; y < 384; y+=2)
            {
                Console.WriteLine("{0:D3}: {1}",idx, toBinaryString(_scanLines[idx]));
                idx++;
            }
        }

        static void Main(string[] args)
        {
            int[] msb = new int[480];
            int[] lsb = new int[480];

            int[] msb2 = new int[480];

            int[] msbtext = new int[32];
            int[] lsbtext = new int[32];

            dumpbin();

            FileStream fslow = new FileStream("lowbyte.dat", FileMode.Create);
            FileStream fshigh = new FileStream("highbyte.dat", FileMode.Create);

            BinaryWriter bwlow = new BinaryWriter(fslow);
            BinaryWriter bwhigh = new BinaryWriter(fshigh);

            ushort [] mem = new ushort[ROMSIZE];

            for (int i = 0; i < ROMSIZE; i++)
            {
                mem[i] = 0;
            }

            // graphics mode page 1
            int idx = 0;
            for (ushort y = 0; y < 480; y++)
            {
                // 0 to 400 - graphics mode 0 graphics page 0
                ushort elem = (ushort) y;
                //ushort addr = (ushort)(0x2000 + (idx * 40));
                ushort addr = (ushort)(0x2000 + _scanLines[idx]);
                if (y < 32)
                {
                    mem[elem] = 0x500; // (ushort)(addr + 1);
                }
                else if (y < 416)
                {
                    mem[elem] = addr;
                    msb[idx] = (addr & 0xFF00) >> 8;
                    lsb[idx] = (addr & 0xFF);
                    Console.WriteLine("addr:0x{0:X4} y:{1} idx:{2}, 0x{3:X2}", addr, y, idx, (idx * 40));
                    if (idx < 191)
                    {
                        idx += y % 2;
                    }
                }
                else
                {
                    //mem[elem] = (ushort)(addr + 1);
                    mem[elem] = (ushort)0x500;
                }
            }

            // graphics mode page 2
            idx = 0;
            for (ushort y = 0; y < 480; y++)
            {
                // graphics mode 0 graphics page 1
                int elem = (ushort)y + 0x400;
                //ushort addr = (ushort)(0x4000 + (idx * 40));
                ushort addr = (ushort)(0x4000 + _scanLines[idx]);

                if (y < 32)
                {
                    mem[elem] = 0x500; // (ushort)(addr + 1);
                }
                else if (y < 416)
                {
                    mem[elem] = (ushort)addr;
                    msb2[idx] = (addr & 0xFF00) >> 8;
                    Console.WriteLine("addr:0x{0:X4} y:{1} idx:{2}, 0x{3:X2}", addr, y, idx, (idx * 40));
                    
                    if (idx < 191)
                    {
                        idx += y % 2;
                    }

                }
                else
                {
                    mem[elem] = 0x500; // (ushort)(addr + 1);
                }
            }


            // now text mode page 1
            idx = 0;
            for (int y = 0; y < 480; y++)
            {
                // graphics mode 1 graphics page 0
                int umem = y + 0x200;

                if ( y < 32)
                {
                    mem[umem] = 0x401;
                }
                else if (y < 432)
                {
                    idx = (y-32) / 16;
                    ushort addr = (ushort)(0x400 + (idx * 40));

                    Console.WriteLine("addr:0x{0:X4} y:{1} idx:{2}, 0x{3:X2}", addr, y, idx, (idx * 40));

                    mem[umem] = addr;
                    msbtext[idx] = (addr & 0xFF00) >> 8;
                    lsbtext[idx] = (addr & 0xFF);
                }
                else
                {
                    mem[umem] =0x401;
                }
            }

            // text mode page 2
            idx = 0;
            for (int y = 0; y < 480; y++)
            {
                // graphics mode 1 graphics page 1
                int umem = y + 0x600;

                if (y < 32)
                {
                    mem[umem] = 0x401;
                }
                else if (y < 432)
                {
                    idx = (y - 32) / 16;
                    ushort addr = (ushort)(0x800 + (idx * 40));

                    Console.WriteLine("addr:0x{0:X4} y:{1} idx:{2}, 0x{3:X2}", addr, y, idx, (idx * 40));

                    mem[umem] = addr;
                    msbtext[idx] = (addr & 0xFF00) >> 8;
                    lsbtext[idx] = (addr & 0xFF);
                }
                else
                {
                    mem[umem] = 0x401;
                }
            }


            for (int i = 0; i < ROMSIZE; i++)
            {
                byte addrl = (byte)(mem[i] & 0xFF);
                byte addrh = (byte)((mem[i] >> 8) & 0xFF);

                bwlow.Write(addrl);
                bwhigh.Write(addrh);
            }


            Console.WriteLine("eb_hires1_msb:");
            for(int y = 0; y < 200; y+=8)
            {
                Console.Write("        .byte ");
                for(int i = 0; i < 8; i++)
                {
                    Console.Write("${0:X2}", msb[y + i]);
                    if (i < 7)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }

            Console.WriteLine("eb_hires_lsb:");
            for (int y = 0; y < 200; y += 8)
            {
                Console.Write("        .byte ");
                for (int i = 0; i < 8; i++)
                {
                    Console.Write("${0:X2}", lsb[y + i]);
                    if (i < 7)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }

            
            Console.WriteLine("eb_hires2_msb:");
            for (int y = 0; y < 200; y += 8)
            {
                Console.Write("        .byte ");
                for (int i = 0; i < 8; i++)
                {
                    Console.Write("${0:X2}", msb2[y + i]);
                    if (i < 7)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }
           

            Console.WriteLine("eb_text_msb:");
            for (int y = 0; y < 30; y+=4)
            {
                Console.Write("        .byte ");
                for (int i = 0; i < 4; i++)
                {
                    Console.Write("${0:X2}", msbtext[y + i]);
                    if (i < 3)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }

            Console.WriteLine("eb_text_lsb:");
            for (int y = 0; y < 30; y += 4)
            {
                Console.Write("        .byte ");
                for (int i = 0; i < 4; i++)
                {
                    Console.Write("${0:X2}", lsbtext[y + i]);
                    if (i < 3)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }

            Console.WriteLine("font_lookup:");
            for (int y = 0; y < 256; y += 4)
            {
                Console.Write("        .addr ");
                for (int i = 0; i < 4; i++)
                {
                    Console.Write("font8x8+${0:X4}", (y + i) * 8);
                    if (i != 3)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }
            /*
            Console.WriteLine("font_lookup_lsb:");
            for (int y = 0; y < 256; y += 4)
            {
                Console.Write("        .addr ");
                for (int i = 0; i < 4; i++)
                {
                    Console.Write("font8x8+${0:X4}", (y + i)*8);
                    if (i != 3)
                    {
                        Console.Write(",");
                    }
                }
                Console.WriteLine("");
            }
            */

            bwlow.Flush();
            bwhigh.Flush();
            bwlow.Close();
            bwhigh.Close();
            fslow.Close();
            fshigh.Close();

        }
    }
}
