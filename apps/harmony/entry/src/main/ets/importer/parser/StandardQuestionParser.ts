/**
 * 标准题解析 — 1:1 移植自 Android StandardQuestionParser.kt。
 * 插值正则用 new RegExp(模板串) 重建，组语义与 Kotlin 一致。
 */
import { Question, QuestionType, Option } from '../../domain/Models';
import { splitQuestionBlocks, QuestionBlock } from './QuestionBlockSplitter';
import { extractLeadingTypeLabel } from './QuestionTypeLabelParser';
import { containsMarker } from '../assets/QuestionImageMarker';
import { isJudgeOptionPair, shouldInferJudgeFromBinaryOptions } from './ParserUtils';
import { parseObjectiveAnswers, isJudgeAnswerText, isObjectiveAnswerText, parseTextAnswer } from './AnswerParser';
import { isProtectedParenthesizedToken, hasUnprotectedEmptyParentheses, looksLikeLeadingCodeOption } from './CodeLikeTextGuard';
import { hasCompactOptionSequence } from './CompactQuestionRepair';
import {
  analyzeInlineFilledBlanks,
  extractMultiBlank,
  InlineBlankAnalysis,
  InlineBlankConfidence
} from './MultiBlankQuestionParser';

const ANSWER_LABEL_PATTERN = '答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答';
const ANALYSIS_LABEL_PATTERN = '答案解析|解题思路|解析思路|解题分析|参考解析|详解|分析|理由|解答|解析|说明';
const OBJECTIVE_ANSWER_VALUE_PATTERN = '[A-Ga-g]{1,7}|对|错|正确|错误|是|否|√|×|True|False';
const EMBEDDED_CHOICE_LETTER_PATTERN = '(?:[A-Ga-g]{1,7}|[A-Ga-g](?:\\s*[,，、;；/\\\\]\\s*[A-Ga-g]){1,6}|[A-Ga-g](?:\\s+[A-Ga-g]){1,6})';
const ANSWER_SEPARATOR_PATTERN = '(?:\\s*(?:[:：,，、.．;；]|为)\\s*|\\s+|(?=\\s*[\\(（]))';

