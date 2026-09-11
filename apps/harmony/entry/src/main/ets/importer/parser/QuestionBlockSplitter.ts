/**
 * 题块拆分器 — 1:1 移植自 Android QuestionBlockSplitter.kt。
 * 正则从 Kotlin 原始字符串逐字拷贝；Kotlin \uXXXX 在 JS 正则中语义一致。
 */
import { QuestionType } from '../../domain/Models';
import { normalizeQuestionIndex } from './ParserUtils';
import { extractLeadingTypeLabel } from './QuestionTypeLabelParser';
import { parseSectionTitle, isSectionHeading } from './SectionTitleParser';
import {
  looksLikeNumericCodeOrDataLine,
  looksLikeStandaloneCodeExpression,
  hasUnprotectedEmptyParentheses,
  isProtectedParenthesizedToken
} from './CodeLikeTextGuard';
import { isStandardOptionLine, hasCompactOptionSequence } from './CompactQuestionRepair';

export class QuestionBlock {
  number: string;
  lines: string[];
  category: string;
  forcedType: string | null;
  sequence: number;
  constructor(number: string, lines: string[], category: string, forcedType: string | null, sequence: number) {
    this.number = number;
    this.lines = lines;
    this.category = category;
    this.forcedType = forcedType;
    this.sequence = sequence;
  }
}

class ParsedQuestionStart {
  number: string;
  remainder: string;
  forcedType: string | null;
  constructor(number: string, remainder: string, forcedType: string | null) {
    this.number = number;
    this.remainder = remainder;
    this.forcedType = forcedType;
  }
}

