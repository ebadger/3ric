#!/usr/bin/env node
// 3RIC Talks v1 entry "claude-opus-5-5-run-1" -- offline table generator.
// Copyright (c) 2026 Claude Opus 5.5 via GitHub Copilot, for ebadger. MIT License.
//
// Generates every data table used by tts.s (phoneme inventory, segment
// templates, letter-to-sound rules, formant level pages and the AY volume
// DAC maps) and splices the result between the GENERATED markers in tts.s.
// It also exports a JavaScript reference of the guest letter-to-sound engine
// so test.mjs can check guest/host parity.  Nothing here synthesizes audio.
//
//   node codegen/challenges/tts/v1/submissions/claude-opus-5-5-run-1/generate.mjs
//   node .../generate.mjs --word COMPUTER      (print reference phonemes)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------- timing
export const PHI2_HZ = 25175000 / 16;          // 3RIC CPU clock (VGA dot clock / 16)
export const SAMPLE_CYCLES = 256;               // VIA T1 free-run period (latch 255)
export const FS = PHI2_HZ / SAMPLE_CYCLES;      // ~6146 Hz synthesis rate
const inc = (hz) => Math.max(0, Math.min(127, Math.round(hz * 256 / FS)));
export const TEMPO = 1.1;               // global duration scale
const dur = (ms) => Math.max(1, Math.round(ms * TEMPO * FS / 1000 / 16));   // 16-sample units

// ---------------------------------------------------------------- phonemes
export const PHONEMES = [
  'IY', 'IH', 'EY', 'EH', 'AE', 'AA', 'AO', 'OW', 'UH', 'UW', 'AH', 'AX', 'IX', 'ER', 'AY', 'AW', 'OY',
  'P', 'B', 'T', 'D', 'K', 'G', 'F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'HH', 'CH', 'JH',
  'M', 'N', 'NG', 'L', 'R', 'W', 'Y',
  'WB', 'PCOMMA', 'PPERIOD', 'PQUEST', 'PEXCL', 'NS',
];
export const CODE = Object.fromEntries(PHONEMES.map((p, i) => [p, i + 1]));
const VOWELS = new Set(PHONEMES.slice(0, 17));
const REDUCED = new Set(['AX', 'IX']);
const PUNCT = new Set(['PCOMMA', 'PPERIOD', 'PQUEST', 'PEXCL']);

// flags (PFLAGS): 1 vowel, 2 full vowel, 4 punctuation, 8 marker (WB/NS), 16 sound
export function pflags(p) {
  let f = 0;
  if (VOWELS.has(p)) f |= 1;
  if (VOWELS.has(p) && !REDUCED.has(p)) f |= 2;
  if (PUNCT.has(p)) f |= 4;
  if (p === 'WB' || p === 'NS') f |= 8;
  if (!PUNCT.has(p) && p !== 'WB' && p !== 'NS') f |= 16;
  return f;
}

