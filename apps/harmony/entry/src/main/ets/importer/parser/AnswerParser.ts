/**
 * 答案侧解析 — 1:1 移植自 Android AnswerParser.kt / AnswerTokenParser。
 * 注意：正则从 Kotlin 原始字符串逐字拷贝，转义语义与 JS 字面量一致
 * （包括上游对 \\s 的两种不同写法，忠实保留）。
 */
import { normalizeQuestionIndex } from './ParserUtils';
import { QuestionType } from '../../domain/Models';
import { parseTypeLabel, extractLeadingTypeLabel } from './QuestionTypeLabelParser';
import { normalizeChapter, hasChapter } from './ChapterScopeParser';
import { parseSectionTitle } from './SectionTitleParser';

export class ParsedAnswerEntry {
  number: string;
  answer: string[];
  analysis: string;
  type: string | null;
  category: string;
  sequence: number;
  constructor(number: string, answer: string[], type: string | null, category: string, sequence: number) {
    this.number = number;
    this.answer = answer;
    this.analysis = '';
    this.type = type;
    this.category = category;
    this.sequence = sequence;
  }
}

function g(match: RegExpExecArray | null, index: number): string {
  if (match === null) {
    return '';
  }
  return match[index] !== undefined ? match[index] : '';
}

function stripBrackets(raw: string): string {
  return raw.replace(/^[\s]*[\[\]【】()（）\s]+/, '').replace(/[\[\]【】()（）\s]+$/, '');
}

const ANSWER_LABEL = '答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答';
const ANSWER_SEPARATOR = '(?:\\s*(?:[:：,，、.．;；]|为)\\s*|\\s+|(?=\\s*[\\(（]))';
const JUDGE_TRUE_REGEX = /^(正确|对|是|√|true|t)$/i;
const JUDGE_FALSE_REGEX = /^(错误|错|否|×|x|false|f)$/i;
const LEADING_CHOICE_REGEX = /^\s*([A-Ga-g]{1,7})(?=\s*(?:[.、．:：)）;；\]\}]|[\u4e00-\u9fa5]|$))/;

// ---------- AnswerTokenParser ----------

function tokenCleanup(raw: string): string {
  return stripBrackets(raw.trim())
    .replace(new RegExp(`^\\s*(?:本题)?(?:${ANSWER_LABEL})(?:${ANSWER_SEPARATOR})?`), '')
    .replace(/^\s*(?:应选|故选)\s*/i, '')
    .replace(/^\s*选\s*(?=[A-Ga-g](?:\b|[.、．:：)）;；,，]))/, '')
    .trim()
    .replace(/^[\[\]【】()（）\s]+/, '')
    .replace(/[\[\]【】()（）\s]+$/, '')
    .trim();
}

export function isJudgeAnswerText(raw: string): boolean {
  const value = tokenCleanup(raw);
  if (value.length === 0) {
    return false;
  }
  if (JUDGE_TRUE_REGEX.test(value) || JUDGE_FALSE_REGEX.test(value)) {
    return true;
  }
  return /^[ABab]\s*[.、．:：)）]?\s*(?:正确|错误|对|错|是|否|√|×|True|False)$/i.test(value);
}

export function isObjectiveAnswerText(raw: string): boolean {
  const value = tokenCleanup(raw);
  if (value.length === 0) {
    return false;
  }
  if (isJudgeAnswerText(value)) {
    return true;
  }
  if (LEADING_CHOICE_REGEX.exec(value) !== null) {
    return true;
  }
  const compact = value.replace(/[,，、;；/\\s]+/g, '').toUpperCase();
  return /^[A-G]{1,7}$/.test(compact);
}

