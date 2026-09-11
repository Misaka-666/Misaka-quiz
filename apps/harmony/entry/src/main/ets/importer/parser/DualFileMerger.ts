/**
 * 双文件合并 — 1:1 移植自 Android DualFileMerger.kt。
 * used 集合用值键（对应 Kotlin data class equals）而非对象身份。
 */
import { Question, QuestionType } from '../../domain/Models';
import { ImportWarning, WarningLevel } from '../model/ImportModels';
import {
  cloneQuestion,
  countExplicitBlanks,
  splitReliableParts,
  withBlankAnswers
} from '../model/MultiBlankSupport';
import { score } from '../score/ImportStrategyScorer';
import { validate } from '../validate/ImportValidator';
import { ParsedAnswerEntry } from './AnswerParser';
import { normalizeChapter } from './ChapterScopeParser';

export class MergeResult {
  questions: Question[];
  warnings: ImportWarning[];
  name: string;
  constructor(questions: Question[], warnings: ImportWarning[], name: string) {
    this.questions = questions;
    this.warnings = warnings;
    this.name = name;
  }
}

// 对应 Kotlin data class ParsedAnswerEntry 的 equals：按全部字段值判等
function entryKey(entry: ParsedAnswerEntry): string {
  return JSON.stringify([entry.number, entry.answer, entry.analysis, entry.type, entry.category, entry.sequence]);
}

function firstByNumber(answers: ParsedAnswerEntry[]): Map<string, ParsedAnswerEntry> {
  const map = new Map<string, ParsedAnswerEntry>();
  for (const entry of answers) {
    if (!map.has(entry.number)) {
      map.set(entry.number, entry);
    }
  }
  return map;
}

export function mergeAuto(questions: Question[], answers: ParsedAnswerEntry[]): MergeResult {
  const candidates = [
    mergeByNumber(questions, answers),
    mergeByTypeAndNumber(questions, answers),
    mergeByChapterAndNumber(questions, answers),
    mergeBySequence(questions, answers)
  ];
  let best = candidates[0];
  let bestScore = Number.MIN_SAFE_INTEGER;
  for (const candidate of candidates) {
    const validation = validate(candidate.questions);
    const candidateScore = score(candidate.questions, validation.concat(candidate.warnings));
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      best = candidate;
    }
  }
  return best;
}

export function mergeByNumber(questions: Question[], answers: ParsedAnswerEntry[]): MergeResult {
  const answerMap = firstByNumber(answers);
  const used = new Set<string>();
  const warnings: ImportWarning[] = [];

  const mergedQuestions = questions.map((question: Question): Question => {
    const matched = answerMap.get(question.number) ?? null;
    if (matched === null) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '未匹配到对应答案'));
      return question;
    }
    used.add(entryKey(matched));
    return applyAnswer(question, matched, warnings);
  });

  for (const entry of answers) {
    if (!used.has(entryKey(entry))) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, entry.number, '答案文件中存在未匹配题号'));
    }
  }

  return new MergeResult(mergedQuestions, warnings, '按全局题号合并');
}

export function mergeByTypeAndNumber(questions: Question[], answers: ParsedAnswerEntry[]): MergeResult {
  const typedAnswers = answers.filter((a: ParsedAnswerEntry): boolean => a.type !== null);
  if (typedAnswers.length === 0) {
    const fallback = mergeByNumber(questions, answers);
    return new MergeResult(fallback.questions, fallback.warnings, '按题型分组题号合并');
  }

  const answerMap = new Map<string, ParsedAnswerEntry>();
  for (const entry of typedAnswers) {
    const key = `${entry.type ?? QuestionType.SINGLE}#${entry.number}`;
    if (!answerMap.has(key)) {
      answerMap.set(key, entry);
    }
  }
  const used = new Set<string>();
  const warnings: ImportWarning[] = [];

  const mergedQuestions = questions.map((question: Question): Question => {
    const matched = answerMap.get(`${question.type}#${question.number}`) ?? null;
    if (matched === null) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '未在对应题型分组中匹配到答案'));
      return question;
    }
    used.add(entryKey(matched));
    return applyAnswer(question, matched, warnings);
  });

  for (const entry of typedAnswers) {
    if (!used.has(entryKey(entry))) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, entry.number, '分组答案中存在未匹配题号'));
    }
  }
  return new MergeResult(mergedQuestions, warnings, '按题型分组题号合并');
}