const ANSWER_LINE_REGEX = new RegExp(`^\\s*(?:(?:[\\[【]\\s*(?:${ANSWER_LABEL_PATTERN})\\s*[\\]】]\\s*)|(?:(?:本题)?(?:${ANSWER_LABEL_PATTERN})${ANSWER_SEPARATOR_PATTERN}))(.+?)\\s*$`);
const ANALYSIS_LINE_REGEX = new RegExp(`^\\s*(?:(?:[\\[【]\\s*(?:${ANALYSIS_LABEL_PATTERN})\\s*[\\]】]\\s*)|(?:(?:${ANALYSIS_LABEL_PATTERN})\\s*[:：]\\s*))(.*)$`);
const BRACKET_ANSWER_REGEX = new RegExp(`[\\[【\\(（]\\s*(?:${ANSWER_LABEL_PATTERN})${ANSWER_SEPARATOR_PATTERN}([^\\]】\\)）]+)\\s*[\\]】\\)）]`);
const EMBEDDED_CHOICE_ANSWER_REGEX = new RegExp(`[\\(（]\\s*(${EMBEDDED_CHOICE_LETTER_PATTERN}|对|错|正确|错误|是|否|√|×|True|False)\\s*[\\)）]`, 'i');
const EMBEDDED_CHOICE_ANSWER_REGEX_GLOBAL = new RegExp(`[\\(（]\\s*(${EMBEDDED_CHOICE_LETTER_PATTERN}|对|错|正确|错误|是|否|√|×|True|False)\\s*[\\)）]`, 'gi');
const BLANK_TEXT_KEYWORDS_REGEX = /(填空|填入|补全|补充完整|空白处|空白|空格|横线|横线上|括号内|括号里|_{2,})/;
const SOLUTION_CHOICE_REGEX = new RegExp(`^\\s*(?:(?:本题)?(?:答案|正确答案|参考答案|标准答案|正确选项)\\s*(?:为|是)|(?:本题)?(?:应选|故选)|(?:分析|解析)\\s*[:：]\\s*(?:应选|故选|选))\\s*(${OBJECTIVE_ANSWER_VALUE_PATTERN})\\b[.。,:：，、;；]?\\s*(.*)$`, 'i');
const SUBJECTIVE_ANSWER_LINE_REGEX = new RegExp(`^\\s*(?:(?:[\\[【]\\s*(?:${ANSWER_LABEL_PATTERN})\\s*[\\]】]\\s*)|(?:(?:本题)?(?:${ANSWER_LABEL_PATTERN})${ANSWER_SEPARATOR_PATTERN}))(.*)$`);
const ANSWER_WITH_ANALYSIS_REGEX = new RegExp(`^\\s*(?:(?:[\\[【]\\s*(?:${ANSWER_LABEL_PATTERN})\\s*[\\]】]\\s*)|(?:(?:本题)?(?:${ANSWER_LABEL_PATTERN})${ANSWER_SEPARATOR_PATTERN}))(.+?)(?:\\s*(?:${ANALYSIS_LABEL_PATTERN})\\s*[:：]\\s*(.*))?\\s*$`);
const CHOICE_INTENT_REGEX = /(?:下列|以下).{0,24}(?:哪|正确|错误|不正确|符合)|选择|选出|最(?:合适|符合|恰当)|应(?:选择|选)/;
const WHITESPACE_REGEX = /\s+/g;
const JUDGE_TRUE_ANSWER_REGEX = /^(对|正确|是|√|true|t)$/i;
const JUDGE_FALSE_ANSWER_REGEX = /^(错|错误|否|×|x|false|f)$/i;
// 函数内联 Regex 提升为常量
const OPTION_LABEL_STRIP_REGEX = /^\s*(?:选项|备选项|选项内容|候选项)\s*[:：]\s*/;
const LEADING_PUNCTUATED_OPTION_REGEX = /^\s*([A-Ga-g])\s*[.、．:：)）]/;
const LEADING_BRACKET_OPTION_REGEX = /^\s*[\(（\[【〔〖《]\s*([A-Ga-g])\s*[\)）\]】〕〗》]/;
const QUESTION_NUMBER_PREFIX_REGEX = /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?\s*[.、．:：)）]/;
const TABLE_ROW_NAME_REGEX = /^(?:df|SS|MS|F|Significance\s+F|回归分析|残差|总计|方差)$/i;
const SENTENCE_END_PUNCT_REGEX = /[。；;]\s*$/;
const CHOICE_STEM_CUE_REGEX = /(?:下列|以下|哪个|哪项|哪一项|选择|选出|不正确|符合|不符合|可以避免|统计量是)/;

class OptionMarker {
  key: string;
  markerStart: number;
  contentStart: number;
  constructor(key: string, markerStart: number, contentStart: number) {
    this.key = key;
    this.markerStart = markerStart;
    this.contentStart = contentStart;
  }
}

class LineAnswerExtraction {
  cleanLine: string;
  answerText: string | null;
  analysisText: string | null;
  constructor(cleanLine: string, answerText: string | null, analysisText: string | null) {
    this.cleanLine = cleanLine;
    this.answerText = answerText;
    this.analysisText = analysisText;
  }
}

class EmbeddedStemAnswer {
  cleanStem: string;
  answerText: string;
  constructor(cleanStem: string, answerText: string) {
    this.cleanStem = cleanStem;
    this.answerText = answerText;
  }
}

class InferredPlainOptions {
  stem: string[];
  options: Option[];
  constructor(stem: string[], options: Option[]) {
    this.stem = stem;
    this.options = options;
  }
}

class PreparedQuestionLine {
  line: string;
  forcedType: string | null;
  constructor(line: string, forcedType: string | null = null) {
    this.line = line;
    this.forcedType = forcedType;
  }
}