const STRICT_QUESTION_START_REGEX = /^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[.、．:：)）]\s*(.*)$/;
const BRACKET_QUESTION_START_REGEX = /^\s*[【\[]\s*(\d{1,4})\s*[】\]]\s*(.*)$/;
const INTERVIEW_QUESTION_START_REGEX = /^\s*(?:(?:问题|题目)\s*([一二三四五六七八九十百0-9]{1,4})|第\s*([一二三四五六七八九十百0-9]{1,4})\s*(?:题|问|道题|个问题)|([一二三四五六七八九十百]+)\s*(?:、|．|\.))\s*[.、．:：)）]?\s*(.*)$/;
const SPACED_QUESTION_START_REGEX = /^\s*(\d{1,3})\s+(.+)$/;
const GLUED_QUESTION_START_REGEX = /^\s*(\d{1,2})(?=[\u4e00-\u9fa5A-Za-z])(.*)$/;
const ANSWER_LINE_REGEX = /^\s*(?:[\[【]\s*)?(?:本题)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)(?:\s*[\]】])?\s*(?:[:：]|为)?/;
const SUBJECTIVE_ANSWER_MARKER_WITH_TAIL_REGEX = /^\s*(?:(?:[\[【]\s*(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)\s*[\]】]\s*)|(?:(?:本题)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)\s*(?:[:：]|为)\s*))(.*)$/;
const BARE_SUBJECTIVE_ANSWER_MARKER_REGEX = /^\s*(?:本题)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)\s*$/;
const ANALYSIS_LINE_REGEX = /^\s*(?:(?:[\[【]\s*(?:答案解析|解题思路|解析思路|解题分析|参考解析|详解|分析|理由|解答|解析|说明)\s*[\]】]\s*)|(?:(?:答案解析|解题思路|解析思路|解题分析|参考解析|详解|分析|理由|解答|解析|说明)\s*[:：]\s*))/;
const EMBEDDED_ANSWER_REGEX = /[\[【]\s*(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答)\s*(?:[:：]|[\]】])|(?:本题)?(?:答案|正确答案|参考答案|标准答案)\s*为/;
const SUBJECTIVE_QUESTION_TYPE_REGEX = /(?:[【\[（(〔〖《]\s*)?(?:简答题|问答题|面试题|结构化面试题|公考面试题|公务员面试题|材料分析题|案例分析题|名词解释|论述题|综合题)(?:\s*[】\]）)〕〗》])?/;
const SUBJECTIVE_CONTINUATION_MARKER_REGEX = /^\s*(?:参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答)\s*[:：]?\s*$/;
const SUBJECTIVE_QUESTION_CUE_REGEX = /(?:请)?(?:简述|简答|论述|阐述|概括|分析|说明|解释|谈谈|指出|列举|试述|为什么|如何|有何|哪些|什么是|提出.{0,12}(?:措施|建议|对策)|说明.{0,12}(?:原因|意义|作用|原则|内容))/;
const SUBJECTIVE_ANSWER_INTRO_REGEX = /(?:如下|以下|主要包括|包括以下|可概括为|分为以下|有以下|要点|措施|原则|原因|意义|作用)\s*[:：]?$/;
const NUMBERED_SUBJECTIVE_ITEM_REGEX = /^\s*(?:(\d{1,2})\s*[.、．:：)）]|[（(]\s*(\d{1,2})\s*[)）])\s*(.+)$/;
const CHINESE_SUBJECTIVE_ITEM_REGEX = /^\s*(?:[一二三四五六七八九十]+\s*[、.．:：)）]|(?:首先|其次|再次|最后|第一|第二|第三|第四|第五|一是|二是|三是|四是|五是))/;
const MATERIAL_INTRO_LINE_REGEX = /^\s*(?:[一二三四五六七八九十0-9]+[、.．:：]\s*)?根据(?:以下|下列|上述|给定)?(?:资料|材料|图表|统计资料).*回答\s*\d{1,4}\s*[~～\-—至到]\s*\d{1,4}\s*题\s*[。.:：]?\s*$/;
const STANDALONE_NUMERIC_TABLE_VALUE_REGEX = /^\s*[+-]?\d+(?:\s*[.．]\s*\d+)?(?:[Ee][+-]?\d+)?\s*$/i;
const UNNUMBERED_OBJECTIVE_MARKER_REGEX = /[（(]\s*(?:([A-Ga-g]{1,7})|(对|错|正确|错误|√|×|True|False))\s*[)）]/gi;
const PURE_FRONT_MATTER_LINE_REGEX = /^(?:[【\[]?\s*)?(?:绝密|密卷|注意事项(?:\s*[:：].*)?|说明\s*[:：]\s*(?:请|考试|答题|作答|时间|考生).*|请(?:认真|仔细)作答|请在规定时间内完成(?:答题|作答)|请将答案(?:填写|填涂|写在|写到).*|请用\s*2B.*|请勿.*|答题前.*|答题卡.*|考试时间\s*[:：].*|时间\s*[:：].*|在考试结束.*|考试结束.*|全部测验到此结束.*|祝各位考生.*|监考老师.*)(?:\s*[】\]])?\s*[。.!！]?$/i;

