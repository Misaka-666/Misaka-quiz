import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { FileStore } from './FileStore';
import {
  QuizBank, Question, QuestionType, Option, WrongQuestionEntry, SlashedQuestionEntry,
  FavoriteQuestionEntry, StudyRecord, DEFAULT_BANK_GROUP_NAME, normalizeBankGroupName,
  bankToJson, parseBank, wrongEntryToJson, parseWrongEntry, slashedEntryToJson,
  parseSlashedEntry, favoriteEntryToJson, parseFavoriteEntry, studyRecordToJson,
  parseStudyRecord
} from '../domain/Models';

const STATE_DIR = 'misaka';
const STATE_FILE = `${STATE_DIR}/state.json`;

// Array.isArray 在 ArkTS 中收窄为 any[]，统一经此转为 Object[] 再逐项判型
function toJsonArray(value: Object | undefined): Object[] {
  if (value === undefined || value === null || !Array.isArray(value)) {
    return [];
  }
  const arr: Object[] = [];
  for (let i = 0; i < value.length; i++) {
    arr.push(value[i] as Object);
  }
  return arr;
}

function isJsonObject(value: Object | undefined): boolean {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 全局状态仓 — 移植自 Android QuizRepository（M1 骨架：加载/持久化/题库 CRUD）。
 * 练习考试会话、错题逻辑、收藏交互等随 M4/M5 移植补充。
 * Android 端用 SharedPreferences 存大 JSON；鸿蒙端为规避 preferences 单值容量限制，
 * 状态整体存 filesDir/misaka/state.json（字段结构与 Android 各 key 的 JSON 完全一致）。
 */
export class QuizRepository {
  private static instance: QuizRepository | null = null;

  private context: common.UIAbilityContext | null = null;
  banks: QuizBank[] = [];
  activeBankId: string = '';
  wrongBook: WrongQuestionEntry[] = [];
  slashedQuestions: SlashedQuestionEntry[] = [];
  favoriteQuestions: FavoriteQuestionEntry[] = [];
  studyRecords: StudyRecord[] = [];
  practiceSequentialProgress: Record<string, number> = {};

  static getInstance(): QuizRepository {
    if (QuizRepository.instance === null) {
      QuizRepository.instance = new QuizRepository();
    }
    return QuizRepository.instance;
  }

  init(context: common.UIAbilityContext): void {
    this.context = context;
    const state = FileStore.readJson(context.filesDir, STATE_FILE);
    if (state !== null) {
      this.loadFromState(state);
    }
  }

  private loadFromState(state: Record<string, Object>): void {
    for (const raw of toJsonArray(state['banks'])) {
      if (isJsonObject(raw)) {
        this.banks.push(parseBank(raw));
      }
    }
    this.activeBankId = typeof state['activeBankId'] === 'string' ? state['activeBankId'] as string : '';
    for (const raw of toJsonArray(state['wrongBook'])) {
      if (isJsonObject(raw)) {
        const entry = parseWrongEntry(raw);
        if (entry !== null) {
          this.wrongBook.push(entry);
        }
      }
    }
    for (const raw of toJsonArray(state['slashedQuestions'])) {
      if (isJsonObject(raw)) {
        this.slashedQuestions.push(parseSlashedEntry(raw));
      }
    }
    for (const raw of toJsonArray(state['favoriteQuestions'])) {
      if (isJsonObject(raw)) {
        const entry = parseFavoriteEntry(raw);
        if (entry !== null) {
          this.favoriteQuestions.push(entry);
        }
      }
    }
    for (const raw of toJsonArray(state['studyRecords'])) {
      if (isJsonObject(raw)) {
        const record = parseStudyRecord(raw);
        if (record !== null) {
          this.studyRecords.push(record);
        }
      }
    }
    const rawProgress = state['practiceSequentialProgress'];
    if (isJsonObject(rawProgress)) {
      const pm = rawProgress as Record<string, Object>;
      for (const key of Object.keys(pm)) {
        const value = pm[key];
        if (typeof value === 'number' && value >= 0) {
          this.practiceSequentialProgress[key] = value;
        }
      }
    }
    if (this.activeBankId.length === 0 && this.banks.length > 0) {
      this.activeBankId = this.banks[0].id;
    }
  }

  persist(): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    const banks: Object[] = [];
    for (const bank of this.banks) {
      banks.push(bankToJson(bank));
    }
    const wrongBook: Object[] = [];
    for (const entry of this.wrongBook) {
      wrongBook.push(wrongEntryToJson(entry));
    }
    const slashed: Object[] = [];
    for (const entry of this.slashedQuestions) {
      slashed.push(slashedEntryToJson(entry));
    }
    const favorites: Object[] = [];
    for (const entry of this.favoriteQuestions) {
      favorites.push(favoriteEntryToJson(entry));
    }
    const records: Object[] = [];
    for (const record of this.studyRecords) {
      records.push(studyRecordToJson(record));
    }
    const progress: Record<string, Object> = {};
    for (const key of Object.keys(this.practiceSequentialProgress)) {
      const value = this.practiceSequentialProgress[key];
      if (key.length > 0 && value >= 0) {
        progress[key] = value;
      }
    }
    const state: Record<string, Object> = {
      'banks': banks,
      'activeBankId': this.activeBankId,
      'wrongBook': wrongBook,
      'slashedQuestions': slashed,
      'favoriteQuestions': favorites,
      'studyRecords': records,
      'practiceSequentialProgress': progress
    };
    FileStore.writeTextAtomic(context.filesDir, STATE_FILE, JSON.stringify(state));
  }

  // ---------- 题库 CRUD ----------

  importBank(name: string, groupName: string, questions: Question[]): QuizBank {
    const bank = new QuizBank(util.generateRandomUUID(true), name, normalizeBankGroupName(groupName));
    bank.questions = questions;
    this.banks.push(bank);
    if (this.activeBankId.length === 0) {
      this.activeBankId = bank.id;
    }
    this.persist();
    return bank;
  }

  deleteBank(bankId: string): void {
    const index = this.banks.findIndex((bank: QuizBank): boolean => bank.id === bankId);
    if (index >= 0) {
      this.banks.splice(index, 1);
    }
    if (this.activeBankId === bankId) {
      this.activeBankId = this.banks.length > 0 ? this.banks[0].id : '';
    }
    this.persist();
  }

  renameBank(bankId: string, newName: string): boolean {
    const bank = this.banks.find((b: QuizBank): boolean => b.id === bankId);
    if (bank === undefined) {
      return false;
    }
    bank.name = newName;
    this.persist();
    return true;
  }

  setActiveBank(bankId: string): void {
    this.activeBankId = bankId;
    this.persist();
  }

  activeBank(): QuizBank | null {
    const found = this.banks.find((bank: QuizBank): boolean => bank.id === this.activeBankId);
    return found !== undefined ? found : (this.banks.length > 0 ? this.banks[0] : null);
  }

  totalQuestionCount(): number {
    let total = 0;
    for (const bank of this.banks) {
      total += bank.questions.length;
    }
    return total;
  }

  // 供 M1 设备自检：生成两道示例题并入库
  createDemoBank(): void {
    const q1 = new Question(util.generateRandomUUID(true), QuestionType.SINGLE, 'HarmonyOS 的应用开发语言是？');
    q1.options = [new Option('A', 'ArkTS'), new Option('B', 'Java')];
    q1.answer = ['A'];
    q1.analysis = 'ArkTS 是 HarmonyOS 主推的应用开发语言。';
    const q2 = new Question(util.generateRandomUUID(true), QuestionType.JUDGE, 'Misaka Quiz 已在鸿蒙端跑通领域层持久化。');
    q2.options = [new Option('A', '正确'), new Option('B', '错误')];
    q2.answer = ['A'];
    this.importBank('M1 自检题库', DEFAULT_BANK_GROUP_NAME, [q1, q2]);
  }
}
