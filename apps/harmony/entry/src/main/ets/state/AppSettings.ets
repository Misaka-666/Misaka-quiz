import { SettingsStore } from './SettingsStore';
import { QuestionType } from '../domain/Models';

/**
 * 应用设置 — 1:1 对应 Android QuizRepository 的偏好字段（键名/默认值一致）。
 * 读在启动时一次完成（getSync），写经 SettingsStore.put 异步落盘。
 * 与 state.json（大数据）分离：这里只有轻量键值。
 */

// 设置键（与 Android KEY_* 常量一致，跨端备份互通）
export const KEY_PRACTICE_NEXT_REQUIRES_RESULT = 'practice_next_requires_result';
export const KEY_REMEMBER_PRACTICE_SETTINGS = 'remember_practice_settings';
export const KEY_SWIPE_NAVIGATION_ENABLED = 'swipe_navigation_enabled';
export const KEY_PRACTICE_AUTO_SUBMIT_ENABLED = 'practice_auto_submit_enabled';
export const KEY_PRACTICE_AUTO_NEXT_ENABLED = 'practice_auto_next_enabled';
export const KEY_PRACTICE_BATCH_AUTO_NEXT_ENABLED = 'practice_batch_auto_next_enabled';
export const KEY_PRACTICE_INLINE_ANSWER_SETTINGS_ENABLED = 'practice_inline_answer_settings_enabled';
export const KEY_PRACTICE_RECITE_MODE_ENABLED = 'practice_recite_mode_enabled';
export const KEY_PRACTICE_SLASH_ENABLED = 'practice_slash_enabled';
export const KEY_PRACTICE_QUICK_EDIT_ENABLED = 'practice_quick_edit_enabled';
export const KEY_PRACTICE_OPTION_SHUFFLE_ENABLED = 'practice_option_shuffle_enabled';
export const KEY_EXAM_OPTION_SHUFFLE_ENABLED = 'exam_option_shuffle_enabled';
export const KEY_PRACTICE_PREFERRED_COUNT_MODE = 'practice_preferred_count_mode';
export const KEY_PRACTICE_PREFERRED_CUSTOM_COUNT = 'practice_preferred_custom_count';
export const KEY_PRACTICE_PREFERRED_ORDER_MODE = 'practice_preferred_order_mode';
export const KEY_PRACTICE_PREFERRED_TYPE_NAMES = 'practice_preferred_type_names';
export const KEY_PRACTICE_PREFERRED_MODE = 'practice_preferred_mode';
export const KEY_PRACTICE_PREFERRED_BATCH_SIZE_MODE = 'practice_preferred_batch_size_mode';
export const KEY_PRACTICE_PREFERRED_BATCH_CUSTOM_SIZE = 'practice_preferred_batch_custom_size';
export const KEY_REMEMBER_EXAM_SETTINGS = 'remember_exam_settings';
export const KEY_EXAM_PREFERRED_COUNT_MODE = 'exam_preferred_count_mode';
export const KEY_EXAM_PREFERRED_CUSTOM_COUNT = 'exam_preferred_custom_count';
export const KEY_EXAM_PREFERRED_DURATION_MINUTES = 'exam_preferred_duration_minutes';
export const KEY_EXAM_PREFERRED_GROUP_MODE = 'exam_preferred_group_mode';
export const KEY_EXAM_PREFERRED_TYPE_COUNTS = 'exam_preferred_type_counts';
export const KEY_EXAM_PREFERRED_TYPE_SCORES = 'exam_preferred_type_scores';
export const KEY_QUESTION_FONT_SIZE_MODE = 'question_font_size_mode';
export const KEY_OPTION_FONT_SIZE_MODE = 'option_font_size_mode';
export const KEY_COMPACT_OPTIONS_ENABLED = 'compact_options_enabled';
export const KEY_WRONG_BOOK_SMART_REVIEW_ENABLED = 'wrong_book_smart_review_enabled';
export const KEY_WRONG_BOOK_SCOPE_MODE = 'wrong_book_scope_mode';
export const KEY_WRONG_BOOK_SCOPE_GROUP_NAME = 'wrong_book_scope_group_name';
export const KEY_WRONG_BOOK_SCOPE_BANK_ID = 'wrong_book_scope_bank_id';