// 函数体内联 Regex 提升为常量（无状态，语义不变）
const DECIMAL_OR_EXPONENT_REGEX = /[.．Ee]/i;
const TWO_PLUS_DIGIT_START_REGEX = /^\s*\d{2,4}\s*[.、．:：)）]/;
const QUESTION_WORD_START_REGEX = /^\s*(?:问题|题目|第\s*[一二三四五六七八九十百0-9]+\s*(?:题|问|道题|个问题))/;
const MATERIAL_LABEL_REGEX = /^\s*材料[一二三四五六七八九十0-9]+\s*[:：]/;
const SUBJECTIVE_QUESTION_LEAD_REGEX = /^(?:请|简述|简答|论述|阐述|概括|分析|说明|解释|谈谈|指出|列举|试述|为什么|如何|结合|根据|什么是|有哪些|有何|提出)/;
const INTERVIEW_EXCLUDE_REGEX = /(?:测试区|样本|题库|格式|边界|极端|客观题|主观题|材料题|集中答案|功能测试)/i;
const INTERVIEW_INCLUDE_REGEX = /^(?:请|谈谈|你|如何|为什么|是否|如果|根据|结合|概括|指出|分析|提出|围绕|下列|单位|群众|有人认为|某)/;
const USAGE_PREFIX_REGEX = /^(?:用途|说明|备注|注意|提示)\s*[:：]/;
const BRACKET_NOTE_PREFIX_REGEX = /^\s*[\[【]\s*(?:待确认|备注|提示|说明|注|注意)/;
const QUESTION_LEAD_WORD_REGEX = /^(?:问题|题目|请回答|请谈谈|谈谈|你怎么看|你怎么处理)/;
const ENDING_PUNCT_REGEX = /[?？。]$/;

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

class NumberedSubjectiveItem {
  number: number;
  content: string;
  constructor(number: number, content: string) {
    this.number = number;
    this.content = content;
  }
}

function syntheticQuestionNumber(parentNumber: string | null, syntheticIndex: number): string {
  const base = parentNumber !== null ? parentNumber.trim() : '';
  return base.length > 0 ? `${base}-${syntheticIndex}` : syntheticIndex.toString();
}

export function splitQuestionBlocks(
  text: string,
  forcedType: string | null = null,
  category: string = '',
  allowUnnumbered: boolean = true
): QuestionBlock[] {
  const blocks: QuestionBlock[] = [];
  let currentNumber: string | null = null;
  let currentLines: string[] = [];
  let currentCategory = category;
  let currentSectionForcedType = forcedType;
  let currentForcedType = forcedType;
  let syntheticNumber = 0;
  let sequence = 0;
  let skippingGlobalAnswerSection = false;
  let skippingMaterialIntro = false;

  const flush = (): void => {
    if (currentNumber === null) return;
    const cleanLines = currentLines.map((l: string): string => l.trim())
      .filter((l: string): boolean => l.length > 0);
    if (cleanLines.length > 0) {
      blocks.push(new QuestionBlock(currentNumber, cleanLines, currentCategory, currentForcedType, sequence));
      sequence += 1;
    }
    currentNumber = null;
    currentLines = [];
    currentForcedType = currentSectionForcedType;
  };

  const sourceLines = text.split('\n');
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
    const line = sourceLines[lineIndex].trim();
    if (line.length === 0) continue;
    if (currentNumber === null && isPureFrontMatterLine(line)) continue;
    if (isMaterialIntroLine(line)) {
      flush();
      skippingMaterialIntro = true;
      continue;
    }
    if (currentNumber !== null &&
      shouldAttachSubjectiveAnswerMarkerToCurrentBlock(currentLines, line, currentForcedType)) {
      currentLines.push(line);
      skippingMaterialIntro = false;
      continue;
    }
    const section = parseSectionTitle(line);
    if (section !== null) {
      if (section.isAnswerSection) {
        flush();
        skippingGlobalAnswerSection = true;
        skippingMaterialIntro = false;
        continue;
      }
      flush();
      currentCategory = section.title.length > 0 ? section.title : category;
      currentSectionForcedType = section.forcedType !== null ? section.forcedType : forcedType;
      currentForcedType = currentSectionForcedType;
      skippingGlobalAnswerSection = false;
      skippingMaterialIntro = false;
      continue;
    }

    if (skippingGlobalAnswerSection) continue;

    const activeNumber = currentNumber;
    if (activeNumber !== null &&
      shouldKeepAsSubjectiveAnswerContinuation(
        currentLines, line, activeNumber, currentForcedType, sourceLines, lineIndex)) {
      currentLines.push(line);
      continue;
    }

    const explicitStart = parseQuestionStart(line);
    if (explicitStart !== null) {
      flush();
      skippingMaterialIntro = false;
      currentNumber = explicitStart.number;
      currentForcedType = explicitStart.forcedType !== null ? explicitStart.forcedType : currentSectionForcedType;
      currentLines = [];
      const remainder = explicitStart.remainder.trim();
      if (remainder.length > 0) {
        currentLines.push(remainder);
      }
      continue;
    }

    if (currentNumber === null) {
      if (skippingMaterialIntro) continue;
      if (allowUnnumbered && (isLikelyUnnumberedQuestionLine(line) || isLikelyTypedQuestionLine(line, forcedType))) {
        syntheticNumber += 1;
        currentNumber = syntheticNumber.toString();
        const typed = extractLeadingTypeLabel(line);
        currentForcedType = typed !== null ? typed.type : currentSectionForcedType;
        const typedRemainder = typed !== null && typed.remainder.trim().length > 0 ? typed.remainder : line;
        currentLines.push(typedRemainder);
      }
      continue;
    }

    if (allowUnnumbered && shouldStartNextSyntheticBlock(currentLines, line)) {
      const parentNumber = currentNumber;
      flush();
      syntheticNumber += 1;
      currentNumber = syntheticQuestionNumber(parentNumber, syntheticNumber);
      const typed = extractLeadingTypeLabel(line);
      currentForcedType = typed !== null ? typed.type : currentSectionForcedType;
      const typedRemainder = typed !== null && typed.remainder.trim().length > 0 ? typed.remainder : line;
      currentLines.push(typedRemainder);
    } else {
      currentLines.push(line);
    }
  }

  flush();
  return blocks;
}

