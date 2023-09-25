#include "pch.h"
#include "ResizeBorder.h"
#if __has_include("ResizeBorder.g.cpp")
#include "ResizeBorder.g.cpp"
#endif


using namespace winrt;
using namespace Windows::Foundation::Numerics;
using namespace Windows::Foundation;
using namespace Windows::UI::Core;
using namespace Microsoft::UI::Xaml::Input;
using namespace Microsoft::UI::Xaml::Controls;

namespace winrt::Badger6502Emulator::implementation
{
	ResizeBorder::ResizeBorder()
	{
		cursorArrow = InputSystemCursor::Create(InputSystemCursorShape::Arrow);
		cursorWestEast = InputSystemCursor::Create(InputSystemCursorShape::SizeWestEast);
		cursorNorthSouth = InputSystemCursor::Create(InputSystemCursorShape::SizeNorthSouth);

		DefaultStyleKey(winrt::box_value(L"Badger6502Emulator.ResizeBorder"));
	}

	void ResizeBorder::Orientation(ResizeOrientation orient)
	{
		_orientation = orient;
	}

	ResizeOrientation ResizeBorder::Orientation()
	{
		return _orientation;
	}

	void ResizeBorder::OnPointerEntered(PointerRoutedEventArgs const& /* e */)
	{
		if (_orientation == ResizeOrientation::Vertical)
		{
			ProtectedCursor(cursorWestEast);
		}
		else if (_orientation == ResizeOrientation::Horizontal)
		{
			ProtectedCursor(cursorNorthSouth);
		}
	}

	void ResizeBorder::OnPointerExited(PointerRoutedEventArgs const& /* e */)
	{
		ProtectedCursor(cursorArrow);
	}

	void ResizeBorder::OnPointerPressed(PointerRoutedEventArgs const& e)
	{
		CapturePointer(e.Pointer());
		_dragging = true;
	}

	void ResizeBorder::OnPointerMoved(PointerRoutedEventArgs const& e)
	{
		if (_dragging)
		{
			Grid grid = Parent().as<Grid>();

			if (_orientation == ResizeOrientation::Vertical)
			{
				//float diff = e.GetCurrentPoint(grid).Position().X - _lastX;
				_lastX = (float)e.GetCurrentPoint(grid).Position().X;

				auto cd1 = grid.ColumnDefinitions().First().Current();
				cd1.MinWidth(_lastX);
				cd1.MaxWidth(_lastX);
			}
			else if (_orientation == ResizeOrientation::Horizontal)
			{
				//float diff = e.GetCurrentPoint(grid).Position().X - _lastX;
				_lastY = (float)e.GetCurrentPoint(grid).Position().Y;

				auto cd1 = grid.RowDefinitions().First().Current();
				cd1.MinHeight(_lastY);
				cd1.MaxHeight(_lastY);
			}
		}
	}

	void ResizeBorder::OnPointerReleased(PointerRoutedEventArgs const& e)
	{
		ReleasePointerCapture(e.Pointer());
		_dragging = false;
	}

	void ResizeBorder::OnPointerCaptureLost(PointerRoutedEventArgs const&)
	{
		_dragging = false;
	}


}
