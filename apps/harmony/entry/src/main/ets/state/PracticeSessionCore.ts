/**
 * 练习会话状态机 — 1:1 移植自 Android QuizRepository 的练习段
 * （startPracticeSession / startSequentialPracticeSession / submit* / batch / slash /
 *  favorite / 顺序进度存取 / finishPracticeSessionIfNeeded）。
 * 仓库侧（题库/错题本/收藏/记录/持久化）经 PracticeHost 钩子注入，Node 可测。
 */
import {
  Question, QuestionType, QuizBank, StudyQuestionResult, StudyRecord,
  WrongQuestionEntry, SlashedQuestionEntry, FavoriteQuestionEntry,
  DEFAULT_BANK_GROUP_NAME, normalizeBankGroupName
} from '../domain/Models';
import { hasStructuredAnswers, padUserAnswers, expectedAnswerText, isUserAnswerComplete, sanitizeQuestion } from '../importer/model/MultiBlankSupport';
import { QuestionCheckResult, evaluateQuestion, resultToStudyQuestionResult } from './AnswerJudge';
import { applyWrongAnswer, applyWrongRight, questionKeyOf } from './WrongBookOps';

export const PRACTICE_MODE_INSTANT = 'instant_feedback';
export const PRACTICE_MODE_BATCH = 'batch_review';
export const PRACTICE_ORDER_RANDOM = 'random';
export const PRACTICE_ORDER_SEQUENTIAL = 'ordered';
export const SEQUENTIAL_START_LAST = 'last';
export const SEQUENTIAL_START_FIRST = 'first';
export const SEQUENTIAL_START_CUSTOM = 'custom';

export const OBJECTIVE_QUESTION_TYPES: string[] = [
  QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE
];
export const ALL_QUESTION_TYPES: string[] = [
  QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT
];

export class PracticeQuestionSource {
  bankId: string;
  bankName: string;
  groupName: string;
  question: Question;
  constructor(bankId: string, bankName: string, groupName: string, question: Question) {
    this.bankId = bankId;
    this.bankName = bankName;
    this.groupName = groupName;
    this.question = question;
  }
}