function g(match: RegExpExecArray | null, index: number): string {
  if (match === null) {
    return '';
  }
  return match[index] !== undefined ? match[index] : '';
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// 解析器生成的临时唯一 id（对应 Android Question 默认 UUID；
// FullPaperFallbackStrategy 依赖 id 定位替换题段）。M3 入库时可重新赋值。
let nextParserQuestionId = 0;

function generateParserQuestionId(): string {
  nextParserQuestionId += 1;
  return `q-${nextParserQuestionId}`;
}

export function parseStandardText(
  text: string,
  forcedType: string | null = null,
  category: string = '',
  allowUnnumbered: boolean = true
): Question[] {
  const blocks = splitQuestionBlocks(text, forcedType, category, allowUnnumbered);
  const out: Question[] = [];
  for (const block of blocks) {
    const q = parseStandardBlock(block);
    if (q !== null) out.push(q);
  }
  return out;
}

export function parseStandardBlock(block: QuestionBlock): Question | null {
  if (block.lines.length === 0) return null;

  const options: Option[] = [];
  const stemLines: string[] = [];
  const analysisLines: string[] = [];
  const subjectiveAnswerLines: string[] = [];
  let answerText = '';
  let forcedType = block.forcedType;
  let inAnalysis = false;
  let inSubjectiveAnswer = false;

  for (const rawLine of block.lines) {
    const preparedLine = prepareQuestionLine(
      rawLine,
      stemLines.length === 0 && options.length === 0 && answerText.trim().length === 0 && subjectiveAnswerLines.length === 0
    );
    if (preparedLine.forcedType !== null) {
      forcedType = preparedLine.forcedType;
    }
    const extracted = extractInlineAnswer(preparedLine.line.trim());
    const line = extracted.cleanLine.trim();
    if (extracted.answerText !== null && extracted.answerText.trim().length > 0 && answerText.trim().length === 0) {
      answerText = extracted.answerText.trim();
    }
    if (extracted.analysisText !== null && extracted.analysisText.trim().length > 0) {
      analysisLines.push(extracted.analysisText.trim());
    }

    if (line.length === 0) {
      // 空行跳过
    } else if (inAnalysis) {
      analysisLines.push(line);
    } else if (ANALYSIS_LINE_REGEX.test(line)) {
      inAnalysis = true;
      inSubjectiveAnswer = false;
      analysisLines.push(g(ANALYSIS_LINE_REGEX.exec(line), 1).trim());
    } else if (SUBJECTIVE_ANSWER_LINE_REGEX.test(line)) {
      const content = g(SUBJECTIVE_ANSWER_LINE_REGEX.exec(line), 1).trim();
      if (content.length > 0) subjectiveAnswerLines.push(content);
      inSubjectiveAnswer = true;
    } else if (ANSWER_LINE_REGEX.test(line)) {
      if (answerText.trim().length === 0) {
        answerText = g(ANSWER_LINE_REGEX.exec(line), 1).trim();
      }
    } else if (inSubjectiveAnswer) {
      subjectiveAnswerLines.push(line);
    } else if (appendOptionsOrStem(line, options)) {
      // 选项已添加
    } else if (options.length > 0) {
      const last = options.pop();
      if (last !== undefined) {
        options.push(new Option(last.key, `${last.text} ${line}`.replace(WHITESPACE_REGEX, ' ').trim()));
      }
    } else {
      stemLines.push(line);
    }
  }

  if (answerText.trim().length === 0 && subjectiveAnswerLines.length > 0) {
    answerText = subjectiveAnswerLines.join('\n').trim();
  }

  if (options.length === 0) {
    const inferred = inferImageOptionLabelLine(stemLines, forcedType) ??
      inferPlainOptionLines(stemLines, forcedType, answerText);
    if (inferred !== null) {
      stemLines.length = 0;
      for (const l of inferred.stem) stemLines.push(l);
      for (const o of inferred.options) options.push(o);
    }
  }

  let stem = stemLines.join(' ').replace(WHITESPACE_REGEX, ' ').trim();
  if (stem.length === 0) return null;

  const embedded = extractEmbeddedAnswerFromStem(stem, answerText, options);
  if (embedded !== null) {
    if (answerText.trim().length === 0) {
      answerText = embedded.answerText;
    }
    stem = embedded.cleanStem;
  }

  const inlineBlankAnalysis = analyzeInlineFilledBlanks(
    stem,
    options,
    answerText,
    forcedType === QuestionType.BLANK
  );
  const type = inferType(stem, options, answerText, forcedType, inlineBlankAnalysis);
  const normalizedOptions = normalizeOptionsForType(options, type);
  const answer = normalizeAnswer(answerText, type);
  const multiBlank = extractMultiBlank(stem, type, normalizedOptions, answerText, answer, inlineBlankAnalysis);

  const question = new Question(generateParserQuestionId(), type, multiBlank.questionText);
  question.number = block.number;
  question.options = normalizedOptions;
  question.answer = multiBlank.answer;
  question.blankAnswers = multiBlank.blankAnswers;
  question.analysis = analysisLines.join('\n').trim();
  question.category = block.category;
  question.warnings = multiBlank.warnings;
  return question;
}

function prepareQuestionLine(rawLine: string, canStripTypeLabel: boolean): PreparedQuestionLine {
  const line = rawLine.trim();
  if (!canStripTypeLabel) return new PreparedQuestionLine(line);
  const typed = extractLeadingTypeLabel(line);
  if (typed === null) return new PreparedQuestionLine(line);
  return new PreparedQuestionLine(typed.remainder, typed.type);
}

function extractEmbeddedAnswerFromStem(
  stem: string,
  existingAnswer: string,
  options: Option[]
): EmbeddedStemAnswer | null {
  const rawMatches: RegExpExecArray[] = [];
  EMBEDDED_CHOICE_ANSWER_REGEX_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBEDDED_CHOICE_ANSWER_REGEX_GLOBAL.exec(stem)) !== null) {
    if (!isProtectedParenthesizedToken(stem, m.index, m.index + m[0].length - 1, g(m, 1))) {
      rawMatches.push(m);
    }
  }
  if (rawMatches.length === 0) return null;

  const answerTokens = parseObjectiveAnswers(existingAnswer);
  const hasCompactOptionContext = hasCompactOptionSequence(stem);
  const hasChoiceIntent = CHOICE_INTENT_REGEX.test(stem);
  let selected: RegExpExecArray | null = null;
  for (let i = rawMatches.length - 1; i >= 0; i--) {
    const match = rawMatches[i];
    const candidate = g(match, 1).trim();
    const candidateTokens = parseObjectiveAnswers(candidate);
    const hasObjectiveContext = options.length > 0 || hasCompactOptionContext || hasChoiceIntent;
    if (candidateTokens.length === 0) continue;
    if (candidateTokens.length > 0 && answerTokens.length > 0 && arraysEqual(candidateTokens, answerTokens)) {
      selected = match;
      break;
    }
    if (isJudgeAnswerText(candidate)) {
      selected = match;
      break;
    }
    if (existingAnswer.trim().length === 0 && hasObjectiveContext) {
      selected = match;
      break;
    }
  }
  if (selected === null) return null;

  const candidate = g(selected, 1).trim();
  const selStart = selected.index;
  const selEnd = selected.index + selected[0].length;
  const cleanStem = (stem.substring(0, selStart) + stem.substring(selEnd))
    .replace(/\s+([?？。；;，,])/g, '$1')
    .replace(WHITESPACE_REGEX, ' ')
    .trim()
    .replace(/[，,；;:：]+$/, '')
    .trim();

  return new EmbeddedStemAnswer(cleanStem, candidate);
}

