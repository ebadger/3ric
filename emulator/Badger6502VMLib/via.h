#pragma once

#include <cstdint>

class VM;

class VIA
{
public:
	enum Register
	{
		ORB_IRB = 0,
		ORA_IRA = 1,
		DDRB = 2,
		DDRA = 3,
		T1CL = 4,
		T1CH = 5,
		T1LL = 6,
		T1LH = 7,
		T2CL = 8,
		T2CH = 9,
		SR = 10,
		ACR = 11,
		PCR = 12,
		IFR = 13,
		IER = 14,
		ORA_IRA_2 = 15,
		MAX_ENUM = 16
	};

	enum Pins
	{
		PA,
		PB,
		CB1,
		CB2,
		CA1,
		CA2
	};

	explicit VIA(VM* vm = nullptr);

	bool SignalPin(Pins pin);
	void WriteRegister(uint8_t reg, uint8_t data);
	uint8_t ReadRegister(uint8_t reg);
	void Tick();
	void Reset();

	bool IRQAsserted() const;
	void SetPortAInput(uint8_t data);
	void SetPortAInputBits(uint8_t mask, uint8_t data);
	void SetPortBInput(uint8_t data);
	void SetPortBInputBits(uint8_t mask, uint8_t data);
	uint8_t GetPortAOutput() const;
	uint8_t GetPortBOutput() const;

private:
	static constexpr uint8_t IFR_CA2 = 0x01;
	static constexpr uint8_t IFR_CA1 = 0x02;
	static constexpr uint8_t IFR_SR = 0x04;
	static constexpr uint8_t IFR_CB2 = 0x08;
	static constexpr uint8_t IFR_CB1 = 0x10;
	static constexpr uint8_t IFR_T2 = 0x20;
	static constexpr uint8_t IFR_T1 = 0x40;

	void ClearPortAInterrupts(bool handshake);
	void ClearPortBInterrupts();
	void ClockTimer2();
	uint8_t ReadPortA() const;
	uint8_t ReadPortB() const;

	uint8_t _register[MAX_ENUM] = { 0 };

	uint16_t _t1Latch = 0;
	uint16_t _t1Counter = 0;
	uint16_t _t2Latch = 0;
	uint16_t _t2Counter = 0;
	bool _t1Running = false;
	bool _t1Fired = false;
	bool _t2Running = false;
	bool _t2Fired = false;
	bool _pb7Output = true;

	uint8_t _portAInput = 0xFF;
	uint8_t _portBInput = 0xFF;
};
