/**
 * 错题本写入与复习推进 — 移植自 Android QuizRepository.addWrongQuestion / markWrongQuestionRight
 * 及智能复习排期（nextReviewLevelAfterCorrect / nextReviewTimeForLevel / nextDayStart）。
 * M5 补充：作用域过滤 / 到期判定 / 手动掌握（markWrongQuestionMastered）/ 今日复习排序。纯数组变换，Node 可测。
 */
import { Question, QuizBank, WrongQuestionEntry, WrongStatus, DEFAULT_BANK_GROUP_NAME } from '../domain/Models';

const DAY_MILLIS = 24 * 60 * 60 * 1000;

export const WRONG_BOOK_SCOPE_CURRENT_BANK = 'current_bank';
export const WRONG_BOOK_SCOPE_ALL_BANKS = 'all_banks';
export const WRONG_BOOK_SCOPE_GROUP = 'group';
export const WRONG_BOOK_SCOPE_BANK = 'bank';

export const WRONG_SORT_RECENT = 'recent_wrong';
export const WRONG_SORT_COUNT = 'wrong_count';
export const WRONG_SORT_MASTERY = 'mastery';

export const WRONG_FILTER_NOT_MASTERED = 'not_mastered';
export const WRONG_FILTER_MASTERED = 'mastered';
export const WRONG_FILTER_ALL = 'all';

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

// ---------- M5：作用域 / 到期 / 手动掌握（等价 Android wrongBookEntriesForCurrentScope 等） ----------

/** 作用域过滤。GROUP 空名或未分组、BANK 空 id 时回退全部（对齐 Android）；CURRENT_BANK 无当前库返回空。 */
export function filterWrongEntriesByScope(
  entries: WrongQuestionEntry[],
  banks: QuizBank[],
  activeBankId: string | null,
  mode: string,
  groupName: string,
  bankId: string
): WrongQuestionEntry[] {
  if (mode === WRONG_BOOK_SCOPE_CURRENT_BANK) {
    if (activeBankId === null) {
      return [];
    }
    return entries.filter((entry): boolean => entry.bankId === activeBankId);
  }
  if (mode === WRONG_BOOK_SCOPE_GROUP) {
    const group = groupName.trim().length > 0 ? groupName.trim() : DEFAULT_BANK_GROUP_NAME;
    if (group === DEFAULT_BANK_GROUP_NAME) {
      return entries.slice();
    }
    const ids = new Set<string>();
    for (const bank of banks) {
      if (bank.groupName === group) {
        ids.add(bank.id);
      }
    }
    return entries.filter((entry): boolean => ids.has(entry.bankId));
  }
  if (mode === WRONG_BOOK_SCOPE_BANK) {
    if (bankId.length === 0) {
      return entries.slice();
    }
    return entries.filter((entry): boolean => entry.bankId === bankId);
  }
  return entries.slice();
}

export function wrongBookScopeLabel(
  banks: QuizBank[],
  activeBankName: string | null,
  mode: string,
  groupName: string,
  bankId: string
): string {
  if (mode === WRONG_BOOK_SCOPE_CURRENT_BANK) {
    return '当前题库';
  }
  if (mode === WRONG_BOOK_SCOPE_GROUP) {
    return groupName.trim().length > 0 ? groupName.trim() : '分组';
  }
  if (mode === WRONG_BOOK_SCOPE_BANK) {
    const found = banks.find((bank): boolean => bank.id === bankId);
    return found !== undefined ? found.name : '题库';
  }
  return '全部题库';
}

/** 到期判定：nextReviewAt 为空时，已掌握不到期，其余按当日零点计（必然已到期）。 */
export function isWrongEntryDueForSmartReview(entry: WrongQuestionEntry, now: number): boolean {
  if (entry.nextReviewAt === null) {
    return entry.status !== WrongStatus.MASTERED;
  }
  return entry.nextReviewAt <= now;
}

/** 今日复习排序：未掌握在前 → nextReviewAt 升序 → wrongCount 降序 → lastWrongAt 降序。 */
export function sortTodaySmartReviewEntries(entries: WrongQuestionEntry[]): WrongQuestionEntry[] {
  const sorted = entries.slice();
  sorted.sort((a: WrongQuestionEntry, b: WrongQuestionEntry): number => {
    const rankA = a.status === WrongStatus.MASTERED ? 1 : 0;
    const rankB = b.status === WrongStatus.MASTERED ? 1 : 0;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const dueA = a.nextReviewAt !== null ? a.nextReviewAt : 0;
    const dueB = b.nextReviewAt !== null ? b.nextReviewAt : 0;
    if (dueA !== dueB) {
      return dueA - dueB;
    }
    if (a.wrongCount !== b.wrongCount) {
      return b.wrongCount - a.wrongCount;
    }
    return b.lastWrongAt - a.lastWrongAt;
  });
  return sorted;
}

/** 列表排序：最近错 / 错误次数 / 掌握程度。 */
export function sortWrongEntries(entries: WrongQuestionEntry[], sort: string): WrongQuestionEntry[] {
  const sorted = entries.slice();
  if (sort === WRONG_SORT_COUNT) {
    sorted.sort((a: WrongQuestionEntry, b: WrongQuestionEntry): number =>
      a.wrongCount !== b.wrongCount ? b.wrongCount - a.wrongCount : b.lastWrongAt - a.lastWrongAt);
  } else if (sort === WRONG_SORT_MASTERY) {
    sorted.sort((a: WrongQuestionEntry, b: WrongQuestionEntry): number => {
      const rankA = a.status === WrongStatus.MASTERED ? 1 : 0;
      const rankB = b.status === WrongStatus.MASTERED ? 1 : 0;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return b.wrongCount - a.wrongCount;
    });
  } else {
    sorted.sort((a: WrongQuestionEntry, b: WrongQuestionEntry): number => b.lastWrongAt - a.lastWrongAt);
  }
  return sorted;
}

/** 手动掌握/取消掌握。等价 Android markWrongQuestionMastered；返回是否发生变更。 */
export function applyManualMastered(
  wrongBook: WrongQuestionEntry[],
  bankId: string,
  questionId: string,
  mastered: boolean,
  now: number
): boolean {
  const index = wrongBook.findIndex((entry): boolean => entry.bankId === bankId && entry.question.id === questionId);
  if (index < 0) {
    return false;
  }
  const current = wrongBook[index];
  const updated = new WrongQuestionEntry(current.bankId, current.bankName, current.question,
    current.lastAnswer.slice(), current.source, current.timestamp);
  updated.wrongCount = current.wrongCount;
  updated.rightCount = current.rightCount;
  updated.reviewRightCount = current.reviewRightCount;
  updated.lastWrongAt = current.lastWrongAt;
  if (mastered) {
    const level = Math.max(2, current.reviewLevel);
    updated.streakCorrectCount = Math.max(2, current.streakCorrectCount);
    updated.lastCorrectAt = now;
    updated.status = WrongStatus.MASTERED;
    updated.reviewLevel = level;
    updated.nextReviewAt = nextReviewTimeForLevel(now, level);
  } else {
    updated.streakCorrectCount = 0;
    updated.lastCorrectAt = current.lastCorrectAt;
    updated.status = WrongStatus.NOT_MASTERED;
    updated.reviewLevel = 0;
    updated.nextReviewAt = startOfDay(now);
  }
  updated.lastReviewedAt = now;
  wrongBook[index] = updated;
  return true;
}