// Segment template: f formants (Hz), a levels 0..15 (3 dB steps), mode v/a
// (voiced pulse / aspirated random pulses), nv/np AY noise volume/period,
// ms duration, as/fs smoothing shifts (0 = jump), inh = take formants of the
// next sounding phoneme, keep = hold the previous segment's formants,
// vd = vowel (duration follows stress/phrase prosody).
const S = (o) => ({ f: [500, 1500, 2500], a: [0, 0, 0], mode: 'v', nv: 0, np: 1, ms: 50, as: 1, fs: 1, inh: false, keep: false, vd: false, ...o });
const V = (f, a, ms, extra = {}) => S({ f, a, ms, vd: true, ...extra });
const FRONT = [14, 13, 12], MID = [15, 14, 11], BACK = [15, 14, 9];
export const TEMPLATES = {
  IY: [V([270, 2250, 2890], FRONT, 100)],
  IH: [V([400, 1900, 2550], MID, 70)],
  EY: [V([480, 1850, 2500], MID, 90), V([320, 2150, 2750], FRONT, 60, { fs: 2 })],
  EH: [V([550, 1770, 2490], MID, 80)],
  AE: [V([680, 1650, 2450], MID, 110)],
  AA: [V([720, 1100, 2450], BACK, 110)],
  AO: [V([580, 880, 2500], BACK, 110)],
  OW: [V([520, 950, 2400], BACK, 80), V([360, 780, 2300], BACK, 60, { fs: 2 })],
  UH: [V([440, 1030, 2250], BACK, 70)],
  UW: [V([320, 900, 2250], [15, 13, 8], 100)],
  AH: [V([620, 1200, 2550], BACK, 70)],
  AX: [V([500, 1450, 2500], [14, 13, 10], 45)],
  IX: [V([420, 1750, 2500], [14, 13, 10], 45)],
  ER: [V([470, 1350, 1650], [15, 14, 12], 100)],
  AY: [V([700, 1200, 2450], BACK, 90), V([380, 2050, 2650], FRONT, 80, { fs: 2 })],
  AW: [V([700, 1200, 2450], BACK, 90), V([400, 900, 2350], BACK, 80, { fs: 2 })],
  OY: [V([560, 880, 2450], BACK, 80), V([380, 1950, 2600], FRONT, 80, { fs: 2 })],

  P: [S({ f: [250, 900, 2200], ms: 60, as: 0 }), S({ keep: true, nv: 10, np: 8, ms: 10, as: 0 }),
      S({ inh: true, mode: 'a', a: [10, 9, 8], ms: 40, as: 0, fs: 1 })],
  B: [S({ f: [250, 900, 2200], a: [9, 0, 0], ms: 50, as: 0 }), S({ keep: true, a: [9, 0, 0], nv: 7, np: 8, ms: 10, as: 0 })],
  T: [S({ f: [300, 1700, 2600], ms: 55, as: 0 }), S({ keep: true, nv: 12, np: 1, ms: 10, as: 0 }),
      S({ inh: true, mode: 'a', a: [10, 10, 9], ms: 40, as: 0, fs: 1 })],
  D: [S({ f: [300, 1700, 2600], a: [9, 0, 0], ms: 45, as: 0 }), S({ keep: true, a: [9, 0, 0], nv: 9, np: 1, ms: 10, as: 0 })],
  K: [S({ f: [300, 1900, 2400], ms: 60, as: 0 }), S({ keep: true, nv: 12, np: 3, ms: 15, as: 0 }),
      S({ inh: true, mode: 'a', a: [10, 10, 9], ms: 45, as: 0, fs: 1 })],
  G: [S({ f: [300, 1900, 2400], a: [9, 0, 0], ms: 50, as: 0 }), S({ keep: true, a: [9, 0, 0], nv: 9, np: 3, ms: 12, as: 0 })],
  F: [S({ keep: true, nv: 8, np: 1, ms: 90, as: 0 })],
  TH: [S({ keep: true, nv: 7, np: 1, ms: 80, as: 0 })],
  S: [S({ keep: true, nv: 12, np: 1, ms: 100, as: 0 })],
  SH: [S({ f: [400, 1800, 2500], mode: 'a', a: [0, 11, 10], nv: 10, np: 3, ms: 100, as: 0, fs: 0 })],
  V: [S({ f: [300, 1100, 2300], a: [11, 4, 2], nv: 6, np: 1, ms: 60 })],
  DH: [S({ f: [300, 1500, 2500], a: [11, 4, 2], nv: 5, np: 1, ms: 45 })],
  Z: [S({ f: [300, 1600, 2500], a: [11, 3, 2], nv: 10, np: 1, ms: 75 })],
  ZH: [S({ f: [300, 1800, 2500], a: [11, 5, 3], nv: 9, np: 3, ms: 70 })],
  HH: [S({ inh: true, mode: 'a', a: [12, 11, 10], ms: 55, as: 0, fs: 0 })],
  CH: [S({ f: [300, 1800, 2500], ms: 50, as: 0 }), S({ keep: true, nv: 11, np: 1, ms: 8, as: 0 }),
       S({ f: [400, 1800, 2500], mode: 'a', a: [0, 11, 10], nv: 10, np: 3, ms: 60, as: 0, fs: 0 })],
  JH: [S({ f: [300, 1800, 2500], a: [9, 0, 0], ms: 40, as: 0 }), S({ keep: true, a: [9, 0, 0], nv: 8, np: 1, ms: 8, as: 0 }),
       S({ f: [300, 1800, 2500], a: [10, 5, 3], nv: 9, np: 3, ms: 50, as: 0, fs: 0 })],
  M: [S({ f: [270, 1000, 2200], a: [13, 6, 4], ms: 60, fs: 0 })],
  N: [S({ f: [270, 1650, 2600], a: [13, 7, 5], ms: 55, fs: 0 })],
  NG: [S({ f: [270, 2100, 2700], a: [13, 6, 4], ms: 60, fs: 0 })],
  L: [S({ f: [360, 1000, 2700], a: [14, 9, 6], ms: 55 })],
  R: [S({ f: [420, 1150, 1500], a: [14, 10, 8], ms: 55 })],
  W: [S({ f: [300, 700, 2200], a: [14, 8, 4], ms: 50 })],
  Y: [S({ f: [280, 2200, 2900], a: [14, 10, 8], ms: 45 })],
  WB: [],
  NS: [],
  PCOMMA: [S({ keep: true, ms: 180 })],
  PPERIOD: [S({ keep: true, ms: 320 })],
  PQUEST: [S({ keep: true, ms: 320 })],
  PEXCL: [S({ keep: true, ms: 320 })],
};

