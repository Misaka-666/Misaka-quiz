/**
 * 考试会话状态机 — 1:1 移植自 Android QuizRepository 的考试段
 * （startExam / startExamByTypeCounts / toggleExamAnswer / submitExam / tickExam / summary）。
 */
import { Question, QuestionType, QuizBank, StudyQuestionResult, StudyRecord } from '../domain/Models';
import { hasStructuredAnswers, padUserAnswers, expectedAnswerText, isUserAnswerComplete, sanitizeQuestion } from '../importer/model/MultiBlankSupport';
import { QuestionCheckResult, evaluateQuestion, isAutoScoredQuestionType, resultToStudyQuestionResult } from './AnswerJudge';
import { applyWrongAnswer, applyWrongRight } from './WrongBookOps';
import { PracticeHost } from './PracticeSessionCore';

export class ExamSummary {
  total: number;
  answered: number;
  correct: number;
  durationSeconds: number;
  remainingSeconds: number;
  autoSubmitted: boolean;
  totalScore: number;
  earnedScore: number;
  constructor(total: number, answered: number, correct: number, durationSeconds: number,
    remainingSeconds: number, autoSubmitted: boolean, totalScore: number, earnedScore: number) {
    this.total = total;
    this.answered = answered;
    this.correct = correct;
    this.durationSeconds = durationSeconds;
    this.remainingSeconds = remainingSeconds;
    this.autoSubmitted = autoSubmitted;
    this.totalScore = totalScore;
    this.earnedScore = earnedScore;
  }
}

/** 交卷产物：成绩摘要 + 明细 + 学习记录（调用方入库） */
export class ExamSubmitOutcome {
  summary: ExamSummary;
  detailResults: StudyQuestionResult[];
  record: StudyRecord;
}

export function defaultExamTypeScores(): Map<string, number> {
  const scores = new Map<string, number>();
  scores.set(QuestionType.SINGLE, 1.0);
  scores.set(QuestionType.MULTIPLE, 2.0);
  scores.set(QuestionType.JUDGE, 1.0);
  scores.set(QuestionType.BLANK, 2.0);
  scores.set(QuestionType.SHORT, 5.0);
  return scores;
}

function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function coerceAtLeast(value: number, min: number): number {
  return Math.max(value, min);
}

export class ExamSessionCore {
  private host: PracticeHost;
  questions: Question[] = [];
  index = 0;
  durationSeconds = 0;
  remainingSeconds = 0;
  finished = false;
  autoSubmitted = false;
  optionShuffleSeed = 0;
  optionShuffleSessionEnabled = false;
  answers: Map<string, string[]> = new Map<string, string[]>();
  typeScores: Map<string, number> = defaultExamTypeScores();
  /** 交卷后保存最近一次记录 id，供成绩页读取（Android 靠 submitExam 直接写 studyRecords） */
  lastRecord: StudyRecord | null = null;

  constructor(host: PracticeHost) {
    this.host = host;
  }

  private activeBank(): QuizBank | null {
    const banks = this.host.banks();
    const activeId = this.host.activeBankId();
    for (const bank of banks) {
      if (bank.id === activeId) {
        return bank;
      }
    }
    return banks.length > 0 ? banks[0] : null;
  }

  private begin(questions: Question[], durationMinutes: number, typeScores: Map<string, number>): boolean {
    if (questions.length === 0) {
      return false;
    }
    this.questions = questions;
    const merged = defaultExamTypeScores();
    for (const key of typeScores.keys()) {
      merged.set(key, Math.max(0, typeScores.get(key) as number));
    }
    this.typeScores = merged;
    this.index = 0;
    this.durationSeconds = coerceAtLeast(durationMinutes, 1) * 60;
    this.remainingSeconds = this.durationSeconds;
    this.finished = false;
    this.autoSubmitted = false;
    this.optionShuffleSessionEnabled = this.examOptionShufflePrefEnabled;
    this.optionShuffleSeed = this.host.now();
    this.answers.clear();
    this.lastRecord = null;
    return true;
  }