/** 仓库侧宿主钩子；默认实现全部无操作，测试按需覆盖 */
export class PracticeHost {
  banks: () => QuizBank[] = (): QuizBank[] => [];
  activeBankId: () => string = (): string => '';
  wrongBook: () => WrongQuestionEntry[] = (): WrongQuestionEntry[] => [];
  slashedQuestions: () => SlashedQuestionEntry[] = (): SlashedQuestionEntry[] => [];
  favoriteQuestions: () => FavoriteQuestionEntry[] = (): FavoriteQuestionEntry[] => [];
  isSlashed: (bankId: string, question: Question) => boolean =
    (_bankId: string, _question: Question): boolean => false;
  addRecord: (record: StudyRecord) => void = (_record: StudyRecord): void => {};
  sequentialProgress: (key: string) => number | null = (_key: string): number | null => null;
  setSequentialProgress: (key: string, value: number) => void = (_key: string, _value: number): void => {};
  now: () => number = (): number => Date.now();
  persist: () => void = (): void => {};
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

function coerceIn(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePracticeMode(mode: string): string {
  return mode === PRACTICE_MODE_BATCH ? PRACTICE_MODE_BATCH : PRACTICE_MODE_INSTANT;
}

export function resolveSequentialStartIndex(
  progressValue: number | null,
  sourceSize: number,
  startMode: string,
  customStartNumber: number
): number {
  if (sourceSize <= 0) {
    return 0;
  }
  if (startMode === SEQUENTIAL_START_FIRST) {
    return 0;
  }
  if (startMode === SEQUENTIAL_START_CUSTOM) {
    return coerceIn(customStartNumber - 1, 0, sourceSize - 1);
  }
  return coerceIn(progressValue !== null ? progressValue : 0, 0, sourceSize - 1);
}

export class PracticeSessionCore {
  private host: PracticeHost;
  questions: Question[] = [];
  private questionSessionKeys: string[] = [];
  sourceLabel = '当前题库';
  index = 0;
  selectedAnswer: string[] = [];
  lastResult: QuestionCheckResult | null = null;
  mode: string = PRACTICE_MODE_INSTANT;
  batchSubmitted = false;
  batchGroupSize = 10;
  batchGroupStartIndex = 0;
  sessionResults: Map<string, boolean> = new Map<string, boolean>();
  answerResults: Map<string, StudyQuestionResult> = new Map<string, StudyQuestionResult>();
  draftAnswers: Map<string, string[]> = new Map<string, string[]>();
  private questionBankIds: Map<string, string> = new Map<string, string>();
  optionShuffleSeed = 0;
  private startedAt: number | null = null;
  sessionScopeType: string | null = null;
  sessionScopeName: string | null = null;
  private sequentialBankId: string | null = null;
  private sequentialStartIndex: number | null = null;
  private sequentialNextIndexAfterComplete: number | null = null;

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

  // ---------- 会话启动 ----------

  start(
    sourceItems: PracticeQuestionSource[],
    allowedTypes: string[],
    randomize: boolean,
    practiceMode: string,
    batchGroupSize: number,
    sessionScopeType: string | null,
    sessionScopeName: string | null
  ): boolean {
    const selectedTypes = allowedTypes.length > 0 ? allowedTypes : OBJECTIVE_QUESTION_TYPES;
    const filteredItems: PracticeQuestionSource[] = [];
    for (const item of sourceItems) {
      if (selectedTypes.includes(item.question.type)) {
        filteredItems.push(item);
      }
    }
    if (filteredItems.length === 0) {
      return false;
    }
    const count = filteredItems.length; // 调用方已按题量截断（Android 由 questionCount 参数控制）
    const selectedItems = randomize ? shuffled(filteredItems).slice(0, count) : filteredItems.slice(0, count);
    this.questions = selectedItems.map((item): Question => item.question);
    this.questionSessionKeys = buildSessionKeys(selectedItems);
    this.index = 0;
    this.selectedAnswer = [];
    this.lastResult = null;
    this.mode = normalizePracticeMode(practiceMode);
    this.batchSubmitted = false;
    this.batchGroupSize = coerceIn(batchGroupSize, 1, Math.max(1, count));
    this.batchGroupStartIndex = 0;
    this.sessionResults.clear();
    this.answerResults.clear();
    this.draftAnswers.clear();
    this.questionBankIds.clear();
    this.optionShuffleSeed = this.host.now();
    for (let i = 0; i < selectedItems.length; i++) {
      const sessionKey = this.questionSessionKeys[i];
      if (selectedItems[i].bankId.length > 0) {
        this.questionBankIds.set(sessionKey, selectedItems[i].bankId);
      }
    }
    this.sessionScopeType = sessionScopeType !== null && sessionScopeType.length > 0 ? sessionScopeType : null;
    this.sessionScopeName = sessionScopeName !== null && sessionScopeName.length > 0 ? sessionScopeName : null;
    this.startedAt = this.host.now();
    this.sequentialBankId = null;
    this.sequentialStartIndex = null;
    this.sequentialNextIndexAfterComplete = null;
    return true;
  }

  /** 顺序练习：从池中按进度起点截取（等价 Android startSequentialPracticeSession） */
  startSequential(
    sourceItems: PracticeQuestionSource[],
    allowedTypes: string[],
    questionCount: number,
    startMode: string,
    customStartNumber: number,
    progressKey: string,
    progressValue: number | null,
    practiceMode: string,
    batchGroupSize: number,
    scopeLabel: string
  ): boolean {
    const selectedTypes = allowedTypes.length > 0 ? allowedTypes : OBJECTIVE_QUESTION_TYPES;
    const source: PracticeQuestionSource[] = [];
    for (const item of sourceItems) {
      if (selectedTypes.includes(item.question.type)) {
        source.push(item);
      }
    }
    if (source.length === 0) {
      return false;
    }
    const startIndex = resolveSequentialStartIndex(progressValue, source.length, startMode, customStartNumber);
    const count = coerceIn(questionCount, 1, source.length);
    const selectedSources = source.slice(startIndex, startIndex + count);
    if (selectedSources.length === 0) {
      return false;
    }
    const started = this.start(selectedSources, selectedTypes, false, practiceMode, batchGroupSize, null, scopeLabel);
    if (started) {
      const nextIndex = startIndex + selectedSources.length;
      this.sequentialBankId = progressKey;
      this.sequentialStartIndex = startIndex;
      this.sequentialNextIndexAfterComplete = nextIndex >= source.length ? 0 : nextIndex;
    }
    return started;
  }

  sessionKeyAt(index: number): string | null {
    return index >= 0 && index < this.questionSessionKeys.length ? this.questionSessionKeys[index] : null;
  }

  currentSessionKey(): string | null {
    return this.sessionKeyAt(this.index);
  }

  bankForIndex(index: number): QuizBank | null {
    const sessionKey = this.sessionKeyAt(index);
    const mappedBankId = sessionKey !== null ? this.questionBankIds.get(sessionKey) : undefined;
    if (mappedBankId !== undefined) {
      for (const bank of this.host.banks()) {
        if (bank.id === mappedBankId) {
          return bank;
        }
      }
    }
    return this.activeBank();
  }

  currentSourceBank(): QuizBank | null {
    return this.bankForIndex(this.index);
  }

  currentQuestion(): Question | null {
    if (this.questions.length === 0) {
      return null;
    }
    const minIndex = this.mode === PRACTICE_MODE_BATCH ? this.batchStartIndex() : 0;
    const maxIndex = this.mode === PRACTICE_MODE_BATCH ? this.batchEndIndex() : this.questions.length - 1;
    this.index = coerceIn(this.index, minIndex, maxIndex);
    return this.questions[this.index];
  }

  // ---------- 翻题 ----------

  nextQuestion(): void {
    if (this.questions.length === 0) {
      return;
    }
    const maxIndex = this.mode === PRACTICE_MODE_BATCH ? this.batchEndIndex() : this.questions.length - 1;
    this.index = Math.min(this.index + 1, maxIndex);
    this.restoreSelectionForCurrent();
  }

  previousQuestion(): void {
    if (this.questions.length === 0) {
      return;
    }
    const minIndex = this.mode === PRACTICE_MODE_BATCH ? this.batchStartIndex() : 0;
    this.index = Math.max(this.index - 1, minIndex);
    this.restoreSelectionForCurrent();
  }

  goToQuestion(index: number): void {
    if (this.questions.length === 0) {
      return;
    }
    const minIndex = this.mode === PRACTICE_MODE_BATCH ? this.batchStartIndex() : 0;
    const maxIndex = this.mode === PRACTICE_MODE_BATCH ? this.batchEndIndex() : this.questions.length - 1;
    this.index = coerceIn(index, minIndex, maxIndex);
    this.restoreSelectionForCurrent();
  }

  // ---------- 作答 ----------

  toggleAnswer(key: string, multiple: boolean): void {
    let nextAnswer: string[] = [];
    if (multiple) {
      nextAnswer = this.selectedAnswer.includes(key)
        ? this.selectedAnswer.filter((item): boolean => item !== key)
        : this.selectedAnswer.concat([key]);
    } else {
      nextAnswer = [key];
    }
    this.updateCurrentAnswer(nextAnswer);
  }

  updateTextAnswer(text: string): void {
    this.updateCurrentAnswer([text]);
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
    const next = padUserAnswers(this.selectedAnswer, count).slice();
    next[index] = text;
    this.updateCurrentAnswer(next);
  }

  private updateCurrentAnswer(answer: string[]): void {
    const question = this.currentQuestion();
    let normalizedAnswer: string[];
    if (question !== null && hasStructuredAnswers(question)) {
      normalizedAnswer = padUserAnswers(answer, question.blankAnswers.length);
    } else {
      normalizedAnswer = [];
      for (const value of answer) {
        if (value.trim().length > 0) {
          normalizedAnswer.push(value.trim());
        }
      }
    }
    this.selectedAnswer = normalizedAnswer;
    if (this.mode === PRACTICE_MODE_BATCH && !this.batchSubmitted) {
      const sessionKey = this.currentSessionKey();
      if (question !== null && sessionKey !== null) {
        if (!normalizedAnswer.some((value): boolean => value.trim().length > 0)) {
          this.draftAnswers.delete(sessionKey);
        } else {
          this.draftAnswers.set(sessionKey, normalizedAnswer);
        }
      }
    }
  }

  // ---------- 判题/提交 ----------

  private currentWrongSource(): string {
    if (this.sourceLabel === '错题本') {
      return '错题练习';
    }
    if (this.sourceLabel === '今日复习') {
      return '今日复习';
    }
    if (this.sourceLabel === '收藏夹') {
      return '收藏练习';
    }
    return '练习';
  }

  private applyResultEffects(bank: QuizBank | null, question: Question, result: QuestionCheckResult, now: number): void {
    if (result.autoScored && result.correct) {
      applyWrongRight(this.host.wrongBook(), bank, question, now);
    } else if (result.autoScored) {
      applyWrongAnswer(this.host.wrongBook(), bank, question, result.userAnswer, this.currentWrongSource(), now);
    }
  }

  submitQuestion(): QuestionCheckResult | null {
    if (this.mode === PRACTICE_MODE_BATCH && !this.batchSubmitted) {
      return null;
    }
    const question = this.currentQuestion();
    if (question === null) {
      return null;
    }
    const sessionKey = this.currentSessionKey();
    if (sessionKey === null) {
      return null;
    }
    const now = this.host.now();
    const result = evaluateQuestion(question, this.selectedAnswer);
    const bank = this.bankForIndex(this.index);
    this.lastResult = result;
    this.sessionResults.set(sessionKey, result.correct);
    this.answerResults.set(sessionKey,
      resultToStudyQuestionResult(result, bank !== null ? bank.id : null, bank !== null ? bank.name : null));
    this.applyResultEffects(bank, question, result, now);
    this.host.persist();
    return result;
  }

  submitBatch(): boolean {
    if (this.mode !== PRACTICE_MODE_BATCH || this.questions.length === 0 || this.batchSubmitted) {
      return false;
    }
    const now = this.host.now();
    for (const index of this.batchIndexes()) {
      if (index < 0 || index >= this.questions.length) {
        continue;
      }
      const question = this.questions[index];
      const sessionKey = this.sessionKeyAt(index);
      if (sessionKey === null) {
        continue;
      }
      const userAnswer = this.draftAnswers.get(sessionKey) !== undefined ? this.draftAnswers.get(sessionKey) as string[] : [];
      const result = evaluateQuestion(question, userAnswer);
      const bank = this.bankForIndex(index);
      this.sessionResults.set(sessionKey, result.correct);
      this.answerResults.set(sessionKey,
        resultToStudyQuestionResult(result, bank !== null ? bank.id : null, bank !== null ? bank.name : null));
      this.applyResultEffects(bank, question, result, now);
    }
    this.batchSubmitted = true;
    this.index = this.batchStartIndex();
    this.restoreSelectionForCurrent();
    this.host.persist();
    return true;
  }

  isDraftAnswered(index: number): boolean {
    if (index < 0 || index >= this.questions.length) {
      return false;
    }
    const sessionKey = this.sessionKeyAt(index);
    if (sessionKey === null) {
      return false;
    }
    const draft = this.draftAnswers.get(sessionKey);
    return isUserAnswerComplete(this.questions[index],
      draft !== undefined ? draft : []);
  }

  resultCorrectAt(index: number): boolean | null {
    const sessionKey = this.sessionKeyAt(index);
    if (sessionKey === null) {
      return null;
    }
    const result = this.answerResults.get(sessionKey);
    return result !== undefined ? result.correct : null;
  }

  draftAnsweredCount(): number {
    const indexes = this.mode === PRACTICE_MODE_BATCH ? this.batchIndexes() : allIndexes(this.questions.length);
    let count = 0;
    for (const index of indexes) {
      if (this.isDraftAnswered(index)) {
        count += 1;
      }
    }
    return count;
  }

  answeredCount(): number {
    return this.sessionResults.size;
  }

  autoScoredCorrectCount(): number {
    let count = 0;
    for (const result of this.answerResults.values()) {
      if (result.autoScored && result.correct) {
        count += 1;
      }
    }
    return count;
  }

  unsubmittedQuestionIndexes(): number[] {
    if (this.mode === PRACTICE_MODE_BATCH) {
      return [];
    }
    const out: number[] = [];
    for (let index = 0; index < this.questions.length; index++) {
      const sessionKey = this.sessionKeyAt(index);
      if (sessionKey === null || !this.answerResults.has(sessionKey)) {
        out.push(index);
      }
    }
    return out;
  }

  submitUnansweredAsBlank(): number {
    if (this.mode === PRACTICE_MODE_BATCH || this.questions.length === 0) {
      return 0;
    }
    const unsubmitted = this.unsubmittedQuestionIndexes();
    if (unsubmitted.length === 0) {
      return 0;
    }
    const now = this.host.now();
    for (const index of unsubmitted) {
      const question = this.questions[index];
      const sessionKey = this.sessionKeyAt(index);
      if (sessionKey === null) {
        continue;
      }
      const result = evaluateQuestion(question, []);
      const bank = this.bankForIndex(index);
      this.sessionResults.set(sessionKey, result.correct);
      this.answerResults.set(sessionKey,
        resultToStudyQuestionResult(result, bank !== null ? bank.id : null, bank !== null ? bank.name : null));
      this.applyResultEffects(bank, question, result, now);
    }
    this.restoreSelectionForCurrent();
    this.host.persist();
    return unsubmitted.length;
  }

  // ---------- 批量分组 ----------

  batchStartIndex(): number {
    if (this.questions.length === 0) {
      return 0;
    }
    return coerceIn(this.batchGroupStartIndex, 0, this.questions.length - 1);
  }

  batchEndIndex(): number {
    if (this.questions.length === 0) {
      return 0;
    }
    return Math.min(this.batchStartIndex() + this.batchGroupSize - 1, this.questions.length - 1);
  }

  batchIndexes(): number[] {
    const out: number[] = [];
    if (this.questions.length === 0) {
      return out;
    }
    for (let i = this.batchStartIndex(); i <= this.batchEndIndex(); i++) {
      out.push(i);
    }
    return out;
  }

  batchGroupNumber(): number {
    if (this.questions.length === 0) {
      return 0;
    }
    return Math.floor(this.batchStartIndex() / this.batchGroupSize) + 1;
  }

  batchGroupCount(): number {
    if (this.questions.length === 0) {
      return 0;
    }
    return Math.ceil(this.questions.length / this.batchGroupSize);
  }

  canStartNextBatchGroup(): boolean {
    return this.mode === PRACTICE_MODE_BATCH && this.batchSubmitted && this.batchEndIndex() < this.questions.length - 1;
  }

  startNextBatchGroup(): boolean {
    if (!this.canStartNextBatchGroup()) {
      return false;
    }
    this.batchGroupStartIndex = this.batchEndIndex() + 1;
    this.index = this.batchGroupStartIndex;
    this.selectedAnswer = [];
    this.lastResult = null;
    this.batchSubmitted = false;
    this.restoreSelectionForCurrent();
    return true;
  }

  isAllBatchGroupsSubmitted(): boolean {
    if (this.mode !== PRACTICE_MODE_BATCH || !this.batchSubmitted) {
      return false;
    }
    if (this.batchEndIndex() < this.questions.length - 1) {
      return false;
    }
    for (let index = 0; index < this.questions.length; index++) {
      const sessionKey = this.sessionKeyAt(index);
      if (sessionKey !== null && !this.answerResults.has(sessionKey)) {
        return false;
      }
    }
    return true;
  }

  // ---------- 斩题 / 收藏 ----------

  canSlashCurrent(slashEnabled: boolean): boolean {
    if (!slashEnabled || this.currentQuestion() === null) {
      return false;
    }
    return this.sourceLabel !== '错题本' && this.sourceLabel !== '今日复习' && this.sourceLabel !== '收藏夹';
  }

  slashCurrent(): boolean {
    const question = this.currentQuestion();
    if (question === null) {
      return false;
    }
    const bank = this.bankForIndex(this.index);
    if (bank === null) {
      return false;
    }
    const key = questionKeyOf(question);
    const now = this.host.now();
    const slashed = this.host.slashedQuestions();
    if (!slashed.some((entry): boolean => entry.bankId === bank.id && entry.questionKey === key)) {
      slashed.unshift(new SlashedQuestionEntry(bank.id, key, now));
    }
    const currentIndex = this.index;
    const currentSessionKey = this.sessionKeyAt(currentIndex);
    this.questions.splice(currentIndex, 1);
    this.questionSessionKeys.splice(currentIndex, 1);
    if (currentSessionKey !== null) {
      this.sessionResults.delete(currentSessionKey);
      this.answerResults.delete(currentSessionKey);
      this.draftAnswers.delete(currentSessionKey);
      this.questionBankIds.delete(currentSessionKey);
    }
    this.lastResult = null;
    this.selectedAnswer = [];
    if (this.questions.length === 0) {
      this.index = 0;
      this.batchSubmitted = false;
      this.batchGroupStartIndex = 0;
    } else {
      this.index = Math.min(currentIndex, this.questions.length - 1);
      if (this.mode === PRACTICE_MODE_BATCH) {
        this.batchGroupStartIndex = Math.min(this.batchGroupStartIndex, this.questions.length - 1);
        if (this.index < this.batchStartIndex()) {
          this.index = this.batchStartIndex();
        }
        if (this.index > this.batchEndIndex()) {
          this.index = this.batchEndIndex();
        }
      }
      this.restoreSelectionForCurrent();
    }
    this.host.persist();
    return true;
  }

  bankForQuestion(question: Question): QuizBank | null {
    let index = -1;
    for (let i = 0; i < this.questions.length; i++) {
      if (this.questions[i] === question) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      index = this.questions.findIndex((item): boolean => questionEquals(item, question));
    }
    return index >= 0 ? this.bankForIndex(index) : this.activeBank();
  }

  isCurrentFavorited(): boolean {
    const question = this.currentQuestion();
    if (question === null) {
      return false;
    }
    const bank = this.bankForQuestion(question);
    if (bank === null) {
      return false;
    }
    return this.host.favoriteQuestions().some((entry): boolean => entry.bankId === bank.id && entry.question.id === question.id);
  }

  toggleCurrentFavorite(): boolean {
    const question = this.currentQuestion();
    if (question === null) {
      return false;
    }
    const bank = this.bankForQuestion(question);
    if (bank === null) {
      return false;
    }
    const favorites = this.host.favoriteQuestions();
    const index = favorites.findIndex((entry): boolean => entry.bankId === bank.id && entry.question.id === question.id);
    if (index >= 0) {
      favorites.splice(index, 1);
    } else {
      favorites.unshift(new FavoriteQuestionEntry(bank.id, bank.name, question, this.host.now()));
    }
    this.host.persist();
    return true;
  }

  // ---------- 快速编辑 ----------

  updateCurrentQuestion(updated: Question): boolean {
    const current = this.currentQuestion();
    if (current === null) {
      return false;
    }
    const targetBank = this.bankForQuestion(current);
    if (targetBank === null) {
      return false;
    }
    const questionIndex = targetBank.questions.findIndex((item): boolean => item.id === current.id);
    if (questionIndex < 0) {
      return false;
    }
    updated.id = current.id;
    updated.number = current.number;
    updated.type = current.type;
    updated.category = current.category;
    updated.images = current.images;
    updated.score = current.score;
    const sanitizedUpdated = sanitizeQuestion(updated);
    targetBank.questions[questionIndex] = sanitizedUpdated;
    const currentIndex = coerceIn(this.index, 0, this.questions.length - 1);
    this.questions[currentIndex] = sanitizedUpdated;
    const currentSessionKey = this.sessionKeyAt(currentIndex);
    const mappedBankId = currentSessionKey !== null && this.questionBankIds.get(currentSessionKey) !== undefined
      ? this.questionBankIds.get(currentSessionKey) as string
      : targetBank.id;
    const wrongBook = this.host.wrongBook();
    for (let i = 0; i < wrongBook.length; i++) {
      const entry = wrongBook[i];
      if (entry.bankId === mappedBankId && entry.question.id === current.id) {
        entry.bankName = targetBank.name;
        entry.question = sanitizedUpdated;
      }
    }
    const favorites = this.host.favoriteQuestions();
    for (let i = 0; i < favorites.length; i++) {
      const entry = favorites[i];
      if (entry.bankId === mappedBankId && entry.question.id === current.id) {
        entry.bankName = targetBank.name;
        entry.question = sanitizedUpdated;
      }
    }
    if (currentSessionKey !== null) {
      this.sessionResults.delete(currentSessionKey);
      this.answerResults.delete(currentSessionKey);
      this.draftAnswers.delete(currentSessionKey);
    }
    if (this.lastResult !== null && this.lastResult.question.id === current.id) {
      this.lastResult = null;
    }
    this.selectedAnswer = [];
    this.host.persist();
    return true;
  }

  // ---------- 会话收尾 ----------

  completeSession(): void {
    this.finishSessionIfNeeded(true);
    this.resetState();
  }

  endSession(): void {
    this.finishSessionIfNeeded(false);
    this.resetState();
  }

  canSaveSequentialProgressOnExit(reciteEnabled: boolean): boolean {
    return this.questions.length > 0 && this.sequentialBankId !== null && this.sequentialStartIndex !== null && !reciteEnabled;
  }

  endSessionSavingSequentialProgress(reciteEnabled: boolean): void {
    const progressSaved = this.saveSequentialProgressForExit(reciteEnabled);
    this.finishSessionIfNeeded(false);
    this.resetState();
    if (progressSaved) {
      this.host.persist();
    }
  }

  private saveSequentialProgressForExit(reciteEnabled: boolean): boolean {
    const bankId = this.sequentialBankId;
    const startIndex = this.sequentialStartIndex;
    if (bankId === null || startIndex === null || reciteEnabled || this.questions.length === 0) {
      return false;
    }
    let targetInCurrentSession: number;
    if (this.mode === PRACTICE_MODE_BATCH) {
      if (this.batchSubmitted) {
        targetInCurrentSession = Math.min(this.batchEndIndex() + 1, this.questions.length);
      } else {
        targetInCurrentSession = this.batchStartIndex();
      }
    } else {
      const currentIndex = coerceIn(this.index, 0, this.questions.length - 1);
      const sessionKey = this.sessionKeyAt(currentIndex);
      const currentSubmitted = sessionKey !== null && this.answerResults.has(sessionKey);
      targetInCurrentSession = currentSubmitted ? Math.min(currentIndex + 1, this.questions.length) : currentIndex;
    }
    let nextProgressIndex: number;
    if (targetInCurrentSession >= this.questions.length) {
      nextProgressIndex = this.sequentialNextIndexAfterComplete !== null
        ? this.sequentialNextIndexAfterComplete
        : startIndex + this.questions.length;
    } else {
      nextProgressIndex = startIndex + targetInCurrentSession;
    }
    this.host.setSequentialProgress(bankId, Math.max(0, nextProgressIndex));
    return true;
  }

  private finishSessionIfNeeded(advanceSequentialProgress: boolean): void {
    if (this.questions.length === 0 || this.answerResults.size === 0) {
      return;
    }
    const now = this.host.now();
    const startedAt = this.startedAt !== null ? this.startedAt : now;
    const orderedResults: StudyQuestionResult[] = [];
    for (let index = 0; index < this.questions.length; index++) {
      const sessionKey = this.sessionKeyAt(index);
      const result = sessionKey !== null ? this.answerResults.get(sessionKey) : undefined;
      if (result !== undefined) {
        orderedResults.push(result);
      }
    }
    if (orderedResults.length === 0) {
      return;
    }
    let correctCount = 0;
    for (const result of orderedResults) {
      if (result.autoScored && result.correct) {
        correctCount += 1;
      }
    }
    const involvedBankIds: string[] = [];
    for (const key of this.questionSessionKeys) {
      const bankId = this.questionBankIds.get(key);
      if (bankId !== undefined && !involvedBankIds.includes(bankId)) {
        involvedBankIds.push(bankId);
      }
    }
    let recordBank: QuizBank | null = null;
    if (involvedBankIds.length === 1) {
      for (const bank of this.host.banks()) {
        if (bank.id === involvedBankIds[0]) {
          recordBank = bank;
          break;
        }
      }
    }
    const recordSource = this.currentWrongSource();
    const record = new StudyRecord(`practice_${now}`,
      recordBank !== null ? recordBank.name : (this.sessionScopeName !== null ? this.sessionScopeName : (this.sourceLabel.length > 0 ? this.sourceLabel : '未命名题库')),
      recordSource,
      this.sourceLabel.length > 0 ? this.sourceLabel : '练习记录',
      orderedResults.length, correctCount, now);
    record.bankId = recordBank !== null ? recordBank.id : null;
    record.durationSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    record.startedAt = startedAt;
    record.questionResults = orderedResults;
    record.scopeType = this.sessionScopeType;
    record.scopeName = this.sessionScopeName;
    this.host.addRecord(record);
    if (advanceSequentialProgress) {
      this.advanceSequentialProgressAfterComplete();
    }
    this.host.persist();
  }

  private advanceSequentialProgressAfterComplete(): void {
    if (this.sequentialBankId === null || this.sequentialNextIndexAfterComplete === null) {
      return;
    }
    this.host.setSequentialProgress(this.sequentialBankId, Math.max(0, this.sequentialNextIndexAfterComplete));
  }

  resetState(): void {
    this.questions = [];
    this.sourceLabel = '当前题库';
    this.index = 0;
    this.selectedAnswer = [];
    this.lastResult = null;
    this.mode = PRACTICE_MODE_INSTANT;
    this.batchSubmitted = false;
    this.batchGroupSize = 10;
    this.batchGroupStartIndex = 0;
    this.sessionResults.clear();
    this.answerResults.clear();
    this.draftAnswers.clear();
    this.questionBankIds.clear();
    this.questionSessionKeys = [];
    this.optionShuffleSeed = this.host.now();
    this.startedAt = null;
    this.sessionScopeType = null;
    this.sessionScopeName = null;
    this.sequentialBankId = null;
    this.sequentialStartIndex = null;
    this.sequentialNextIndexAfterComplete = null;
  }

  private restoreSelectionForCurrent(): void {
    const question = this.currentQuestion();
    if (question === null) {
      this.selectedAnswer = [];
      this.lastResult = null;
      return;
    }
    const sessionKey = this.currentSessionKey();
    if (this.mode === PRACTICE_MODE_BATCH && !this.batchSubmitted) {
      const draft = sessionKey !== null ? this.draftAnswers.get(sessionKey) : undefined;
      this.selectedAnswer = draft !== undefined ? draft : [];
      this.lastResult = null;
      return;
    }
    const result = sessionKey !== null ? this.answerResults.get(sessionKey) : undefined;
    this.selectedAnswer = result !== undefined ? result.userAnswer : [];
    if (this.mode === PRACTICE_MODE_BATCH && this.batchSubmitted && result !== undefined) {
      this.lastResult = new QuestionCheckResult(question, result.userAnswer, result.correct, result.answerText, result.autoScored);
      this.lastResult.userBlankAnswers = result.userBlankAnswers.slice();
    } else {
      this.lastResult = null;
    }
  }
}

function buildSessionKeys(items: PracticeQuestionSource[]): string[] {
  const occurrences = new Map<string, number>();
  const keys: string[] = [];
  for (const item of items) {
    const base = `${item.bankId}#${item.question.id}`;
    const occurrence = occurrences.get(base) !== undefined ? occurrences.get(base) as number : 0;
    occurrences.set(base, occurrence + 1);
    keys.push(occurrence === 0 ? base : `${base}#${occurrence}`);
  }
  return keys;
}

function allIndexes(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i);
  }
  return out;
}

function questionEquals(a: Question, b: Question): boolean {
  return a.id === b.id && a.type === b.type && a.question === b.question;
}

/** 题池源（不含已斩题），等价 Android activePracticePoolSources（单库作用域版本） */
export function bankPoolSources(bank: QuizBank, isSlashed: (bankId: string, question: Question) => boolean): PracticeQuestionSource[] {
  const out: PracticeQuestionSource[] = [];
  for (const question of bank.questions) {
    if (!isSlashed(bank.id, question)) {
      out.push(new PracticeQuestionSource(bank.id, bank.name, normalizeBankGroupName(bank.groupName), question));
    }
  }
  return out;
}

export { DEFAULT_BANK_GROUP_NAME };
