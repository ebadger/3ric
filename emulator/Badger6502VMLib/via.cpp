#include "via.h"

void SetDPins(uint8_t pins, uint8_t dir);
uint8_t ReadDPins();

// via implementation is not complete and not tested for the large variety of scenarios supported
// adding basic skeleton and adding support for my particular PS/2 keyboard scenario

VIA::VIA(VM* p)
{
	_vm = p;
}

void VIA::SignalPin(VIA::Pins pin)
{
	// interrupt behavior is not modeled correctly
	// no modeling of edge triggering, etc...

	switch (pin)
	{
	case CA1:
		if (_register[IER] & 0x2)
		{
			_register[IFR] |= 0x2;
			_vm->GetCPU()->MaskableInterrupt(false);
		}
		break;
	case CA2:
		if (_register[IER] & 0x1)
		{
			_register[IFR] |= 0x1;
			_vm->GetCPU()->MaskableInterrupt(false);
		}
		break;

	case CB1:
		if (_register[IER] & 0x10)
		{
			_register[IFR] |= 0x10;
			_vm->GetCPU()->MaskableInterrupt(false);
		}
		break;
	case CB2:
		if (_register[IER] & 0x08)
		{
			_register[IFR] |= 0x08;
			_vm->GetCPU()->MaskableInterrupt(false);
		}
		break;
	}
}

uint8_t VIA::ReadRegister(uint8_t reg)
{
	uint8_t pins = 0;
/*
	When reading the Peripheral Port (PA or PB), the contents of the corresponding Input Register (IRA or IRB)
	is transferred onto the Data Bus. When the input latching feature is disabled, IRA will reflect the logic levels
	present on the PA bus pins. However, with input latching enabled and the selected active transition on
	Peripheral A Control 1 (CA1) having occurred, IRA will contain the data present on the PA bus lines at the
	time of the transition. In this case, once IRA has been read, it will appear transparent, reflecting the current
	state of the PA bus pins until the next CA1 latching transition.
	With respect to IRB, it operates similar to IRA except that for those PB bus pins that have been programmed
	as outputs, there is a difference. When reading IRA, the logic level on the pins determines whether logic 1
	or 0 is read. However, when reading IRB, the logic level stored in ORB is the logic level read. For this
	reason, those outputs which have large loading effects may cause the reading of IRA to result in the reading
	of a logic 0 when a 1 was actually programmed, and reading logic 1 when a 0 was programmed. However,
	when reading IRB, the logic level read will be correct, regardless of loading on the particular pin.
*/

	switch (reg)
	{
	case IER:
		return _register[IER] | 0x80;

	case IFR:
/*
		BIT SET BY                 CLEARED BY
		------------------------------------------------------------
		0   CA2                    active edge Read or write ORA*
		1   CA1                    active edge Read or write ORA
		2   Complete 8 shifts      Read or write Shift Reg.
		3   CB2 active edge        Read or write ORB*
		4   CB1 active edge        Read or write ORB
		5   Time out of T2         Read T2 low or write T2 high
		6   Time out of T1         Read T1C-L low or write T1L-H high
		7   Any enabled interrupt  Clear all interrupts

		If the CA2 / CB2 control in the PCR is selected as "independent" interrupt input, then reading or writing
		the output register ORA / ORB will not clear the flag bit. Instead, the bit must be cleared by writing into
		the IFR, as described previously.
*/
		return _register[IFR] | 0x80;


	case ORA_IRA_2:
	case ORA_IRA:
		// clear IFR flag for CA1
		// clear IFR flag for CA2 unless PCR has independent interrupt set
		_register[IFR] &= 0xFD;

		if ((_register[PCR] & 0x6) == 0x6 || (_register[PCR] & 0x6) == 0x2)
		{
			_register[IFR] &= 0xFE;
		}

		//_register[reg] = ReadDPins();
		pins = ReadDPins();
		pins = pins & ~(_register[DDRA]);
		return pins;

	case ORB_IRB:
		// clear IFR flag for CB1
		// clear IFR flag for CB2 unless PCR has independent interrupt set
		_register[IFR] &= 0xEF;

		if ((_register[PCR] & 0x60) == 0x60 || (_register[PCR] & 0x60) == 0x20)
		{
			_register[IFR] &= 0xF7;
		}

		return _register[ORB_IRB];

	case DDRA:
		// latching behavior doesn't match spec
		return _register[DDRA];

	case DDRB:
		// latching behavior doesn't match spec
		return _register[DDRB];

	case PCR:
		return _register[PCR];

//5   Time out of T2         Read T2 low or write T2 high
//6   Time out of T1         Read T1C - L low or write T1L - H high

	case T1CH:
		// counter behavior not implemented
		return _register[T1CH];

	case T1CL:
		// counter behavior not implemented
		// clear bit 4 in the IFR
		_register[IFR] &= 0xEF;
		return _register[T1CL];

	case T2CH:
		// counter behavior not implemented
		return _register[T2CH];

	case T2CL:
		// clear bit 5 in the IFR
		_register[IFR] &= 0xDF;
		return _register[T2CL];

	case T1LH:
		return _register[T1LH];

	case T1LL:
		return _register[T1LL];

	case SR:
		// clear bit 2 of the IFR
		_register[IFR] &= 0xFB;
		return _register[SR];

	case ACR:
		return _register[ACR];
	}

	return 0;
}

