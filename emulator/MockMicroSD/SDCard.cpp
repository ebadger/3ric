#include "pch.h"
#include "stdlib.h"
#include <wchar.h>


/*
sd_cmd0_bytes
  .byte $40, $00, $00, $00, $00, $95
sd_cmd8_bytes
  .byte $48, $00, $00, $01, $aa, $87
sd_cmd55_bytes
  .byte $77, $00, $00, $00, $00, $01
sd_cmd41_bytes
  .byte $69, $40, $00, $00, $00, $01
*/

const int c_clusterSize = 512;

uint32_t SDCard::LoadImageFile(wchar_t* filename)
{
	return _mappedFile.MapFile(filename);
}

void SDCard::SetCS(bool level)
{
	_cs = level;

	if (_cs)
	{
		if (_mode == MODE_READSECTOR)
		{
			_mode = MODE_COMMAND;
		}
	}
}

void SDCard::SetMOSI(bool level)
{
	_mosi = level;

}

void SDCard::SetSCK(bool level)
{
	wchar_t buf[255];

	if (_cs)
	{
		// if chip select is high, do nothing
		return;
	}

	if (!level)
	{
		return;
	}

	if (MODE_READSECTOR_ACK == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_READSECTOR_START;
			_response = 0xfe;
			_bits = 0;
		}
		return;
	}
	else if (MODE_READSECTOR_START == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_READSECTOR;
			_bits = 0;
		}
		return;

	}
	else if (MODE_WRITESECTOR_ACK == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_WRITESECTOR_START;
			_bits = 0;
		}
		return;
	}
	else if (MODE_WRITESECTOR_START == _mode)
	{
		_byteIn <<= 1;
		_byteIn |= _mosi ? 1 : 0;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_WRITESECTOR;
			_bits = 0;
			_byteIn = 0;
			_byteCount = 0;
		}
		return;
	}
	else if (MODE_WRITESECTOR_COMPLETE == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_GO_IDLE;
			_response = 0xff;
			_bits = 0;
		}
		return;
	}

	else if (MODE_GO_IDLE == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_COMMAND;
			_bits = 0;
		}
		return;
	}
	else if (MODE_SEND_IF_COND == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_OUTPUT_STATUS;
			_bits = 0;
		}
		return;
	}
	else if (MODE_OUTPUT_STATUS == _mode)
	{
		_miso = (_status >> _bits) & 1;
		_bits++;

		if (_bits == 32)
		{
			_mode = MODE_COMMAND;
			_bits = 0;
		}
		return;
	}
	else if (MODE_APP_COMMAND == _mode)
	{
		_miso = (_response >> (7-_bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_COMMAND;
			_bits = 0;
		}
		return;
	}
	else if (MODE_APP_SEND_OP_COND == _mode)
	{
		_miso = (_response >> (7 - _bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_mode = MODE_COMMAND;
			_bits = 0;
		}
		return;
	}

	if (MODE_COMMAND == _mode)
	{
		// on rising clock when CS is down, let's look at MOSI
		_byteIn <<= 1;
		_byteIn |= _mosi ? 1 : 0;
		_bits++;

		if (_bits < 8)
		{
			return;
		}

		_command[_commandByte++] = _byteIn;

		_bits = 0;
		_byteIn = 0;

		if (_commandByte == 6)
		{
			_commandByte = 0;

			swprintf_s(buf, _countof(buf), L"%02x %02x %02x %02x %02x %02x\r\n",
				_command[0], _command[1], _command[2], _command[3], _command[4], _command[5]);
			OutputDebugString(buf);

			switch (_command[0])
			{
			case 0x40: // CMD0
				_mode = MODE_GO_IDLE;
				_response = 1;
				break;
			case 0x48: // CMD8
				_mode = MODE_SEND_IF_COND;
				_response = 1;
				break;
			case 0x77: // CMD55
				_mode = MODE_APP_COMMAND;
				_response = 1;
				break;
			case 0x69: // CMD41
				_mode = MODE_APP_SEND_OP_COND;
				_response = 0;
				break;
			case 0x51: // CMD17 - read single block
				_mode = MODE_READSECTOR_ACK;
				_response = 0;
				SetSector();
				break;
			case 0x58:
				_mode = MODE_WRITESECTOR_ACK;
				_response = 0;
				SetSector();
				break;
			}

		}

	}
	else if (MODE_READSECTOR == _mode)
	{
		_miso = (_mappedFile.GetData(_pos) >> (7-_bits)) & 1;
		_bits++;

		if (_bits == 8)
		{
			_bits = 0;
			_pos++;
		}
	}
	else if (MODE_WRITESECTOR == _mode)
	{
		_byteIn <<= 1;
		_byteIn |= _mosi ? 1 : 0;
		_bits++;

		if (_bits == 8)
		{
			_mappedFile.SetData(_pos++, _byteIn);
			_bits = 0;
			_byteIn = 0;

			if (++_byteCount == 512)
			{
				_response = 5;
				_mode = MODE_WRITESECTOR_COMPLETE;
				_byteCount = 0;
			}
		}
	}


}

bool SDCard::GetMISO()
{
	return _miso;
}

void SDCard::SetSector()
{
	_sector = 0;
	_sector =  _command[1] << 24;
	_sector |= _command[2] << 16;
	_sector |= _command[3] << 8;
	_sector |= _command[4];

	_pos = _sector * c_clusterSize;

}