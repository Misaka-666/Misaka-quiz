/**
 * 表格题库解析 — 1:1 移植自 Android ExcelQuestionTableParser.kt。
 * 输入为 TextImportDecoder 转出的分隔符纯文本（XLSX/CSV）。
 */
import { Question, QuestionType, Option } from '../../domain/Models';
import { isJudgeOptionPair, shouldInferJudgeFromBinaryOptions } from './ParserUtils';
import { parseTypeLabel } from './QuestionTypeLabelParser';
import { parseObjectiveAnswers, isJudgeAnswerText, parseTextAnswer } from './AnswerParser';
import { extractMultiBlank } from './MultiBlankQuestionParser';

const MAX_HEADER_SCAN_ROWS = 12;
const COMBINED_OPTION_MARKER_REGEX = /(?:^|[\n;；\s])([A-Ga-g])\s*[.、．:：)）]\s*/g;
const JUDGE_TRUE_ANSWER_REGEX = /^(对|正确|是|√|true|t)$/i;
const JUDGE_FALSE_ANSWER_REGEX = /^(错|错误|否|×|x|false|f)$/i;
const OPTION_COLUMN_KEY_A_REGEX = /^(?:选项)?([a-g])(?:选项|项)?$/;
const OPTION_COLUMN_KEY_B_REGEX = /^(?:option|choice)([a-g])$/;
const HEADER_NOISE_REGEX = /[\s_\-—－:：.．()（）\[\]【】]/g;

const NUMBER_HEADERS = ['序号', '题号', '编号', 'no', 'number', 'id', 'index'];
const TYPE_HEADERS = ['题型', '类型', '题目类型', '试题类型', 'questiontype', 'type'];
const STEM_HEADERS = ['题干', '题目', '问题', '试题', '试题内容', '题目内容', '内容', 'question', 'stem', 'title'];
const COMBINED_OPTION_HEADERS = ['选项', '选项内容', '备选项', '候选项', 'choices', 'options', 'choice', 'option'];
const ANSWER_HEADERS = ['答案', '正确答案', '标准答案', '参考答案', '正确选项', 'answer', 'answers', 'correctanswer'];
const ANALYSIS_HEADERS = ['解析', '答案解析', '试题解析', '说明', '解释', 'analysis', 'explanation', 'reason'];
const CATEGORY_HEADERS = ['分类', '章节', '知识点', '标签', '科目', '目录', 'category', 'tag', 'chapter', 'subject'];
const SCORE_HEADERS = ['分值', '分数', '得分', 'score', 'point', 'points'];
const BLANK_HINTS = ['填空', '填入', '补全', '空白处', '____', '()', '（）'];

class HeaderMapping {
  headerIndex: number;
  numberColumn: number | null;
  typeColumn: number | null;
  stemColumn: number;
  optionColumns: Map<string, number>;
  combinedOptionsColumn: number | null;
  answerColumn: number | null;
  analysisColumn: number | null;
  categoryColumn: number | null;
  scoreColumn: number | null;
  constructor(
    headerIndex: number,
    numberColumn: number | null,
    typeColumn: number | null,
    stemColumn: number,
    optionColumns: Map<string, number>,
    combinedOptionsColumn: number | null,
    answerColumn: number | null,
    analysisColumn: number | null,
    categoryColumn: number | null,
    scoreColumn: number | null
  ) {
    this.headerIndex = headerIndex;
    this.numberColumn = numberColumn;
    this.typeColumn = typeColumn;
    this.stemColumn = stemColumn;
    this.optionColumns = optionColumns;
    this.combinedOptionsColumn = combinedOptionsColumn;
    this.answerColumn = answerColumn;
    this.analysisColumn = analysisColumn;
    this.categoryColumn = categoryColumn;
    this.scoreColumn = scoreColumn;
  }
}

let nextExcelQuestionId = 0;

function cell(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index] : '';
}

function toDoubleOrNull(raw: string): number | null {
  const clean = raw.trim();
  if (!/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(clean)) return null;
  return parseFloat(clean);
}

