/**
 * 选项打乱展示 — 移植自 Android PracticeScreen.practiceDisplayOptions。
 * 用 JS 复刻 java.util.Random（48 位 LCG）+ Collections.shuffle，
 * 保证同一会话种子下选项顺序稳定（跨页面重渲染不跳变）。
 */
import { Question, QuestionType, Option } from '../domain/Models';

const MULTIPLIER = 0x5DEECE66D; // 25214903917
const ADDEND = 0xB;
const MOD_48 = 281474976710656; // 2^48，Number 可精确表示

// 拆 24 位半段做 48 位乘法，全程中间值 < 2^49，无需 BigInt（ArkTS 兼容）
function mul48Mod(a: number, b: number): number {
  const aHi = Math.floor(a / 16777216);
  const aLo = a % 16777216;
  const bHi = Math.floor(b / 16777216);
  const bLo = b % 16777216;
  const middle = ((aHi * bLo) % 16777216 + (aLo * bHi) % 16777216) % 16777216;
  return (middle * 16777216 + aLo * bLo) % MOD_48;
}

// JS 位运算符只有 32 位：48 位 XOR 需按 16+32 分段做
function xor48Mod(a: number, b: number): number {
  const aLo = a % 4294967296;
  const aHi = Math.floor(a / 4294967296) % 65536;
  const bLo = b % 4294967296;
  const bHi = Math.floor(b / 4294967296) % 65536;
  return ((aHi ^ bHi) % 65536) * 4294967296 + ((aLo ^ bLo) >>> 0);
}

export class JavaRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = xor48Mod(seed, MULTIPLIER) % MOD_48;
  }
  private nextBits(bits: number): number {
    this.seed = (mul48Mod(this.seed, MULTIPLIER) + ADDEND) % MOD_48;
    const shifted = Math.floor(this.seed / Math.pow(2, 48 - bits));
    // 取低 32 位并符号化（Java nextInt 语义）
    const low32 = shifted % 4294967296;
    return low32 >= 2147483648 ? low32 - 4294967296 : low32;
  }
  nextInt(bound?: number): number {
    if (bound === undefined) {
      return this.nextBits(32);
    }
    if (bound <= 0) {
      throw new Error('bound must be positive');
    }
    if ((bound & -bound) === bound) {
      // 2 的幂：(int)((bound * (long)next(31)) >> 31)，next(31) 恒非负
      return Math.floor(bound * this.nextBits(31) / 2147483648);
    }
    // 标准 Java nextInt 拒绝采样：bits - val + (bound-1) 无符号 < 2^31 时接受
    while (true) {
      const bits = this.nextBits(31);
      const value = bits % bound;
      if (bits - value + (bound - 1) < 2147483648) {
        return value;
      }
    }
  }
}

export function javaStringHashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Kotlin: sessionSeed xor seedSource.hashCode().toLong()，仅需低 48 位（Random 掩码） */
function sessionShuffleSeed(sessionSeed: number, sessionKey: string, question: Question): number {
  const hash = javaStringHashCode(`${sessionKey}|${question.number}|${question.question}`);
  const hashLow = hash >>> 0; // 低 32 位
  const hashHigh16 = hash < 0 ? 0xFFFF : 0; // 符号扩展进 32..47 位
  const seedLow32 = ((sessionSeed % 4294967296) ^ hashLow) >>> 0;
  const seedHigh16 = (Math.floor(sessionSeed / 4294967296) & 0xFFFF) ^ hashHigh16;
  return seedHigh16 * 4294967296 + seedLow32;
}

export class PracticeDisplayOption {
  displayKey: string;
  originalKey: string;
  text: string;
  constructor(displayKey: string, originalKey: string, text: string) {
    this.displayKey = displayKey;
    this.originalKey = originalKey;
    this.text = text;
  }
}

export function practiceDisplayKey(index: number): string {
  if (index >= 0 && index <= 25) {
    return String.fromCharCode('A'.charCodeAt(0) + index);
  }
  return String(index + 1);
}

function shuffle<T>(items: T[], random: JavaRandom): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function practiceDisplayOptions(
  question: Question,
  shuffleEnabled: boolean,
  sessionSeed: number,
  sessionKey: string
): PracticeDisplayOption[] {
  const canShuffle = shuffleEnabled &&
    (question.type === QuestionType.SINGLE || question.type === QuestionType.MULTIPLE) &&
    question.options.length > 1;
  let ordered: Option[] = question.options;
  if (canShuffle) {
    ordered = shuffle(question.options, new JavaRandom(sessionShuffleSeed(sessionSeed, sessionKey, question)));
  }
  const result: PracticeDisplayOption[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const option = ordered[i];
    result.push(new PracticeDisplayOption(canShuffle ? practiceDisplayKey(i) : option.key, option.key, option.text));
  }
  return result;
}

/** 选择题答案先换成当前字母，再按显示字母排序。 */
export function practiceAnswersForDisplay(answers: string[], displayOptions: PracticeDisplayOption[]): string[] {
  const originalToDisplay = new Map<string, string>();
  for (const option of displayOptions) {
    originalToDisplay.set(option.originalKey.trim().toUpperCase(), option.displayKey);
  }
  return answers.map((answer: string): string => originalToDisplay.get(answer.trim().toUpperCase()) ?? answer)
    .sort((left: string, right: string): number => {
      const leftKey = left.trim().toUpperCase();
      const rightKey = right.trim().toUpperCase();
      // 展示键先用单字母，超过 Z 后用 27、28 等数字。
      return leftKey.length - rightKey.length || leftKey.localeCompare(rightKey);
    });
}
