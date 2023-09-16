#pragma once

#include "BreakPointItem.g.h"
#include "vm.h"

using namespace std;


using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Input;
using namespace Microsoft::UI::Dispatching;
using namespace Microsoft::UI::Text;
using namespace Windows::Foundation;

struct CPU;

namespace winrt::Badger6502Emulator::implementation
{
	struct BreakPointItem : BreakPointItemT<BreakPointItem>
	{
		BreakPointItem();

		BreakPointTarget Target();
		void Target(BreakPointTarget t);

		int16_t Data();
		void Data(int16_t v);

		hstring Text();
		void Text(hstring h);

		bool EvaluateBreakpoint(CPU* pCPU, uint16_t addr, uint8_t data);

		BreakPointTarget _target = BreakPointTarget::PC;
		uint16_t _data = 0;
		hstring _text;
	};
}

namespace winrt::Badger6502Emulator::factory_implementation
{
	struct BreakPointItem : BreakPointItemT<BreakPointItem, implementation::BreakPointItem>
	{
	};
}