// ---------------------------------------------------------------- rules
// Original rule set written for this entry.  Syntax:  left[match]right=PHONEMES
// Context classes: | word boundary, # one or more vowels (AEIOUY), . one
// consonant, : zero or more consonants, + E/I/Y, % voiceless letter,
// & voiced consonant letter, @ (right only, last) weak ending such as E|, ES|, ING.
// A trailing 1 marks primary stress; NS marks an unstressed function word.
// Within a letter, the first matching rule wins.
export const RULE_TEXT = `
|[A]|=AX NS
|[ARE]|=AA R NS
|[AS]|=AE Z NS
|[AT]|=AE T NS
|[AN]|=AE N NS
|[AND]|=AE N D NS
|[ANY]|=EH1 N IY
|[MANY]|=M EH1 N IY
|[AGAIN]|=AX G EH1 N
|[ALWAYS]|=AO1 L W EY Z
|[ALSO]|=AO1 L S OW
|[ABOUT]|=AX B AW1 T
|[AFTER]|=AE1 F T ER
|[A]BOU=AX
|[A]GO=AX
|[A]GAIN=AX
|[A]WAY=AX
|[A]LONE=AX
|[A]LONG=AX
|[A]MONG=AX
|[A]ROUND=AX
|[A]LIVE=AX
|[A]HEAD=AX
[AIR]=EH R
[AI]=EY
[AY]=EY
[AUGH]=AO
[AU]=AO
[AW]=AO
[AR]E|=EH R
[A]RR=AE
W[AR]=AO R
[AR]#=EH R
[AR]=AA R
[ALK]=AO K
[ALL]=AO L
[AL]T=AO L
[AL]D=AO L
[ALM]=AA M
|[AL]M=AO L
#:[AL]|=AX L
[A]NGE=EY
[A]STE=EY
[A]TION=EY
[A]BLE|=EY
[A]BLES|=EY
[A].@=EY
[A].Y|=EY
QU[A]L=AA
QU[A]N=AA
W[A]S=AA
W[A]T=AA
W[A]NT=AA
W[A]ND=AA
#:[A]|=AX
[A]=AE
|[BE]|=B IY NS
|[BY]|=B AY NS
|[BUT]|=B AH T NS
|[BEEN]|=B IH N NS
|[BECAUSE]|=B IX K AO1 Z
|[BUSY]|=B IH1 Z IY
|[BUSINESS]|=B IH1 Z N IX S
|[BUILD]=B IH L D
|[BYE]|=B AY
|[BEGIN]=B IX G IH1 N
|[BE]C=B IX
|[BE]F=B IX
|[BE]G=B IX
|[BE]H=B IX
|[BE]L#=B IX
|[BE]TW=B IX
|[BE]Y=B IX
|[BE]SIDE=B IX
M[B]|=
OU[B]T=
E[B]T=
[BB]=B
[B]=B
S[CH]=K
[CH]R=K
[CH]INE=SH
[CH]=CH
[CI]A=SH
[CI]O=SH
[CI]EN=SH
S[C]+=
[C]+=S
[CK]=K
[CC]+=K S
[CC]=K
[C]=K
|[DO]|=D UW NS
|[DOES]|=D AH Z
|[DONE]|=D AH N
|[DOING]|=D UW1 IH NG
[DG]=JH
[DD]=D
[D]=D
|[EYE]|=AY
|[EVERY]=EH1 V R IY
|[EVEN]|=IY1 V AX N
|:[E]|=IY
|:[E]D|=EH
T[ED]|=IX D
D[ED]|=IX D
%[ED]|=T
#:[ED]|=D
CH[E]S|=IX
SH[E]S|=IX
S[E]S|=IX
X[E]S|=IX
Z[E]S|=IX
C[E]S|=IX
G[E]S|=IX
#:[E]S|=
#:[E]|=
#:[E]LY|=
#:[E]MENT=
#:[E]FUL=
#:[E]NESS=
#:[E]NCE|=AX
#:[E]NT|=AX
#:[E]SS|=IX
#:[EN]|=AX N
#:[EL]|=AX L
[EIGH]=EY
[EE]=IY
[EAR]N=ER
[EAR]L=ER
[EAR]TH=ER
[EAR]D=ER
[EAR]CH=ER
[EA]R|=IY
R[EA]DI=IY
[EA]D=EH
[EA]TH=EH
[EA]LTH=EH
[EA]=IY
[EI]=IY
[EY]|=IY
[EY]=EY
[EW]=UW
[E]RE|=IY
|:[E]RY=EH
[ER]|=ER
[ER]#=EH R
[ER]=ER
[E]=EH
|[FOR]|=F AO R NS
|[FROM]|=F R AH M NS
|[FRIEND]=F R EH N D
#:[FUL]=F AX L
[FF]=F
[F]=F
|[GIVE]|=G IH V
|[GI]V=G IH
|[GET]=G EH T
|[GONE]|=G AO N
|[G]EN=JH
|[G]EM=JH
|[G]ERM=JH
|[GH]=G
[GH]=F
[GG]=G
|[G]N=
[G]N|=
[G]E|=JH
[G]ES|=JH
[G]ED|=JH
[G]Y=JH
N[G]E=JH
#[G]I=JH
[G]=G
|[HAVE]|=HH AE V NS
|[HAS]|=HH AE Z NS
|[HAD]|=HH AE D NS
|[HE]|=HH IY NS
|[HER]|=HH ER NS
|[HIS]|=HH IH Z NS
|[HIM]|=HH IH M NS
|[HOUR]=AW ER
[H]#=HH
[H]=
|[I]|=AY1
|[IS]|=IH Z NS
|[IN]|=IH N NS
|[IT]|=IH T NS
|[IF]|=IH F NS
|[INTO]|=IH1 N T UW
[IGH]=AY
|:[IE]|=AY
|:[IE]S|=AY Z
|:[IE]D|=AY D
[IE]S|=IY Z
[IE]D|=IY D
[IE]=IY
CH[I]NE=IY
[I]ND|=AY
[I]NDS|=AY
[I]LD=AY
[I]GN=AY
[IR]E=AY R
[IR]=ER
#:[I]VE|=IH
#:[I]CE|=IH
[I].@=AY
[I]A=IY
[I]OUS=IY
[I]O=IY
[I]=IH
[J]=JH
|[K]N=
[K]=K
[LL]=L
.[LE]|=AX L
.[LE]S|=AX L
.[LE]D|=AX L
[L]=L
[MM]=M
[M]=M
|[NO]|=N OW
|[NOT]|=N AA T
A[N]GE=N
E[N]GE=N
[NG]L=NG G
[NG]=NG
[N]K=NG
[NN]=N
[N]=N
|[OF]|=AX V NS
|[ON]|=AA N NS
|[OR]|=AO R NS
|[ONE]|=W AH N
|[ONES]|=W AH N Z
|[ONCE]|=W AH N S
|[ONLY]|=OW1 N L IY
|[OUR]|=AW ER
|[OH]|=OW
|[OTHER]=AH1 DH ER
|C[O]ME=AH
|C[O]MING=AH
|C[O]M.=AX
|C[O]N.=AX
[OUGHT]=AO T
[OUGH]=AH F
[OUL]D=UH
[OUR]=AO R
#:[OUS]|=AX S
[OU]P=UW
[OU]=AW
[OO]K=UH
G[OO]D=UH
W[OO]D=UH
T[OO]D=UH
F[OO]T=UH
[OO]R=AO R
[OO]=UW
[OA]=OW
[O]ING=OW
[OI]=OY
[OY]=OY
|H[OW]|=AW
|N[OW]|=AW
|C[OW]|=AW
|W[OW]|=AW
#:[OW]|=OW
[OW]|=OW
|[OWN]=OW N
KN[OWN]=OW N
SH[OWN]=OW N
GR[OWN]=OW N
BL[OWN]=OW N
THR[OWN]=OW N
FL[OWN]=OW N
[OW]N=AW
[OW]ER=AW
[OW]EL=AW
|[OWL]=AW L
[OW]=OW
[O]LD=OW
[O]LT=OW
M[O]ST=OW
P[O]ST=OW
H[O]ST=OW
|W[OR].=ER
#:[OR]|=ER
[OR]=AO R
L[O]VE=AH
B[O]VE=AH
M[O]VE=UW
PR[O]VE=UW
|S[O]ME=AH
#:[ON]|=AX N
#:[OM]|=AX M
[O].@=OW
[O]|=OW
[OE]|=OW
[O]=AA
|[PEOPLE]=P IY1 P AX L
[PH]=F
|[P]S=
[PP]=P
[P]=P
[QU]E|=K
[QU]=K W
[Q]=K
[RR]=R
[R]=R
|[SAID]|=S EH D
|[SAYS]|=S EH Z
|[SHE]|=SH IY NS
|[SO]|=S OW
|[SURE]=SH UH R
[SH]=SH
[SSI]ON=SH
#[SI]ON=ZH
[SI]ON=SH
#[S]UR=ZH
#[S]UAL=ZH
[SS]=S
OU[S]E=S
EA[S]E|=Z
|:A[S]E|=S
OO[S]E=S
#[S]#=Z
'[S]|=Z
KE[S]|=S
PE[S]|=S
TE[S]|=S
FE[S]|=S
E[S]|=Z
&[S]|=Z
[S]=S
|[THE]|=DH AX NS
|[TO]|=T UW NS
|[THAT]|=DH AE T NS
|[THIS]|=DH IH S
|[THAN]|=DH AE N NS
|[THEN]|=DH EH N
|[THEM]|=DH EH M NS
|[THEY]|=DH EY NS
|[THERE]|=DH EH R
|[THEIR]|=DH EH R
|[THESE]|=DH IY Z
|[THOSE]|=DH OW Z
|[THUS]|=DH AH S
|[THOUGH]|=DH OW
|[THROUGH]|=TH R UW
|[TWO]|=T UW
|[TO]DAY=T AX
|[TO]GETHER=T AX
#[TH]ER=DH
[TH]E|=DH
[TH]=TH
[TI]ON=SH
[TI]A=SH
[TI]EN=SH
[TURE]=CH ER
[TU]A=CH UW
[TCH]=CH
S[T]EN|=
S[T]LE|=
[TT]=T
[T]=T
|[UP]|=AH P
|[US]|=AH S
|[U]NI=Y UW
|[UN]=AH N
[UR]E|=Y UH R
[UR]#=UH R
[UR]=ER
|[U].@=Y UW
R[U].@=UW
L[U].@=UW
J[U].@=UW
T[U].@=UW
D[U].@=UW
N[U].@=UW
S[U].@=UW
[U].@=Y UW
M[U]SIC=Y UW
[UI]=UW
[UE]|=UW
B[U]LL=UH
P[U]LL=UH
F[U]LL=UH
P[U]SH=UH
B[U]SH=UH
P[U]T|=UH
[UY]=AY
[U]=AH
[V]=V
|[WAS]|=W AA Z NS
|[WE]|=W IY NS
|[WERE]|=W ER NS
|[WHERE]|=W EH R
|[WITH]|=W IH DH NS
|[WHO]=HH UW
|[WH]OLE=HH
|[WOMAN]|=W UH1 M AX N
|[WOMEN]|=W IH1 M IX N
|[WATER]|=W AO1 T ER
|[WR]=R
[WH]=W
[W]=W
|[X]=Z
[X]=K S
|[YOU]|=Y UW
|[YOUR]|=Y AO R
|[YOUNG]=Y AH NG
|[YES]|=Y EH S
|:[Y]|=AY
|[Y]=Y
[Y].@=AY
#:[Y]|=IY
[Y]=IH
[ZZ]=Z
[Z]=Z
[']=
`;