export function parseExcelTable(text: string): Question[] {
  const rows = parseDelimitedRows(text)
    .map((row: string[]): string[] => row.map((c: string): string => cleanupCell(c)))
    .filter((row: string[]): boolean => row.some((c: string): boolean => c.trim().length > 0));
  if (rows.length < 2) return [];

  const questions: Question[] = [];
  let searchStart = 0;
  let fallbackNumber = 1;

  while (searchStart < rows.length) {
    const localMapping = findHeaderMapping(rows.slice(searchStart));
    if (localMapping === null) break;
    const mapping = new HeaderMapping(
      localMapping.headerIndex + searchStart,
      localMapping.numberColumn,
      localMapping.typeColumn,
      localMapping.stemColumn,
      localMapping.optionColumns,
      localMapping.combinedOptionsColumn,
      localMapping.answerColumn,
      localMapping.analysisColumn,
      localMapping.categoryColumn,
      localMapping.scoreColumn
    );
    let rowIndex = mapping.headerIndex + 1;
    while (rowIndex < rows.length) {
      const nextMapping = buildHeaderMapping(rows[rowIndex], rowIndex);
      if (nextMapping !== null) break;
      const row = rows[rowIndex];
      if (!isIgnorableRow(row)) {
        const question = parseQuestionRow(row, mapping, fallbackNumber);
        if (question !== null) {
          questions.push(question);
          fallbackNumber += 1;
        }
      }
      rowIndex += 1;
    }
    searchStart = Math.max(rowIndex, mapping.headerIndex + 1);
  }

  return questions;
}

function parseQuestionRow(row: string[], mapping: HeaderMapping, fallbackNumber: number): Question | null {
  const stem = cell(row, mapping.stemColumn).trim();
  if (stem.length === 0 || isRepeatedHeaderRow(row, mapping)) return null;

  const rawType = mapping.typeColumn !== null ? cell(row, mapping.typeColumn) : '';
  const explicitType = parseQuestionType(rawType);
  const numberCell = mapping.numberColumn !== null ? cell(row, mapping.numberColumn).trim() : '';
  const number = numberCell.length > 0 ? numberCell : fallbackNumber.toString();
  const category = mapping.categoryColumn !== null ? cell(row, mapping.categoryColumn).trim() : '';
  const analysis = mapping.analysisColumn !== null ? cell(row, mapping.analysisColumn).trim() : '';
  const rawAnswer = mapping.answerColumn !== null ? cell(row, mapping.answerColumn).trim() : '';
  const score = mapping.scoreColumn !== null ? toDoubleOrNull(cell(row, mapping.scoreColumn)) : null;

  const optionMap = new Map<string, string>();
  const sortedKeys = Array.from(mapping.optionColumns.keys()).sort();
  for (const key of sortedKeys) {
    const index = mapping.optionColumns.get(key);
    if (index === undefined) continue;
    const text = cleanupOptionText(cell(row, index), key);
    if (text.length > 0) optionMap.set(key, text);
  }
  if (mapping.combinedOptionsColumn !== null) {
    for (const option of parseCombinedOptions(cell(row, mapping.combinedOptionsColumn))) {
      if (!optionMap.has(option.key)) {
        optionMap.set(option.key, option.text);
      }
    }
  }
  const options: Option[] = [];
  optionMap.forEach((value: string, key: string): void => {
    options.push(new Option(key, value));
  });
  const type = inferQuestionType(explicitType, stem, options, rawAnswer);
  const normalizedOptions = normalizeOptionsForType(options, type);
  const answer = normalizeAnswer(rawAnswer, type);
  const multiBlank = extractMultiBlank(stem, type, normalizedOptions, rawAnswer, answer);

  nextExcelQuestionId += 1;
  const question = new Question(`xq-${nextExcelQuestionId}`, type, multiBlank.questionText);
  question.number = cleanupNumber(number);
  question.options = normalizedOptions;
  question.answer = multiBlank.answer;
  question.blankAnswers = multiBlank.blankAnswers;
  question.analysis = analysis;
  question.category = category;
  question.score = score;
  question.warnings = multiBlank.warnings;
  return question;
}

function findHeaderMapping(rows: string[][]): HeaderMapping | null {
  const scanCount = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let index = 0; index < scanCount; index++) {
    const mapping = buildHeaderMapping(rows[index], index);
    if (mapping !== null) return mapping;
  }
  return null;
}

