#pragma once

using namespace std;

#include <vector>
#include <string>
#include <stdio.h>
#include "pico/stdlib.h"
#include "sd_card.h"


class SDCard
{
    public:

    int Init();
    int Mount();
    void Unmount();
    int GetSubDirectories(const char *path, vector<std::string> &vecDirectories);
    int GetFilesInDirectory(const char * directory, vector<std::string> &vecFiles);
    int GetEntries(const char * directory, vector<std::string> &vecEntries);
    int OpenAndRead(const char *filename, vector<uint8_t> &bytes);
    int WriteFile(const char *filename, vector<uint8_t> &bytes);

    int OpenAndReadAtByte(const char *filename, int pos, int size, vector<uint8_t> &bytes);
    int OpenAndWriteAtByte(const char *filename, int pos, vector<uint8_t> &bytes);
    int DeleteFile(const char *filename);
    
private:
    FATFS _fs;
};