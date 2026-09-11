/**
 * 答案区拆分 — 1:1 移植自 Android AnswerSectionParser.kt。
 */
import { QuestionType } from '../../domain/Models';
import { parseAnswers, ParsedAnswerEntry } from './AnswerParser';
import { splitQuestionBlocks } from './QuestionBlockSplitter';
import { isAnswerSectionHeading, isSectionHeading } from './SectionTitleParser';

const ANSWER_ENTRY_WITH_ANALYSIS_REGEX = new RegExp(
  '^\\s*(?:第\\s*)?\\d{1,4}\\s*(?:题)?\\s*(?:[.、．:：]?\\s*(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|×|True|False)|[.、．:：]?\\s*(?:[【\\[]\\s*(?:答案|正确答案|参考答案|标准答案|解析)\\s*[】\\]]|(?:答案|正确答案|参考答案|标准答案|解析)\\s*[:：])\\s*(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|×|True|False))\\s*[.。]?\\s*(?:\\[?\\s*解析\\s*\\]?|【\\s*解析\\s*】|解析)?',
  'i'
);
const LOCAL_SUBJECTIVE_ANSWER_HEADING_REGEX = /^\s*(?:本题)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)\s*[:：]?\s*$/;
const NUMBERED_QUESTION_LINE_REGEX = /^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[.、．:：)）]\s*(.*)$/;
const SUBJECTIVE_QUESTION_CUE_REGEX = /^(?:请|简述|简答|论述|阐述|概括|分析|说明|解释|谈谈|指出|列举|试述|为什么|如何|结合|根据|什么是|有哪些|有何|提出)/;
const ANSWER_MARKER_WITH_TAIL_REGEX = /^\s*(?:(?:[\[【]\s*(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)\s*[\]】]\s*.*)|(?:(?:本题)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)\s*(?:[:：]|为)\s*.*))$/;

export class SplitResult {
  questionArea: string;
  answerArea: string | null;
  constructor(questionArea: string, answerArea: string | null) {
    this.questionArea = questionArea;
    this.answerArea = answerArea;
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
  if (!/^-?\d+$/.test(clean)) return null;
  return parseInt(clean, 10);
}

export function hasAnswerSection(text: string): boolean {
  const lines = text.split('\n');
  if (findExplicitAnswerStart(lines) >= 0) return true;
  return findImplicitAnswerStart(lines) >= 0;
}

export function splitSections(text: string): SplitResult {
  const lines = text.split('\n');
  const explicitIndex = findExplicitAnswerStart(lines);
  const startIndex = explicitIndex >= 0 ? explicitIndex : findImplicitAnswerStart(lines);
  if (startIndex < 0) return new SplitResult(text, null);
  const questionArea = lines.slice(0, startIndex).join('\n').trim();
  const answerArea = lines.slice(explicitIndex >= 0 ? startIndex + 1 : startIndex).join('\n').trim();
  return new SplitResult(questionArea, answerArea);
}

export function parseAnswerSection(text: string): ParsedAnswerEntry[] {
  const split = splitSections(text);
  const answerArea = split.answerArea !== null && split.answerArea.trim().length > 0 ? split.answerArea : text;
  const parsed = parseAnswers(answerArea);
  if (parsed.length > 0) return parsed;

  const blocks = splitQuestionBlocks(answerArea, null, '', false);
  const out: ParsedAnswerEntry[] = [];
  for (const block of blocks) {
    const combined = block.lines.join('\n');
    const entries = parseAnswers(`${block.number}. ${combined}`);
    if (entries.length > 0) {
      out.push(entries[0]);
    }
  }
  return out;
}

function findExplicitAnswerStart(lines: string[]): number {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!isAnswerSectionHeading(line)) continue;
    if (isLocalSubjectiveAnswerHeading(lines, index)) continue;
    return index;
  }
  return -1;
}