export function parseObjectiveAnswers(raw: string): string[] {
  const value = tokenCleanup(raw);
  if (value.length === 0) {
    return [];
  }
  if (JUDGE_TRUE_REGEX.test(value)) {
    return ['A'];
  }
  if (JUDGE_FALSE_REGEX.test(value)) {
    return ['B'];
  }

  const match = LEADING_CHOICE_REGEX.exec(value);
  if (match !== null) {
    const letters = g(match, 1).toUpperCase();
    if (/^[A-G]{1,7}$/.test(letters)) {
      return Array.from(new Set<string>(letters.split('')));
    }
  }

  const compact = value.replace(/[,，、;；/\\\s]+/g, '').toUpperCase();
  if (/^[A-G]{1,7}$/.test(compact)) {
    return Array.from(new Set<string>(compact.split('')));
  }

  const parts = value.split(/[,，、;；/\\]+/)
    .map((s: string): string => s.trim().toUpperCase())
    .filter((s: string): boolean => /^[A-G]$/.test(s));
  return Array.from(new Set<string>(parts));
}

export function parseTextAnswer(raw: string): string[] {
  const value = tokenCleanup(raw);
  return value.length === 0 ? [] : [value];
}

// ---------- AnswerParser ----------

const ANALYSIS_LABEL = '答案解析|解题思路|解析思路|解题分析|参考解析|详解|分析|理由|解答|解析|说明';
const OBJECTIVE_ANSWER_VALUE = '[\\(（]?\\s*(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|×|True|False)\\s*[\\)）]?';

const INLINE_ENTRY_REGEX = new RegExp(
  `(?:第\\s*)?(\\d{1,4})\\s*(?:题)?\\s*[.、．:：]?\\s*(?:(?:答案)${ANSWER_SEPARATOR})?(${OBJECTIVE_ANSWER_VALUE})(?=\\s*(?:\\d{1,4}\\s*[.、．:：]|$|\\[|【|解析|[;；]))`,
  'i');
const INLINE_ENTRY_REGEX_G = new RegExp(INLINE_ENTRY_REGEX.source, 'gi');
const ANSWER_ANALYSIS_LINE_REGEX = new RegExp(
  `^\\s*(?:第\\s*)?(\\d{1,4})\\s*(?:题)?\\s*[.、．:：]?\\s*(?:(?:本题)?(?:答案|正确答案|参考答案|标准答案)${ANSWER_SEPARATOR})?(${OBJECTIVE_ANSWER_VALUE})\\s*[.。]?\\s*(?:\\[?\\s*(?:${ANALYSIS_LABEL})\\s*\\]?\\s*[:：]?|【\\s*(?:${ANALYSIS_LABEL})\\s*】\\s*[:：]?)?\\s*(.*)$`,
  'i');
const RANGE_ENTRY_REGEX = /^\s*(\d{1,4})\s*[-~～至]\s*(\d{1,4})\s*[:：]\s*(.+)$/;
const BRACKET_ANSWER_LINE_REGEX = new RegExp(
  `^\\s*(?:第\\s*)?(\\d{1,4})\\s*(?:题)?\\s*[.、．:：]?\\s*(?:[【\\[]\\s*(?:答案|正确答案|参考答案|标准答案|解析)\\s*[】\\]]|(?:本题)?(?:答案|正确答案|参考答案|标准答案|解析)${ANSWER_SEPARATOR})\\s*(${OBJECTIVE_ANSWER_VALUE})\\s*[.。]?\\s*(?:[【\\[]?\\s*(?:${ANALYSIS_LABEL})\\s*[】\\]]?\\s*[:：]?)?\\s*(.*)$`,
  'i');
const SIMPLE_ANSWER_TAIL_REGEX = /^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[.、．:：]?\s*([\(（]?\s*[A-Ga-g]{1,7}\s*[\)）]?)(?=\s|$|[\u4e00-\u9fa5])\s*(.*)$/i;
const MULTIPLE_BRACKET_ENTRY_REGEX = new RegExp(
  `(?:第\\s*)?(\\d{1,4})\\s*(?:题)?\\s*[【\\[]\\s*(?:答案|正确答案|参考答案|标准答案)\\s*[】\\]]\\s*(${OBJECTIVE_ANSWER_VALUE})`,
  'i');