function parseQuestionStart(line: string): ParsedQuestionStart | null {
  if (looksLikeStandaloneNumericTableValue(line)) return null;
  if (looksLikeNumericCodeOrDataLine(line)) return null;
  const bracketMatch = BRACKET_QUESTION_START_REGEX.exec(line);
  if (bracketMatch !== null) {
    const typed = extractLeadingTypeLabel(g(bracketMatch, 2));
    return new ParsedQuestionStart(
      g(bracketMatch, 1),
      typed !== null ? typed.remainder : g(bracketMatch, 2),
      typed !== null ? typed.type : null
    );
  }

  const interviewMatch = INTERVIEW_QUESTION_START_REGEX.exec(line);
  if (interviewMatch !== null) {
    const candidates = [g(interviewMatch, 1), g(interviewMatch, 2), g(interviewMatch, 3)];
    const rawNumber = candidates.find((c: string): boolean => c.length > 0) ?? '';
    const number = normalizeQuestionIndex(rawNumber);
    const rest = g(interviewMatch, 4).trim();
    const isChineseOrdinalOnly = g(interviewMatch, 3).length > 0;
    if (number.length > 0 && (!isChineseOrdinalOnly || looksLikeInterviewQuestionRemainder(rest))) {
      const typed = extractLeadingTypeLabel(rest);
      return new ParsedQuestionStart(
        number,
        typed !== null ? typed.remainder : rest,
        typed !== null ? typed.type : null
      );
    }
  }

  const strictMatch = STRICT_QUESTION_START_REGEX.exec(line);
  if (strictMatch !== null) {
    const number = g(strictMatch, 1);
    if (isInvalidQuestionNumber(number)) return null;
    const typed = extractLeadingTypeLabel(g(strictMatch, 2));
    return new ParsedQuestionStart(
      number,
      typed !== null ? typed.remainder : g(strictMatch, 2),
      typed !== null ? typed.type : null
    );
  }

  const spacedMatch = SPACED_QUESTION_START_REGEX.exec(line);
  if (spacedMatch !== null) {
    const number = g(spacedMatch, 1);
    const rest = g(spacedMatch, 2);
    if (number.length <= 3 && !isInvalidQuestionNumber(number) && !looksLikeYearPrefix(number, rest)) {
      const typed = extractLeadingTypeLabel(rest);
      return new ParsedQuestionStart(
        number,
        typed !== null ? typed.remainder : rest,
        typed !== null ? typed.type : null
      );
    }
  }

  const gluedMatch = GLUED_QUESTION_START_REGEX.exec(line);
  if (gluedMatch !== null) {
    const number = g(gluedMatch, 1);
    const rest = g(gluedMatch, 2);
    if (number.length <= 2 && !isInvalidQuestionNumber(number) && rest.trim().length > 0) {
      const typed = extractLeadingTypeLabel(rest);
      return new ParsedQuestionStart(
        number,
        typed !== null ? typed.remainder : rest,
        typed !== null ? typed.type : null
      );
    }
  }

  return null;
}