export function normalizeWrongBookScopeMode(mode: string): string {
  if (mode === 'current_bank' || mode === 'group' || mode === 'bank') {
    return mode;
  }
  return 'all_banks';
}

export function normalizePracticeCountMode(mode: string): string {
  if (mode === '50' || mode === '100' || mode === 'half' || mode === 'all') {
    return mode;
  }
  return 'custom';
}

export function normalizeExamCountMode(mode: string): string {
  if (mode === '50' || mode === '100' || mode === 'all') {
    return mode;
  }
  return 'custom';
}

export function normalizePracticeOrderMode(mode: string): string {
  return mode === 'ordered' ? 'ordered' : 'random';
}

export function normalizePracticeBatchSizeMode(mode: string): string {
  return mode === '20' || mode === 'custom' ? mode : '10';
}

export function resolveBatchGroupSize(mode: string, customSize: number): number {
  if (mode === '20') {
    return 20;
  }
  if (mode === 'custom') {
    return Math.max(1, customSize);
  }
  return 10;
}

const TYPE_NAMES: string[] = [
  QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT
];

function encodeTypeTextMap(values: Map<string, string>): string {
  const parts: string[] = [];
  for (const type of TYPE_NAMES) {
    const value = values.get(type);
    if (value !== undefined) {
      parts.push(`${type}=${value.trim()}`);
    }
  }
  return parts.join(';');
}

function decodeTypeTextMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  if (text.trim().length === 0) {
    return map;
  }
  for (const part of text.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return map;
}

export class AppSettings {
  practiceNextRequiresResult = false;
  rememberPracticeSettingsEnabled = true;
  swipeNavigationEnabled = true;
  practiceAutoSubmitEnabled = true;
  practiceAutoNextEnabled = false;
  practiceBatchAutoNextEnabled = false;
  practiceInlineAnswerSettingsEnabled = false;
  practiceReciteModeEnabled = false;
  practiceSlashEnabled = false;
  practiceQuickEditEnabled = false;
  practiceOptionShuffleEnabled = false;
  examOptionShuffleEnabled = false;
  preferredPracticeQuestionCountMode = 'custom';
  preferredPracticeCustomQuestionCount = 20;
  preferredPracticeOrderMode = 'random';
  preferredPracticeTypeNames = '';
  preferredPracticeMode = 'instant_feedback';
  preferredPracticeBatchSizeMode = '10';
  preferredPracticeBatchCustomSize = 10;
  rememberExamSettingsEnabled = true;
  preferredExamQuestionCountMode = '100';
  preferredExamCustomQuestionCount = 20;
  preferredExamDurationMinutes = 30;
  preferredExamGroupMode = 'random';
  private preferredExamTypeCountsText = '';
  private preferredExamTypeScoresText = '';
  questionFontSizeMode = 'standard';
  optionFontSizeMode = 'standard';
  compactOptionsEnabled = false;
  wrongBookSmartReviewEnabled = false;
  wrongBookScopeMode = 'all_banks';
  wrongBookScopeGroupName = '';
  wrongBookScopeBankId = '';