const MULTIPLE_BRACKET_ENTRY_REGEX_G = new RegExp(MULTIPLE_BRACKET_ENTRY_REGEX.source, 'gi');
const EXPRESSION_ANSWER_LINE_REGEX = new RegExp(
  `^\\s*(?:第\\s*)?(\\d{1,4})\\s*(?:题)?\\s*[.、．:：)）]?\\s*(?:(?:本题)?(?:答案|正确答案|参考答案|标准答案|正确选项)\\s*(?:为|是)|(?:本题)?(?:应选|故选))\\s*(${OBJECTIVE_ANSWER_VALUE})\\s*[.。,:：，、;；]?\\s*(?:[【\\[]?\\s*(?:${ANALYSIS_LABEL})\\s*[】\\]]?\\s*[:：]?)?\\s*(.*)$`,
  'i');
const LABELED_ANSWER_LINE_REGEX = new RegExp(
  `^\\s*(?:第\\s*)?(\\d{1,4})\\s*(?:题)?\\s*[.、．:：)）]?\\s*(?:(?:本题)?(?:答案|正确答案|参考答案|标准答案|正确选项)${ANSWER_SEPARATOR})\\s*(${OBJECTIVE_ANSWER_VALUE})\\s*[.。,:：，、;；]?\\s*(?:[【\\[]?\\s*(?:${ANALYSIS_LABEL})\\s*[】\\]]?\\s*[:：]?)?\\s*(.*)$`,
  'i');
const SUBJECTIVE_ANSWER_LINE_REGEX = new RegExp(
  `^\\s*(?:(?:第\\s*)?([一二三四五六七八九十百0-9]{1,4})\\s*(?:题|问)?|(?:问题|题目)\\s*([一二三四五六七八九十百0-9]{1,4}))\\s*[.、．:：]?\\s*(?:本题)?(?:${ANSWER_LABEL})${ANSWER_SEPARATOR}(.+)$`,
  'i');
const TABLE_QUESTION_NUMBER_ROW_REGEX = /^\s*(?:题号|题目|序号)\s*[:：]?\s+(.+)$/i;
const TABLE_ANSWER_ROW_REGEX = /^\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s+(.+)$/i;
const TABLE_NUMBER_TOKEN_REGEX = /(?:第\s*)?([0-9]{1,4}|[一二三四五六七八九十百]{1,4})(?:\s*题)?/g;
const COMPACT_ANSWER_PAIR_REGEX = /(\d{1,4})\s*([A-Ga-g])(?=\s*\d{1,4}|\s*$)/g;
const COMPACT_ANSWER_NOISE_REGEX = /[\s,，、;；:：.．\-—_()（）\[\]【】第章节单项选择题答案参考标准正确]+/g;

class AnswerParseContext {
  lines: string[];
  index: number;
  currentType: string | null;
  currentCategory: string;
  sequence: number;
  constructor(lines: string[], index: number, currentType: string | null, currentCategory: string, sequence: number) {
    this.lines = lines;
    this.index = index;
    this.currentType = currentType;
    this.currentCategory = currentCategory;
    this.sequence = sequence;
  }
  get line(): string {
    return this.lines[this.index];
  }
}

class AnswerEntriesResult {
  values: ParsedAnswerEntry[];
  consumedLines: number;
  constructor(values: ParsedAnswerEntry[], consumedLines: number = 1) {
    this.values = values;
    this.consumedLines = consumedLines;
  }
}

class AnswerConsumeLineResult {
  nextType: string | null;
  nextCategory: string | null;
  consumedLines: number;
  constructor(nextType: string | null, nextCategory: string | null, consumedLines: number = 1) {
    this.nextType = nextType;
    this.nextCategory = nextCategory;
    this.consumedLines = consumedLines;
  }
}

type AnswerRuleResult = AnswerEntriesResult | AnswerConsumeLineResult;

