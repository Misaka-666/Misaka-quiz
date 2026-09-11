/**
 * 多空填空解析 — 1:1 移植自 Android MultiBlankQuestionParser.kt。
 */
import { QuestionType, Option } from '../../domain/Models';
import { splitReliableParts, compatibilityAnswer, countExplicitBlanks } from '../model/MultiBlankSupport';
import { isProtectedParenthesizedToken } from './CodeLikeTextGuard';

export class InlineBlankConfidence {
  static readonly NONE: string = 'NONE';
  static readonly MEDIUM: string = 'MEDIUM';
  static readonly HIGH: string = 'HIGH';
}

export class InlineBlankAnalysis {
  confidence: string;
  questionText: string;
  blankAnswers: string[][];
  answer: string[];
  warnings: string[];
  evidence: string[];
  rejectionReason: string | null;
  constructor(confidence: string, questionText: string) {
    this.confidence = confidence;
    this.questionText = questionText;
    this.blankAnswers = [];
    this.answer = [];
    this.warnings = [];
    this.evidence = [];
    this.rejectionReason = null;
  }
}

export class MultiBlankParseResult {
  questionText: string;
  blankAnswers: string[][];
  answer: string[];
  warnings: string[];
  constructor(questionText: string, answer: string[], blankAnswers: string[][], warnings: string[]) {
    this.questionText = questionText;
    this.blankAnswers = blankAnswers;
    this.answer = answer;
    this.warnings = warnings;
  }
}

// 对应 Kotlin MatchResult.range [start, end]（含端点）+ 第 1 组（开括号字符）
class BracketMatchInfo {
  start: number;
  end: number;
  open: string;
  constructor(start: number, end: number, open: string) {
    this.start = start;
    this.end = end;
    this.open = open;
  }
}

class FilledBlankCandidate {
  match: BracketMatchInfo;
  content: string;
  constructor(match: BracketMatchInfo, content: string) {
    this.match = match;
    this.content = content;
  }
}

const FILLED_BRACKET_REGEX = /([（(])\s*([^()（）\r\n]{1,80}?)\s*([）)])/g;
const FILL_INTENT_REGEX = /(填空|填入|填写|依次填写|补全|补充完整|括号内|括号里|空白处|横线上)/;
const SEMANTIC_STRUCTURE_REGEX = /(?:包括|包含|主要有|由.{0,24}组成|由.{0,24}构成|分为|可分为|分成|可分成|分别(?:是|为)|依次(?:是|为)|组成(?:是|为)|构成(?:是|为)|概括(?:是|为)|表现(?:是|为)|要求做到|对应(?:是|为)|表示)|(?:方针|原则|内容|要点|措施|目标|要求|职责|任务|分类|类型|阶段|部分|模块|环节|步骤|条件|因素|特点|特征).{0,12}(?:是|为|有|包括|包含|分为|组成|构成)/;
const PAIRED_STRUCTURE_REGEX = /(?:一是.{0,80}二是|其一.{0,80}其二|首先.{0,80}其次|第一.{0,80}第二|一个.{0,80}另一个|前者.{0,80}后者|横坐标.{0,80}纵坐标|横向.{0,80}纵向)/;
const OBJECTIVE_ANSWER_TOKEN_REGEX = /^[A-Ga-g](?:\s*[,，、;；/\\]?\s*[A-Ga-g]){0,6}$/;
const LIKELY_UNIT_ONLY_REGEX = /^(?:MPa|kPa|Pa|℃|°C|K|m|cm|mm|km|m\/s|km\/h|kg|g|mol|s|min|h|%|V|A)$/i;
const METADATA_CONTEXT_REGEX = /(?:以下简称|简称|又称|英文名称?|注册地址|统一社会信用代码|主席令|令第\s*\d+\s*号|征求意见稿|修订版|修订稿|出版社|文件编号|标准编号|附录\s*[A-Z0-9一二三四五六七八九十]+|图表\s*\d+)/i;
const METADATA_CONTENT_REGEX = /^(?:\d{4}\s*年?(?:修订|版)?|第?\s*\d+\s*号|.*(?:修订版|修订稿|征求意见稿|主席令|出版社)|(?:以下简称|简称|又称|英文名称?|注册地址|型号|规格|编号|标准号|文件号)\s*[:：]?.*)$/i;
const PARAMETER_CONTENT_REGEX = /^(?:(?:型号|规格|功率|电压|电流|直径|长度|宽度|高度|重量|质量|容量|温度|压力|频率|转速)\s*[:：]?)?.*\d+(?:\.\d+)?\s*(?:MPa|kPa|Pa|℃|°C|K|mm|cm|km|m|m\/s|km\/h|kg|g|mol|s|min|h|Hz|kW|W|V|A|%|型|号)$/i;
const ORDINAL_TOKEN_REGEX = /^(?:\d{1,2}|[一二三四五六七八九十]{1,3})$/;
const SKELETON_BLANK_REGEX = /(?:\(\s*\)|（\s*）|_{3,})/g;
const SKELETON_FILLER_REGEX = /[\s、，,；;和及与或以及并且]+/g;

