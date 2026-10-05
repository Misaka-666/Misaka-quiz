/**
 * 判分核心 — 1:1 移植自 Android QuizRepository.evaluateQuestion 及其辅助。
 * 纯函数，Node 可测（test/harmony-parser-regression/session-core.mjs）。
 */
import { Question, QuestionType, StudyQuestionResult, Option } from '../domain/Models';
import { hasStructuredAnswers, padUserAnswers, expectedAnswerText } from '../importer/model/MultiBlankSupport';

export class QuestionCheckResult {
  question: Question;
  userAnswer: string[];
  userBlankAnswers: string[];
  correct: boolean;
  answerText: string;
  autoScored: boolean;
  constructor(question: Question, userAnswer: string[], correct: boolean, answerText: string, autoScored: boolean) {
    this.question = question;
    this.userAnswer = userAnswer;
    this.userBlankAnswers = [];
    this.correct = correct;
    this.answerText = answerText;
    this.autoScored = autoScored;
  }
}

function sortedCopy(values: string[]): string[] {
  const copy = values.slice();
  copy.sort();
  return copy;
}

export function isAutoScoredQuestionType(type: string): boolean {
  return type === QuestionType.SINGLE || type === QuestionType.MULTIPLE ||
    type === QuestionType.JUDGE || type === QuestionType.BLANK;
}

/**
 * 快速编辑答案解析 — 1:1 移植自 Android PracticeScreen.parseQuickEditAnswer。
 * 整串 对/正确/是/TRUE/T/√→A、错/错误/否/FALSE/F/×/X→B；多字母全大写 token 拆单键；
 * 只保留合法选项键并去重。BLANK/SHORT 原样整串保留。
 */
export function parseQuickEditAnswer(raw: string, type: string, options: Option[]): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (type !== QuestionType.SINGLE && type !== QuestionType.MULTIPLE && type !== QuestionType.JUDGE) {
    return [trimmed];
  }
  const upper = trimmed.toUpperCase();
  let normalized = upper;
  if (upper === '正确' || upper === '对' || upper === '是' || upper === 'TRUE' || upper === 'T' || upper === '√') {
    normalized = 'A';
  } else if (upper === '错误' || upper === '错' || upper === '否' || upper === 'FALSE' || upper === 'F' ||
    upper === '×' || upper === 'X') {
    normalized = 'B';
  }
  const optionKeys = new Set<string>();
  for (const option of options) {
    optionKeys.add(option.key.toUpperCase());
  }
  const tokens: string[] = [];
  for (const part of normalized.split(/[\s,，、/|;；]+/)) {
    const token = part.trim().toUpperCase();
    if (token.length === 0) {
      continue;
    }
    const pieces: string[] = token.length > 1 && /^[A-Z]+$/.test(token) ? token.split('') : [token];
    for (const piece of pieces) {
      if (optionKeys.has(piece) && !tokens.includes(piece)) {
        tokens.push(piece);
      }
    }
  }
  return tokens;
}

function isStructuredBlankAnswerCorrect(userAnswers: string[], acceptedAnswers: string[][]): boolean {
  if (acceptedAnswers.length === 0 || userAnswers.length !== acceptedAnswers.length) {
    return false;
  }
  for (let index = 0; index < acceptedAnswers.length; index++) {
    const user = normalizeBlankAnswer(userAnswers[index]);
    if (user.length === 0) {
      return false;
    }
    let matched = false;
    for (const accepted of acceptedAnswers[index]) {
      const normalized = normalizeBlankAnswer(accepted);
      if (normalized.length > 0 && normalized === user) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

function isBlankAnswerCorrect(userAnswer: string, acceptedAnswers: string[]): boolean {
  const normalizedUserAnswer = normalizeBlankAnswer(userAnswer);
  if (normalizedUserAnswer.length === 0) {
    return false;
  }
  for (const raw of acceptedAnswers) {
    for (const candidate of splitAcceptedBlankAnswers(raw)) {
      const normalized = normalizeBlankAnswer(candidate);
      if (normalized.length > 0 && normalized === normalizedUserAnswer) {
        return true;
      }
    }
  }
  return false;
}

function splitAcceptedBlankAnswers(answer: string): string[] {
  const parts = answer.split(/[/／|｜]/);
  const trimmed: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (value.length > 0) {
      trimmed.push(value);
    }
  }
  return trimmed.length > 0 ? trimmed : [answer.trim()];
}

const BOUNDARY_PUNCTUATION = '.,;:!?.，；：！？、';

function trimBoundary(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && BOUNDARY_PUNCTUATION.includes(value.charAt(start))) {
    start += 1;
  }
  while (end > start && BOUNDARY_PUNCTUATION.includes(value.charAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

export function normalizeBlankAnswer(value: string): string {
  // Kotlin: NFKC + trim + lowercase(ROOT) + 全角标点转半角 + 去空白 + 边界标点修剪
  const compact = value.normalize('NFKC').trim().toLowerCase()
    .split('，').join(',').split('。').join('.').split('；').join(';').split('：').join(':')
    .split('（').join('(').split('）').join(')').split('！').join('!').split('？').join('?')
    .replace(/[\s　]+/g, '');
  return trimBoundary(compact);
}

export function evaluateQuestion(question: Question, userAnswer: string[]): QuestionCheckResult {
  const structuredBlank = hasStructuredAnswers(question);
  let normalizedUserAnswer: string[];
  if (structuredBlank) {
    normalizedUserAnswer = padUserAnswers(userAnswer, question.blankAnswers.length);
  } else {
    normalizedUserAnswer = [];
    for (const answer of userAnswer) {
      if (answer.trim().length > 0) {
        normalizedUserAnswer.push(answer.trim());
      }
    }
  }
  const answerText = structuredBlank
    ? expectedAnswerText(question.blankAnswers)
    : (question.answer.join(' / ').length > 0 ? question.answer.join(' / ') : '未识别答案');
  let correct = false;
  if (question.type === QuestionType.SINGLE || question.type === QuestionType.MULTIPLE || question.type === QuestionType.JUDGE) {
    correct = normalizedUserAnswer.length > 0 && arraysEqualSorted(normalizedUserAnswer, question.answer);
  } else if (question.type === QuestionType.BLANK) {
    if (structuredBlank) {
      correct = isStructuredBlankAnswerCorrect(normalizedUserAnswer, question.blankAnswers);
    } else {
      correct = isBlankAnswerCorrect(normalizedUserAnswer.join(' '), question.answer);
    }
  }
  const result = new QuestionCheckResult(question, normalizedUserAnswer, correct, answerText,
    isAutoScoredQuestionType(question.type));
  result.userBlankAnswers = structuredBlank ? normalizedUserAnswer.slice() : [];
  return result;
}

function arraysEqualSorted(user: string[], expected: string[]): boolean {
  if (user.length !== expected.length) {
    return false;
  }
  const a = sortedCopy(user);
  const b = sortedCopy(expected);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function resultToStudyQuestionResult(
  result: QuestionCheckResult,
  sourceBankId: string | null,
  sourceBankName: string | null,
  earnedScore: number | null = null,
  maxScore: number | null = null
): StudyQuestionResult {
  const studyResult = new StudyQuestionResult(result.question, result.userAnswer.slice(), result.correct, result.answerText);
  studyResult.userBlankAnswers = result.userBlankAnswers.slice();
  studyResult.autoScored = result.autoScored;
  studyResult.sourceBankId = sourceBankId;
  studyResult.sourceBankName = sourceBankName;
  studyResult.earnedScore = earnedScore;
  studyResult.maxScore = maxScore;
  return studyResult;
}