void VIA::WriteRegister(uint8_t reg, uint8_t data)
{
	uint8_t temp;

	switch (reg)
	{
	case IER:
		
/*
	Each Interrupt Flag within the IFR has a corresponding enable bit in IER.The microprocessor can set or
	clear selected bits within the IER.This allows the control of individual interrupts without affecting others.To
	set or clear a particular Interrupt Enable bit, the microprocessor must write to the IER address.During this
	write operation, if IER7 is Logic 0, each Logic 1 in IER6 thru IER0 will clear the corresponding bit in the IER.
	For each Logic 0 in IER6 thru IER0, the corresponding bit in the IER will be unaffected.
	Setting selected bits in the IER is accomplished by writing to the same address with IER7 set to a Logic 1.
	In this case, each Logic 1 in IER6 through IER0 will set the corresponding bit to a Logic 1. For each Logic 0
	the corresponding bit will be unaffected.This method of controlling the bits in the IER allows convenient
	user control of interrupts during system operation.The microprocessor can also read the contents of the
	IER by placing the proper address on the Register Select and Chip Select inputs with the RWB line high.
	IER7 will be read as a Logic 1.
*/

		if (data & 0x80)
		{
			// clear bit set
			// not the IFR and AND with data to clear the bits

			// IER  D  Res
			// -----------
			//  1   1   0
			//  1   0   0
			//  0   1   1
			//  0   0   0

			_register[IER] = ~_register[IER];
			_register[IER] &= data;
		}
		else
		{
			_register[IER] |= data;
		}

		_register[IER] |= 0x80;
		break;

	case IFR:
		
/*
The IFR and IER format and operation is shown in Tables 2-11 and 2-12. The IFR may be read directly by 
the microprocessor, and individual flag bits may be cleared by writing a Logic 1 into the appropriate bit of the 
IFR. Bit 7 of the IFR indicates the status of the IRQB output. Bit 7 corresponds to the following logic 

function: 
IRQ = (IFR6 && IER6) || (IFR5 && IER5) || (IFR4 && IER4) || (IFR3 && IER3) || (IFR2 && IER2) || (IFR1 && IER1) || (IFR0 && IER0) 

IFR7 is not a flag. Therefore, IFR7 is not directly cleared by writing a Logic 1 into its bit position. It can be 
cleared, however, by clearing all the flags within the register, or by disabling all active interrupts as 
presented in the next section.
*/

		// not the IFR and AND with data to clear the bits

		// IFR  D  Res
		// -----------
		//  1   1   0
		//  1   0   0
		//  0   1   1
		//  0   0   0

		//_register[IFR] = ~_register[IFR];
		_register[IFR] &= (uint8_t)~data;

		if ((_register[IFR] & 0x7F) == 0)  // if all bits are cleared
		{
			_register[IFR] = 0;
		}

		if (_register[IFR] & _register[IER])
		{
			_register[IFR] |= 0x80;
		}
		
		//_register[IFR] = data;
		break;

	case DDRA:
		_register[DDRA] = data;
		SetDPins(_register[ORA_IRA] & _register[DDRA], _register[DDRA]);
		break;

	case DDRB:
		_register[DDRB] = data;
		break;

	case PCR:
		_register[PCR] = data;
		break;

	case T1CH:
		_register[T1CH] = data;
		break;

	case T1CL:
		_register[T1CL] = data;
		break;

	case T2CH:
		// clear bit 5 in the IFR
		_register[IFR] &= 0xDF;

		_register[T2CH] = data;
		break;

	case T2CL:
		_register[T2CL] = data;
		break;

	case T1LH:
		// clear bit 4 in the IFR
		_register[IFR] &= 0xEF;

		_register[T1LH] = data;
		break;

	case T1LL:
		_register[T1LL] = data;
		break;

	case SR:
		// clear bit 2 of the IFR
		_register[IFR] &= 0xFB;

		_register[SR] = data;
		break;

	case ACR:
		_register[ACR] = data;
		break;

	case ORA_IRA_2:
	case ORA_IRA:

		// clear IFR flag for CA1
		// clear IFR flag for CA2 unless PCR has independent interrupt set
		_register[IFR] &= 0xFD;

		if ((_register[PCR] & 0x6) == 0x6 || (_register[PCR] & 0x6) == 0x2)
		{
			_register[IFR] &= 0xFE;
		}

		// only write for pins that DDRA is set for
        // only write the bits where ~register[DDRA] == 1	
		//temp = (~_register[DDRA]) & data;

		// or temp with _register[DDRA] to set all the bits to 1 that are currently set for output
		// we can then and with current register
		//temp |= _register[DDRA];
		temp = data;

		// not sure this is correct

		_register[ORA_IRA] = temp;

		SetDPins(temp & _register[DDRA], _register[DDRA]);

		break;

	case ORB_IRB:
		// clear IFR flag for CB1
		// clear IFR flag for CB2 unless PCR has independent interrupt set
		_register[IFR] &= 0xEF;

		if ((_register[PCR] & 0x60) == 0x60 || (_register[PCR] & 0x60) == 0x20)
		{
			_register[IFR] &= 0xF7;
		}

#if 0
		// only write for pins that DDRB is set for
		// only write the bits where ~register[DDRB] == 1	
		temp = (~_register[DDRB]) & data;

		// or temp with _register[DDRA] to set all the bits to 1 that are currently set for output
		// we can then and with current register
		temp |= _register[DDRB];

		_register[reg] = temp;
#endif
		_register[ORB_IRB] = data;
		break;


	}

}