function buildHeaderMapping(header: string[], headerIndex: number): HeaderMapping | null {
  let numberColumn: number | null = null;
  let typeColumn: number | null = null;
  let stemColumn: number | null = null;
  let combinedOptionsColumn: number | null = null;
  let answerColumn: number | null = null;
  let analysisColumn: number | null = null;
  let categoryColumn: number | null = null;
  let scoreColumn: number | null = null;
  const optionColumns = new Map<string, number>();

  for (let index = 0; index < header.length; index++) {
    const normalized = normalizeHeader(header[index]);
    if (normalized.length === 0) continue;

    const optionKey = optionColumnKey(normalized);
    if (optionKey !== null) {
      optionColumns.set(optionKey, index);
    } else if (numberColumn === null && NUMBER_HEADERS.includes(normalized)) {
      numberColumn = index;
    } else if (typeColumn === null && TYPE_HEADERS.includes(normalized)) {
      typeColumn = index;
    } else if (stemColumn === null && STEM_HEADERS.includes(normalized)) {
      stemColumn = index;
    } else if (combinedOptionsColumn === null && COMBINED_OPTION_HEADERS.includes(normalized)) {
      combinedOptionsColumn = index;
    } else if (answerColumn === null && ANSWER_HEADERS.includes(normalized)) {
      answerColumn = index;
    } else if (analysisColumn === null && ANALYSIS_HEADERS.includes(normalized)) {
      analysisColumn = index;
    } else if (categoryColumn === null && CATEGORY_HEADERS.includes(normalized)) {
      categoryColumn = index;
    } else if (scoreColumn === null && SCORE_HEADERS.includes(normalized)) {
      scoreColumn = index;
    }
  }

  if (stemColumn === null) return null;
  const hasAnswer = answerColumn !== null;
  const hasOptions = optionColumns.size > 0 || combinedOptionsColumn !== null;
  const hasTypeOrAnalysis = typeColumn !== null || analysisColumn !== null;
  if (!hasAnswer && !hasOptions && !hasTypeOrAnalysis) return null;

  return new HeaderMapping(
    headerIndex,
    numberColumn,
    typeColumn,
    stemColumn,
    optionColumns,
    combinedOptionsColumn,
    answerColumn,
    analysisColumn,
    categoryColumn,
    scoreColumn
  );
}

function parseDelimitedRows(text: string): string[][] {
  return text.split('\n')
    .map((line: string): string => line.replace(/\s+$/, ''))
    .filter((line: string): boolean => line.trim().length > 0)
    .map((line: string): string[] => {
      if (line.includes('\t')) return splitTabLine(line);
      if (looksLikeCsvLine(line)) return parseCsvLine(line);
      return line.split(/\s{2,}/);
    });
}

function splitTabLine(line: string): string[] {
  return line.split('\t');
}

function looksLikeCsvLine(line: string): boolean {
  if (!line.includes(',')) return false;
  let commaCount = 0;
  let chineseCommaCount = 0;
  for (const ch of line) {
    if (ch === ',') commaCount += 1;
    if (ch === '，') chineseCommaCount += 1;
  }
  return commaCount >= chineseCommaCount && commaCount >= 2;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  let index = 0;
  while (index < line.length) {
    const ch = line.charAt(index);
    if (ch === '"' && inQuotes && line.charAt(index + 1) === '"') {
      current += '"';
      index += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
    index += 1;
  }
  cells.push(current);
  return cells;
}

function cleanupCell(raw: string): string {
  let value = raw.trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    value = value.substring(1, value.length - 1);
  }
  return value.split('\\n').join('\n')
    .split('_x000D_').join('\n')
    .trim();
}

function cleanupOptionText(raw: string, key: string): string {
  return raw.trim()
    .replace(new RegExp(`^${key}\\s*[.、．:：)）]\\s*`, 'i'), '')
    .trim();
}

function parseCombinedOptions(raw: string): Option[] {
  const text = raw.trim();
  if (text.length === 0) return [];
  const matches: RegExpExecArray[] = [];
  COMBINED_OPTION_MARKER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMBINED_OPTION_MARKER_REGEX.exec(text)) !== null) {
    matches.push(m);
  }
  if (matches.length === 0) return [];

  const out: Option[] = [];
  const seenKeys = new Set<string>();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const key = (match[1] ?? '').toUpperCase();
    const start = match.index + match[0].length;
    const nextMatch = index + 1 < matches.length ? matches[index + 1] : null;
    const end = nextMatch !== null ? nextMatch.index : text.length;
    const value = text.substring(start, end)
      .trim()
      .replace(/^[;；]+/, '')
      .replace(/[;；]+$/, '')
      .trim();
    if (value.length > 0 && !seenKeys.has(key)) {
      seenKeys.add(key);
      out.push(new Option(key, value));
    }
  }
  return out;
}