  static load(): AppSettings {
    const s = new AppSettings();
    s.practiceNextRequiresResult = SettingsStore.getBool(KEY_PRACTICE_NEXT_REQUIRES_RESULT, false);
    s.rememberPracticeSettingsEnabled = SettingsStore.getBool(KEY_REMEMBER_PRACTICE_SETTINGS, true);
    s.swipeNavigationEnabled = SettingsStore.getBool(KEY_SWIPE_NAVIGATION_ENABLED, true);
    s.practiceAutoSubmitEnabled = SettingsStore.getBool(KEY_PRACTICE_AUTO_SUBMIT_ENABLED, true);
    s.practiceAutoNextEnabled = SettingsStore.getBool(KEY_PRACTICE_AUTO_NEXT_ENABLED, false);
    s.practiceBatchAutoNextEnabled = SettingsStore.getBool(KEY_PRACTICE_BATCH_AUTO_NEXT_ENABLED, false);
    s.practiceInlineAnswerSettingsEnabled = SettingsStore.getBool(KEY_PRACTICE_INLINE_ANSWER_SETTINGS_ENABLED, false);
    s.practiceReciteModeEnabled = SettingsStore.getBool(KEY_PRACTICE_RECITE_MODE_ENABLED, false);
    s.practiceSlashEnabled = SettingsStore.getBool(KEY_PRACTICE_SLASH_ENABLED, false);
    s.practiceQuickEditEnabled = SettingsStore.getBool(KEY_PRACTICE_QUICK_EDIT_ENABLED, false);
    s.practiceOptionShuffleEnabled = SettingsStore.getBool(KEY_PRACTICE_OPTION_SHUFFLE_ENABLED, false);
    s.examOptionShuffleEnabled = SettingsStore.getBool(KEY_EXAM_OPTION_SHUFFLE_ENABLED, false);
    s.preferredPracticeQuestionCountMode = normalizePracticeCountMode(
      SettingsStore.getString(KEY_PRACTICE_PREFERRED_COUNT_MODE, 'custom'));
    s.preferredPracticeCustomQuestionCount = Math.max(1,
      SettingsStore.getNumber(KEY_PRACTICE_PREFERRED_CUSTOM_COUNT, 20));
    s.preferredPracticeOrderMode = normalizePracticeOrderMode(
      SettingsStore.getString(KEY_PRACTICE_PREFERRED_ORDER_MODE, 'random'));
    s.preferredPracticeTypeNames = SettingsStore.getString(KEY_PRACTICE_PREFERRED_TYPE_NAMES, '');
    s.preferredPracticeMode = SettingsStore.getString(KEY_PRACTICE_PREFERRED_MODE, 'instant_feedback');
    s.preferredPracticeBatchSizeMode = normalizePracticeBatchSizeMode(
      SettingsStore.getString(KEY_PRACTICE_PREFERRED_BATCH_SIZE_MODE, '10'));
    s.preferredPracticeBatchCustomSize = Math.max(1,
      SettingsStore.getNumber(KEY_PRACTICE_PREFERRED_BATCH_CUSTOM_SIZE, 10));
    s.rememberExamSettingsEnabled = SettingsStore.getBool(KEY_REMEMBER_EXAM_SETTINGS, true);
    s.preferredExamQuestionCountMode = normalizeExamCountMode(
      SettingsStore.getString(KEY_EXAM_PREFERRED_COUNT_MODE, '100'));
    s.preferredExamCustomQuestionCount = Math.max(1,
      SettingsStore.getNumber(KEY_EXAM_PREFERRED_CUSTOM_COUNT, 20));
    s.preferredExamDurationMinutes = Math.min(999, Math.max(1,
      SettingsStore.getNumber(KEY_EXAM_PREFERRED_DURATION_MINUTES, 30)));
    s.preferredExamGroupMode = SettingsStore.getString(KEY_EXAM_PREFERRED_GROUP_MODE, 'random');
    s.preferredExamTypeCountsText = SettingsStore.getString(KEY_EXAM_PREFERRED_TYPE_COUNTS, '');
    s.preferredExamTypeScoresText = SettingsStore.getString(KEY_EXAM_PREFERRED_TYPE_SCORES, '');
    s.questionFontSizeMode = SettingsStore.getString(KEY_QUESTION_FONT_SIZE_MODE, 'standard');
    s.optionFontSizeMode = SettingsStore.getString(KEY_OPTION_FONT_SIZE_MODE, 'standard');
    s.compactOptionsEnabled = SettingsStore.getBool(KEY_COMPACT_OPTIONS_ENABLED, false);
    s.wrongBookSmartReviewEnabled = SettingsStore.getBool(KEY_WRONG_BOOK_SMART_REVIEW_ENABLED, false);
    s.wrongBookScopeMode = normalizeWrongBookScopeMode(
      SettingsStore.getString(KEY_WRONG_BOOK_SCOPE_MODE, 'all_banks'));
    s.wrongBookScopeGroupName = SettingsStore.getString(KEY_WRONG_BOOK_SCOPE_GROUP_NAME, '');
    s.wrongBookScopeBankId = SettingsStore.getString(KEY_WRONG_BOOK_SCOPE_BANK_ID, '');
    return s;
  }

