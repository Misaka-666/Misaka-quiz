/**
 * 错题本写入与复习推进 — 移植自 Android QuizRepository.addWrongQuestion / markWrongQuestionRight
 * 及智能复习排期（nextReviewLevelAfterCorrect / nextReviewTimeForLevel / nextDayStart）。
 * 纯数组变换，Node 可测。
 */
import { Question, QuizBank, WrongQuestionEntry, WrongStatus } from '../domain/Models';

const DAY_MILLIS = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

function nextDayStart(timestamp: number): number {
  return startOfDay(timestamp) + DAY_MILLIS;
}

function isWrongEntryMastered(reviewRightCount: number, streakCorrectCount: number): boolean {
  return streakCorrectCount >= 2;
}

function nextReviewLevelAfterCorrect(entry: WrongQuestionEntry, mastered: boolean): number {
  if (mastered) {
    return Math.min(5, Math.max(2, Math.max(1, entry.reviewLevel) + 1));
  }
  return 1;
}

function nextReviewTimeForLevel(now: number, level: number): number {
  let days = 30;
  const clamped = Math.max(0, level);
  if (clamped <= 1) {
    days = 1;
  } else if (clamped === 2) {
    days = 3;
  } else if (clamped === 3) {
    days = 7;
  } else if (clamped === 4) {
    days = 15;
  }
  return startOfDay(now) + days * DAY_MILLIS;
}

export function questionKeyOf(question: Question): string {
  if (question.id.length > 0) {
    return question.id;
  }
  const parts: string[] = [
    question.type,
    question.question.trim(),
    question.options.map((option): string => `${option.key}:${option.text}`).join('|'),
    question.answer.join('|'),
    question.blankAnswers.map((blanks): string => blanks.join('|')).join('||')
  ];
  return parts.join('#').toLowerCase();
}

/** 答错入库 / 复位复习进度。等价 Android addWrongQuestion。 */
export function applyWrongAnswer(
  wrongBook: WrongQuestionEntry[],
  bank: QuizBank | null,
  question: Question,
  userAnswer: string[],
  source: string,
  now: number
): void {
  if (bank === null) {
    return;
  }
  const index = wrongBook.findIndex((entry): boolean => entry.bankId === bank.id && entry.question.id === question.id);
  if (index >= 0) {
    const current = wrongBook[index];
    const updated = new WrongQuestionEntry(current.bankId, bank.name, question, userAnswer.slice(), source, now);
    updated.wrongCount = current.wrongCount + 1;
    updated.rightCount = current.rightCount;
    updated.reviewRightCount = 0;
    updated.streakCorrectCount = 0;
    updated.lastWrongAt = now;
    updated.lastCorrectAt = current.lastCorrectAt;
    updated.status = WrongStatus.NOT_MASTERED;
    updated.lastReviewedAt = now;
    updated.nextReviewAt = nextDayStart(now);
    updated.reviewLevel = 0;
    wrongBook[index] = updated;
  } else {
    const entry = new WrongQuestionEntry(bank.id, bank.name, question, userAnswer.slice(), source, now);
    entry.status = WrongStatus.NOT_MASTERED;
    entry.nextReviewAt = nextDayStart(now);
    wrongBook.unshift(entry);
  }
}

/** 答对推进复习（连续 2 次判掌握）。等价 Android markWrongQuestionRight。 */
export function applyWrongRight(
  wrongBook: WrongQuestionEntry[],
  bank: QuizBank | null,
  question: Question,
  now: number
): void {
  if (bank === null) {
    return;
  }
  const index = wrongBook.findIndex((entry): boolean => entry.bankId === bank.id && entry.question.id === question.id);
  if (index < 0) {
    return;
  }
  const current = wrongBook[index];
  const nextReviewRightCount = current.reviewRightCount + 1;
  const nextStreakCorrectCount = current.streakCorrectCount + 1;
  const mastered = isWrongEntryMastered(nextReviewRightCount, nextStreakCorrectCount);
  const updated = new WrongQuestionEntry(current.bankId, current.bankName, question, current.lastAnswer.slice(),
    current.source, now);
  updated.wrongCount = current.wrongCount;
  updated.rightCount = current.rightCount + 1;
  updated.reviewRightCount = nextReviewRightCount;
  updated.streakCorrectCount = nextStreakCorrectCount;
  updated.lastWrongAt = current.lastWrongAt;
  updated.lastCorrectAt = now;
  updated.status = mastered ? WrongStatus.MASTERED : WrongStatus.REVIEWING;
  updated.lastReviewedAt = now;
  updated.reviewLevel = nextReviewLevelAfterCorrect(current, mastered);
  updated.nextReviewAt = nextReviewTimeForLevel(now, updated.reviewLevel);
  wrongBook[index] = updated;
}