export function mergeByChapterAndNumber(questions: Question[], answers: ParsedAnswerEntry[]): MergeResult {
  const answerGroups = new Map<string, ParsedAnswerEntry[]>();
  for (const entry of answers) {
    if (entry.category.trim().length === 0) continue;
    const key = normalizeChapter(entry.category);
    if (key.trim().length === 0) continue;
    const group = answerGroups.get(key);
    if (group !== undefined) {
      group.push(entry);
    } else {
      answerGroups.set(key, [entry]);
    }
  }
  if (answerGroups.size < 2) {
    const fallback = mergeByNumber(questions, answers);
    return new MergeResult(fallback.questions, fallback.warnings, '按章节顺序题号合并');
  }

  const questionGroups = splitQuestionsByNumberRestart(questions);
  if (questionGroups.length < 2) {
    const fallback = mergeByNumber(questions, answers);
    return new MergeResult(fallback.questions, fallback.warnings, '按章节顺序题号合并');
  }

  const used = new Set<string>();
  const warnings: ImportWarning[] = [];
  let matchedCount = 0;
  const answerGroupList = Array.from(answerGroups.values());
  const pairCount = Math.min(questionGroups.length, answerGroupList.length);
  const mergedQuestions: Question[] = [];

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const questionGroup = questionGroups[pairIndex];
    const answerGroup = answerGroupList[pairIndex];
    const answerMap = new Map<string, ParsedAnswerEntry>();
    const fallbackAnswerMap = new Map<string, ParsedAnswerEntry>();
    for (const entry of answerGroup) {
      const key = `${entry.type ?? ''}#${entry.number}`;
      if (!answerMap.has(key)) answerMap.set(key, entry);
      const fallbackKey = `#${entry.number}`;
      if (!fallbackAnswerMap.has(fallbackKey)) fallbackAnswerMap.set(fallbackKey, entry);
    }
    for (const question of questionGroup) {
      const matched = answerMap.get(`${question.type}#${question.number}`) ??
        fallbackAnswerMap.get(`#${question.number}`) ?? null;
      if (matched === null) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '未在对应章节中匹配到答案'));
        mergedQuestions.push(question);
      } else {
        matchedCount += 1;
        used.add(entryKey(matched));
        mergedQuestions.push(applyAnswer(question, matched, warnings));
      }
    }
  }

  if (questionGroups.length > pairCount) {
    for (const question of questionGroups.slice(pairCount).flat()) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '题目章节多于答案章节，未匹配到对应答案'));
      mergedQuestions.push(question);
    }
  }
  if (answerGroups.size > pairCount) {
    warnings.push(new ImportWarning(WarningLevel.WARNING, null, '答案章节多于题目章节，已忽略多余章节答案'));
  }
  for (const entry of answers) {
    if (entry.category.trim().length > 0 && !used.has(entryKey(entry))) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, entry.number, '章节答案中存在未匹配题号'));
    }
  }
  if (matchedCount < 5) {
    warnings.push(new ImportWarning(WarningLevel.WARNING, null, '章节答案匹配数量不足，建议改用标准答案表或检查章节标题'));
  }
  return new MergeResult(mergedQuestions, warnings, '按章节顺序题号合并');
}

function splitQuestionsByNumberRestart(questions: Question[]): Question[][] {
  if (questions.length === 0) return [];
  const groups: Question[][] = [];
  let current: Question[] = [];
  for (const question of questions) {
    const number = question.number.trim().length > 0 && /^\d+$/.test(question.number.trim())
      ? parseInt(question.number.trim(), 10)
      : null;
    if (current.length > 0 && number === 1) {
      groups.push(current);
      current = [];
    }
    current.push(question);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function mergeBySequence(questions: Question[], answers: ParsedAnswerEntry[]): MergeResult {
  const warnings: ImportWarning[] = [];
  const mergedQuestions = questions.map((question: Question, index: number): Question => {
    const matched = index < answers.length ? answers[index] : null;
    if (matched === null) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '按顺序未匹配到答案'));
      return question;
    }
    return applyAnswer(question, matched, warnings);
  });
  if (answers.length > questions.length) {
    warnings.push(new ImportWarning(WarningLevel.WARNING, null, '答案数量多于题目数量，已忽略多余答案'));
  }
  return new MergeResult(mergedQuestions, warnings, '按顺序合并');
}

function applyAnswer(question: Question, entry: ParsedAnswerEntry, warnings: ImportWarning[]): Question {
  if (question.type === QuestionType.BLANK) {
    let blankCount = question.blankAnswers.length > 1 ? question.blankAnswers.length : null;
    if (blankCount === null) {
      const detected = countExplicitBlanks(question.question);
      blankCount = detected > 1 ? detected : null;
    }
    if (blankCount !== null && question.answer.length === 0) {
      const rawAnswer = entry.answer.join('；');
      const parts = splitReliableParts(rawAnswer, blankCount);
      if (parts !== null) {
        const groups = parts.map((p: string): string[] => [p]);
        const merged = withBlankAnswers(question, groups);
        merged.analysis = question.analysis.trim().length > 0 ? question.analysis : entry.analysis;
        return merged;
      }
      warnings.push(new ImportWarning(
        WarningLevel.WARNING,
        question.number,
        `检测到${blankCount}个题空，答案数量无法对应，请人工核对`
      ));
    }
  }

  const mergedAnswer = question.answer.length > 0
    ? question.answer
    : normalizeAnswerForQuestion(question, entry.answer);
  const mergedType = normalizeTypeAfterMerge(question, mergedAnswer);
  if (mergedType !== question.type) {
    warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '题型根据多答案由单选修正为多选'));
  }
  const result = cloneQuestion(question);
  result.type = mergedType;
  result.answer = mergedAnswer;
  result.analysis = question.analysis.trim().length > 0 ? question.analysis : entry.analysis;
  return result;
}

function normalizeTypeAfterMerge(question: Question, answer: string[]): string {
  return question.type === QuestionType.SINGLE && answer.length > 1 ? QuestionType.MULTIPLE : question.type;
}

function normalizeAnswerForQuestion(question: Question, answer: string[]): string[] {
  if (answer.length === 0) return [];
  if (question.type === QuestionType.JUDGE) {
    const first = answer[0].trim();
    if (['正确', '对', '是', '√', 'T', 'TRUE'].includes(first)) return ['A'];
    if (['错误', '错', '否', '×', 'F', 'FALSE'].includes(first)) return ['B'];
    return answer;
  }
  return answer;
}