function extractInlineAnswer(line: string): LineAnswerExtraction {
  let answer: string | null = null;
  let analysis: string | null = null;
  let clean = line;

  const solutionMatch = SOLUTION_CHOICE_REGEX.exec(clean);
  if (solutionMatch !== null) {
    if (answer === null) answer = g(solutionMatch, 1).trim();
    const tail = g(solutionMatch, 2).trim();
    analysis = cleanAnalysisTail(tail);
    clean = '';
  }

  const bracketMatch = BRACKET_ANSWER_REGEX.exec(clean);
  if (bracketMatch !== null) {
    answer = g(bracketMatch, 1).trim();
    clean = (clean.substring(0, bracketMatch.index) + clean.substring(bracketMatch.index + bracketMatch[0].length)).trim();
  }

  const answerWithAnalysis = ANSWER_WITH_ANALYSIS_REGEX.exec(clean);
  if (answerWithAnalysis !== null) {
    if (answer === null) answer = g(answerWithAnalysis, 1).trim();
    const analysisValue = g(answerWithAnalysis, 2).trim();
    analysis = analysisValue.length === 0 ? null : analysisValue;
  }

  return new LineAnswerExtraction(clean, answer, analysis);
}

function cleanAnalysisTail(raw: string): string | null {
  const tail = raw.trim().replace(/^[。.，,；;:：]+/, '').trim();
  if (tail.length === 0) return null;
  const match = ANALYSIS_LINE_REGEX.exec(tail);
  if (match !== null) {
    const content = g(match, 1).trim();
    return content.length === 0 ? null : content;
  }
  return tail;
}