function isInvalidQuestionNumber(number: string): boolean {
  return toIntOrNull(number.trim()) === 0;
}

function looksLikeStandaloneNumericTableValue(line: string): boolean {
  const normalized = line.trim();
  if (!STANDALONE_NUMERIC_TABLE_VALUE_REGEX.test(normalized)) return false;
  let digits = 0;
  for (const ch of normalized) {
    if (/[0-9]/.test(ch)) digits += 1;
  }
  if (digits >= 4) return true;
  if (DECIMAL_OR_EXPONENT_REGEX.test(normalized)) return true;
  return normalized === '0';
}

function looksLikeYearPrefix(number: string, rest: string): boolean {
  return number.length === 4 && rest.startsWith('年');
}

function isMaterialIntroLine(line: string): boolean {
  return MATERIAL_LABEL_REGEX.test(line) || MATERIAL_INTRO_LINE_REGEX.test(line);
}

function shouldKeepAsSubjectiveAnswerContinuation(
  currentLines: string[],
  line: string,
  currentNumber: string,
  forcedType: string | null,
  sourceLines: string[],
  lineIndex: number
): boolean {
  const answerMarkerIndex = findSubjectiveAnswerMarkerIndex(currentLines, forcedType);
  if (answerMarkerIndex < 0) return false;
  if (looksLikeTypedQuestionStart(line)) return false;
  if (TWO_PLUS_DIGIT_START_REGEX.test(line)) return false;
  if (QUESTION_WORD_START_REGEX.test(line)) return false;

  const numberedItem = parseNumberedSubjectiveItem(line);
  if (numberedItem === null) {
    return CHINESE_SUBJECTIVE_ITEM_REGEX.test(line);
  }

  const previousItemNumbers: number[] = [];
  for (const l of currentLines.slice(answerMarkerIndex + 1)) {
    const item = parseNumberedSubjectiveItem(l);
    if (item !== null) previousItemNumbers.push(item.number);
  }
  const lastItemNumber = previousItemNumbers.length > 0
    ? previousItemNumbers[previousItemNumbers.length - 1]
    : null;
  const currentQuestionIndex = toIntOrNull(currentNumber.split('-')[0]);
  const isExpectedOfficialNext = currentQuestionIndex !== null && numberedItem.number === currentQuestionIndex + 1;
  const rollsBackFromAnswerItems = lastItemNumber !== null && numberedItem.number <= lastItemNumber;
  const breaksAnswerItemSequence = lastItemNumber !== null && numberedItem.number !== lastItemNumber + 1;
  const hasBlankSeparator = sourceLines
    .slice(Math.max(lineIndex - 2, 0), lineIndex)
    .some((l: string): boolean => l.trim().length === 0);
  const looksLikeQuestion = looksLikeSubjectiveQuestionRemainder(numberedItem.content);
  const hasOwnAnswerMarkerAhead = hasAnswerMarkerAheadBeforeNextQuestion(sourceLines, lineIndex);

  const isHighConfidenceNextQuestion = isExpectedOfficialNext && (
    hasOwnAnswerMarkerAhead ||
    (rollsBackFromAnswerItems && looksLikeQuestion) ||
    (breaksAnswerItemSequence && looksLikeQuestion) ||
    (lastItemNumber === null && hasBlankSeparator && looksLikeQuestion)
  );
  if (isHighConfidenceNextQuestion) return false;

  if (lastItemNumber === null) {
    return numberedItem.number === 1 || !isExpectedOfficialNext;
  }
  if (numberedItem.number === lastItemNumber + 1) return true;
  if (numberedItem.number > lastItemNumber) return true;
  return !isExpectedOfficialNext;
}

