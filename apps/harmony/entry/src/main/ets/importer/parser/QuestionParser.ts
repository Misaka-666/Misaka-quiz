/**
 * 混合策略题解析 — 1:1 移植自 Android QuestionParser.kt。
 * 标准解析为主路径；单题块出现明确紧凑信号且修复结果更完整时才替换。
 */
import { Question, QuestionType, Option } from '../../domain/Models';
import { splitQuestionBlocks, QuestionBlock } from './QuestionBlockSplitter';
import { parseStandardText, parseStandardBlock } from './StandardQuestionParser';
import { hasCompactPattern, compactOptionKeys, repair } from './CompactQuestionRepair';
import { parseSectionTitle } from './SectionTitleParser';
import { arraysEqual } from '../model/MultiBlankSupport';

const INLINE_METADATA_LABEL_REGEX = /(?:答案|正确答案|参考答案|标准答案|解析|答案解析|说明)\s*[:：]/;
const CHOICE_INTENT_REGEX = /(?:下列|以下).{0,24}(?:哪|正确|错误|不正确|符合)|选择|选出|最(?:合适|符合|恰当)|应(?:选择|选)/;
const SUBJECTIVE_LEAD_REGEX = /^(?:请|试)?(?:分别)?(?:说明|简述|阐述|论述|比较|解释|概述|谈谈|回答|分析)/;
const SUBJECTIVE_PURPOSE_REGEX = /(?:差异|区别|联系|原因|影响|措施|方法|原则|条件|优缺点|意义|作用|过程|依据|适用|如何|为什么|各自|分别)/;
const COMPARISON_QUESTION_REGEX = /(?:有何|有什么).*(?:区别|差异|联系)/;
const OBJECTIVE_ANSWER_STRICT_REGEX = /^[A-Ga-g\s,，、;；/\\]+$/;
const ANSWER_SEPARATOR_COLLAPSE_REGEX = /[\s,，、;；/\\]+/g;
const COMPACT_LETTERS_ONLY_REGEX = /^[A-G]+$/;

class Pair {
  first: string;
  second: string;
  constructor(first: string, second: string) {
    this.first = first;
    this.second = second;
  }
}

class SectionChunk {
  title: string;
  forcedType: string | null;
  body: string;
  constructor(title: string, forcedType: string | null, body: string) {
    this.title = title;
    this.forcedType = forcedType;
    this.body = body;
  }
}

export function parseStandard(text: string): Question[] {
  return parseStandardText(text);
}

export function parseStandardFirst(
  text: string,
  forcedType: string | null = null,
  category: string = '',
  allowUnnumbered: boolean = true
): Question[] {
  const blocks = splitQuestionBlocks(text, forcedType, category, allowUnnumbered);
  const out: Question[] = [];
  for (const block of blocks) {
    const q = parseBlockStandardFirst(block);
    if (q !== null) out.push(q);
  }
  return out;
}

export function parseCompact(text: string): Question[] {
  const preprocessed = repair(text);
  return parseStandardText(preprocessed);
}

export function looksCompact(text: string): boolean {
  return hasCompactPattern(text);
}

export function parseSectioned(text: string): Question[] {
  const sections = splitBySections(text);
  if (sections.length === 0) return parseStandardFirst(text);

  const out: Question[] = [];
  for (const section of sections) {
    for (const q of parseStandardFirst(section.body, section.forcedType, section.title)) {
      out.push(q);
    }
  }
  return out;
}

export function looksSectioned(text: string): boolean {
  return text.split('\n').some((line: string): boolean => {
    const section = parseSectionTitle(line.trim());
    return section !== null && !section.isAnswerSection;
  });
}

function parseBlockStandardFirst(block: QuestionBlock): Question | null {
  const standard = parseStandardBlock(block);
  const rawBlock = block.lines.join('\n');
  const expectedOptionKeys = compactOptionKeys(rawBlock);
  if (!hasCompactPattern(rawBlock)) return standard;

  // 明确的主观题中，A./B./C. 很可能只是分项说明，不能按紧凑选择题拆分。
  if (expectedOptionKeys.length > 0 &&
    (block.forcedType === QuestionType.SHORT || block.forcedType === QuestionType.BLANK)) {
    return standard;
  }
  if (expectedOptionKeys.length > 0 && looksLikeSubjectiveEnumeration(standard)) return standard;
  if (expectedOptionKeys.length === 1) return standard;
  if (expectedOptionKeys.length >= 2 && isCompleteStandardQuestion(standard, expectedOptionKeys)) return standard;

  const repaired = repair(rawBlock);
  if (repaired === rawBlock) return standard;

  const repairedLines = repaired.split('\n')
    .map((l: string): string => l.trim())
    .filter((l: string): boolean => l.length > 0);
  if (repairedLines.length === 0) return standard;

  const fallback = parseStandardBlock(
    new QuestionBlock(block.number, repairedLines, block.category, block.forcedType, block.sequence));

  if (expectedOptionKeys.length === 0) {
    return inlineMetadataFallbackCanReplace(standard, fallback) ? fallback : standard;
  }

  return localFallbackCanReplace(block, standard, fallback, expectedOptionKeys) ? fallback : standard;
}

