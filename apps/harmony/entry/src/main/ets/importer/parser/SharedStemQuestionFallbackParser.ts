/**
 * 共享题干/材料题兜底 — 1:1 移植自 Android SharedStemQuestionFallbackParser.kt。
 * 把显式共享题干组改写为普通编号题（题干复制进每个子题），再走标准解析。
 */
import { Question } from '../../domain/Models';
import { parseStandardText } from './StandardQuestionParser';
import { parseSectionTitle } from './SectionTitleParser';

const SHARED_LABEL_REGEX = /^\s*[【\[（(〔〖《]?\s*(?:共用题干题|共用题干|共用材料题|共用材料|共用资料题|共用资料|共用案例题|共用案例|共用病例题|共用病例)\s*[】\]）)〕〗》]?\s*$/;
const MATERIAL_INTRO_REGEX = /^\s*(?:[一二三四五六七八九十0-9]+[、.．:：]\s*)?根据(?:以下|下列|上述|给定)?(?:资料|材料|图表|统计资料|病例|案例|病历).*回答\s*(\d{1,4})\s*[~～\-—至到]\s*(\d{1,4})\s*题\s*[。.:：]?\s*$/;
const STRICT_QUESTION_START_REGEX = /^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[.、．:：)）]\s*(.*)$/;
const BRACKET_QUESTION_START_REGEX = /^\s*[【\[]\s*(\d{1,4})\s*[】\]]\s*(.*)$/;
const STEM_PREFIX_REGEX = /^\s*(?:题干|材料|资料|案例|病例|病历摘要|共用题干|共用材料|共用资料|共用病例)\s*[:：]\s*(.*)$/;
const OPTION_START_REGEX = /^\s*(?:[A-Ga-g]\s*[.、．:：)）]|[\(（\[【〔〖《]\s*[A-Ga-g]\s*[\)）\]】〕〗》])/;
const ANSWER_LINE_REGEX = /^\s*(?:[\[【]\s*)?(?:本题)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)(?:\s*[\]】])?\s*(?:[:：]|为)?/;
const ANALYSIS_LINE_REGEX = /^\s*(?:(?:[\[【]\s*(?:答案解析|解题思路|解析思路|解题分析|参考解析|详解|分析|理由|解答|解析|说明)\s*[\]】]\s*)|(?:(?:答案解析|解题思路|解析思路|解题分析|参考解析|详解|分析|理由|解答|解析|说明)\s*[:：]\s*))/;

class SharedIntro {
  startNumber: number | null;
  endNumber: number | null;
  explicitLabel: boolean;
  constructor(startNumber: number | null, endNumber: number | null, explicitLabel: boolean) {
    this.startNumber = startNumber;
    this.endNumber = endNumber;
    this.explicitLabel = explicitLabel;
  }
}

class ParsedQuestionStart {
  number: string;
  numberValue: number | null;
  remainder: string;
  constructor(number: string, numberValue: number | null, remainder: string) {
    this.number = number;
    this.numberValue = numberValue;
    this.remainder = remainder;
  }
}

class ChildBlock {
  start: ParsedQuestionStart;
  lines: string[];
  constructor(start: ParsedQuestionStart, lines: string[]) {
    this.start = start;
    this.lines = lines;
  }
}

function g(match: RegExpExecArray | null, index: number): string {
  if (match === null) {
    return '';
  }
  return match[index] !== undefined ? match[index] : '';
}

function toIntOrNull(raw: string): number | null {
  const clean = raw.trim();
  if (!/^\d+$/.test(clean)) return null;
  return parseInt(clean, 10);
}

export function parseSharedStem(text: string): Question[] {
  const rewritten = rewrite(text);
  if (rewritten === null) return [];
  return parseStandardText(rewritten);
}