function shouldAttachSubjectiveAnswerMarkerToCurrentBlock(
  currentLines: string[],
  line: string,
  forcedType: string | null
): boolean {
  if (currentLines.length === 0) return false;
  if (extractSubjectiveAnswerMarkerTail(line) === null) return false;
  if (currentLines.some((l: string): boolean => isStandardOptionLine(l))) return false;
  if (forcedType === QuestionType.SHORT) return true;

  const questionPart = currentLines.join('\n');
  if (SUBJECTIVE_QUESTION_TYPE_REGEX.test(questionPart)) return true;
  return SUBJECTIVE_QUESTION_CUE_REGEX.test(questionPart);
}

function findSubjectiveAnswerMarkerIndex(currentLines: string[], forcedType: string | null): number {
  let markerIndex = -1;
  for (let i = currentLines.length - 1; i >= 0; i--) {
    if (extractSubjectiveAnswerMarkerTail(currentLines[i]) !== null) {
      markerIndex = i;
      break;
    }
  }
  if (markerIndex < 0) return -1;
  if (forcedType === QuestionType.SHORT) return markerIndex;

  const questionPart = currentLines.slice(0, markerIndex).join('\n');
  if (SUBJECTIVE_QUESTION_TYPE_REGEX.test(questionPart)) return markerIndex;
  if (SUBJECTIVE_QUESTION_CUE_REGEX.test(questionPart)) return markerIndex;

  const markerLine = currentLines[markerIndex];
  if (SUBJECTIVE_CONTINUATION_MARKER_REGEX.test(markerLine)) return markerIndex;
  const markerTail = extractSubjectiveAnswerMarkerTail(markerLine) ?? '';
  if (markerTail.trim().length === 0 || SUBJECTIVE_ANSWER_INTRO_REGEX.test(markerTail)) return markerIndex;
  return -1;
}

function extractSubjectiveAnswerMarkerTail(line: string): string | null {
  const match = SUBJECTIVE_ANSWER_MARKER_WITH_TAIL_REGEX.exec(line);
  if (match !== null) {
    return g(match, 1).trim();
  }
  if (BARE_SUBJECTIVE_ANSWER_MARKER_REGEX.test(line)) return '';
  return null;
}

function parseNumberedSubjectiveItem(line: string): NumberedSubjectiveItem | null {
  const match = NUMBERED_SUBJECTIVE_ITEM_REGEX.exec(line);
  if (match === null) return null;
  const numberRaw = g(match, 1).length > 0 ? g(match, 1) : g(match, 2);
  const number = toIntOrNull(numberRaw);
  if (number === null) return null;
  const content = g(match, 3).trim();
  if (content.length === 0) return null;
  return new NumberedSubjectiveItem(number, content);
}

function looksLikeSubjectiveQuestionRemainder(content: string): boolean {
  const normalized = content.trim();
  if (normalized.length === 0) return false;
  if (normalized.endsWith('？') || normalized.endsWith('?')) return true;
  return SUBJECTIVE_QUESTION_LEAD_REGEX.test(normalized);
}

function hasAnswerMarkerAheadBeforeNextQuestion(sourceLines: string[], currentLineIndex: number): boolean {
  let nonBlankCount = 0;
  for (let index = currentLineIndex + 1; index < sourceLines.length; index++) {
    const nextLine = sourceLines[index].trim();
    if (nextLine.length === 0) continue;
    nonBlankCount += 1;
    if (extractSubjectiveAnswerMarkerTail(nextLine) !== null) return true;
    if (parseQuestionStart(nextLine) !== null) return false;
    if (isSectionHeading(nextLine)) return false;
    if (nonBlankCount >= 12) return false;
  }
  return false;
}