function g(match: RegExpExecArray | null, index: number): string {
  if (match === null) {
    return '';
  }
  return match[index] !== undefined ? match[index] : '';
}

function isLetterOrDigitOrNonAscii(ch: string): boolean {
  if (ch >= 'a' && ch <= 'z') return true;
  if (ch >= 'A' && ch <= 'Z') return true;
  if (ch >= '0' && ch <= '9') return true;
  return ch.codePointAt(0) > 127;
}

function distinctStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function findAllFilledBrackets(stem: string): BracketMatchInfo[] {
  const out: BracketMatchInfo[] = [];
  FILLED_BRACKET_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FILLED_BRACKET_REGEX.exec(stem)) !== null) {
    out.push(new BracketMatchInfo(m.index, m.index + m[0].length - 1, g(m, 1)));
  }
  return out;
}

export function analyzeInlineFilledBlanks(
  stem: string,
  options: Option[],
  answerText: string,
  forcedBlankContext: boolean
): InlineBlankAnalysis {
  if (stem.trim().length === 0 || options.length > 0) return noneResult(stem);

  const rawMatches = findAllFilledBrackets(stem);
  if (rawMatches.length < 2) return noneResult(stem);

  const addedFlags: boolean[] = [];
  const unprotectedMatches: BracketMatchInfo[] = [];
  for (let index = 0; index < rawMatches.length; index++) {
    const match = rawMatches[index];
    const contentStart = match.start + 1;
    const content = stem.substring(contentStart, match.end);
    const protectedToken = isProtectedParenthesizedToken(stem, match.start, match.end, content.trim());
    const previousIndex = index - 1;
    let followsSafeBracket = false;
    if (protectedToken && previousIndex >= 0 && addedFlags[previousIndex] === true) {
      followsSafeBracket = stem
        .substring(rawMatches[previousIndex].end + 1, match.start)
        .trim()
        .length === 0;
    }
    if (!protectedToken || followsSafeBracket) {
      unprotectedMatches.push(match);
      addedFlags.push(true);
    } else {
      addedFlags.push(false);
    }
  }
  if (unprotectedMatches.length < 2) return noneResult(stem);

  const contentOf = (match: BracketMatchInfo): string =>
    stem.substring(match.start + 1, match.end).trim();

  if (unprotectedMatches.some((match: BracketMatchInfo): boolean =>
    OBJECTIVE_ANSWER_TOKEN_REGEX.test(contentOf(match)))) {
    return rejected(stem, forcedBlankContext, '括号内容疑似选择题答案');
  }

  const candidates: FilledBlankCandidate[] = [];
  for (const match of unprotectedMatches) {
    const content = contentOf(match);
    if (isLikelyOrdinalLabel(stem, match, content)) continue;
    if (!isPlausibleFilledBlank(content)) continue;
    candidates.push(new FilledBlankCandidate(match, content));
  }
  if (candidates.length < 2) return noneResult(stem);

  const hardRejection = hardRejectionReason(stem, candidates);
  if (hardRejection !== null) {
    return rejected(stem, forcedBlankContext, hardRejection);
  }

  const answerParts = splitReliableParts(answerText, candidates.length);
  let answerMatches = false;
  if (answerParts !== null) {
    answerMatches = answerParts.every((answer: string, index: number): boolean =>
      normalizeComparable(answer) === normalizeComparable(candidates[index].content));
  }
  if (answerText.trim().length > 0 && answerParts === null) {
    return mediumResult(stem, '检测到多个内嵌答案，但独立答案数量无法对应');
  }
  if (answerParts !== null && !answerMatches) {
    return mediumResult(stem, '内嵌答案与独立答案不一致');
  }

  const evidence: string[] = [];
  let score = 0;

  if (FILL_INTENT_REGEX.test(stem)) {
    score += 4;
    evidence.push('明确填空提示');
  }
  if (answerMatches) {
    score += 3;
    evidence.push('独立答案逐空对应');
  }
  if (SEMANTIC_STRUCTURE_REGEX.test(stem) || PAIRED_STRUCTURE_REGEX.test(stem)) {
    score += 3;
    evidence.push('组成、分类、列举或对应结构');
  }
  if (candidates.every((c: FilledBlankCandidate): boolean => c.content.length <= 32)) {
    score += 2;
    evidence.push('多个短语型括号');
  }
  if (hasStableParallelGaps(stem, candidates)) {
    score += 2;
    evidence.push('括号之间存在稳定并列关系');
  }
  const cleanStem = replaceCandidatesWithBlanks(stem, candidates);
  if (formsPlausibleBlankSkeleton(cleanStem, candidates.length)) {
    score += 1;
    evidence.push('替换后形成多空骨架');
  }
  if (hasSimilarContentLengths(candidates)) {
    score += 1;
    evidence.push('括号内容形式接近');
  }
  if (candidates.length >= 3) {
    score += 1;
    evidence.push('三个以上连续题空');
  }

  const groups = candidates.map((candidate: FilledBlankCandidate, index: number): string[] => {
    const group = [candidate.content];
    const part = answerParts !== null && index < answerParts.length ? answerParts[index] : null;
    if (part !== null && part !== undefined && part.trim().length > 0) {
      group.push(part.trim());
    }
    return distinctStrings(group);
  });
  const compatAnswer = compatibilityAnswer(groups);

  let confidence: string;
  if (forcedBlankContext) {
    confidence = InlineBlankConfidence.HIGH;
  } else if (score >= 7) {
    confidence = InlineBlankConfidence.HIGH;
  } else if (score >= 4) {
    confidence = InlineBlankConfidence.MEDIUM;
  } else {
    confidence = InlineBlankConfidence.NONE;
  }

  if (confidence === InlineBlankConfidence.HIGH) {
    const result = new InlineBlankAnalysis(confidence, cleanStem);
    result.blankAnswers = groups;
    result.answer = compatAnswer;
    result.evidence = forcedBlankContext ? evidence.concat(['明确填空题分区或题型']) : evidence;
    return result;
  }
  if (confidence === InlineBlankConfidence.MEDIUM) {
    const result = new InlineBlankAnalysis(confidence, stem);
    result.warnings = ['疑似内嵌多空题，请人工核对'];
    result.evidence = evidence;
    return result;
  }
  return noneResult(stem);
}

