const int _datapins[] =  {22, 24, 26, 28, 30, 32, 34, 36};
const int _addrpins[] =  {39, 41, 43, 45};
// 47, 49, 51, 53
const int _selectDrive = 47;
const int _selectCom = 49;
const int _readWrite = 51;
const int _phi2 = 53;

bool _readMode = false;
bool _clockHigh = false;
char _buf[255];
uint8_t _addr = 0;

void SetReadWrite(bool read)
{
  _readMode = read;
  digitalWrite(_readWrite, read);

  for(int i = 0; i < 8; i++)
  {
    pinMode(_datapins[i], read ? INPUT : OUTPUT);
  } 
}

void WriteData(uint8_t data)
{
  if (!_readMode)
  {
    for(int i = 0; i < 8; i++)
    {
      bool bitset = (data << i) != 0;
      digitalWrite(_datapins[i], bitset);
    }
  }
}

void WriteAddress(uint8_t addr)
{
    for(int i = 0; i < 4; i++)
    {
      bool bitset = ((addr >> i) & 1) == 1;
      digitalWrite(_addrpins[i], bitset);
    }
}

uint8_t ReadData()
{
  uint8_t val = 0;
  if (_readMode)
  {
    for(int i = 0; i < 8; i++)
    {
      bool isSet = digitalRead(_datapins[i]);
      val |= ((isSet ? 1 : 0) << i);
    }
  }

  return val;
}

void setup() 
{
  Serial.begin(9600);
  Serial.println("setting up");
  // put your setup code here, to run once:
  for(int i = 0; i < 4; i++)
  {
    pinMode(_addrpins[i], OUTPUT);
  }

  pinMode(_selectDrive, OUTPUT);
  pinMode(_selectCom, OUTPUT);
  pinMode(_readWrite, OUTPUT);
  pinMode(_phi2, OUTPUT);

  digitalWrite(_selectCom, false);
  digitalWrite(_selectDrive, true);

  SetReadWrite(true);
}

void loop() {
  // put your main code here, to run repeatedly:

  if (_clockHigh)
  {
    _addr++;
    _addr = _addr % 2;
    WriteAddress(_addr);
  }
  
  digitalWrite(_phi2, _clockHigh);
  _clockHigh = !_clockHigh;

  delay(200);

//  uint8_t val = ReadData();
//  sprintf(_buf,"data=%02x : addr=%02x", val, _addr);
//  Serial.println(_buf);
}