  /** 考试选项打乱偏好由仓库注入（Android examOptionShuffleEnabled 字段） */
  examOptionShufflePrefEnabled = false;

  /** 按总题量开考（题源按题型过滤） */
  start(
    sourceQuestions: Question[],
    questionCount: number,
    durationMinutes: number,
    allowedTypes: string[],
    typeScores: Map<string, number>,
    randomize: boolean,
    objectiveTypes: string[]
  ): boolean {
    const selectedTypes = allowedTypes.length > 0 ? allowedTypes : objectiveTypes;
    const source = sourceQuestions.filter((question): boolean => selectedTypes.includes(question.type));
    if (source.length === 0) {
      return false;
    }
    const count = Math.min(Math.max(questionCount, 1), source.length);
    const picked = randomize ? shuffled(source).slice(0, count) : source.slice(0, count);
    return this.begin(picked, durationMinutes, typeScores);
  }

  /** 按题型数量开考（每题型独立抽取后整体打乱） */
  startByTypeCounts(
    sourceQuestions: Question[],
    typeCounts: Map<string, number>,
    durationMinutes: number,
    typeScores: Map<string, number>
  ): boolean {
    const picked: Question[] = [];
    for (const type of typeCounts.keys()) {
      const count = typeCounts.get(type) as number;
      if (count <= 0) {
        continue;
      }
      const pool = sourceQuestions.filter((question): boolean => question.type === type);
      picked.push(...shuffled(pool).slice(0, count));
    }
    if (picked.length === 0) {
      return false;
    }
    return this.begin(shuffled(picked), durationMinutes, typeScores);
  }

  reset(): void {
    this.questions = [];
    this.index = 0;
    this.durationSeconds = 0;
    this.remainingSeconds = 0;
    this.finished = false;
    this.autoSubmitted = false;
    this.optionShuffleSessionEnabled = false;
    this.optionShuffleSeed = 0;
    this.typeScores = defaultExamTypeScores();
    this.answers.clear();
    this.lastRecord = null;
  }

  currentQuestion(): Question | null {
    if (this.questions.length === 0) {
      return null;
    }
    this.index = Math.min(Math.max(this.index, 0), this.questions.length - 1);
    return this.questions[this.index];
  }

  nextQuestion(): void {
    if (this.questions.length === 0) {
      return;
    }
    this.index = Math.min(this.index + 1, this.questions.length - 1);
  }

  previousQuestion(): void {
    if (this.questions.length === 0) {
      return;
    }
    this.index = Math.max(this.index - 1, 0);
  }

  jumpToQuestion(index: number): void {
    if (this.questions.length === 0) {
      return;
    }
    this.index = Math.min(Math.max(index, 0), this.questions.length - 1);
  }

  answerOf(question: Question): string[] {
    const value = this.answers.get(question.id);
    return value !== undefined ? value : [];
  }

  toggleAnswer(key: string, multiple: boolean): void {
    const question = this.currentQuestion();
    if (question === null) {
      return;
    }
    const current = this.answerOf(question);
    let updated: string[];
    if (multiple) {
      updated = current.includes(key)
        ? current.filter((item): boolean => item !== key)
        : current.concat([key]);
    } else {
      updated = [key];
    }
    this.answers.set(question.id, updated);
  }

  updateTextAnswer(text: string): void {
    const question = this.currentQuestion();
    if (question === null) {
      return;
    }
    const cleanAnswer = text.trim();
    if (cleanAnswer.length === 0) {
      this.answers.delete(question.id);
    } else {
      this.answers.set(question.id, [cleanAnswer]);
    }
  }

  updateBlankAnswer(index: number, text: string): void {
    const question = this.currentQuestion();
    if (question === null || !hasStructuredAnswers(question)) {
      return;
    }
    const count = question.blankAnswers.length;
    if (index < 0 || index >= count) {
      return;
    }
    const next = padUserAnswers(this.answerOf(question), count).slice();
    next[index] = text;
    if (!next.some((value): boolean => value.trim().length > 0)) {
      this.answers.delete(question.id);
    } else {
      this.answers.set(question.id, next);
    }
  }