function parseCompactAnswerLine(line: string, currentType: string | null, currentCategory: string, startSequence: number): ParsedAnswerEntry[] | null {
  // compactLineContext
  COMPACT_ANSWER_PAIR_REGEX.lastIndex = 0;
  const firstPair = COMPACT_ANSWER_PAIR_REGEX.exec(line);
  if (firstPair === null) {
    return null;
  }
  const prefix = line.substring(0, firstPair.index).trim();
  const body = line.substring(firstPair.index).trim();
  const explicitChapter = hasChapter(prefix);
  const normalizedChapter = normalizeChapter(prefix);
  const category = normalizedChapter.length > 0 ? normalizedChapter : currentCategory;
  const prefixLeading = extractLeadingTypeLabel(prefix);
  const afterChapterType = prefixLeading !== null ? null :
    parseTypeLabel(prefix.replace(/^.*章/, '').trim().replace(/[:：]+$/, ''));
  const type = prefixLeading !== null ? prefixLeading.type :
    (afterChapterType !== null ? afterChapterType : currentType);

  COMPACT_ANSWER_PAIR_REGEX.lastIndex = 0;
  const matches = Array.from(line === null ? [] : body.matchAll(COMPACT_ANSWER_PAIR_REGEX));
  const minPairs = (explicitChapter || category.length > 0) ? 1 : 5;
  if (matches.length < minPairs) {
    return null;
  }
  const noise = body.replace(new RegExp(COMPACT_ANSWER_PAIR_REGEX.source, 'g'), '');
  const remainingNoise = noise.replace(new RegExp(COMPACT_ANSWER_NOISE_REGEX.source, 'g'), '');
  if (remainingNoise.trim().length > 0) {
    return null;
  }

  const entries: ParsedAnswerEntry[] = [];
  for (let offset = 0; offset < matches.length; offset++) {
    const match = matches[offset] as RegExpMatchArray;
    const number = normalizeQuestionIndex(g(match as unknown as RegExpExecArray, 1));
    const answer = parseObjectiveAnswers(g(match as unknown as RegExpExecArray, 2));
    if (number.length > 0 && answer.length > 0) {
      entries.push(new ParsedAnswerEntry(number, answer, type, category, startSequence + offset));
    }
  }
  return entries.length >= minPairs ? entries : null;
}

function parseAnswerTableAt(ctx: AnswerParseContext): ParsedAnswerEntry[] | null {
  if (ctx.index + 1 >= ctx.lines.length) {
    return null;
  }
  const numberRow = TABLE_QUESTION_NUMBER_ROW_REGEX.exec(ctx.lines[ctx.index]);
  if (numberRow === null) {
    return null;
  }
  const answerRow = TABLE_ANSWER_ROW_REGEX.exec(ctx.lines[ctx.index + 1]);
  if (answerRow === null) {
    return null;
  }
  TABLE_NUMBER_TOKEN_REGEX.lastIndex = 0;
  const numbers: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = TABLE_NUMBER_TOKEN_REGEX.exec(g(numberRow, 1))) !== null) {
    const normalized = normalizeQuestionIndex(g(m, 1));
    if (normalized.length > 0) {
      numbers.push(normalized);
    }
  }
  if (numbers.length === 0) {
    return null;
  }
  const answers: string[][] = [];
  for (const token of g(answerRow, 1).split(/\s+/)) {
    const parsed = parseObjectiveAnswers(token);
    if (parsed.length > 0) {
      answers.push(parsed);
    }
  }
  if (answers.length !== numbers.length) {
    return null;
  }
  const entries: ParsedAnswerEntry[] = [];
  for (let offset = 0; offset < numbers.length; offset++) {
    entries.push(new ParsedAnswerEntry(numbers[offset], answers[offset], ctx.currentType, ctx.currentCategory, ctx.sequence + offset));
  }
  return entries;
}

function singleEntryFromLine(match: RegExpExecArray | null, ctx: AnswerParseContext, answerGroup: number, analysisGroup: number): AnswerRuleResult | null {
  if (match === null) {
    return null;
  }
  const answer = parseObjectiveAnswers(g(match, answerGroup));
  if (answer.length === 0) {
    return null;
  }
  const entry = new ParsedAnswerEntry(g(match, 1), answer, ctx.currentType, ctx.currentCategory, ctx.sequence);
  entry.analysis = g(match, analysisGroup).trim();
  return new AnswerEntriesResult([entry]);
}