export function extractMultiBlank(
  stem: string,
  type: string,
  options: Option[],
  answerText: string,
  normalizedAnswer: string[],
  inlineAnalysis: InlineBlankAnalysis | null = null
): MultiBlankParseResult {
  if (type !== QuestionType.BLANK || options.length > 0) {
    const warnings = inlineAnalysis !== null && inlineAnalysis.confidence === InlineBlankConfidence.MEDIUM
      ? inlineAnalysis.warnings
      : [];
    return new MultiBlankParseResult(stem, normalizedAnswer, [], warnings);
  }

  const explicitBlankCount = countExplicitBlanks(stem);
  if (explicitBlankCount > 1) {
    if (answerText.trim().length === 0) {
      const emptyGroups: string[][] = [];
      for (let i = 0; i < explicitBlankCount; i++) emptyGroups.push([]);
      return new MultiBlankParseResult(stem, [], emptyGroups,
        [`检测到${explicitBlankCount}个题空，未识别逐空答案，请人工核对`]);
    }
    const parts = splitReliableParts(answerText, explicitBlankCount);
    if (parts !== null) {
      const groups = parts.map((p: string): string[] => [p]);
      return new MultiBlankParseResult(stem, compatibilityAnswer(groups), groups, []);
    }
    return new MultiBlankParseResult(stem, normalizedAnswer, [],
      [`检测到${explicitBlankCount}个题空，答案数量无法对应，请人工核对`]);
  }

  if (explicitBlankCount > 0) {
    return new MultiBlankParseResult(stem, normalizedAnswer, [], []);
  }

  const analysis = inlineAnalysis ?? analyzeInlineFilledBlanks(stem, options, answerText, true);
  if (analysis.confidence === InlineBlankConfidence.HIGH) {
    return new MultiBlankParseResult(analysis.questionText, analysis.answer, analysis.blankAnswers, analysis.warnings);
  }
  if (analysis.confidence === InlineBlankConfidence.MEDIUM) {
    return new MultiBlankParseResult(stem, normalizedAnswer, [], analysis.warnings);
  }
  return new MultiBlankParseResult(stem, normalizedAnswer, [], []);
}

