#include "sdcard.h"
#include "stdio.h"
#include "stdlib.h"

int SDCard::Init()
{
    FRESULT fr;
    FIL fil;

    if (!sd_init_driver()) 
    {
        return -1;
    }

    return 0;
}

int SDCard::Mount()
{
    FRESULT fr;

    fr = f_mount(&_fs, "0:", 1);
    if (fr != FR_OK)
    {
        return -1;
    }

    return 0;
}

void SDCard::Unmount()
{
    f_unmount("0:");
}


int SDCard::GetEntries(
        const char *directory, 
        vector<std::string> &vecEntries
        )
{
    FRESULT fr = FR_OK;
    DIR dp = {};
    FILINFO info = {};
    const char * filter = "*";
    char entry[280] = {};
    char buf[255] = {};

    vecEntries.clear();

    if (directory && directory[1])
    {
        sprintf(entry, "<DIR> ..");
        vecEntries.push_back(entry);
    }

    fr = f_findfirst(&dp, &info, directory, filter);

    if (FR_OK != fr)
    {
        sprintf(buf, "f_findfirst failed: %d, directory: %s", fr, directory);
        //PrintRow(ROW_ERROR, buf, COLOR_RED | COLOR_INVERT);
    }

    while(fr == FR_OK && info.fname[0])
    {
        if (info.fattrib & AM_DIR)
        {
            sprintf(entry, "<DIR> %s", info.fname);
            vecEntries.push_back(entry);        
        }
        else
        {
            sprintf(entry, "%s", info.fname);
            vecEntries.push_back(entry);        
        }

        fr = f_findnext(&dp, &info);
    }
    
    f_closedir(&dp);
    
    return 0;
}

int SDCard::GetSubDirectories(
                    const char *directory, 
                    vector<std::string> &vecDirectories)
{
    FRESULT fr = FR_OK;
    DIR dp;
    FILINFO info;
    const char * filter = "*";

    vecDirectories.clear();

    fr = f_findfirst(&dp, &info, directory, filter);
    
    while(fr == FR_OK && info.fname[0])
    {
        if (info.fattrib & AM_DIR)
        {
            vecDirectories.push_back(info.fname);
        }

        fr = f_findnext(&dp, &info);
    }
    
    return 0;
}

int SDCard::GetFilesInDirectory(
                const char * directory, 
                vector<std::string> &vecFiles
                )
{
    FRESULT fr = FR_OK;
    DIR dp = {};
    FILINFO info = {};
    const char * filter = "*";

    vecFiles.clear();

    fr = f_findfirst(&dp, &info, directory, filter);

    while(fr == FR_OK && info.fname[0])
    {
        if (0 == (info.fattrib & AM_DIR))
        {
            vecFiles.push_back(info.fname);
        }

        fr = f_findnext(&dp, &info);
    }

    return 0;
}

int SDCard::OpenAndRead(
                    const char *filename, 
                    vector<uint8_t> &bytes
                    )
{
    FRESULT fr;
    FIL fil = {};
    uint8_t buf[1024] ={};
    uint cRead = 0;

    bytes.clear();

    fr = f_open(&fil, filename, FA_READ);
    if (fr != FR_OK)
    {
        return fr;
    }

    while (f_read(&fil, buf, sizeof(buf), &cRead) == FR_OK)
    {
        for(int i = 0; i < cRead; i++)
        {
            bytes.push_back(buf[i]);
        }

        if (cRead < sizeof(buf))
        {
            break;
        }
    }

    
    fr = f_close(&fil);
    if (fr != FR_OK)
    {
        return fr;
    }

    return 0;
}

int SDCard::WriteFile(const char *filename, vector<uint8_t> &bytes)
{
    FRESULT fr;
    FIL fil;
    UINT written = 0;

    while(bytes.size() < 256)
    {
        bytes.push_back((uint8_t)0);
    }

    fr = f_open(&fil, filename, FA_WRITE | FA_CREATE_ALWAYS);
    if (fr != FR_OK)
    {
        return fr;
    }

    fr = f_write(&fil, bytes.data(), bytes.size(), &written);

    f_close(&fil);

    return 0;
}

int SDCard::OpenAndReadAtByte(const char *filename, int pos, int size, vector<uint8_t> &bytes)
{
    FRESULT fr;
    FIL fil = {};
    uint8_t buf[1024] ={};
    uint cRead = 0;

    bytes.clear();

    fr = f_open(&fil, filename, FA_READ | FA_WRITE);
    if (fr != FR_OK)
    {
        return fr;
    }

    fr = f_lseek(&fil, pos);
    if (fr == FR_OK)
    {        
        long readsize = min(sizeof(buf), (uint)size);
        while (f_read(&fil, buf, readsize, &cRead) == FR_OK)
        {
            for(int i = 0; i < cRead; i++)
            {
                bytes.push_back(buf[i]);
            }

            if (cRead < sizeof(buf))
            {
                break;
            }
        }
    }

    while(bytes.size() < size)
    {
        bytes.push_back(0);
    }
    
    fr = f_close(&fil);
    if (fr != FR_OK)
    {
        return fr;
    }

    return 0;
}

int SDCard::OpenAndWriteAtByte(const char *filename, int pos, vector<uint8_t> &bytes)
{
    FRESULT fr;
    FIL fil;
    UINT written = 0;

    while(bytes.size() < 256)
    {
        bytes.push_back((uint8_t)0);
    }

    fr = f_open(&fil, filename, FA_READ | FA_WRITE | FA_OPEN_ALWAYS);
    if (fr != FR_OK)
    {
        return fr;
    }

    fr = f_lseek(&fil, pos);
    if (fr != FR_OK)
    {
        return fr;
    }

    fr = f_write(&fil, bytes.data(), bytes.size(), &written);

    f_close(&fil);

    return 0;
}

int SDCard::DeleteFile(const char *path)
{
    return f_unlink(path);
}
