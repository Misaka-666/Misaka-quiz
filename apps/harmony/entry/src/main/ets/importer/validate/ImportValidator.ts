/**
 * 导入校验 — 1:1 移植自 Android ImportValidator.kt。
 */
import { Question, QuestionType, Option } from '../../domain/Models';
import { ImportWarning, WarningLevel } from '../model/ImportModels';
import { hasStructuredAnswers, countExplicitBlanks } from '../model/MultiBlankSupport';
import { containsMarker } from '../assets/QuestionImageMarker';

export function validate(questions: Question[]): ImportWarning[] {
  const warnings: ImportWarning[] = [];

  for (const question of questions) {
    for (const message of question.warnings) {
      warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, message));
    }
    if (question.question.trim().length === 0) {
      warnings.push(new ImportWarning(WarningLevel.ERROR, question.number, '题干为空'));
    }

    if (question.type === QuestionType.SINGLE) {
      if (question.options.length < 2 && !isImageChoiceQuestion(question)) {
        warnings.push(new ImportWarning(WarningLevel.ERROR, question.number, '单选题缺少足够选项'));
      }
      if (question.answer.length === 0) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '单选题未识别到答案'));
      }
      if (question.answer.length > 1) {
        warnings.push(new ImportWarning(WarningLevel.ERROR, question.number, '单选题出现多个答案'));
      }
      validateChoiceAnswer(question, warnings);
    } else if (question.type === QuestionType.MULTIPLE) {
      if (question.options.length < 2 && !isImageChoiceQuestion(question)) {
        warnings.push(new ImportWarning(WarningLevel.ERROR, question.number, '多选题缺少足够选项'));
      }
      if (question.answer.length === 0) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '多选题未识别到答案'));
      }
      validateChoiceAnswer(question, warnings);
    } else if (question.type === QuestionType.JUDGE) {
      if (question.options.length < 2) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '判断题缺少对/错选项，已尝试自动补全'));
      }
      if (question.answer.length === 0) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '判断题未识别到答案'));
      }
      if (question.answer.some((a: string): boolean => a !== 'A' && a !== 'B')) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '判断题答案不是标准对/错标记'));
      }
    } else if (question.type === QuestionType.BLANK) {
      if (hasStructuredAnswers(question)) {
        const detectedCount = countExplicitBlanks(question.question);
        if (detectedCount > 0 && detectedCount !== question.blankAnswers.length) {
          warnings.push(new ImportWarning(
            WarningLevel.WARNING,
            question.number,
            `题干检测到${detectedCount}个题空，当前配置了${question.blankAnswers.length}组答案，请人工核对`
          ));
        }
        if (question.blankAnswers.some((group: string[]): boolean =>
          group.every((v: string): boolean => v.trim().length === 0))) {
          warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '多空填空题存在未配置答案的题空'));
        }
      } else if (question.answer.length === 0) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '主观题未识别到参考答案'));
      }
    } else if (question.type === QuestionType.SHORT) {
      if (question.answer.length === 0) {
        warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '主观题未识别到参考答案'));
      }
    }
  }

  return warnings;
}

function isImageChoiceQuestion(question: Question): boolean {
  if (question.images.length > 0) return true;
  if (containsMarker(question.question)) return true;
  if (containsMarker(question.analysis)) return true;
  return question.options.some((o: Option): boolean => containsMarker(o.text));
}

function validateChoiceAnswer(question: Question, warnings: ImportWarning[]): void {
  if (question.answer.length === 0 || question.options.length === 0) return;
  const keys = question.options.map((o: Option): string => o.key);
  const invalid = question.answer.filter((a: string): boolean => !keys.includes(a));
  if (invalid.length > 0) {
    warnings.push(new ImportWarning(WarningLevel.WARNING, question.number, '答案选项不在当前题目选项范围内'));
  }
}