function inlineMetadataFallbackCanReplace(standard: Question | null, fallback: Question | null): boolean {
  if (fallback === null) return false;
  if (fallback.question.trim().length === 0) return false;
  if (standard === null) return fallback.answer.length > 0 || fallback.analysis.trim().length > 0;

  if (standard.answer.length > 0 && !arraysEqual(standard.answer, fallback.answer)) return false;
  if (standard.analysis.trim().length > 0 && standard.analysis !== fallback.analysis) return false;

  const standardOptions = standard.options.map((o: Option): Pair => new Pair(o.key, o.text));
  const fallbackOptions = fallback.options.map((o: Option): Pair => new Pair(o.key, o.text));
  const judgeUpgrade = standard.type === QuestionType.SHORT &&
    fallback.type === QuestionType.JUDGE &&
    standard.options.length === 0 &&
    fallback.answer.length > 0;
  if (!judgeUpgrade) {
    if (standard.type !== fallback.type) return false;
    if (!inlineMetadataOptionsPreserved(standardOptions, fallbackOptions)) return false;
  }

  const questionPreserved = fallback.question === standard.question ||
    standard.question.startsWith(fallback.question) ||
    standard.question.includes(fallback.question);
  if (!questionPreserved) return false;

  const answerImproved = standard.answer.length === 0 && fallback.answer.length > 0;
  const analysisImproved = standard.analysis.trim().length === 0 && fallback.analysis.trim().length > 0;
  return answerImproved || analysisImproved;
}

function inlineMetadataOptionsPreserved(standardOptions: Pair[], fallbackOptions: Pair[]): boolean {
  if (standardOptions.length !== fallbackOptions.length) return false;
  for (let i = 0; i < standardOptions.length; i++) {
    const standardOption = standardOptions[i];
    const fallbackOption = fallbackOptions[i];
    if (standardOption.first !== fallbackOption.first) return false;
    if (standardOption.second === fallbackOption.second) continue;

    const standardText = standardOption.second.trim();
    const fallbackText = fallbackOption.second.trim();
    if (!(standardText.startsWith(fallbackText) &&
      INLINE_METADATA_LABEL_REGEX.test(standardText.substring(fallbackText.length)))) {
      return false;
    }
  }
  return true;
}

function isCompleteStandardQuestion(question: Question | null, expectedOptionKeys: string[]): boolean {
  if (question === null) return false;
  if (question.question.trim().length === 0) return false;

  const isObjective = question.type === QuestionType.SINGLE ||
    question.type === QuestionType.MULTIPLE ||
    question.type === QuestionType.JUDGE;
  if (!isObjective || question.options.length < 2) return false;

  const optionKeys = distinct(question.options.map((o: Option): string => o.key.toUpperCase()));
  if (!expectedOptionKeys.every((k: string): boolean => optionKeys.includes(k))) return false;
  return question.answer.length === 0 ||
    question.answer.every((a: string): boolean => optionKeys.includes(a.toUpperCase()));
}

function localFallbackCanReplace(
  block: QuestionBlock,
  standard: Question | null,
  fallback: Question | null,
  expectedOptionKeys: string[]
): boolean {
  if (fallback === null) return false;
  if (fallback.question.trim().length === 0) return false;
  if (block.forcedType === QuestionType.SHORT || block.forcedType === QuestionType.BLANK) return false;

  const fallbackIsObjective = fallback.type === QuestionType.SINGLE ||
    fallback.type === QuestionType.MULTIPLE ||
    fallback.type === QuestionType.JUDGE;
  if (!fallbackIsObjective || fallback.options.length < 2) return false;

  const fallbackOptionKeys = distinct(fallback.options.map((o: Option): string => o.key.toUpperCase()));
  if (!expectedOptionKeys.every((k: string): boolean => fallbackOptionKeys.includes(k))) return false;
  if (fallback.answer.some((a: string): boolean => !fallbackOptionKeys.includes(a.toUpperCase()))) return false;

  // “AB / A,B / A B”属于合法的紧凑客观答案，不能因为标准结果暂时是 SHORT
  // 就被当成文本答案拦截；只有无法严格归一化为现有选项键的内容才视为主观答案。
  const standardAnswerRaw = standard !== null ? standard.answer : [];
  const standardAnswer = normalizeLocalObjectiveAnswer(standardAnswerRaw, expectedOptionKeys);
  const fallbackAnswer = normalizeLocalObjectiveAnswer(fallback.answer, expectedOptionKeys);
  const standardHasTextAnswer = standardAnswerRaw.length > 0 && standardAnswer === null;
  if (standardHasTextAnswer) {
    if (!arraysEqual(fallback.answer, standardAnswerRaw)) return false;
    if (fallback.type !== (standard !== null ? standard.type : null)) return false;
  } else if (standardAnswer !== null && standardAnswer.length > 0) {
    if (fallbackAnswer === null || !arraysEqual(fallbackAnswer, standardAnswer)) return false;
  }

  return questionStructureScore(fallback, expectedOptionKeys) >
    questionStructureScore(standard, expectedOptionKeys);
}