function appendOptionsOrStem(line: string, options: Option[]): boolean {
  const optionLine = stripLeadingOptionLabel(line);
  const marker = findLeadingOptionMarker(optionLine);
  if (marker === null) return false;
  const text = optionLine.substring(marker.contentStart)
    .trim()
    .replace(/^[;；]+/, '')
    .replace(/[;；]+$/, '')
    .trim();
  if (text.length === 0) return false;

  let existingIndex = -1;
  for (let i = options.length - 1; i >= 0; i--) {
    if (options[i].key === marker.key) {
      existingIndex = i;
      break;
    }
  }
  if (existingIndex >= 0) {
    const relabelKey = missingPreviousOptionKey(marker.key, options);
    if (relabelKey !== null) {
      options[existingIndex] = new Option(relabelKey, options[existingIndex].text);
      options.push(new Option(marker.key, text));
    } else {
      const old = options[existingIndex];
      options[existingIndex] = new Option(old.key, `${old.text} ${text}`.replace(WHITESPACE_REGEX, ' ').trim());
    }
  } else {
    options.push(new Option(marker.key, text));
  }
  return true;
}

function inferImageOptionLabelLine(stemLines: string[], forcedType: string | null): InferredPlainOptions | null {
  if (forcedType === QuestionType.BLANK || forcedType === QuestionType.SHORT || forcedType === QuestionType.JUDGE) {
    return null;
  }
  if (!stemLines.some((l: string): boolean => containsMarker(l))) return null;

  let labelIndex = -1;
  for (let i = stemLines.length - 1; i >= 0; i--) {
    if (parseSequentialImageOptionKeys(stemLines[i]) !== null) {
      labelIndex = i;
      break;
    }
  }
  if (labelIndex < 0) return null;

  const keys = parseSequentialImageOptionKeys(stemLines[labelIndex]);
  if (keys === null) return null;
  const remainingStem = stemLines.filter((_: string, index: number): boolean => index !== labelIndex);
  const plainStem = remainingStem
    .filter((l: string): boolean => !containsMarker(l))
    .join(' ')
    .replace(WHITESPACE_REGEX, ' ')
    .trim();
  if (!looksLikeChoiceStemNeedingOptions(plainStem)) return null;

  return new InferredPlainOptions(
    remainingStem,
    keys.map((key: string): Option => new Option(key, `图中选项${key}`))
  );
}

function parseSequentialImageOptionKeys(line: string): string[] | null {
  const tokens = line.trim()
    .split(/\s+/)
    .map((t: string): string => t.trim().toUpperCase())
    .filter((t: string): boolean => t.length > 0);
  if (tokens.length < 2 || tokens.length > 7) return null;
  if (tokens.some((t: string): boolean => !/^[A-G]$/.test(t))) return null;
  const expected = 'ABCDEFG'.slice(0, tokens.length).split('');
  return arraysEqual(tokens, expected) ? tokens : null;
}