export const DIGIT_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
export const SUFFIXES = ['E|', 'ES|', 'ED|', 'ER|', 'ERS|', 'EN|', 'ELY', 'EMENT', 'EFUL', 'ENESS', 'ING', 'ABLE'];

// ---------------------------------------------------------------- character classes
const isLetter = (c) => (c >= 'A' && c <= 'Z') || c === "'";
const isVowel = (c) => c.length === 1 && 'AEIOUY'.includes(c);
const isCons = (c) => c >= 'A' && c <= 'Z' && !'AEIOUY'.includes(c);
const CLASS_TESTS = {
  '.': isCons,
  '+': (c) => c.length === 1 && 'EIY'.includes(c),
  '%': (c) => c.length === 1 && 'CFKPSTXH'.includes(c),
  '&': (c) => c.length === 1 && 'BDGLMNRVWY'.includes(c),
};
const CLASS_CODE = { '#': 0x81, '.': 0x82, ':': 0x83, '+': 0x84, '%': 0x85, '@': 0x86, '&': 0x87, '|': 0x20 };

export function parseRules(text = RULE_TEXT) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^\[]*)\[([^\]]+)\]([^=]*)=(.*)$/.exec(line);
    if (!m) throw new Error(`bad rule: ${line}`);
    const [, left, match, right, phon] = m;
    const toks = phon.trim() ? phon.trim().split(/\s+/) : [];
    const codes = toks.map((t) => {
      const stress = t.endsWith('1');
      const name = stress ? t.slice(0, -1) : t;
      if (!(name in CODE)) throw new Error(`bad phoneme ${t} in ${line}`);
      return CODE[name] | (stress ? 0x80 : 0);
    });
    if (right.includes('@') && right.indexOf('@') !== right.length - 1) throw new Error(`@ must be last: ${line}`);
    if (left.includes('@')) throw new Error(`@ only allowed on the right: ${line}`);
    rules.push({ line, left, match, right, codes });
  }
  return rules;
}

