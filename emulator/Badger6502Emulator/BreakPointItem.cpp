#include "pch.h"
#include "BreakPointItem.h"
#if __has_include("BreakPointItem.g.cpp")
#include "BreakPointItem.g.cpp"
#endif
#include "vm.h"

namespace winrt::Badger6502Emulator::implementation
{

	BreakPointItem::BreakPointItem()
	{
		_data = 0;
		_target = BreakPointTarget::PC;
	}
	
	void BreakPointItem::Text(hstring t)
	{
		_text = t;
	}

	hstring BreakPointItem::Text()
	{
		return _text;
	}

	void BreakPointItem::Target(BreakPointTarget t)
	{
		_target = t;
	}

	BreakPointTarget BreakPointItem::Target()
	{
		return _target;
	}

	void BreakPointItem::Data(int16_t i)
	{
		_data = i;
	}

	int16_t BreakPointItem::Data()
	{
		return _data;
	}

	bool BreakPointItem::EvaluateBreakpoint(CPU* pCPU, uint16_t addr, uint8_t data)
	{
		UNREFERENCED_PARAMETER(data);

		switch (_target)
		{
		case BreakPointTarget::PC:
			if (pCPU->PC == _data)
			{
				return true;
			}
			break;
		case BreakPointTarget::SP:
			if (pCPU->SP == _data)
			{
				return true;
			}
			break;
		case BreakPointTarget::A:
			if (pCPU->A == _data)
			{
				return true;
			}
			break;
		case BreakPointTarget::X:
			if (pCPU->X == _data)
			{
				return true;
			}
			break;
		case BreakPointTarget::Y:
			if (pCPU->Y == _data)
			{
				return true;
			}
			break;
		case BreakPointTarget::OpCode:
			if (pCPU->_OpCode == _data)
			{
				return true;
			}
			break;
		case BreakPointTarget::MemoryWrite:
			if (addr == _data)
			{
				return true;
			}
			break;
		}

		return false;
	}
}
