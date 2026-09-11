/**
 * 多空填空支持 — 1:1 移植自 Android MultiBlankSupport.kt。
 * 复用 domain Question（字段与 importer.model.Question 一致）。
 */
import { Question, QuestionType, Option } from '../../domain/Models';

const ROUND_BLANK_REGEX = /(?<![A-Za-z0-9_])(?:\(\s*\)|（\s*）)/g;
const UNDERLINE_BLANK_REGEX = /_{3,}/g;
const URL_OR_WWW_REGEX = /https?:\/\/|www\./i;
const DATE_SLASH_REGEX = /\b\d{1,4}\/\d{1,2}(?:\/\d{1,4})?\b/;
const WORD_SLASH_REGEX = /\b[A-Za-z]{1,8}\s*\/\s*[A-Za-z]{1,8}\b/;

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

export function cloneQuestion(q: Question): Question {
  const copy = new Question(q.id, q.type, q.question);
  copy.number = q.number;
  copy.options = q.options.map((o: Option): Option => new Option(o.key, o.text));
  copy.answer = q.answer.slice();
  copy.blankAnswers = q.blankAnswers.map((g: string[]): string[] => g.slice());
  copy.analysis = q.analysis;
  copy.category = q.category;
  copy.images = q.images.slice();
  copy.score = q.score;
  copy.subject = q.subject;
  copy.grade = q.grade;
  copy.difficulty = q.difficulty;
  copy.knowledgePoints = q.knowledgePoints.slice();
  copy.tags = q.tags.slice();
  copy.source = q.source;
  copy.sourceFileId = q.sourceFileId;
  copy.version = q.version;
  copy.reviewStatus = q.reviewStatus;
  copy.aiConfidence = q.aiConfidence;
  copy.warnings = q.warnings.slice();
  return copy;
}

export function hasStructuredAnswers(question: Question): boolean {
  return question.type === QuestionType.BLANK && question.blankAnswers.length > 0;
}

export function countExplicitBlanks(text: string): number {
  if (text.trim().length === 0) return 0;
  let count = 0;
  ROUND_BLANK_REGEX.lastIndex = 0;
  while (ROUND_BLANK_REGEX.exec(text) !== null) count += 1;
  UNDERLINE_BLANK_REGEX.lastIndex = 0;
  while (UNDERLINE_BLANK_REGEX.exec(text) !== null) count += 1;
  return count;
}

export function normalizeGroups(groups: string[][], preserveEmptyGroups: boolean = true): string[][] {
  const out: string[][] = [];
  for (const group of groups) {
    const cleaned = distinctStrings(
      group.map((v: string): string => v.trim()).filter((v: string): boolean => v.length > 0)
    ).slice(0, 3);
    if (cleaned.length > 0 || preserveEmptyGroups) {
      out.push(cleaned);
    }
  }
  return out;
}

export function compatibilityAnswer(groups: string[][]): string[] {
  if (groups.length === 0) return [];
  const primaryAnswers = groups.map((group: string[]): string => {
    const first = group.find((v: string): boolean => v.trim().length > 0);
    return first !== undefined ? first.trim() : '';
  });
  if (primaryAnswers.every((v: string): boolean => v.length === 0)) return [];
  return [primaryAnswers.join('；')];
}

export function withBlankAnswers(question: Question, groups: string[][]): Question {
  const preservedGroups = groups.map((group: string[]): string[] => group.slice(0, 3));
  const cleanWarnings = clearMultiBlankWarnings(question.warnings);
  const result = cloneQuestion(question);
  result.blankAnswers = preservedGroups;
  result.answer = compatibilityAnswer(preservedGroups);
  result.warnings = warningsForGroups(cleanWarnings, preservedGroups);
  return result;
}

export function clearMultiBlankWarnings(warnings: string[]): string[] {
  return warnings.filter((message: string): boolean => {
    const multiBlankRelated = message.includes('个题空') &&
      (message.includes('未识别逐空答案') || message.includes('答案数量无法对应') || message.includes('当前配置了'));
    return !(multiBlankRelated || message.includes('多空填空题存在未配置答案'));
  });
}