function hardRejectionReason(stem: string, candidates: FilledBlankCandidate[]): string | null {
  if (METADATA_CONTEXT_REGEX.test(stem)) return '括号内容疑似版本、引用或补充说明';
  if (candidates.some((c: FilledBlankCandidate): boolean => METADATA_CONTENT_REGEX.test(c.content))) {
    return '括号内容疑似版本、编号或补充说明';
  }
  if (candidates.some((c: FilledBlankCandidate): boolean => PARAMETER_CONTENT_REGEX.test(c.content))) {
    return '括号内容疑似型号、参数或单位说明';
  }
  if (candidates.some((c: FilledBlankCandidate): boolean => c.content.length > 60)) return '括号内容过长';
  const sentencePunctuation = ['。', '！', '？', '!', '?', '；', ';'];
  if (candidates.some((c: FilledBlankCandidate): boolean =>
    c.content.split('').some((ch: string): boolean => sentencePunctuation.includes(ch)))) {
    return '括号内容疑似完整说明句';
  }
  return null;
}

function isPlausibleFilledBlank(content: string): boolean {
  if (content.trim().length === 0 || content.length > 60) return false;
  if (OBJECTIVE_ANSWER_TOKEN_REGEX.test(content)) return false;
  if (LIKELY_UNIT_ONLY_REGEX.test(content)) return false;
  const sentencePunctuation = ['。', '！', '？', '!', '?', '；', ';'];
  for (const ch of content) {
    if (sentencePunctuation.includes(ch)) return false;
  }
  for (const ch of content) {
    if (isLetterOrDigitOrNonAscii(ch)) return true;
  }
  return false;
}

function isLikelyOrdinalLabel(stem: string, match: BracketMatchInfo, content: string): boolean {
  if (!ORDINAL_TOKEN_REGEX.test(content)) return false;
  let next = match.end + 1;
  while (next < stem.length && /\s/.test(stem.charAt(next))) next += 1;
  const nextChar = next < stem.length ? stem.charAt(next) : null;
  const immediatelyFollowedByBracket = nextChar === '(' || nextChar === '（';
  if (!immediatelyFollowedByBracket) return false;

  let previous = match.start - 1;
  while (previous >= 0 && /\s/.test(stem.charAt(previous))) previous -= 1;
  if (previous < 0) return true;
  return ['。', '；', ';', '：', ':', '，', ',', '）', ')'].includes(stem.charAt(previous));
}

function hasStableParallelGaps(stem: string, candidates: FilledBlankCandidate[]): boolean {
  if (candidates.length < 2) return false;
  for (let i = 0; i + 1 < candidates.length; i++) {
    const left = candidates[i].match;
    const right = candidates[i + 1].match;
    const start = left.end + 1;
    const end = right.start;
    if (start > end) return false;
    const gapText = stem.substring(start, end).trim();
    if (gapText.length > 24) return false;
    if (gapText.split('').some((ch: string): boolean => ['。', '！', '？', '!', '?'].includes(ch))) {
      return false;
    }
  }
  return true;
}

function formsPlausibleBlankSkeleton(stem: string, expectedCount: number): boolean {
  if (countExplicitBlanks(stem) !== expectedCount) return false;
  const outside = stem
    .replace(SKELETON_BLANK_REGEX, '')
    .replace(SKELETON_FILLER_REGEX, '');
  let count = 0;
  for (const ch of outside) {
    if (isLetterOrDigitOrNonAscii(ch)) {
      count += 1;
      if (count >= 2) return true;
    }
  }
  return false;
}

function hasSimilarContentLengths(candidates: FilledBlankCandidate[]): boolean {
  if (candidates.length < 2) return false;
  const lengths = candidates.map((c: FilledBlankCandidate): number => c.content.length);
  const average = lengths.reduce((a: number, b: number): number => a + b, 0) / lengths.length;
  const maxLen = Math.max(...lengths);
  const minLen = Math.min(...lengths);
  return maxLen - minLen <= Math.max(8, Math.floor(average));
}

function replaceCandidatesWithBlanks(text: string, candidates: FilledBlankCandidate[]): string {
  let result = text;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    const replacement = candidate.match.open === '（' ? '（ ）' : '( )';
    result = result.substring(0, candidate.match.start) + replacement + result.substring(candidate.match.end + 1);
  }
  return result;
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase().replace(/[\s　]+/g, '');
}

function noneResult(stem: string): InlineBlankAnalysis {
  return new InlineBlankAnalysis(InlineBlankConfidence.NONE, stem);
}

function mediumResult(stem: string, reason: string): InlineBlankAnalysis {
  const result = new InlineBlankAnalysis(InlineBlankConfidence.MEDIUM, stem);
  result.warnings = [`疑似内嵌多空题，请人工核对：${reason}`];
  result.rejectionReason = reason;
  return result;
}

function rejected(stem: string, forcedBlankContext: boolean, reason: string): InlineBlankAnalysis {
  if (forcedBlankContext) {
    return mediumResult(stem, reason);
  }
  const result = new InlineBlankAnalysis(InlineBlankConfidence.NONE, stem);
  result.rejectionReason = reason;
  return result;
}
