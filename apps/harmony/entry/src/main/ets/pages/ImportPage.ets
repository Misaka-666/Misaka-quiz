/**
 * M3 导入面板：文件选择/粘贴文本 → 解码 → 解析 → 预览与手动修正 → 入库。
 * 文件解码走 importer/ImportDecoder.ets，解析走 importer/parser/QuizImportParser.ts，
 * 图片绑定走 importer/assets/QuestionImageBinder.ts。
 * M4 起作为 Index「导入」tab 的内嵌组件（无 @Entry，不占路由栈）。
 */
import { picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { decodeImportFile, readUriBytes, baseNameOf, ImportedContent } from '../importer/ImportDecoder';
import { parseStandardText, parseDualText } from '../importer/parser/QuizImportParser';
import { attachImages } from '../importer/assets/QuestionImageBinder';
import { ImportResult, ImportWarning } from '../importer/model/ImportModels';
import { Question, QuestionType, DEFAULT_BANK_GROUP_NAME } from '../domain/Models';
import { QuizRepository } from '../state/QuizRepository';
import { MisakaAiClient } from '../ai/MisakaAiClient';
import { AiReviewSuggestion, AiStreamCallback } from '../ai/AiTypes';
import { parseAnalysisSuggestions } from '../ai/AiCodec';
import {
  aiSuggestionsForQuestion, canApplyAiSuggestion, isHardErrorAiSuggestion, isActionableAiSuggestion,
  mergeAiReviewSuggestions, shouldApplyAiAnalysis, applyAiAnalysisSuggestion, applyAiReviewSuggestion,
  aiSuggestionApplySummary, suggestedTypeLabel
} from '../ai/AiSuggestions';
import { MisakaColors, PillButton, InfoNotice } from './common/QuizWidgets';

const TYPE_LABELS: Record<string, string> = {
  'SINGLE': '单选', 'MULTIPLE': '多选', 'JUDGE': '判断', 'BLANK': '填空', 'SHORT': '简答'
};

class SecondFilePayload {
  bytes: ArrayBuffer;
  fileName: string;
  constructor(bytes: ArrayBuffer, fileName: string) {
    this.bytes = bytes;
    this.fileName = fileName;
  }
}

@Component
export struct ImportPage {
  @State bankName: string = '';
  @State statusText: string = '选择 docx / xlsx / txt 文件，或粘贴题目文本';
  @State busy: boolean = false;
  @State result: ImportResult | null = null;
  @State pasteText: string = '';
  @State showPaste: boolean = false;
  @State editingIndex: number = -1;
  @State editStem: string = '';
  @State editAnswer: string = '';
  @State editAnalysis: string = '';
  @State editTypeIndex: number = 0;
  // M8 AI 核对/补解析/重构状态
  @State aiSuggestions: AiReviewSuggestion[] = [];
  @State aiReviewedIds: string[] = [];
  @State aiAnalyzedIds: string[] = [];
  @State aiAnalysisAppliedIds: string[] = [];
  @State aiBusy: boolean = false;
  @State editAiBusy: boolean = false;
  @State editAiStream: string = '';
  @State editAiError: string = '';
  @State editAiSuggestion: string = '';
  private sourceText: string = '';
  private answerText: string = '';
  private typeOrder: string[] = [QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT];

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  private typeBadgeColor(type: string): ResourceColor {
    if (type === QuestionType.SINGLE) {
      return MisakaColors.PRIMARY;
    }
    if (type === QuestionType.MULTIPLE) {
      return MisakaColors.ACCENT_PURPLE;
    }
    if (type === QuestionType.JUDGE) {
      return MisakaColors.GREEN;
    }
    if (type === QuestionType.BLANK) {
      return MisakaColors.WARN;
    }
    return MisakaColors.TEXT_TERTIARY;
  }

  private async importFromBytes(bytes: ArrayBuffer, fileName: string, second?: SecondFilePayload): Promise<void> {
    const outcome = await decodeImportFile(this.context(), bytes, fileName);
    if (!outcome.ok || outcome.content === null) {
      this.statusText = outcome.userMessage.length > 0
        ? `${outcome.userMessage}${outcome.technicalMessage.length > 0 ? `（${outcome.technicalMessage}）` : ''}`
        : '文件解码失败';
      this.result = null;
      return;
    }
    if (second !== undefined) {
      const secondOutcome = await decodeImportFile(this.context(), second.bytes, second.fileName);
      if (!secondOutcome.ok || secondOutcome.content === null) {
        this.statusText = secondOutcome.userMessage.length > 0 ? secondOutcome.userMessage : '答案文件解码失败';
        return;
      }
      this.runParse(outcome.content, secondOutcome.content);
      return;
    }
    this.runParse(outcome.content, null);
  }

  private runParse(content: ImportedContent, answers: ImportedContent | null): void {
    this.sourceText = content.text;
    this.answerText = answers !== null ? answers.text : '';
    this.resetAiState();
    const parsed = answers !== null
      ? parseDualText(content.text, answers.text)
      : parseStandardText(content.text);
    const bound = attachImages(parsed, content.images);
    this.result = bound;
    const answered = bound.questions.filter((q: Question): boolean => q.answer.length > 0).length;
    this.statusText = `${bound.strategyName}：${bound.questions.length} 题 / 已识别答案 ${answered} 题` +
      ` / 图片 ${content.images.length} 张`;
    if (this.bankName.length === 0) {
      this.bankName = '导入题库';
    }
  }

  private resetAiState(): void {
    this.aiSuggestions = [];
    this.aiReviewedIds = [];
    this.aiAnalyzedIds = [];
    this.aiAnalysisAppliedIds = [];
  }

  private repo(): QuizRepository {
    return QuizRepository.getInstance();
  }

  /** 异常题：导入警告命中的题（ponytail: 警告只带题号，按题号匹配；无题号的警告无法归属） */
  private anomalyQuestions(): Question[] {
    if (this.result === null) {
      return [];
    }
    const numbers = new Set<string>();
    for (const warning of this.result.warnings) {
      if (warning.questionNumber !== null && warning.questionNumber.trim().length > 0) {
        numbers.add(warning.questionNumber.trim());
      }
    }
    if (numbers.size === 0) {
      return [];
    }
    return this.result.questions.filter((q: Question): boolean =>
      q.number.trim().length > 0 && numbers.has(q.number.trim()));
  }

  private applyQuestions(next: Question[]): void {
    if (this.result === null) {
      return;
    }
    this.result = new ImportResult(next, this.result.strategyName, this.result.warnings,
      this.result.diagnostics);
  }

  private runAiReview(): void {
    const repo = this.repo();
    if (this.result === null || this.result.questions.length === 0 || this.aiBusy) {
      return;
    }
    if (!repo.isAiConfigured()) {
      this.statusText = 'AI 核对：请先在「我的 → AI 设置」中配置接口。';
      return;
    }
    if (!repo.settings.aiReviewEnabled) {
      this.statusText = 'AI 核对未启用，请先在「我的 → AI 设置」中开启。';
      return;
    }
    const base = repo.settings.aiOnlyAnomaly ? this.anomalyQuestions() : this.result.questions;
    const reviewed = new Set<string>(this.aiReviewedIds);
    const remaining = base.filter((q: Question): boolean => !reviewed.has(q.id));
    const limited = remaining.slice(0, repo.settings.aiMaxQuestions);
    if (base.length === 0) {
      this.statusText = repo.settings.aiOnlyAnomaly
        ? 'AI 核对：当前开启了仅处理异常题，但没有可核对的异常题。'
        : 'AI 核对：当前没有可供核对的题目。';
      return;
    }
    if (limited.length === 0) {
      this.statusText = 'AI 核对：当前范围已全部处理。如需重新核对，请重新解析题库或切换处理范围。';
      return;
    }
    this.aiBusy = true;
    this.statusText = `AI 核对中：本次处理 ${limited.length} 题（累计 ${this.aiReviewedIds.length + limited.length}/${base.length}）。`;
    MisakaAiClient.reviewQuestions(repo.settings.aiApiBaseUrl, repo.settings.aiApiKey,
      repo.settings.aiModelName, limited, repo.settings.aiTimeoutSeconds)
      .then((suggestions: AiReviewSuggestion[]): void => {
        this.aiSuggestions = mergeAiReviewSuggestions(this.aiSuggestions, suggestions,
          limited.map((q: Question): string => q.id));
        this.aiReviewedIds = this.aiReviewedIds.concat(limited.map((q: Question): string => q.id));
        const actionable = suggestions.filter(isActionableAiSuggestion).length;
        const reviewedTotal = this.aiReviewedIds.length;
        this.statusText = actionable === 0
          ? `AI 核对完成：本批未发现重点问题，已处理 ${reviewedTotal}/${base.length} 题。`
          : `AI 核对完成：本批生成 ${this.aiSuggestions.length} 条待确认建议，已处理 ${reviewedTotal}/${base.length} 题。`;
        this.aiBusy = false;
      })
      .catch((err: Error): void => {
        this.statusText = `AI 核对失败：${err.message.length > 0 ? err.message : '请检查接口配置'}`;
        this.aiBusy = false;
      });
  }

  private runAiAnalysis(): void {
    const repo = this.repo();
    if (this.result === null || this.result.questions.length === 0 || this.aiBusy) {
      return;
    }
    if (!repo.isAiConfigured()) {
      this.statusText = 'AI 解析：请先在「我的 → AI 设置」中配置接口。';
      return;
    }
    if (!repo.settings.aiAnalysisEnabled) {
      this.statusText = 'AI 解析未启用，请先在「我的 → AI 设置」中开启。';
      return;
    }
    const allTargets = this.result.questions.filter(shouldApplyAiAnalysis);
    if (allTargets.length === 0) {
      this.statusText = 'AI 解析：当前没有缺少解析或解析过短的题目。';
      return;
    }
    const analyzed = new Set<string>(this.aiAnalyzedIds);
    const anomalyTargets = this.anomalyQuestions().filter(shouldApplyAiAnalysis);
    const useAnomaly = repo.settings.aiOnlyAnomaly && anomalyTargets.length > 0;
    const pool = useAnomaly ? anomalyTargets : allTargets;
    const remaining = pool.filter((q: Question): boolean => !analyzed.has(q.id));
    if (remaining.length === 0) {
      this.statusText = 'AI 解析：当前缺解析题已全部尝试。若仍有题目缺解析，可重新解析题库或调整单次题数后重试。';
      return;
    }
    const targets = remaining.slice(0, repo.settings.aiMaxQuestions);
    this.aiBusy = true;
    this.statusText = `AI 解析中：本次处理 ${targets.length} 道缺解析题（累计 ${this.aiAnalyzedIds.length + targets.length}/${pool.length}）。`;
    MisakaAiClient.generateAnalysis(repo.settings.aiApiBaseUrl, repo.settings.aiApiKey,
      repo.settings.aiModelName, targets, repo.settings.aiTimeoutSeconds)
      .then((suggestions): void => {
        const byId = new Map<string, string>();
        for (const item of suggestions) {
          byId.set(item.questionId, item.analysis);
        }
        const appliedIds: string[] = [];
        const next = this.result?.questions.map((q: Question): Question => {
          const text = byId.get(q.id);
          if (text !== undefined && text.trim().length > 0 && shouldApplyAiAnalysis(q)) {
            appliedIds.push(q.id);
            return applyAiAnalysisSuggestion(q, text);
          }
          return q;
        }) ?? [];
        this.applyQuestions(next);
        this.aiAnalyzedIds = this.aiAnalyzedIds.concat(targets.map((q: Question): string => q.id));
        this.aiAnalysisAppliedIds = this.aiAnalysisAppliedIds.concat(appliedIds);
        this.statusText = appliedIds.length === 0
          ? 'AI 解析完成：本批没有可写入的解析建议。'
          : `AI 解析完成：已为 ${appliedIds.length} 道题写入待核对解析，保存前请人工确认。`;
        this.aiBusy = false;
      })
      .catch((err: Error): void => {
        this.statusText = `AI 解析失败：${err.message.length > 0 ? err.message : '请检查接口配置'}`;
        this.aiBusy = false;
      });
  }

  private runAiRefactor(): void {
    const repo = this.repo();
    if (this.aiBusy) {
      return;
    }
    if (this.sourceText.trim().length === 0) {
      this.statusText = 'AI 重构：当前没有可用的原始文本（需从文件或粘贴解析后使用）。';
      return;
    }
    if (!repo.isAiConfigured()) {
      this.statusText = 'AI 重构：请先在「我的 → AI 设置」中配置并开启。';
      return;
    }
    if (!repo.settings.aiRefactorEnabled) {
      this.statusText = 'AI 重构未启用，请先在「我的 → AI 设置」中开启。';
      return;
    }
    const sourceLength = this.sourceText.length;
    if (sourceLength > repo.settings.aiRefactorMaxChars) {
      this.statusText = `AI 重构：原文约 ${sourceLength} 字，超过当前上限 ${repo.settings.aiRefactorMaxChars} 字。请在 AI 设置中调大上限，或拆分题库后处理。`;
      return;
    }
    this.aiBusy = true;
    const beforeCount = this.result !== null ? this.result.questions.length : 0;
    MisakaAiClient.refactorQuestions(repo.settings.aiApiBaseUrl, repo.settings.aiApiKey,
      repo.settings.aiModelName, this.sourceText, this.answerText,
      this.result !== null ? this.result.questions : [], this.result !== null ? this.result.warnings.map((w: ImportWarning): string => w.message) : [],
      repo.settings.aiTimeoutSeconds)
      .then((refactor): void => {
        let reparsed: ImportResult | null = null;
        if (refactor.cleanedText !== null && refactor.cleanedText.trim().length > 0) {
          const parsed = parseStandardText(refactor.cleanedText);
          if (parsed.questions.length > 0) {
            reparsed = new ImportResult(parsed.questions, `${parsed.strategyName} + AI重构`,
              parsed.warnings, parsed.diagnostics);
          }
        }
        if (reparsed !== null) {
          this.sourceText = refactor.cleanedText ?? this.sourceText;
          this.result = reparsed;
          this.resetAiState();
          this.statusText = `AI 重构完成：由 ${beforeCount} 题重整为 ${reparsed.questions.length} 题。请先人工核对，再继续 AI 核对或 AI 解析。`;
        } else if (refactor.questions.length > 0) {
          this.applyQuestions(refactor.questions);
          this.resetAiState();
          this.statusText = `AI 重构完成（direct_questions）：由 ${beforeCount} 题重整为 ${refactor.questions.length} 题。请人工核对后再保存。`;
        } else {
          this.statusText = 'AI 重构完成但没有返回可用清洗文本或题目，当前待核对结果未改动。';
        }
        if (refactor.notes.length > 0) {
          this.statusText += ` 说明：${refactor.notes.slice(0, 2).join('；')}`;
        }
        this.aiBusy = false;
      })
      .catch((err: Error): void => {
        this.statusText = `AI 重构失败：${err.message.length > 0 ? err.message : '请检查接口配置'}`;
        this.aiBusy = false;
      });
  }

  private applySuggestion(question: Question, suggestion: AiReviewSuggestion): void {
    if (this.result === null) {
      return;
    }
    const next = this.result.questions.map((q: Question): Question =>
      q.id === question.id ? applyAiReviewSuggestion(q, suggestion) : q);
    this.applyQuestions(next);
    this.aiSuggestions = this.aiSuggestions.filter((s: AiReviewSuggestion): boolean => s.questionId !== suggestion.questionId);
  }

  // 编辑器内 AI 补解析（对齐 Android AiAnalysisFillPanel：流式生成 → 采纳写入编辑框）
  private runEditorAiAnalysis(): void {
    const repo = this.repo();
    if (this.editAiBusy) {
      return;
    }
    if (!repo.isAiConfigured()) {
      this.editAiError = '请先在「我的 → AI 设置」中配置接口。';
      return;
    }
    const stem = this.editStem.trim();
    const answerRaw = this.editAnswer.replace(/[，,\s]+/g, '、');
    const answers = answerRaw.trim().length > 0
      ? answerRaw.split('、').filter((s: string): boolean => s.length > 0) : [];
    if (stem.length === 0) {
      this.editAiError = '请先填写题干，再生成解析。';
      return;
    }
    if (answers.length === 0) {
      this.editAiError = '请先填写答案，再生成解析。';
      return;
    }
    const draft = new Question('editor-draft', this.typeOrder[this.editTypeIndex] ?? QuestionType.SINGLE, stem);
    draft.answer = answers;
    this.editAiBusy = true;
    this.editAiError = '';
    this.editAiSuggestion = '';
    this.editAiStream = '';
    MisakaAiClient.generateAnalysisStreaming(repo.settings.aiApiBaseUrl, repo.settings.aiApiKey,
      repo.settings.aiModelName, [draft],
      new AiStreamCallback((): void => {}, (cumulative: string): void => {
        this.editAiStream = cumulative;
      }, (_full: string): void => {}),
      repo.settings.aiTimeoutSeconds)
      .then((full: string): void => {
        const parsed = parseAnalysisSuggestions(full);
        const text = parsed.length > 0 ? parsed[0].analysis.trim() : '';
        if (text.length === 0) {
          this.editAiError = 'AI 没有返回可用解析。';
        } else {
          this.editAiSuggestion = text;
        }
        this.editAiBusy = false;
      })
      .catch((err: Error): void => {
        this.editAiError = err.message.length > 0 ? err.message : '请检查接口配置或网络。';
        this.editAiBusy = false;
      });
  }

  private async pickFiles(): Promise<void> {
    this.busy = true;
    this.statusText = '选择文件…';
    try {
      const docPicker = new picker.DocumentViewPicker(this.context());
      const options: picker.DocumentSelectOptions = {
        fileSuffixFilters: ['.txt', '.json', '.docx', '.doc', '.xlsx', '.xls', '.csv'],
        maxSelectNumber: 2
      };
      const uris: string[] = await docPicker.select(options);
      if (uris.length === 0) {
        this.statusText = '未选择文件';
        this.busy = false;
        return;
      }
      const firstBytes = readUriBytes(uris[0]);
      if (firstBytes === null) {
        this.statusText = '文件读取失败';
        this.busy = false;
        return;
      }
      if (uris.length >= 2) {
        const secondBytes = readUriBytes(uris[1]);
        if (secondBytes !== null) {
          this.statusText = '双文件导入：第 1 个为题目文件，第 2 个为答案文件…';
          await this.importFromBytes(firstBytes, baseNameOf(uris[0]),
            new SecondFilePayload(secondBytes, baseNameOf(uris[1])));
          this.busy = false;
          return;
        }
      }
      await this.importFromBytes(firstBytes, baseNameOf(uris[0]));
    } catch (err) {
      this.statusText = `选择文件取消或失败：${err}`;
    }
    this.busy = false;
  }

  // 设备验证入口：直接读取打包在 rawfile 中的示例文件（不依赖文件选择与沙盒推送）
  private async importRawfile(rawfileName: string, displayName: string): Promise<void> {
    this.busy = true;
    try {
      const raw: Uint8Array = await this.context().resourceManager.getRawFileContent(rawfileName);
      const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      await this.importFromBytes(buffer, displayName);
    } catch (err) {
      this.statusText = `内置示例读取失败：${err}`;
    }
    this.busy = false;
  }

  private parsePasted(): void {
    if (this.pasteText.trim().length === 0) {
      this.statusText = '请先粘贴题目文本';
      return;
    }
    const content = new ImportedContent();
    content.text = this.pasteText;
    this.runParse(content, null);
  }

  private removeQuestion(index: number): void {
    if (this.result === null) {
      return;
    }
    const removed = this.result.questions[index];
    if (removed !== undefined && this.aiSuggestions.length > 0) {
      this.aiSuggestions = this.aiSuggestions.filter((s: AiReviewSuggestion): boolean => s.questionId !== removed.id);
    }
    const kept = this.result.questions.filter((_q: Question, i: number): boolean => i !== index);
    this.result = new ImportResult(kept, this.result.strategyName, this.result.warnings, this.result.diagnostics);
  }

  private openEditor(index: number): void {
    if (this.result === null) {
      return;
    }
    const q = this.result.questions[index];
    this.editingIndex = index;
    this.editStem = q.question;
    this.editAnswer = q.answer.join('、');
    this.editAnalysis = q.analysis;
    this.editTypeIndex = Math.max(0, this.typeOrder.indexOf(q.type));
    this.editAiBusy = false;
    this.editAiStream = '';
    this.editAiError = '';
    this.editAiSuggestion = '';
  }

  private applyEditor(): void {
    if (this.result === null || this.editingIndex < 0) {
      this.editingIndex = -1;
      return;
    }
    const q = this.result.questions[this.editingIndex];
    q.question = this.editStem.trim().length > 0 ? this.editStem : q.question;
    const answerRaw = this.editAnswer.replace(/[，,\s]+/g, '、');
    q.answer = answerRaw.trim().length > 0 ? answerRaw.split('、').filter((s: string): boolean => s.length > 0) : q.answer;
    q.analysis = this.editAnalysis;
    q.type = this.typeOrder[this.editTypeIndex] ?? q.type;
    this.editingIndex = -1;
    // 触发刷新
    this.result = new ImportResult(this.result.questions, this.result.strategyName, this.result.warnings, this.result.diagnostics);
  }

  private confirmImport(): void {
    if (this.result === null || this.result.questions.length === 0) {
      this.statusText = '没有可导入的题目';
      return;
    }
    const repo = QuizRepository.getInstance();
    const name = this.bankName.trim().length > 0 ? this.bankName.trim() : '导入题库';
    const bank = repo.importBank(name, DEFAULT_BANK_GROUP_NAME, this.result.questions);
    this.statusText = `已导入「${bank.name}」（${bank.questions.length} 题）`;
  }

  @Builder
  warningRow(warning: ImportWarning) {
    Row({ space: 6 }) {
      Text(warning.level === 'ERROR' ? '错误' : '警告')
        .fontSize(10)
        .fontColor(MisakaColors.ON_BRAND)
        .backgroundColor(warning.level === 'ERROR' ? MisakaColors.RED : MisakaColors.WARN)
        .borderRadius(4)
        .padding({ left: 5, right: 5, top: 1, bottom: 1 })
      Text(`${warning.questionNumber ?? ''} ${warning.message}`)
        .fontSize(11)
        .fontColor(MisakaColors.TEXT_TERTIARY)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  aiTagRow(q: Question) {
    // 状态标签行：AI已核对 / 未发现重点问题 / AI已补解析（对齐 Android importPreviewQuestionTags 的常用子集）
    Row({ space: 6 }) {
      if (this.aiAnalysisAppliedIds.indexOf(q.id) >= 0) {
        Text('AI已补解析')
          .fontSize(10)
          .fontColor(MisakaColors.GREEN)
          .backgroundColor(MisakaColors.GREEN_SOFT)
          .borderRadius(4)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
      }
      if (this.aiReviewedIds.indexOf(q.id) >= 0) {
        Text('AI已核对')
          .fontSize(10)
          .fontColor(MisakaColors.PRIMARY)
          .backgroundColor(MisakaColors.PRIMARY_SOFT)
          .borderRadius(4)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        if (aiSuggestionsForQuestion(q.id, this.aiSuggestions).length === 0) {
          Text('未发现重点问题')
            .fontSize(10)
            .fontColor(MisakaColors.TEXT_SUB)
            .backgroundColor(MisakaColors.MUTED)
            .borderRadius(4)
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        }
      }
      if (shouldApplyAiAnalysis(q)) {
        Text('缺/短解析')
          .fontSize(10)
          .fontColor(MisakaColors.AMBER)
          .backgroundColor(MisakaColors.AMBER_SOFT)
          .borderRadius(4)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
      }
    }
    .width('100%')
  }

  @Builder
  aiSuggestionCard(q: Question) {
    ForEach(aiSuggestionsForQuestion(q.id, this.aiSuggestions), (suggestion: AiReviewSuggestion) => {
      Column({ space: 6 }) {
        Row({ space: 6 }) {
          Text(isHardErrorAiSuggestion(suggestion) ? 'AI硬错误' : 'AI建议')
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(isHardErrorAiSuggestion(suggestion) ? MisakaColors.RED : MisakaColors.AMBER)
            .backgroundColor(isHardErrorAiSuggestion(suggestion) ? MisakaColors.RED_SOFT : MisakaColors.AMBER_SOFT)
            .borderRadius(4)
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          Text(suggestion.issueTypes.join('、').length > 0
            ? suggestion.issueTypes.join('、') : (suggestion.status === 'error' ? 'error' : 'warning'))
            .fontSize(11)
            .fontColor(MisakaColors.TEXT_TERTIARY)
          Blank()
          Text(suggestion.suggestedType !== null ? suggestedTypeLabel(suggestion.suggestedType ?? '') : '')
            .fontSize(11)
            .fontColor(MisakaColors.TEXT_TERTIARY)
        }
        .width('100%')
        if (suggestion.reason.length > 0) {
          Text(`原因：${suggestion.reason}`)
            .fontSize(12)
            .fontColor(MisakaColors.TEXT)
            .width('100%')
        }
        if (suggestion.suggestion.length > 0) {
          Text(`建议：${suggestion.suggestion}`)
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
            .width('100%')
        }
        Text(aiSuggestionApplySummary(suggestion).length > 0
          ? `${canApplyAiSuggestion(suggestion) ? '可采纳' : '建议内容'}：${aiSuggestionApplySummary(suggestion)}`
          : (canApplyAiSuggestion(suggestion) ? '可采纳' : '需人工确认'))
          .fontSize(12)
          .fontColor(canApplyAiSuggestion(suggestion) ? MisakaColors.PRIMARY : MisakaColors.TEXT_TERTIARY)
          .width('100%')
        if (canApplyAiSuggestion(suggestion)) {
          Text('采纳建议')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.ON_BRAND)
            .backgroundColor(MisakaColors.PRIMARY)
            .borderRadius(16)
            .padding({ left: 14, right: 14, top: 7, bottom: 7 })
            .alignSelf(ItemAlign.Start)
            .onClick((): void => {
              this.applySuggestion(q, suggestion);
            })
        } else {
          Text('需人工确认（不可自动采纳）')
            .fontSize(11)
            .fontColor(MisakaColors.RED)
            .width('100%')
        }
      }
      .padding(10)
      .borderRadius(10)
      .backgroundColor(MisakaColors.CARD)
      .border({ width: 1, color: MisakaColors.AMBER_SOFT })
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }, (suggestion: AiReviewSuggestion): string => `${q.id}-${suggestion.questionId}-${suggestion.suggestedAnswer.join('')}`)
  }

  @Builder
  questionRow(q: Question, index: number) {
    Column({ space: 4 }) {
      Row({ space: 8 }) {
        Text(this.typeLabel(q.type))
          .fontSize(11)
          .fontColor(MisakaColors.ON_BRAND)
          .backgroundColor(this.typeBadgeColor(q.type))
          .borderRadius(4)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        Text(`第 ${q.number.length > 0 ? q.number : String(index + 1)} 题`)
          .fontSize(11)
          .fontColor(MisakaColors.TEXT_SUB)
        if (q.images.length > 0) {
          Text(`图×${q.images.length}`)
            .fontSize(11)
            .fontColor(MisakaColors.WARN)
        }
        Blank()
        Text('编辑')
          .fontSize(12)
          .fontColor(MisakaColors.PRIMARY)
          .onClick(() => {
            this.openEditor(index);
          })
        Text('删除')
          .fontSize(12)
          .fontColor(MisakaColors.RED)
          .onClick(() => {
            this.removeQuestion(index);
          })
      }
      .width('100%')
      Text(q.question)
        .fontSize(14)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      if (q.answer.length > 0) {
        Text(`答案：${q.answer.join('、')}`)
          .fontSize(12)
          .fontColor(MisakaColors.GREEN)
          .width('100%')
      } else {
        Text('未识别到答案')
          .fontSize(12)
          .fontColor(MisakaColors.RED)
          .width('100%')
      }
      if (q.analysis.trim().length > 0) {
        Text(`解析：${q.analysis}`)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      if (this.aiReviewedIds.indexOf(q.id) >= 0 || this.aiAnalysisAppliedIds.indexOf(q.id) >= 0 ||
        shouldApplyAiAnalysis(q)) {
        this.aiTagRow(q)
      }
      this.aiSuggestionCard(q)
    }
    .padding(10)
    .borderRadius(10)
    .backgroundColor(MisakaColors.MUTED)
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  editorPanel() {
    Column({ space: 10 }) {
      Text('编辑题目')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
      Text('题型')
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
        .alignSelf(ItemAlign.Start)
      Row({ space: 8 }) {
        ForEach(this.typeOrder, (type: string, typeIndex?: number) => {
          Text(this.typeLabel(type))
            .fontSize(13)
            .fontColor(this.editTypeIndex === typeIndex ? MisakaColors.ON_BRAND : MisakaColors.TEXT)
            .backgroundColor(this.editTypeIndex === typeIndex ? MisakaColors.PRIMARY : MisakaColors.MUTED)
            .borderRadius(14)
            .padding({ left: 12, right: 12, top: 5, bottom: 5 })
            .onClick(() => {
              this.editTypeIndex = typeIndex ?? 0;
            })
        }, (type: string) => type)
      }
      Text('题干')
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
        .alignSelf(ItemAlign.Start)
      TextArea({ text: this.editStem, placeholder: '题干文本' })
        .height(88)
        .fontSize(13)
        .onChange((value: string) => {
          this.editStem = value;
        })
      Text('答案（多个用顿号或逗号分隔）')
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
        .alignSelf(ItemAlign.Start)
      TextInput({ text: this.editAnswer, placeholder: '如 A 或 A、B、C' })
        .fontSize(13)
        .onChange((value: string) => {
          this.editAnswer = value;
        })
      Text('解析')
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
        .alignSelf(ItemAlign.Start)
      TextArea({ text: this.editAnalysis, placeholder: '解析内容（可留空，用 AI 补解析生成建议）' })
        .height(72)
        .fontSize(13)
        .onChange((value: string) => {
          this.editAnalysis = value;
        })
      if (this.repo().settings.aiAnalysisEnabled) {
        Row() {
          PillButton({
            label: this.editAiBusy ? 'AI 解析生成中…'
              : (this.editAnalysis.trim().length === 0 ? 'AI 补解析' : 'AI 优化解析'),
            primary: false, grow: true, isEnabled: !this.editAiBusy,
            onTap: (): void => {
              this.runEditorAiAnalysis();
            }
          })
        }
        .width('100%')
        if (this.editAiBusy) {
          Text(this.editAiStream.length > 0
            ? `生成中：…${this.editAiStream.substring(Math.max(0, this.editAiStream.length - 160))}`
            : 'AI 正在根据题干、选项和答案生成解析建议，请稍候。')
            .fontSize(11)
            .fontColor(MisakaColors.TEXT_SUB)
            .width('100%')
        }
        if (this.editAiError.length > 0) {
          Text(`AI 补解析失败：${this.editAiError}`)
            .fontSize(11)
            .fontColor(MisakaColors.RED)
            .width('100%')
        }
        if (this.editAiSuggestion.length > 0) {
          Column({ space: 6 }) {
            Text('AI 建议解析')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(MisakaColors.TEXT)
            Text(this.editAiSuggestion)
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
              .width('100%')
            Text('AI 结果只写入当前编辑框，仍需手动保存题目。')
              .fontSize(10)
              .fontColor(MisakaColors.TEXT_TERTIARY)
              .width('100%')
            Text('采纳到解析')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(MisakaColors.ON_BRAND)
              .backgroundColor(MisakaColors.PRIMARY)
              .borderRadius(16)
              .padding({ left: 14, right: 14, top: 7, bottom: 7 })
              .alignSelf(ItemAlign.Start)
              .onClick((): void => {
                this.editAnalysis = this.editAiSuggestion;
                this.editAiSuggestion = '';
              })
          }
          .padding(10)
          .borderRadius(10)
          .backgroundColor(MisakaColors.MUTED)
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
      }
      Row({ space: 12 }) {
        Button('取消')
          .layoutWeight(1)
          .backgroundColor(MisakaColors.MUTED)
          .fontColor(MisakaColors.TEXT)
          .onClick(() => {
            this.editingIndex = -1;
          })
        Button('保存')
          .layoutWeight(1)
          .onClick(() => {
            this.applyEditor();
          })
      }
      .width('100%')
    }
    .padding(16)
    .borderRadius(16)
    .backgroundColor(MisakaColors.CARD)
    .width('86%')
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Column({ space: 10 }) {
        Text('导入题库')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
        TextInput({ text: this.bankName, placeholder: '题库名称（默认：导入题库）' })
          .width('100%')
          .onChange((value: string) => {
            this.bankName = value;
          })
        Row({ space: 10 }) {
          Button(this.busy ? '处理中…' : '选择文件（可双文件）')
            .layoutWeight(1)
            .enabled(!this.busy)
            .onClick(() => {
              this.pickFiles();
            })
          Button(this.showPaste ? '收起粘贴' : '粘贴文本')
            .layoutWeight(1)
            .backgroundColor(MisakaColors.MUTED)
            .fontColor(MisakaColors.TEXT)
            .enabled(!this.busy)
            .onClick(() => {
              this.showPaste = !this.showPaste;
            })
        }
        .width('100%')
        Row({ space: 8 }) {
          Button('内置示例 docx')
            .layoutWeight(1)
            .backgroundColor(MisakaColors.MUTED)
            .fontColor(MisakaColors.TEXT)
            .fontSize(12)
            .enabled(!this.busy)
            .onClick(() => {
              this.importRawfile('sample_bank.docx', 'sample_bank.docx');
            })
          Button('测试 docx')
            .layoutWeight(1)
            .backgroundColor(MisakaColors.MUTED)
            .fontColor(MisakaColors.TEXT)
            .fontSize(12)
            .enabled(!this.busy)
            .onClick(() => {
              this.importRawfile('m3_test.docx', 'm3_test.docx');
            })
          Button('测试 xlsx')
            .layoutWeight(1)
            .backgroundColor(MisakaColors.MUTED)
            .fontColor(MisakaColors.TEXT)
            .fontSize(12)
            .enabled(!this.busy)
            .onClick(() => {
              this.importRawfile('m3_test.xlsx', 'm3_test.xlsx');
            })
        }
        .width('100%')
        if (this.showPaste) {
          TextArea({ text: this.pasteText, placeholder: '粘贴题目/答案文本…' })
            .height(120)
            .width('100%')
            .fontSize(13)
            .onChange((value: string) => {
              this.pasteText = value;
            })
          Button('解析粘贴文本')
            .width('100%')
            .enabled(!this.busy)
            .onClick(() => {
              this.parsePasted();
            })
        }
        Text(this.statusText)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.result !== null && this.result.questions.length > 0) {
          Row({ space: 8 }) {
            PillButton({ label: this.aiBusy ? 'AI 核对中…' : 'AI 核对', primary: false, grow: true,
              isEnabled: !this.aiBusy, onTap: (): void => {
                this.runAiReview();
              } })
            PillButton({ label: this.aiBusy ? 'AI 解析中…' : 'AI 解析', primary: false, grow: true,
              isEnabled: !this.aiBusy, onTap: (): void => {
                this.runAiAnalysis();
              } })
            PillButton({ label: this.aiBusy ? 'AI 重构中…' : 'AI 重构', primary: false, grow: true,
              isEnabled: !this.aiBusy, onTap: (): void => {
                this.runAiRefactor();
              } })
          }
          .width('100%')
          if (this.aiSuggestions.length > 0) {
            InfoNotice({
              text: `AI 建议 ${this.aiSuggestions.length} 条：在下方题目卡上逐条核对，点「采纳建议」应用到对应题目；AI 结果只写入待核对结果，仍需手动导入题库。`,
              warning: false
            })
          }
          if (this.aiAnalysisAppliedIds.length > 0) {
            InfoNotice({
              text: `AI 已为 ${this.aiAnalysisAppliedIds.length} 道题写入待核对解析，导入前请人工确认。`,
              warning: false
            })
          }
        }

        if (this.result !== null && this.result.warnings.length > 0) {
          List({ space: 4 }) {
            ForEach(this.result.warnings.slice(0, 8), (warning: ImportWarning) => {
              ListItem() {
                this.warningRow(warning)
              }
            }, (warning: ImportWarning, index?: number) => `${warning.message}-${index ?? 0}`)
          }
          .width('100%')
          .height(120)
        }

        if (this.result !== null && this.result.questions.length > 0) {
          List({ space: 8 }) {
            ForEach(this.result.questions, (q: Question, index?: number) => {
              ListItem() {
                this.questionRow(q, index ?? 0)
              }
            }, (q: Question) => q.id)
          }
          .layoutWeight(1)
          .width('100%')
        } else {
          Blank()
        }

        if (this.result !== null && this.result.questions.length > 0) {
          Button(`导入题库（${this.result.questions.length} 题）`)
            .width('100%')
            .fontSize(16)
            .onClick(() => {
              this.confirmImport();
            })
        }
      }
      .justifyContent(FlexAlign.Start)
      .width('92%')
      .height('100%')

      if (this.editingIndex >= 0) {
        Scroll() {
          this.editorPanel()
        }
        .width('100%')
        .height('100%')
        .align(Alignment.Center)
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.editingIndex = -1;
        })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.MUTED)
  }
}