// “参考答案：”既可能是整卷集中答案标题，也可能是当前简答题的答案起点。
// 当它位于主观题之后，且能确认是逐题答案结构（存在下一道明确主观题、仅有一道题，
// 或前面题块都已经各自带有答案标记）时，应保留在当前题块中，不能提前截断整份题目文本。
function isLocalSubjectiveAnswerHeading(lines: string[], headingIndex: number): boolean {
  const heading = headingIndex < lines.length ? lines[headingIndex].trim() : '';
  if (!LOCAL_SUBJECTIVE_ANSWER_HEADING_REGEX.test(heading)) return false;

  const prefix = lines.slice(0, headingIndex).join('\n').trim();
  if (prefix.length === 0) return false;
  const prefixBlocks = splitQuestionBlocks(prefix, null, '', false);
  if (prefixBlocks.length === 0) return false;
  const currentBlock = prefixBlocks[prefixBlocks.length - 1];
  const currentNumber = toIntOrNull(currentBlock.number.split('-')[0]);
  if (currentNumber === null) return false;
  const currentStem = currentBlock.lines.join(' ').trim();
  const isSubjective = currentBlock.forcedType === QuestionType.SHORT ||
    SUBJECTIVE_QUESTION_CUE_REGEX.test(currentStem);
  if (!isSubjective) return false;

  if (hasDefiniteNextSubjectiveQuestion(lines, headingIndex, currentNumber)) return true;
  if (prefixBlocks.length === 1) return true;

  // 多道主观题逐题给出答案时，前面题块已经各自带有答案标记；
  // 最后一题的独立“参考答案：”也应继续按局部答案处理。
  const previousBlocks = prefixBlocks.slice(0, prefixBlocks.length - 1);
  return previousBlocks.every((block: { lines: string[] }): boolean =>
    block.lines.some((l: string): boolean => isAnswerMarkerLine(l)));
}

function hasDefiniteNextSubjectiveQuestion(
  lines: string[],
  headingIndex: number,
  currentNumber: number
): boolean {
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    const match = NUMBERED_QUESTION_LINE_REGEX.exec(line);
    if (match === null) continue;
    const number = toIntOrNull(g(match, 1));
    if (number === null) continue;
    if (number !== currentNumber + 1) continue;

    const remainder = g(match, 2).trim();
    if (!looksLikeSubjectiveQuestionRemainder(remainder)) continue;
    if (hasOwnAnswerMarkerAhead(lines, index)) return true;
  }
  return false;
}

function looksLikeSubjectiveQuestionRemainder(content: string): boolean {
  const normalized = content.trim();
  if (normalized.length === 0) return false;
  if (normalized.endsWith('？') || normalized.endsWith('?')) return true;
  return SUBJECTIVE_QUESTION_CUE_REGEX.test(normalized);
}

function isAnswerMarkerLine(line: string): boolean {
  const normalized = line.trim();
  return LOCAL_SUBJECTIVE_ANSWER_HEADING_REGEX.test(normalized) ||
    ANSWER_MARKER_WITH_TAIL_REGEX.test(normalized);
}

function hasOwnAnswerMarkerAhead(lines: string[], questionIndex: number): boolean {
  let nonBlankCount = 0;
  for (let index = questionIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    nonBlankCount += 1;
    if (isAnswerMarkerLine(line)) return true;

    const nextQuestion = NUMBERED_QUESTION_LINE_REGEX.exec(line);
    if (nextQuestion !== null && looksLikeSubjectiveQuestionRemainder(g(nextQuestion, 2))) {
      return false;
    }
    if (isSectionHeading(line)) return false;
    if (nonBlankCount >= 12) return false;
  }
  return false;
}

function findImplicitAnswerStart(lines: string[]): number {
  if (lines.length < 8) return -1;
  const startAt = Math.max(Math.floor(lines.length * 0.25), 0);
  for (let index = startAt; index < lines.length; index++) {
    if (!ANSWER_ENTRY_WITH_ANALYSIS_REGEX.test(lines[index].trim())) continue;
    const nextWindow = lines.slice(index).slice(0, 12);
    const hitCount = nextWindow
      .filter((l: string): boolean => ANSWER_ENTRY_WITH_ANALYSIS_REGEX.test(l.trim()))
      .length;
    if (hitCount >= 3) return index;
  }
  return -1;
}