  // ---------- 字号（对齐 Android questionFontSizeSp/optionFontSizeSp） ----------

  questionFontSizeSp(): number {
    if (this.questionFontSizeMode === 'small') {
      return 18;
    }
    if (this.questionFontSizeMode === 'large') {
      return 26;
    }
    return 22;
  }

  questionLineHeightSp(): number {
    if (this.questionFontSizeMode === 'small') {
      return 25;
    }
    if (this.questionFontSizeMode === 'large') {
      return 34;
    }
    return 29;
  }

  optionFontSizeSp(): number {
    if (this.optionFontSizeMode === 'small') {
      return 14;
    }
    if (this.optionFontSizeMode === 'large') {
      return 19;
    }
    return 16;
  }

  optionLineHeightSp(): number {
    if (this.optionFontSizeMode === 'small') {
      return 19;
    }
    if (this.optionFontSizeMode === 'large') {
      return 25;
    }
    return 21;
  }

  // ---------- 练习偏好 ----------

  preferredPracticeTypes(): string[] {
    const names = this.preferredPracticeTypeNames.split(',').map((s): string => s.trim()).filter((s): boolean => s.length > 0);
    return names.filter((name): boolean => TYPE_NAMES.includes(name));
  }

  rememberPracticeTypes(types: string[]): void {
    this.preferredPracticeTypeNames = types.slice().sort().join(',');
  }

  resolvePreferredBatchGroupSize(): number {
    return resolveBatchGroupSize(this.preferredPracticeBatchSizeMode, this.preferredPracticeBatchCustomSize);
  }

  // ---------- 考试偏好 ----------

  preferredExamTypeCounts(available: Map<string, number>): Map<string, number> {
    const saved = decodeTypeTextMap(this.preferredExamTypeCountsText);
    const out = new Map<string, number>();
    for (const type of TYPE_NAMES) {
      const max = available.get(type) !== undefined ? available.get(type) as number : 0;
      const raw = saved.get(type);
      let count = 0;
      if (raw !== undefined && !Number.isNaN(Number(raw))) {
        count = Math.min(Math.max(Number(raw), 0), max);
      }
      out.set(type, count);
    }
    return out;
  }

  preferredExamTypeScores(): Map<string, number> {
    const defaults = new Map<string, number>();
    defaults.set(QuestionType.SINGLE, 1.0);
    defaults.set(QuestionType.MULTIPLE, 2.0);
    defaults.set(QuestionType.JUDGE, 1.0);
    defaults.set(QuestionType.BLANK, 2.0);
    defaults.set(QuestionType.SHORT, 5.0);
    const saved = decodeTypeTextMap(this.preferredExamTypeScoresText);
    const out = new Map<string, number>();
    for (const type of TYPE_NAMES) {
      const raw = saved.get(type);
      const value = raw !== undefined && !Number.isNaN(Number(raw)) ? Number(raw) : defaults.get(type) as number;
      out.set(type, value);
    }
    return out;
  }

  rememberExamTypeCounts(counts: Map<string, number>): void {
    const texts = new Map<string, string>();
    for (const key of counts.keys()) {
      texts.set(key, String(counts.get(key) as number));
    }
    this.preferredExamTypeCountsText = encodeTypeTextMap(texts);
  }

  encodedExamTypeCountsText(): string {
    return this.preferredExamTypeCountsText;
  }

  encodedExamTypeScoresText(): string {
    return this.preferredExamTypeScoresText;
  }

  rememberExamTypeScores(scores: Map<string, number>): void {
    const texts = new Map<string, string>();
    for (const key of scores.keys()) {
      texts.set(key, String(scores.get(key) as number));
    }
    this.preferredExamTypeScoresText = encodeTypeTextMap(texts);
  }

  // ---------- 落盘 ----------

  async putBool(key: string, value: boolean): Promise<void> {
    await SettingsStore.put(key, value);
  }

  async putString(key: string, value: string): Promise<void> {
    await SettingsStore.put(key, value);
  }

  async putNumber(key: string, value: number): Promise<void> {
    await SettingsStore.put(key, value);
  }
}
