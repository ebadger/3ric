using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.IO;

// bits 0..7   <-  character     (256 characters)          0x......FF
// bits 8..11  <-  row           (16 rows per character)   0x.....F..
// bits 12..17 <-- font select   (6 bits, up to 64 fonts)  0x...3F...
// bit 18      <-- low, unused

namespace fontrom
{
    internal class Program
    {
        static bool consoleOutput = true;

        static byte NotReverseBits(byte b)
        {
            return b;
        }

        static byte ReverseBits(byte b)
        {
            byte b2 = 0;
            int i = 0;
            for (int p = 7; p >= 0; p--)
            {
                if ((b & (1 << p)) != 0)
                {
                    b2 |= (byte)(1 << i);
                }

                i++;
            }

            return b2;
        }

        static void Main(string[] args)
        {
            string[] fontfiles = {
                "VGA-ROM.F16",
                "HANDWRIT.F16",
                "MEDIEVAL.F16",
                "MODERN.F16",
                "OLD-ENGL.F16",
                "PS2OLD8.F16",
                "SANSERIF.F16",
                "SUPER.F16",
                "ROMAN.F16",
                "VGA8.F16",
                "WACKY2.F16",
                "WIGGLY.F16",
                "HOLLOW.F16",
                "FATSCII.F16",
                "BIGGER.F16",
                "ANSIBLE.F16",
                "16.F16",
                "ART.F16",
                "ARTX.F16",
                "HACK4TH.F16",
                "thin_ss.f16",
                "TEX-MATH.F16",
                "runic.f16",
                "ROTUND.F16",
                "SCRAWL2.F16",
                "TALL_GFX.F16",
                "TANDY2K1.F16",
                "NICER40C.F16",
                "police.f16",
                "READABL8.F16",
                "MACNTOSH.F16",
                "lbitalic.f16",
                "KEWL.F16",
                "KANA.F16",
                "HUGE.F16",
                "STANDARD.F16",
                "VOYNICH.F16",
                "HANDUGLY.F16",
                "boxround.f16",
                "BLKBOARD.F16",
                "bigserif.f16",
                "AS-100.F16",
                "APRI200D.F16",
                "BIOS_D.F16",
                "cp111.f16",
                "cp112.f16",
                "cp113.f16",
                "cp437.f16",
                "cp850.f16",
                "cp851.f16",
                "cp852.f16",
                "cp853.f16",
                "cp860.f16",
                "cp861.f16",
                "cp862.f16",
                "cp863.f16",
                "cp864.f16",
                "cp865.f16",
                "cp866.f16",
                "cp880.f16",
                "cp881.f16",
                "cp882.f16",
                "cp883.f16",
                "cp884.f16"
            };

            // 512KB
            byte[] mem = new byte[0x80000];

            Console.WriteLine("Count Files={0}", fontfiles.Length);

            string lookup = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";
            int maxaddress = 0;
            int iFont = 0;
            foreach(string font in fontfiles)
            {
                FileStream f = new FileStream("../../fonts/" + font, FileMode.Open);
                BinaryReader br = new BinaryReader(f);
                byte [] fontdata = new byte[br.BaseStream.Length];
                fontdata = br.ReadBytes((int)br.BaseStream.Length);

                for(uint c = 0; c < 256; c++)
                {
                    uint c2 = lookup[(int)(c & 0x3F)];

                    if (consoleOutput)
                    {
                        Console.WriteLine("======================== Font={0} Char={1}", font, c);
                    }

                    for (int r = 0; r < 16; r++)
                    {
                        //int b = br.ReadByte();
                        int b = fontdata[(c2 * 16) + r];

                        if ( c >= 0 && c < 128) // inverse
                        {
                            b = ~b; 
                        }

                        int address = (NotReverseBits((byte)c)) | (r & 0xF) << 8 | (iFont & 0xFF) << 12;
                        if (address > maxaddress)
                        {
                            maxaddress = address;
                        }

                        mem[address] = (byte)b;

                        if(consoleOutput)
                        {
                            for (int p = 7; p >= 0; p--)
                            {                          
                                if ((b & (1 << p)) != 0)
                                {
                                    Console.Write("#");
                                }
                                else
                                {
                                    Console.Write(" ");
                                }
                            }

                            Console.Write ("   ${0:X}", b);
                            Console.WriteLine("");
                        }
                    }
                }
                iFont++;
                f.Close();
            }

            // now populate the low-res graphics data

            for(int i = 0; i < 256; i++)
            {
                for(int r = 0; r < 16; r++)
                {
                    for(int iPal = 0; iPal < 64; iPal++)  
                    {
                        // iPal == the color palette, for now, leave them all the same
                        byte c = 0;
                        byte b = 0;
                        
                        byte red = 0;
                        byte green = 0;
                        byte blue = 0;
                        byte intensity = 0;

                        if (r < 8)
                        {
                            c = (byte)(i >> 4);
                        }
                        else
                        {
                            c = (byte)(i & 0xF);
                        }

                        int address = (NotReverseBits((byte)i)) | (r & 0xF) << 8 | (iPal & 0xFF) << 12 | 1 << 18;
                        if (address > maxaddress)
                        {
                            maxaddress = address;
                        }

                        switch(c)
                        {
                            case 0: // black
                                red = 0;
                                green = 0;
                                blue = 0;
                                intensity = 0;
                                break;
                            case 1: // red
                                red = 3;
                                green = 0;
                                blue = 0;
                                intensity = 0;
                                break;
                            case 2:  // dark blue
                                red = 0;
                                green = 0;
                                blue = 3;
                                intensity = 0;
                                break;
                            case 3: // purple
                                red = 3;
                                green = 0;
                                blue = 3;
                                intensity = 0;
                                break;
                            case 4: // Dark Green
                                red = 0;
                                green = 3;
                                blue = 0;
                                intensity = 0;
                                break;
                            case 5: // Gray 1
                                red = 1;
                                green = 1;
                                blue = 1;
                                intensity = 0;
                                break;
                            case 6: // Medium Blue
                                red = 1;
                                green = 1;
                                blue = 3;
                                intensity = 0;
                                break;
                            case 7: // Light Blue
                                red = 2;
                                green = 2;
                                blue = 3;
                                intensity = 1;
                                break;
                            case 8: // Brown
                                red = 3;
                                green = 2;
                                blue = 0;
                                intensity = 0;
                                break;
                            case 9: // orange
                                red = 3;
                                green = 1;
                                blue = 0;
                                intensity = 0;
                                break;
                            case 10: // Gray 2
                                red = 2;
                                green = 2;
                                blue = 2;
                                intensity = 0;
                                break;
                            case 11: // Pink
                                red = 3;
                                green = 1;
                                blue = 1;
                                intensity = 0;
                                break;
                            case 12: // Light Green
                                red = 2;
                                green = 3;
                                blue = 2;
                                intensity = 0;
                                break;
                            case 13: // Yellow
                                red = 3;
                                green = 3;
                                blue = 0;
                                intensity = 0;
                                break;
                            case 14: // Aqua
                                red = 0;
                                green = 3;
                                blue = 3;
                                intensity = 0;
                                break;
                            case 15: // White
                                red = 3;
                                green = 3;
                                blue = 3;
                                intensity = 3;
                                break;
                        }

                        b = (byte)((red & 3) | (green & 3) << 2 | (blue & 3) << 4 | (intensity & 3) << 6);
                        mem[address] = (byte)b;

                    }
                }
            }

            // font rom memory populated, now output
            Console.WriteLine("maxaddress=0x{0:X}", maxaddress);
            FileStream fsfontrom = new FileStream("fontrom.dat", FileMode.Create);
            BinaryWriter bw = new BinaryWriter(fsfontrom);
            for (int i = 0; i < 0x80000; i++)
            {
                bw.Write(mem[i]);
            }
            bw.Flush();
            bw.Close();
            fsfontrom.Close();
        }
    }
}