function parseInlineEntries(ctx: AnswerParseContext): ParsedAnswerEntry[] {
  INLINE_ENTRY_REGEX_G.lastIndex = 0;
  const entries: ParsedAnswerEntry[] = [];
  let offset = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_ENTRY_REGEX_G.exec(ctx.line)) !== null) {
    const answer = parseObjectiveAnswers(g(m, 2));
    if (answer.length > 0) {
      entries.push(new ParsedAnswerEntry(g(m, 1), answer, ctx.currentType, ctx.currentCategory, ctx.sequence + offset));
      offset++;
    }
  }
  return entries;
}

const ANSWER_PARSE_RULES: { name: string, parse: (ctx: AnswerParseContext) => AnswerRuleResult | null }[] = [
  {
    name: 'table_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const entries = parseAnswerTableAt(ctx);
      return entries === null ? null : new AnswerEntriesResult(entries, 2);
    }
  },
  {
    name: 'compact_answer_line',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const entries = parseCompactAnswerLine(ctx.line, ctx.currentType, ctx.currentCategory, ctx.sequence);
      return entries === null ? null : new AnswerEntriesResult(entries);
    }
  },
  {
    name: 'labeled_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null =>
      singleEntryFromLine(LABELED_ANSWER_LINE_REGEX.exec(ctx.line), ctx, 2, 3)
  },
  {
    name: 'expression_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null =>
      singleEntryFromLine(EXPRESSION_ANSWER_LINE_REGEX.exec(ctx.line), ctx, 2, 3)
  },
  {
    name: 'subjective_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const match = SUBJECTIVE_ANSWER_LINE_REGEX.exec(ctx.line);
      if (match === null) {
        return null;
      }
      const first = g(match, 1);
      const number = normalizeQuestionIndex(first.length > 0 ? first : g(match, 2));
      const answerText = g(match, 3).trim();
      if (number.length === 0 || answerText.length === 0) {
        return null;
      }
      const objectiveAnswer = parseObjectiveAnswers(answerText);
      const entry = objectiveAnswer.length > 0
        ? new ParsedAnswerEntry(number, objectiveAnswer, ctx.currentType, ctx.currentCategory, ctx.sequence)
        : new ParsedAnswerEntry(number, [answerText], ctx.currentType !== null ? ctx.currentType : QuestionType.SHORT, ctx.currentCategory, ctx.sequence);
      return new AnswerEntriesResult([entry]);
    }
  },
  {
    name: 'section_heading',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const chapter = normalizeChapter(ctx.line);
      if (chapter.length > 0) {
        const afterChapter = ctx.line.replace(/^.*?章/, '').trim().replace(/[:：]+$/, '');
        const type = parseTypeLabel(afterChapter);
        return new AnswerConsumeLineResult(type !== null ? type : ctx.currentType, chapter);
      }
      const section = parseSectionTitle(ctx.line);
      if (section === null) {
        return null;
      }
      const nextType = section.isAnswerSection ? ctx.currentType : section.forcedType;
      const nextCategory = (!section.isAnswerSection && section.forcedType === null) ? section.title : null;
      return new AnswerConsumeLineResult(nextType, nextCategory);
    }
  },
  {
    name: 'range_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const match = RANGE_ENTRY_REGEX.exec(ctx.line);
      if (match === null) {
        return null;
      }
      const start = parseInt(g(match, 1), 10);
      const end = parseInt(g(match, 2), 10);
      const tokens: string[][] = [];
      for (const token of g(match, 3).split(/\s+/)) {
        const parsed = parseObjectiveAnswers(token);
        if (parsed.length > 0) {
          tokens.push(parsed);
        }
      }
      if (tokens.length === 0 || end < start) {
        return null;
      }
      const entries: ParsedAnswerEntry[] = [];
      for (let offset = 0; offset <= end - start; offset++) {
        if (offset >= tokens.length) {
          break;
        }
        entries.push(new ParsedAnswerEntry(String(start + offset), tokens[offset], ctx.currentType, ctx.currentCategory, ctx.sequence + offset));
      }
      return entries.length === 0 ? null : new AnswerEntriesResult(entries);
    }
  },
  {
    name: 'multiple_bracket_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      MULTIPLE_BRACKET_ENTRY_REGEX_G.lastIndex = 0;
      const entries: ParsedAnswerEntry[] = [];
      let offset = 0;
      let m: RegExpExecArray | null;
      while ((m = MULTIPLE_BRACKET_ENTRY_REGEX_G.exec(ctx.line)) !== null) {
        const answer = parseObjectiveAnswers(g(m, 2));
        if (answer.length > 0) {
          entries.push(new ParsedAnswerEntry(g(m, 1), answer, ctx.currentType, ctx.currentCategory, ctx.sequence + offset));
          offset++;
        }
      }
      return entries.length < 2 ? null : new AnswerEntriesResult(entries);
    }
  },
  {
    name: 'bracket_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null =>
      singleEntryFromLine(BRACKET_ANSWER_LINE_REGEX.exec(ctx.line), ctx, 2, 3)
  },
  {
    name: 'inline_multi_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const entries = parseInlineEntries(ctx);
      return entries.length < 2 ? null : new AnswerEntriesResult(entries);
    }
  },
  {
    name: 'answer_analysis',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null =>
      singleEntryFromLine(ANSWER_ANALYSIS_LINE_REGEX.exec(ctx.line), ctx, 2, 3)
  },
  {
    name: 'inline_single_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const entries = parseInlineEntries(ctx);
      return entries.length === 0 ? null : new AnswerEntriesResult(entries);
    }
  },
  {
    name: 'simple_tail_answer',
    parse: (ctx: AnswerParseContext): AnswerRuleResult | null => {
      const match = SIMPLE_ANSWER_TAIL_REGEX.exec(ctx.line);
      if (match === null) {
        return null;
      }
      const answer = parseObjectiveAnswers(g(match, 2));
      const tail = g(match, 3).trim();
      if (answer.length === 0 || tail.length < 2) {
        return null;
      }
      const entry = new ParsedAnswerEntry(g(match, 1), answer, ctx.currentType, ctx.currentCategory, ctx.sequence);
      entry.analysis = tail;
      return new AnswerEntriesResult([entry]);
    }
  }
];