function inferPlainOptionLines(
  stemLines: string[],
  forcedType: string | null,
  answerText: string
): InferredPlainOptions | null {
  if (stemLines.length < 5 || stemLines.length > 8) return null;
  if (!shouldInferPlainOptions(forcedType, answerText)) return null;
  const stem = stemLines[0].trim();
  if (!looksLikeChoiceStemNeedingOptions(stem)) return null;
  const optionLines = stemLines.slice(1).map((l: string): string => l.trim())
    .filter((l: string): boolean => l.length > 0);
  if (optionLines.length < 4 || optionLines.length > 7) return null;
  if (optionLines.some((l: string): boolean => !looksLikePlainOptionText(l))) return null;
  if (!looksLikePlainOptionList(optionLines)) return null;
  const keys = 'ABCDEFG'.slice(0, optionLines.length).split('');
  return new InferredPlainOptions(
    [stem],
    keys.map((key: string, index: number): Option => new Option(key, optionLines[index]))
  );
}

function shouldInferPlainOptions(forcedType: string | null, answerText: string): boolean {
  if (forcedType === QuestionType.SINGLE || forcedType === QuestionType.MULTIPLE) return true;
  if (forcedType === QuestionType.BLANK || forcedType === QuestionType.SHORT || forcedType === QuestionType.JUDGE) return false;
  return parseObjectiveAnswers(answerText).length > 0;
}

function looksLikeChoiceStemNeedingOptions(stem: string): boolean {
  if (hasUnprotectedEmptyParentheses(stem)) return true;
  return CHOICE_STEM_CUE_REGEX.test(stem);
}

function looksLikePlainOptionText(line: string): boolean {
  if (line.length < 1 || line.length > 90) return false;
  if (ANSWER_LINE_REGEX.test(line) || ANALYSIS_LINE_REGEX.test(line)) return false;
  if (extractLeadingTypeLabel(line) !== null) return false;
  if (QUESTION_NUMBER_PREFIX_REGEX.test(line)) return false;
  if (TABLE_ROW_NAME_REGEX.test(line)) return false;
  return true;
}

function looksLikePlainOptionList(lines: string[]): boolean {
  if (lines.some((l: string): boolean => SENTENCE_END_PUNCT_REGEX.test(l))) return false;
  if (lines.filter((l: string): boolean => l.length <= 32).length < lines.length) return false;
  const totalLength = lines.reduce((a: number, l: string): number => a + l.length, 0);
  return totalLength / lines.length <= 24.0;
}

function stripLeadingOptionLabel(line: string): string {
  return line.replace(OPTION_LABEL_STRIP_REGEX, '');
}

function findLeadingOptionMarker(line: string): OptionMarker | null {
  const punctMatch = LEADING_PUNCTUATED_OPTION_REGEX.exec(line);
  if (punctMatch !== null && punctMatch[1] !== undefined) {
    const marker = new OptionMarker(
      punctMatch[1].toUpperCase(),
      punctMatch.index + punctMatch[0].indexOf(punctMatch[1]),
      punctMatch.index + punctMatch[0].length
    );
    if (
      !looksLikeDottedEnglishAbbreviation(line, marker) &&
      !looksLikeLeadingCodeOption(line, marker.markerStart, marker.contentStart)
    ) {
      return marker;
    }
  }

  const bracketMatch = LEADING_BRACKET_OPTION_REGEX.exec(line);
  if (bracketMatch !== null && bracketMatch[1] !== undefined) {
    const marker = new OptionMarker(
      bracketMatch[1].toUpperCase(),
      bracketMatch.index,
      bracketMatch.index + bracketMatch[0].length
    );
    if (!looksLikeLeadingCodeOption(line, marker.markerStart, marker.contentStart)) {
      return marker;
    }
  }
  return null;
}