// Matcher semantics (mirrors the 65C02 engine exactly; w(i) is ' ' outside the word).
function matchLeft(w, j, left) {
  for (let n = left.length - 1; n >= 0; n--) {
    const c = left[n];
    if (c === '#') {
      let cnt = 0;
      while (isVowel(w(j))) { j--; cnt++; }
      if (!cnt) return false;
    } else if (c === ':') {
      while (isCons(w(j))) j--;
    } else if (c === '|') {
      if (isLetter(w(j))) return false;
      j--;
    } else if (CLASS_TESTS[c]) {
      if (!CLASS_TESTS[c](w(j))) return false;
      j--;
    } else {
      if (w(j) !== c) return false;
      j--;
    }
  }
  return true;
}
function matchSuffix(w, k) {
  for (const s of SUFFIXES) {
    let ok = true;
    for (let n = 0; n < s.length; n++) {
      const c = s[n], wc = w(k + n);
      if (c === '|' ? isLetter(wc) : wc !== c) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function matchRight(w, k, right) {
  for (const c of right) {
    if (c === '#') {
      let cnt = 0;
      while (isVowel(w(k))) { k++; cnt++; }
      if (!cnt) return false;
    } else if (c === ':') {
      while (isCons(w(k))) k++;
    } else if (c === '|') {
      if (isLetter(w(k))) return false;
      k++;
    } else if (c === '@') {
      return matchSuffix(w, k);
    } else if (CLASS_TESTS[c]) {
      if (!CLASS_TESTS[c](w(k))) return false;
      k++;
    } else {
      if (w(k) !== c) return false;
      k++;
    }
  }
  return true;
}

let RULES_BY_LETTER = null;
function rulesByLetter() {
  if (RULES_BY_LETTER) return RULES_BY_LETTER;
  RULES_BY_LETTER = {};
  for (const r of parseRules()) (RULES_BY_LETTER[r.match[0]] ||= []).push(r);
  return RULES_BY_LETTER;
}

// Word (uppercase letters/apostrophes) -> phoneme codes including stress.
export function wordToCodes(word) {
  const w = (i) => (i >= 1 && i <= word.length ? word[i - 1] : ' ');
  const out = [];
  let i = 1;
  const byLetter = rulesByLetter();
  while (i <= word.length) {
    const list = byLetter[word[i - 1]] || [];
    let done = false;
    for (const r of list) {
      if (!matchLeft(w, i - 1, r.left)) continue;
      let k = i + 1, ok = true;
      for (let n = 1; n < r.match.length; n++, k++) if (w(k) !== r.match[n]) { ok = false; break; }
      if (!ok || !matchRight(w, k, r.right)) continue;
      out.push(...r.codes);
      i = k;
      done = true;
      break;
    }
    if (!done) i++;
  }
  // stress: explicit or NS wins; otherwise first full vowel, else first vowel
  if (!out.some((c) => c & 0x80) && !out.includes(CODE.NS)) {
    let idx = out.findIndex((c) => pflags(PHONEMES[c - 1]) & 2);
    if (idx < 0) idx = out.findIndex((c) => pflags(PHONEMES[c - 1]) & 1);
    if (idx >= 0) out[idx] |= 0x80;
  }
  return out;
}

export const MAX_WORD = 60;
// Whole-text reference: returns the phoneme code stream exactly as the guest's PHB.
export function textToCodes(text) {
  const out = [];
  const up = text.toUpperCase();
  let p = 0;
  while (p < up.length) {
    const c = up[p];
    if (isLetter(c)) {
      let wd = '';
      while (p < up.length && isLetter(up[p]) && wd.length < MAX_WORD) wd += up[p++];
      out.push(...wordToCodes(wd), CODE.WB);
    } else if (c >= '0' && c <= '9') {
      out.push(...wordToCodes(DIGIT_WORDS[c.charCodeAt(0) - 48]), CODE.WB);
      p++;
    } else {
      if (c === ',' || c === ';' || c === ':') out.push(CODE.PCOMMA);
      else if (c === '.') out.push(CODE.PPERIOD);
      else if (c === '?') out.push(CODE.PQUEST);
      else if (c === '!') out.push(CODE.PEXCL);
      p++;
    }
  }
  return out;
}
export const codesToText = (codes) => codes.map((c) => PHONEMES[(c & 0x7f) - 1] + (c & 0x80 ? '1' : '')).join(' ');

// ---------------------------------------------------------------- DAC and level tables
export const AY_VOLUMES = [0, 0.00999, 0.01445, 0.02106, 0.0307, 0.04555, 0.0645, 0.10736,
  0.12659, 0.20499, 0.29221, 0.37284, 0.49253, 0.63532, 0.80558, 1.0];
// Two-channel volume sum at index 252.  Register 8 (the coarse level) is written
// ~29 cycles before register 9, so register 9 is limited to small volumes: this
// keeps the transient mismatch small (modelled SNR ~28 dB versus ~10 dB for an
// unconstrained nearest-pair map at full scale).
export const DAC_MAX = 0.7;
export const DAC_FINE_MAX = 6;
export const LEVEL_MID = 42;           // one formant table centre
export function dacMaps() {
  const a = [], b = [];
  for (let s = 0; s < 256; s++) {
    const t = Math.min(s, 252) / 252 * DAC_MAX;
    let best = [0, 0], be = 1e9;
    for (let x = 0; x < 16; x++) for (let y = 0; y <= Math.min(x, DAC_FINE_MAX); y++) {
      const e = Math.abs(AY_VOLUMES[x] + AY_VOLUMES[y] - t);
      if (e < be - 1e-9) { be = e; best = [x, y]; }
    }
    a.push(best[0]); b.push(best[1]);
  }
  return { a, b };
}
export function levelPages() {
  const pages = [];
  for (let k = 0; k < 16; k++) {
    const amp = k === 0 ? 0 : LEVEL_MID * Math.pow(10, -(15 - k) * 3 / 20);
    const pg = [];
    for (let n = 0; n < 256; n++) pg.push(Math.max(0, Math.min(84, Math.round(LEVEL_MID + amp * Math.sin(2 * Math.PI * n / 256)))));
    pages.push(pg);
  }
  return pages;
}

// ---------------------------------------------------------------- assembly emitter
const hex2 = (v) => '$' + (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
function byteLines(bytes, per = 16) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += per) lines.push('        .byte ' + bytes.slice(i, i + per).map(hex2).join(','));
  return lines;
}

export function buildGenerated() {
  const L = [];
  L.push('; ---- generated by generate.mjs; do not edit by hand ----');
  L.push(`; synthesis rate ${FS.toFixed(1)} Hz (${SAMPLE_CYCLES} cycles at ${PHI2_HZ} Hz)`);

  PHONEMES.forEach((p, i) => L.push(`PH_${p} = ${i + 1}`));
  const flags = [0], tidx = [0], tcnt = [0], trecs = [];
  for (const p of PHONEMES) {
    flags.push(pflags(p));
    tidx.push(trecs.length);
    tcnt.push(TEMPLATES[p].length);
    for (const t of TEMPLATES[p]) trecs.push(t);
  }
  if (trecs.length > 255) throw new Error('too many templates');
  L.push('PFLAGS:'); L.push(...byteLines(flags));
  L.push('PTIDX:'); L.push(...byteLines(tidx));
  L.push('PTCNT:'); L.push(...byteLines(tcnt));
  L.push('; template records: F1inc F2inc F3inc A1 A2 A3 mode nvol nper dur16 rate flags(1 inh,2 keep,4 vowel), 16 bytes each');
  L.push('TEMPL:');
  for (const t of trecs) {
    const rec = [inc(t.f[0]), inc(t.f[1]), inc(t.f[2]), t.a[0], t.a[1], t.a[2], t.mode === 'a' ? 2 : 1,
      t.nv, t.np, dur(t.ms), (t.as << 4) | t.fs, (t.inh ? 1 : 0) | (t.keep ? 2 : 0) | (t.vd ? 4 : 0), 0, 0, 0, 0];
    L.push('        .byte ' + rec.map(hex2).join(','));
  }
  L.push(`TEMPL_COUNT = ${trecs.length}`);

  const byLetter = rulesByLetter();
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "'"];
  const enc = (s) => [...s].map((c) => CLASS_CODE[c] ?? c.charCodeAt(0));
  for (const [li, letter] of letters.entries()) {
    L.push(`RL_${li}:`);
    for (const r of byLetter[letter] || []) {
      const bytes = [...enc([...r.left].reverse().join('')), 1, ...enc(r.match.slice(1)), 2, ...enc(r.right), 3, ...r.codes, 0xff];
      L.push(`        .byte ${bytes.map(hex2).join(',')}   ; ${r.line}`);
    }
    L.push('        .byte $00');
  }
  L.push('RIDXL:'); L.push('        .byte ' + letters.map((_, i) => `<RL_${i}`).join(','));
  L.push('RIDXH:'); L.push('        .byte ' + letters.map((_, i) => `>RL_${i}`).join(','));
  L.push('SUFTAB:');
  for (const s of SUFFIXES) L.push('        .byte ' + [...enc(s), 0].map(hex2).join(','));
  L.push('        .byte $FF');
  // character classes for $20..$5F: 1 vowel 2 consonant 4 EIY 8 voiceless 16 voiced 32 letter
  const cc = [];
  for (let c = 0x20; c < 0x60; c++) {
    const ch = String.fromCharCode(c);
    let v = 0;
    if (isVowel(ch)) v |= 1;
    if (isCons(ch)) v |= 2;
    if (CLASS_TESTS['+'](ch)) v |= 4;
    if (CLASS_TESTS['%'](ch)) v |= 8;
    if (CLASS_TESTS['&'](ch)) v |= 16;
    if (isLetter(ch)) v |= 32;
    cc.push(v);
  }
  L.push('CCLASS:'); L.push(...byteLines(cc));
  L.push('DIGL:'); L.push('        .byte ' + DIGIT_WORDS.map((_, i) => `<DIG_${i}`).join(','));
  L.push('DIGH:'); L.push('        .byte ' + DIGIT_WORDS.map((_, i) => `>DIG_${i}`).join(','));
  DIGIT_WORDS.forEach((w, i) => L.push(`DIG_${i}: .byte ${[...w].map((c) => hex2(c.charCodeAt(0))).join(',')},$00`));

  const { a, b } = dacMaps();
  L.push('; AY volume pairs approximating index/252*1.2 (two channels summed)');
  L.push('DACA:'); L.push(...byteLines(a));
  L.push('DACB:'); L.push(...byteLines(b));
  L.push('; formant level pages: page k = 42 + 42*10^(-(15-k)*3/20)*sin(2*pi*n/256); page 0 = constant 42');
  L.push('        .res <(0-*)');
  L.push('LEVELS:');
  for (const pg of levelPages()) L.push(...byteLines(pg));
  L.push('; ---- end generated ----');
  return L.join('\n');
}

function spliceIntoSource() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, 'tts.s');
  const src = readFileSync(file, 'utf8');
  const B = '; >>> GENERATED DATA (generate.mjs)', E = '; <<< GENERATED DATA';
  const s = src.indexOf(B), e = src.indexOf(E);
  if (s < 0 || e < 0) throw new Error('generated markers not found in tts.s');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const out = src.slice(0, s + B.length) + eol + buildGenerated().replace(/\n/g, eol) + eol + src.slice(e);
  if (out !== src) writeFileSync(file, out);
  console.log(`tts.s generated block ${out === src ? 'unchanged' : 'updated'} (${parseRules().length} rules)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wi = process.argv.indexOf('--word');
  if (wi > 0) console.log(codesToText(textToCodes(process.argv.slice(wi + 1).join(' '))));
  else spliceIntoSource();
}