  tick(): void {
    if (this.finished || this.questions.length === 0) {
      return;
    }
    if (this.remainingSeconds > 0) {
      this.remainingSeconds -= 1;
    }
    if (this.remainingSeconds <= 0 && !this.finished) {
      this.submit(true);
    }
  }

  isAnswered(question: Question): boolean {
    return isUserAnswerComplete(question, this.answerOf(question));
  }

  answeredCount(): number {
    let count = 0;
    for (const question of this.questions) {
      if (this.isAnswered(question)) {
        count += 1;
      }
    }
    return count;
  }

  scoreForQuestion(question: Question): number {
    if (question.score !== null && isFinite(question.score)) {
      return question.score;
    }
    const value = this.typeScores.get(question.type);
    if (value !== undefined) {
      return value;
    }
    const fallback = defaultExamTypeScores().get(question.type);
    return fallback !== undefined ? fallback : 1.0;
  }

  evaluate(question: Question): QuestionCheckResult {
    return evaluateQuestion(question, this.answerOf(question));
  }

  correctCount(): number {
    let count = 0;
    for (const question of this.questions) {
      const result = this.evaluate(question);
      if (result.autoScored && result.correct) {
        count += 1;
      }
    }
    return count;
  }

  totalScore(): number {
    let total = 0;
    for (const question of this.questions) {
      if (isAutoScoredQuestionType(question.type)) {
        total += this.scoreForQuestion(question);
      }
    }
    return total;
  }

  earnedScore(): number {
    let earned = 0;
    for (const question of this.questions) {
      const result = this.evaluate(question);
      if (result.autoScored && result.correct) {
        earned += this.scoreForQuestion(question);
      }
    }
    return earned;
  }

  summary(): ExamSummary {
    return new ExamSummary(this.questions.length, this.answeredCount(), this.correctCount(),
      this.durationSeconds, this.remainingSeconds, this.autoSubmitted, this.totalScore(), this.earnedScore());
  }

  submit(autoSubmitted: boolean): ExamSubmitOutcome | null {
    if (this.questions.length === 0 || this.finished) {
      return null;
    }
    this.finished = true;
    this.autoSubmitted = autoSubmitted;
    const now = this.host.now();
    const bank = this.activeBank();
    const usedSeconds = this.durationSeconds - this.remainingSeconds;
    const detailResults: StudyQuestionResult[] = [];
    for (const question of this.questions) {
      const result = this.evaluate(question);
      const maxScore = this.scoreForQuestion(question);
      detailResults.push(resultToStudyQuestionResult(result,
        bank !== null ? bank.id : null, bank !== null ? bank.name : null,
        result.autoScored ? (result.correct ? maxScore : 0) : null,
        result.autoScored ? maxScore : null));
    }
    const summary = this.summary();
    const record = new StudyRecord(`exam_${now}`,
      bank !== null ? bank.name : '未命名题库', '考试', '原生考试',
      summary.total, summary.correct, now);
    record.bankId = bank !== null ? bank.id : null;
    record.durationSeconds = usedSeconds;
    record.autoSubmitted = autoSubmitted;
    record.startedAt = now - usedSeconds * 1000;
    record.earnedScore = summary.earnedScore;
    record.totalScore = summary.totalScore;
    record.questionResults = detailResults;
    for (let i = 0; i < this.questions.length; i++) {
      const question = this.questions[i];
      const result = this.evaluate(question);
      if (result.autoScored && result.correct) {
        applyWrongRight(this.host.wrongBook(), bank, question, now);
      } else if (result.autoScored) {
        applyWrongAnswer(this.host.wrongBook(), bank, question, result.userAnswer, '考试', now);
      }
    }
    this.host.addRecord(record);
    this.lastRecord = record;
    this.host.persist();
    const outcome = new ExamSubmitOutcome();
    outcome.summary = summary;
    outcome.detailResults = detailResults;
    outcome.record = record;
    return outcome;
  }
}