export function answerRuleNamesForTest(): string[] {
  return ANSWER_PARSE_RULES.map((rule: { name: string }): string => rule.name);
}

export function parseAnswers(text: string): ParsedAnswerEntry[] {
  const entries: ParsedAnswerEntry[] = [];
  let currentType: string | null = null;
  let currentCategory = '';
  let sequence = 0;

  const lines = text.split('\n').map((line: string): string => line.trim()).filter((line: string): boolean => line.length > 0);
  let index = 0;
  while (index < lines.length) {
    const ctx = new AnswerParseContext(lines, index, currentType, currentCategory, sequence);
    let result: AnswerRuleResult | null = null;
    for (const rule of ANSWER_PARSE_RULES) {
      result = rule.parse(ctx);
      if (result !== null) {
        break;
      }
    }

    if (result instanceof AnswerEntriesResult) {
      entries.push(...result.values);
      for (let i = result.values.length - 1; i >= 0; i--) {
        if (result.values[i].category.length > 0) {
          currentCategory = result.values[i].category;
          currentType = result.values[i].type !== null ? result.values[i].type : currentType;
          break;
        }
      }
      sequence += result.values.length;
      index += result.consumedLines;
    } else if (result instanceof AnswerConsumeLineResult) {
      currentType = result.nextType;
      if (result.nextCategory !== null) {
        currentCategory = result.nextCategory;
      }
      index += result.consumedLines;
    } else {
      index += 1;
    }
  }

  return entries;
}
