#pragma once
#include "ResizeBorder.g.h"
#include "vm.h"

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Foundation::Numerics;
using namespace Windows::UI::Core;
using namespace Microsoft::UI::Input;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Input;

namespace winrt::Badger6502Emulator::implementation
{
	struct ResizeBorder : ResizeBorderT<ResizeBorder>
	{
		ResizeBorder();

		ResizeOrientation Orientation();
		void Orientation(ResizeOrientation value);

		void OnPointerPressed(PointerRoutedEventArgs const&);
		void OnPointerMoved(PointerRoutedEventArgs const&);
		void OnPointerReleased(PointerRoutedEventArgs const&);
		void OnPointerCaptureLost(PointerRoutedEventArgs const&);
		void OnPointerEntered(PointerRoutedEventArgs const& /* e */);
		void OnPointerExited(PointerRoutedEventArgs const& /* e */) ;

		bool _isResizable;
		bool _dragging = false;

		InputCursor cursorWestEast = nullptr;
		InputCursor cursorNorthSouth = nullptr;
		InputCursor cursorArrow = nullptr;

		float _lastX = 0.0f;
		float _lastY = 0.0f;

		UIElement _left = nullptr;
		UIElement _right = nullptr;

		ResizeOrientation _orientation;

	};
}

namespace winrt::Badger6502Emulator::factory_implementation
{
	struct ResizeBorder : ResizeBorderT<ResizeBorder, implementation::ResizeBorder>
	{
	};
}