function looksLikeDottedEnglishAbbreviation(line: string, marker: OptionMarker): boolean {
  const markerText = line.substring(marker.markerStart, marker.contentStart);
  if (!markerText.includes('.') && !markerText.includes('．')) return false;

  const next = marker.contentStart < line.length ? line.charAt(marker.contentStart) : null;
  if (next === null || !(next >= 'A' && next <= 'Z') && !(next >= 'a' && next <= 'z')) return false;
  const nextNext = marker.contentStart + 1 < line.length ? line.charAt(marker.contentStart + 1) : null;

  if (nextNext === '.' || nextNext === '．') return true;
  if (next >= 'A' && next <= 'Z' &&
    (nextNext === null || /\s/.test(nextNext) ||
      [',', '，', ';', '；', ':', '：', ')', '）', ']', '】', '}', '》', '/', '\\'].includes(nextNext))) {
    return true;
  }
  return false;
}

function missingPreviousOptionKey(key: string, options: Option[]): string | null {
  const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const index = expected.indexOf(key.toUpperCase());
  if (index <= 0) return null;
  const previous = expected[index - 1];
  return options.every((o: Option): boolean => o.key !== previous) ? previous : null;
}

function inferType(
  stem: string,
  options: Option[],
  answerText: string,
  forcedType: string | null,
  inlineBlankAnalysis: InlineBlankAnalysis
): string {
  if (forcedType !== null) return forcedType;

  if (options.length === 0) {
    if (inlineBlankAnalysis.confidence === InlineBlankConfidence.HIGH) {
      return QuestionType.BLANK;
    }
    if (isJudgeAnswerText(answerText)) {
      return QuestionType.JUDGE;
    }
    if (isObjectiveAnswerText(answerText)) {
      const tokens = parseObjectiveAnswers(answerText);
      if (tokens.every((t: string): boolean => t === 'A' || t === 'B') && shouldInferJudgeFromBinaryOptions(stem, answerText)) {
        return QuestionType.JUDGE;
      }
      return containsBlankCue(stem) ? QuestionType.BLANK : QuestionType.SHORT;
    }
    return containsBlankCue(stem) ? QuestionType.BLANK : QuestionType.SHORT;
  }

  const optionKeys = options.map((o: Option): string => o.key.toUpperCase());
  const looksLikeJudgePair = isJudgeOptionPair(
    optionKeys,
    options.map((o: Option): string => o.text)
  );
  if (looksLikeJudgePair && shouldInferJudgeFromBinaryOptions(stem, answerText)) return QuestionType.JUDGE;

  const tokens = parseObjectiveAnswers(answerText);
  return tokens.length > 1 ? QuestionType.MULTIPLE : QuestionType.SINGLE;
}

function containsBlankCue(stem: string): boolean {
  return BLANK_TEXT_KEYWORDS_REGEX.test(stem) || hasUnprotectedEmptyParentheses(stem);
}

function normalizeOptionsForType(options: Option[], type: string): Option[] {
  if (type === QuestionType.JUDGE && options.length === 0) {
    return [new Option('A', '正确'), new Option('B', '错误')];
  }
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const o of options) {
    if (!seen.has(o.key)) {
      seen.add(o.key);
      out.push(o);
    }
  }
  return out;
}

function normalizeAnswer(answerText: string, type: string): string[] {
  if (answerText.trim().length === 0) return [];
  if (type === QuestionType.SINGLE || type === QuestionType.MULTIPLE) {
    return parseObjectiveAnswers(answerText);
  }
  if (type === QuestionType.JUDGE) {
    const normalized = parseObjectiveAnswers(answerText);
    if (normalized.length > 0) return normalized;
    if (JUDGE_TRUE_ANSWER_REGEX.test(answerText.trim())) return ['A'];
    if (JUDGE_FALSE_ANSWER_REGEX.test(answerText.trim())) return ['B'];
    return [];
  }
  return parseTextAnswer(answerText);
}
