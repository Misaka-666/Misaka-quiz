/**
 * 导入结果模型 — 1:1 移植自 Android ImportModels.kt 的非 Question 部分
 * （Question/Option/QuestionImage/QuestionType 直接复用 domain/Models）。
 */
import { Question } from '../../domain/Models';

export class WarningLevel {
  static readonly NORMAL: string = 'NORMAL';
  static readonly WARNING: string = 'WARNING';
  static readonly ERROR: string = 'ERROR';
}

export class ImportWarning {
  level: string;
  questionNumber: string | null;
  message: string;
  constructor(level: string, questionNumber: string | null, message: string) {
    this.level = level;
    this.questionNumber = questionNumber;
    this.message = message;
  }
}

export class ImportDiagnostics {
  normalizedLength: number;
  blockCount: number;
  answeredCount: number;
  candidateCount: number;
  notes: string[];
  constructor() {
    this.normalizedLength = 0;
    this.blockCount = 0;
    this.answeredCount = 0;
    this.candidateCount = 0;
    this.notes = [];
  }
}

export class ImportResult {
  questions: Question[];
  strategyName: string;
  warnings: ImportWarning[];
  diagnostics: ImportDiagnostics;
  constructor(questions: Question[], strategyName: string, warnings: ImportWarning[], diagnostics: ImportDiagnostics) {
    this.questions = questions;
    this.strategyName = strategyName;
    this.warnings = warnings;
    this.diagnostics = diagnostics;
  }
}