export function sanitizeQuestion(question: Question): Question {
  if (question.type !== QuestionType.BLANK) {
    const cleanWarnings = clearMultiBlankWarnings(question.warnings);
    if (question.blankAnswers.length === 0 && arraysEqual(cleanWarnings, question.warnings)) {
      return question;
    }
    const result = cloneQuestion(question);
    result.blankAnswers = [];
    result.warnings = cleanWarnings;
    return result;
  }
  if (question.blankAnswers.length === 0) return question;
  const cleaned = normalizeGroups(question.blankAnswers, true);
  const result = cloneQuestion(question);
  result.blankAnswers = cleaned;
  result.answer = compatibilityAnswer(cleaned);
  result.warnings = warningsForGroups(clearMultiBlankWarnings(question.warnings), cleaned);
  return result;
}

function warningsForGroups(baseWarnings: string[], groups: string[][]): string[] {
  if (groups.length === 0 || groups.every((group: string[]): boolean => group.some((v: string): boolean => v.trim().length > 0))) {
    return baseWarnings;
  }
  return distinctStrings(baseWarnings.concat(['多空填空题存在未配置答案的题空']));
}

export function expectedAnswerText(groups: string[][]): string {
  if (groups.length === 0) return '未识别答案';
  return groups
    .map((answers: string[], index: number): string => {
      const text = answers.filter((v: string): boolean => v.trim().length > 0).join(' / ');
      return `第${index + 1}空：${text.length > 0 ? text : '未配置'}`;
    })
    .join('\n');
}

export function userAnswerText(answers: string[]): string {
  if (answers.length === 0) return '未作答';
  return answers
    .map((answer: string, index: number): string => `第${index + 1}空：${answer.length > 0 ? answer : '未作答'}`)
    .join('\n');
}

export function padUserAnswers(answers: string[], count: number): string[] {
  if (count <= 0) return [];
  const out: string[] = [];
  for (let index = 0; index < count; index++) {
    out.push(index < answers.length ? answers[index].trim() : '');
  }
  return out;
}

export function isUserAnswerComplete(question: Question, answers: string[]): boolean {
  if (hasStructuredAnswers(question)) {
    return padUserAnswers(answers, question.blankAnswers.length)
      .every((v: string): boolean => v.length > 0);
  }
  return answers.some((v: string): boolean => v.length > 0);
}

export function initialGroups(questionText: string, legacyAnswer: string[]): string[][] {
  const count = countExplicitBlanks(questionText);
  if (count <= 1) return [];
  const raw = legacyAnswer.join('；').trim();
  const parts = splitReliableParts(raw, count);
  if (parts !== null) {
    return parts.map((p: string): string[] => [p]);
  }
  const groups: string[][] = [];
  for (let i = 0; i < count; i++) groups.push([]);
  return groups;
}

export function splitReliableParts(raw: string, expectedCount: number): string[] | null {
  if (expectedCount <= 1 || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  const lineParts = trimmed.split('\n').map((l: string): string => l.trim())
    .filter((l: string): boolean => l.length > 0);
  if (lineParts.length === expectedCount) return lineParts;

  const separatorCandidates = [/[；;]/, /[|｜]/];
  for (const regex of separatorCandidates) {
    const parts = trimmed.split(regex).map((p: string): string => p.trim())
      .filter((p: string): boolean => p.length > 0);
    if (parts.length === expectedCount) return parts;
  }

  if (isSafeSlashSeparated(trimmed)) {
    const parts = trimmed.split(/[\/／]/).map((p: string): string => p.trim())
      .filter((p: string): boolean => p.length > 0);
    if (parts.length === expectedCount) return parts;
  }
  return null;
}

function isSafeSlashSeparated(value: string): boolean {
  if (!value.includes('/') && !value.includes('／')) return false;
  if (URL_OR_WWW_REGEX.test(value)) return false;
  if (DATE_SLASH_REGEX.test(value)) return false;
  if (WORD_SLASH_REGEX.test(value)) return false;
  return true;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