function normalizeLocalObjectiveAnswer(answers: string[], expectedOptionKeys: string[]): string[] | null {
  if (answers.length === 0) return [];
  if (expectedOptionKeys.length === 0) return null;

  const raw = answers.join(',').trim()
    .replace(/^[[\]【】()（）]+/, '')
    .replace(/[[\]【】()（）]+$/, '')
    .trim();
  if (raw.trim().length === 0) return [];

  // 严格限制为选项字母及分隔符，避免把“AB法、A方案、AI”等文本答案拆成字母。
  if (!OBJECTIVE_ANSWER_STRICT_REGEX.test(raw)) return null;
  const compact = raw.replace(ANSWER_SEPARATOR_COLLAPSE_REGEX, '').toUpperCase();
  if (compact.length === 0 || !COMPACT_LETTERS_ONLY_REGEX.test(compact)) return null;

  const letters = compact.split('');
  const normalized = distinct(letters);
  // 重复字母（如 AA / A,A）不是合法多选答案，不能作为题型转换依据。
  if (normalized.length !== letters.length) return null;
  if (normalized.some((l: string): boolean => !expectedOptionKeys.includes(l))) return null;
  return normalized.slice().sort();
}

function looksLikeSubjectiveEnumeration(question: Question | null): boolean {
  if (question === null) return false;
  if (question.type !== QuestionType.SHORT && question.type !== QuestionType.BLANK) return false;

  const stem = question.question.trim();
  if (CHOICE_INTENT_REGEX.test(stem)) return false;

  const subjectiveLead = SUBJECTIVE_LEAD_REGEX.test(stem);
  const subjectivePurpose = SUBJECTIVE_PURPOSE_REGEX.test(stem);
  const comparisonQuestion = COMPARISON_QUESTION_REGEX.test(stem);
  return (subjectiveLead && subjectivePurpose) || comparisonQuestion;
}

function questionStructureScore(question: Question | null, expectedOptionKeys: string[]): number {
  if (question === null) return -536870912; // Int.MIN_VALUE / 4
  if (question.question.trim().length === 0) return -536870912;

  let score = 100;
  const optionKeys = distinct(question.options.map((o: Option): string => o.key.toUpperCase()));
  const isObjective = question.type === QuestionType.SINGLE ||
    question.type === QuestionType.MULTIPLE ||
    question.type === QuestionType.JUDGE;

  if (expectedOptionKeys.length > 0) {
    const covered = expectedOptionKeys.filter((k: string): boolean => optionKeys.includes(k)).length;
    score += covered * 35;
    score -= (expectedOptionKeys.length - covered) * 55;
    score += isObjective ? 80 : -180;
  } else if (isObjective) {
    score += question.options.length >= 2 ? 60 : -100;
  }

  if (isObjective) {
    if (question.options.length >= 2) {
      score += 40;
    } else if (question.options.length === 0) {
      score -= 100;
    } else {
      score -= 60;
    }
    if (question.answer.length > 0) {
      score += question.answer.every((a: string): boolean => optionKeys.includes(a.toUpperCase())) ? 35 : -90;
    }
  } else if (expectedOptionKeys.length > 0) {
    score -= 120;
  }

  if (question.analysis.trim().length > 0) score += 5;
  return score;
}

function splitBySections(text: string): SectionChunk[] {
  const chunks: SectionChunk[] = [];
  let currentTitle = '';
  let currentType: string | null = null;
  let currentLines: string[] = [];
  let sawSection = false;

  const flush = (): void => {
    const body = currentLines.join('\n').trim();
    if (body.length > 0) {
      chunks.push(new SectionChunk(currentTitle, currentType, body));
    }
    currentLines = [];
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      currentLines.push(rawLine);
      continue;
    }

    const section = parseSectionTitle(line);
    if (section !== null && !section.isAnswerSection) {
      flush();
      sawSection = true;
      currentTitle = section.title;
      currentType = section.forcedType;
    } else {
      currentLines.push(rawLine);
    }
  }
  flush();

  return sawSection ? chunks : [];
}

function distinct(values: string[]): string[] {
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