export function rewrite(text: string): string | null {
  const lines = text.split('\n');
  const output: string[] = [];
  let index = 0;
  let rewrittenGroupCount = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    const intro = parseSharedIntro(line);
    if (intro === null) {
      output.push(rawLine);
      index += 1;
      continue;
    }

    const groupStart = index;
    index += 1;

    const stemLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (current.length === 0) {
        if (stemLines.length > 0) stemLines.push('');
        index += 1;
        continue;
      }
      if (parseQuestionStart(current) !== null) break;
      if (parseSharedIntro(current) !== null || parseSectionTitle(current) !== null) break;
      stemLines.push(normalizeStemLine(current));
      index += 1;
    }

    const children: ChildBlock[] = [];
    let currentStart: ParsedQuestionStart | null = null;
    let currentLines: string[] = [];

    const flushChild = (): void => {
      if (currentStart === null) return;
      const cleanLines = currentLines.map((l: string): string => l.trim())
        .filter((l: string): boolean => l.length > 0);
      if (cleanLines.length > 0) {
        children.push(new ChildBlock(currentStart, cleanLines));
      }
      currentStart = null;
      currentLines = [];
    };

    let brokeFromChildLoop = false;
    while (index < lines.length && !brokeFromChildLoop) {
      const currentRaw = lines[index];
      const current = currentRaw.trim();
      if (current.length === 0) {
        currentLines.push(currentRaw);
        index += 1;
        continue;
      }
      if (parseSharedIntro(current) !== null) break;
      const section = parseSectionTitle(current);
      if (section !== null && (section.isAnswerSection || children.length > 0)) break;

      const start = parseQuestionStart(current);
      if (start !== null) {
        if (intro.endNumber !== null && start.numberValue !== null &&
          start.numberValue > intro.endNumber && children.length > 0) {
          break;
        }
        if (intro.startNumber !== null && start.numberValue !== null &&
          start.numberValue < intro.startNumber && children.length === 0) {
          for (const l of lines.slice(groupStart, index + 1)) output.push(l);
          index += 1;
          currentStart = null;
          currentLines = [];
          brokeFromChildLoop = true;
          break;
        }
        flushChild();
        currentStart = start;
        currentLines = [currentRaw];
        index += 1;
        continue;
      }

      if (currentStart === null) break;
      currentLines.push(currentRaw);
      index += 1;
    }
    flushChild();

    const cleanedStem = stemLines
      .map((l: string): string => l.trim())
      .filter((l: string): boolean => l.length > 0)
      .join('\n')
      .trim();

    const validChildren = children.filter((child: ChildBlock): boolean =>
      intro.startNumber === null || intro.endNumber === null || child.start.numberValue === null ||
      (child.start.numberValue >= intro.startNumber && child.start.numberValue <= intro.endNumber));

    const hasEnoughChildren = validChildren.length >= 2;
    const stemLooksUseful = cleanedStem.length >= 4;
    if (!hasEnoughChildren || !stemLooksUseful) {
      for (const l of lines.slice(groupStart, index)) output.push(l);
      continue;
    }

    for (const child of validChildren) {
      for (const l of buildRewrittenChildLines(cleanedStem, child)) output.push(l);
      output.push('');
    }
    rewrittenGroupCount += 1;
  }

  return rewrittenGroupCount > 0 ? output.join('\n') : null;
}

function parseSharedIntro(line: string): SharedIntro | null {
  if (SHARED_LABEL_REGEX.test(line)) {
    return new SharedIntro(null, null, true);
  }
  const match = MATERIAL_INTRO_REGEX.exec(line);
  if (match !== null) {
    const start = toIntOrNull(g(match, 1));
    const end = toIntOrNull(g(match, 2));
    if (start !== null && end !== null && end > start) {
      return new SharedIntro(start, end, false);
    }
  }
  return null;
}

function parseQuestionStart(line: string): ParsedQuestionStart | null {
  const bracketMatch = BRACKET_QUESTION_START_REGEX.exec(line);
  if (bracketMatch !== null) {
    const number = g(bracketMatch, 1);
    return new ParsedQuestionStart(number, toIntOrNull(number), g(bracketMatch, 2).trim());
  }
  const strictMatch = STRICT_QUESTION_START_REGEX.exec(line);
  if (strictMatch !== null) {
    const number = g(strictMatch, 1);
    const remainder = g(strictMatch, 2).trim();
    if (remainder.length === 0) return null;
    if (OPTION_START_REGEX.test(line) || ANSWER_LINE_REGEX.test(line) || ANALYSIS_LINE_REGEX.test(line)) return null;
    return new ParsedQuestionStart(number, toIntOrNull(number), remainder);
  }
  return null;
}

function normalizeStemLine(line: string): string {
  const match = STEM_PREFIX_REGEX.exec(line);
  if (match !== null) {
    return g(match, 1).trim();
  }
  return line.trim();
}

function buildRewrittenChildLines(stem: string, child: ChildBlock): string[] {
  const originalLines = child.lines;
  const firstLineRemainder = child.start.remainder.trim();
  const result: string[] = [];
  const stemParts = stem.split('\n').map((l: string): string => l.trim())
    .filter((l: string): boolean => l.length > 0);
  const firstStemLine = stemParts.length > 0 ? stemParts[0] : '';
  result.push(`${child.start.number}．${firstStemLine}`);
  for (const part of stemParts.slice(1)) result.push(part);
  if (firstLineRemainder.length > 0) result.push(firstLineRemainder);
  for (const l of originalLines.slice(1)) result.push(l.trim());
  return result;
}
