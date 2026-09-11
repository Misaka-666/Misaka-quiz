/**
 * 解析器工具函数 — 移植自 Android ParserUtils.kt（1:1 对应）。
 * 约束：本文件必须同时可被 hvigor(ArkTS 工程) 与 Node/tsc 编译，
 * 因此只使用 TS 与 ArkTS 的公共子集（显式类型、无 any、无动态对象）。
 */

export function normalizeQuestionIndex(raw: string): string {
  const clean = raw.trim();
  if (clean.length > 0 && /^[0-9]+$/.test(clean)) return clean;
  const cn = chineseNumberToInt(clean);
  return cn === null ? '' : String(cn);
}

const DIGIT_MAP: Map<string, number> = new Map<string, number>([
  ['零', 0], ['〇', 0], ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4],
  ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9]
]);

function splitLimit(text: string, sep: string, limit: number): string[] {
  // ponytail: 仅支持单字符分隔的 limit 语义，覆盖现有解析器用法
  const parts = text.split(sep);
  if (limit <= 0 || parts.length <= limit) return parts;
  const head = parts.slice(0, limit - 1);
  head.push(parts.slice(limit - 1).join(sep));
  return head;
}

function firstDigit(text: string): number | undefined {
  return text.length > 0 ? DIGIT_MAP.get(text.charAt(0)) : undefined;
}

export function chineseNumberToInt(raw: string): number | null {
  if (raw.trim().length === 0) return null;
  if (raw.includes('百')) {
    const parts = splitLimit(raw, '百', 2);
    const head = parts[0];
    const hundreds = (head !== undefined && head.trim().length > 0) ? firstDigit(head) : 1;
    const tail = parts.length > 1 ? parts[1] : '';
    return (hundreds === undefined ? 1 : hundreds) * 100 + (chineseNumberToInt(tail) ?? 0);
  }
  if (raw.includes('十')) {
    const parts = splitLimit(raw, '十', 2);
    const head = parts[0];
    const tens = (head !== undefined && head.trim().length > 0) ? firstDigit(head) : 1;
    const tail = parts.length > 1 ? parts[1] : '';
    const ones = (tail !== undefined && tail.trim().length > 0) ? firstDigit(tail) : 0;
    return (tens === undefined ? 1 : tens) * 10 + (ones === undefined ? 0 : ones);
  }
  const v = firstDigit(raw);
  return v === undefined ? null : v;
}

const BINARY_JUDGE_STRONG_PROMPT = /(判断|判定|正误|对错|是非|是否|能否|可否|正确与否|错误与否|对还是错|对不对|错不错|正确吗|错误吗)/;
const BINARY_OPTION_CHOICE_PROMPT = /(下列|以下|哪(?:一)?(?:项|个|些|种|条)|选择|选出|应选|正确的是|错误的是|不正确的是|不属于|属于|包括|不包括|符合|不符合|最佳|最合适|最恰当)/;
const BINARY_JUDGE_LOOSE_PROMPT = /(判断|正确|错误|对错|是非|是否|正误|√|×)/;
const JUDGE_OPTION_TEXTS: string[] = ['正确', '错误', '对', '错', '是', '否', '√', '×', 'True', 'False', 'true', 'false'];

export function isJudgeOptionPair(optionKeys: string[], optionTexts: string[]): boolean {
  const keysUpper = optionKeys.map((k: string): string => k.toUpperCase());
  if (keysUpper.length !== 2 || keysUpper[0] !== 'A' || keysUpper[1] !== 'B') return false;
  return optionTexts.map((t: string): string => t.trim())
    .every((t: string): boolean => JUDGE_OPTION_TEXTS.includes(t));
}

export function shouldInferJudgeFromBinaryOptions(stem: string, answerText: string = ''): boolean {
  const cleanStem = stem.trim();
  if (BINARY_JUDGE_STRONG_PROMPT.test(cleanStem)) return true;
  if (BINARY_OPTION_CHOICE_PROMPT.test(cleanStem)) return false;
  return BINARY_JUDGE_LOOSE_PROMPT.test(cleanStem + answerText);
}