function parseQuestionType(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  const label = parseTypeLabel(text);
  if (label !== null) return label;
  const normalized = normalizeHeader(text);
  if (['single', 'singlechoice', 'danxuan', '单选', '单项选择'].includes(normalized)) return QuestionType.SINGLE;
  if (['multiple', 'multiplechoice', 'duoxuan', '多选', '多项选择', '不定项'].includes(normalized)) return QuestionType.MULTIPLE;
  if (['judge', 'truefalse', 'tf', '判断', '是非', '对错'].includes(normalized)) return QuestionType.JUDGE;
  if (['blank', 'fillblank', '填空'].includes(normalized)) return QuestionType.BLANK;
  if (['short', 'essay', 'qa', '简答', '问答', '论述'].includes(normalized)) return QuestionType.SHORT;
  return null;
}

function inferQuestionType(
  explicitType: string | null,
  stem: string,
  options: Option[],
  answerText: string
): string {
  if (explicitType !== null) return explicitType;
  const normalizedAnswer = answerText.trim();
  const optionKeys = options.map((o: Option): string => o.key.toUpperCase());
  const looksLikeJudgePair = isJudgeOptionPair(optionKeys, options.map((o: Option): string => o.text));
  if (looksLikeJudgePair && shouldInferJudgeFromBinaryOptions(stem, normalizedAnswer)) return QuestionType.JUDGE;
  if (options.length === 0 && isJudgeAnswerText(normalizedAnswer)) return QuestionType.JUDGE;
  if (options.length > 0) {
    const answers = parseObjectiveAnswers(normalizedAnswer);
    return answers.length > 1 ? QuestionType.MULTIPLE : QuestionType.SINGLE;
  }
  if (BLANK_HINTS.some((h: string): boolean => stem.includes(h))) return QuestionType.BLANK;
  return QuestionType.SHORT;
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

function normalizeAnswer(raw: string, type: string): string[] {
  if (raw.trim().length === 0) return [];
  if (type === QuestionType.SINGLE || type === QuestionType.MULTIPLE) {
    return parseObjectiveAnswers(raw);
  }
  if (type === QuestionType.JUDGE) {
    const parsed = parseObjectiveAnswers(raw);
    if (parsed.length > 0) return parsed;
    if (JUDGE_TRUE_ANSWER_REGEX.test(raw.trim())) return ['A'];
    if (JUDGE_FALSE_ANSWER_REGEX.test(raw.trim())) return ['B'];
    return [];
  }
  return parseTextAnswer(raw);
}

function isRepeatedHeaderRow(row: string[], mapping: HeaderMapping): boolean {
  const stemHeader = STEM_HEADERS.includes(normalizeHeader(cell(row, mapping.stemColumn)));
  if (!stemHeader) return false;
  const answerHeader = mapping.answerColumn !== null &&
    ANSWER_HEADERS.includes(normalizeHeader(cell(row, mapping.answerColumn)));
  let optionHeader = false;
  mapping.optionColumns.forEach((index: number, key: string): void => {
    if (optionColumnKey(normalizeHeader(cell(row, index))) === key) {
      optionHeader = true;
    }
  });
  const combinedHeader = mapping.combinedOptionsColumn !== null &&
    COMBINED_OPTION_HEADERS.includes(normalizeHeader(cell(row, mapping.combinedOptionsColumn)));
  return answerHeader || optionHeader || combinedHeader;
}

function isIgnorableRow(row: string[]): boolean {
  const compact = row.join('').trim();
  if (compact.length === 0) return true;
  return ['合计', '总计', '备注'].includes(compact);
}

function cleanupNumber(raw: string): string {
  let value = raw.trim();
  if (value.endsWith('.0')) {
    value = value.substring(0, value.length - 2);
  }
  return value;
}

function normalizeHeader(raw: string): string {
  let value = raw.trim().toLowerCase().replace(HEADER_NOISE_REGEX, '');
  value = value.split('ａ').join('a')
    .split('ｂ').join('b')
    .split('ｃ').join('c')
    .split('ｄ').join('d')
    .split('ｅ').join('e')
    .split('ｆ').join('f')
    .split('ｇ').join('g');
  return value;
}

function optionColumnKey(normalizedHeader: string): string | null {
  if (normalizedHeader.length > 8) return null;
  const direct = OPTION_COLUMN_KEY_A_REGEX.exec(normalizedHeader) ??
    OPTION_COLUMN_KEY_B_REGEX.exec(normalizedHeader);
  if (direct === null || direct[1] === undefined) return null;
  return direct[1].toUpperCase();
}