function hasSubjectiveContinuationContext(currentLines: string[]): boolean {
  if (currentLines.some((l: string): boolean => SUBJECTIVE_CONTINUATION_MARKER_REGEX.test(l))) return true;
  const combined = currentLines.join('\n');
  if (!SUBJECTIVE_QUESTION_TYPE_REGEX.test(combined)) return false;
  return currentLines.some((l: string): boolean => ANSWER_LINE_REGEX.test(l));
}

function looksLikeTypedQuestionStart(line: string): boolean {
  const start = parseQuestionStart(line);
  return start !== null && start.forcedType !== null;
}

function looksLikeInterviewQuestionRemainder(rest: string): boolean {
  if (rest.trim().length === 0) return false;
  if (isSectionHeading(rest)) return false;
  if (INTERVIEW_EXCLUDE_REGEX.test(rest)) return false;
  return /[?？]/.test(rest) || INTERVIEW_INCLUDE_REGEX.test(rest);
}

function shouldStartNextSyntheticBlock(currentLines: string[], nextLine: string): boolean {
  if (hasSubjectiveContinuationContext(currentLines)) return false;
  if (!isLikelyUnnumberedQuestionLine(nextLine)) return false;
  if (isStandardOptionLine(nextLine)) return false;
  const hasOption = currentLines.some((l: string): boolean =>
    isStandardOptionLine(l) || hasCompactOptionSequence(l));
  const hasAnswer = currentLines.some((l: string): boolean =>
    EMBEDDED_ANSWER_REGEX.test(l) || ANSWER_LINE_REGEX.test(l));
  return hasAnswer || hasOption;
}

function isLikelyTypedQuestionLine(line: string, forcedType: string | null): boolean {
  if (forcedType === null) return false;
  if (line.length < 2) return false;
  if (isStandardOptionLine(line)) return false;
  if (ANSWER_LINE_REGEX.test(line) || ANALYSIS_LINE_REGEX.test(line)) return false;
  if (isSectionHeading(line)) return false;
  return true;
}

function isPureFrontMatterLine(line: string): boolean {
  const normalized = line.trim();
  if (normalized.length === 0) return false;
  return PURE_FRONT_MATTER_LINE_REGEX.test(normalized);
}

function isLikelyUnnumberedQuestionLine(line: string): boolean {
  if (line.length < 4) return false;
  if (isPureFrontMatterLine(line)) return false;
  if (USAGE_PREFIX_REGEX.test(line)) return false;
  if (BRACKET_NOTE_PREFIX_REGEX.test(line)) return false;
  if (isStandardOptionLine(line)) return false;
  if (ANSWER_LINE_REGEX.test(line) || ANALYSIS_LINE_REGEX.test(line)) return false;
  if (isSectionHeading(line)) return false;
  const typed = extractLeadingTypeLabel(line);
  if (typed !== null && typed.remainder.trim().length > 0) return true;
  if (EMBEDDED_ANSWER_REGEX.test(line)) return true;
  if (looksLikeStandaloneCodeExpression(line)) return false;
  if (hasUnprotectedObjectiveMarker(line)) return true;
  if (hasUnprotectedEmptyParentheses(line)) return true;
  if (QUESTION_LEAD_WORD_REGEX.test(line)) return true;
  if (ENDING_PUNCT_REGEX.test(line)) return true;
  return false;
}

function hasUnprotectedObjectiveMarker(line: string): boolean {
  UNNUMBERED_OBJECTIVE_MARKER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNNUMBERED_OBJECTIVE_MARKER_REGEX.exec(line)) !== null) {
    const v = g(m, 1);
    const token = v.length > 0 ? v : g(m, 2);
    if (!isProtectedParenthesizedToken(line, m.index, m.index + m[0].length - 1, token)) {
      return true;
    }
  }
  return false;
}
