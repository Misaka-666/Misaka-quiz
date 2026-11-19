/**
 * M4 题库列表 — 按分组展示，设为当前/改名/删除/进详情。
 * M8：题库 AI 分析（多库勾选 → 顺序流式分析 → 结构化结果 + ai_cache.json 缓存）。
 */
import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { QuizRepository } from '../state/QuizRepository';
import { QuizBank } from '../domain/Models';
import { MisakaAiClient } from '../ai/MisakaAiClient';
import {
  AiBankAnalysis, AiBankCluster, AiConfusingPair, AiProgression, AiEntityKnowledge,
  AiEntityAppearance, AiStreamCallback
} from '../ai/AiTypes';
import { AiBankAnalysisCache } from '../ai/AiBankAnalysisCache';
import { parseBankAnalysis, AI_BANK_ANALYSIS_MAX_QUESTIONS } from '../ai/AiCodec';
import { appendAiReasoningPreview } from '../ai/AiSse';
import { MisakaColors, PillButton, StatusChip, InfoNotice, AiReasoningLine } from './common/QuizWidgets';

class BankGroup {
  name: string;
  banks: QuizBank[];
  constructor(name: string) {
    this.name = name;
    this.banks = [];
  }
}

/** 单个题库的分析面板状态（done 时 result 非空；fromCache 表示读缓存未重跑） */
class BankAiPanel {
  bankId: string;
  bankName: string;
  status: string; // analyzing / done / error
  error: string = '';
  result: AiBankAnalysis | null = null;
  fromCache: boolean = false;
  sentCount: number = 0;
  constructor(bankId: string, bankName: string) {
    this.bankId = bankId;
    this.bankName = bankName;
    this.status = 'done';
  }
}

@Entry
@Component
struct BankListPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State renamingBankId: string = '';
  @State renameText: string = '';
  @State showRename: boolean = false;
  // M8 题库 AI 分析
  @State showAiSheet: boolean = false;
  @State aiSelected: Record<string, boolean> = {};
  @State aiPanels: BankAiPanel[] = [];
  @State aiQueueRunning: boolean = false;
  @State aiStreamBankId: string = '';
  @State aiReasoningPreview: string = '';
  @State aiErrorText: string = '';

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private groups(): BankGroup[] {
    const map: BankGroup[] = [];
    for (const bank of this.repo.banks) {
      let group = map.find((item): boolean => item.name === bank.groupName);
      if (group === undefined) {
        group = new BankGroup(bank.groupName);
        map.push(group);
      }
      group.banks.push(bank);
    }
    return map;
  }

  private questionCount(bank: QuizBank): number {
    return bank.questions.length;
  }

  private openAiSheet(): void {
    if (this.aiQueueRunning) {
      this.showAiSheet = true;
      return;
    }
    const selected: Record<string, boolean> = {};
    for (const bank of this.repo.banks) {
      selected[bank.id] = true;
    }
    this.aiSelected = selected;
    // 预载缓存（有缓存的库直接显示结果）
    const panels: BankAiPanel[] = [];
    for (const bank of this.repo.banks) {
      const panel = new BankAiPanel(bank.id, bank.name);
      const cached = AiBankAnalysisCache.loadBankAnalysis(this.context(), bank.id);
      if (cached !== null) {
        panel.result = cached;
        panel.fromCache = true;
      }
      panels.push(panel);
    }
    this.aiPanels = panels;
    this.aiQueueRunning = false;
    this.aiStreamBankId = '';
    this.aiReasoningPreview = '';
    this.aiErrorText = '';
    this.showAiSheet = true;
    this.tick += 1;
  }

  private toggleAiBank(bankId: string): void {
    const next: Record<string, boolean> = {};
    for (const key of Object.keys(this.aiSelected)) {
      next[key] = this.aiSelected[key];
    }
    next[bankId] = !next[bankId];
    this.aiSelected = next;
  }

  private selectedAiBankCount(): number {
    let count = 0;
    for (const bank of this.repo.banks) {
      if (this.aiSelected[bank.id] === true) {
        count += 1;
      }
    }
    return count;
  }

  private rebuildPanels(): void {
    this.aiPanels = this.aiPanels.slice();
    this.tick += 1;
  }

  private startAiAnalysis(): void {
    if (this.aiQueueRunning) {
      return;
    }
    if (!this.repo.isAiConfigured()) {
      this.aiErrorText = '请先在「我的 → AI 设置」中配置 AI 接口。';
      this.tick += 1;
      return;
    }
    const targets = this.repo.banks.filter((bank: QuizBank): boolean => this.aiSelected[bank.id] === true);
    if (targets.length === 0) {
      this.aiErrorText = '请先勾选要分析的题库。';
      this.tick += 1;
      return;
    }
    // 重建面板：只留选中的库（保留已有缓存结果）
    const byId = new Map<string, BankAiPanel>();
    for (const panel of this.aiPanels) {
      byId.set(panel.bankId, panel);
    }
    const panels: BankAiPanel[] = [];
    for (const bank of targets) {
      const existing = byId.get(bank.id);
      const panel = new BankAiPanel(bank.id, bank.name);
      if (existing !== undefined && existing.result !== null) {
        panel.result = existing.result;
        panel.fromCache = existing.fromCache;
      }
      panels.push(panel);
    }
    this.aiPanels = panels;
    this.aiErrorText = '';
    this.aiQueueRunning = true;
    this.runAiAt(0);
  }

  /** 顺序逐库流式分析（对齐 Android BatchAiAnalysisDialog 的逐库串行体验） */
  private runAiAt(index: number): void {
    if (index >= this.aiPanels.length) {
      this.aiQueueRunning = false;
      this.aiStreamBankId = '';
      this.aiReasoningPreview = '';
      this.rebuildPanels();
      return;
    }
    const panel = this.aiPanels[index];
    const bank = this.repo.banks.find((item: QuizBank): boolean => item.id === panel.bankId);
    if (bank === undefined || bank.questions.length === 0) {
      panel.status = 'error';
      panel.error = '题库为空，无法分析。';
      this.rebuildPanels();
      this.runAiAt(index + 1);
      return;
    }
    panel.status = 'analyzing';
    panel.fromCache = false;
    panel.error = '';
    panel.sentCount = Math.min(bank.questions.length, AI_BANK_ANALYSIS_MAX_QUESTIONS);
    this.aiStreamBankId = panel.bankId;
    this.aiReasoningPreview = '';
    this.rebuildPanels();
    const settings = this.repo.settings;
    MisakaAiClient.analyzeBankStreaming(settings.aiApiBaseUrl, settings.aiApiKey, settings.aiModelName,
      bank.questions, bank.name,
      new AiStreamCallback((chunk: string): void => {
        this.aiReasoningPreview = appendAiReasoningPreview(this.aiReasoningPreview, chunk);
      }, (): void => {}, (): void => {}), 120)
      .then((full: string): void => {
        const cached = AiBankAnalysisCache.saveBankAnalysis(this.context(), panel.bankId, full);
        panel.result = cached !== null ? cached : parseBankAnalysis(full);
        panel.status = 'done';
        this.rebuildPanels();
        this.runAiAt(index + 1);
      })
      .catch((err: Error): void => {
        panel.status = 'error';
        panel.error = err.message.length > 0 ? err.message : 'AI 分析失败';
        this.rebuildPanels();
        this.runAiAt(index + 1);
      });
  }

  /** 重新分析单个库 */
  private reanalyzeOne(bankId: string): void {
    if (this.aiQueueRunning) {
      return;
    }
    const index = this.aiPanels.findIndex((panel: BankAiPanel): boolean => panel.bankId === bankId);
    if (index < 0) {
      return;
    }
    this.aiQueueRunning = true;
    this.runAiAt(index);
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('题库管理')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        Text(this.tick >= 0 ? `共 ${this.repo.banks.length} 库` : '')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
        Text('搜索')
          .fontSize(14)
          .fontColor(MisakaColors.PRIMARY)
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .onClick((): void => {
            router.pushUrl({ url: 'pages/QuestionSearchPage' });
          })
        Text('AI 分析')
          .fontSize(14)
          .fontColor(MisakaColors.ACCENT_PURPLE)
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .onClick((): void => {
            this.openAiSheet();
          })
      }
      .width('100%')
      .padding(16)
      // ponytail: 同一节点链两个 bindSheet 时第一个（改名）打不开（v0.9.0 加 AI sheet 后回归），
      // 拆到不同节点各挂一个；升级路径 = 官方多 sheet 支持明确后合并回去
      .bindSheet($$this.showRename, this.renameSheet(), {
        height: SheetSize.FIT_CONTENT,
        dragBar: true
      })

      Scroll() {
        Column({ space: 14 }) {
          if (this.tick % 2 === 0) {
            this.listBody()
          } else {
            this.listBody()
          }
        }
        .padding({ left: 16, right: 16, bottom: 24 })
        .width('100%')
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
    .bindSheet($$this.showAiSheet, this.aiSheet(), {
      height: SheetSize.LARGE,
      dragBar: true
    })
  }

  @Builder
  listBody() {
    if (this.repo.banks.length === 0) {
      Text('还没有题库，去「导入」页导入或添加内置题库。')
        .fontSize(14)
        .fontColor(MisakaColors.TEXT_SUB)
        .padding(20)
    }
    ForEach(this.groups(), (group: BankGroup) => {
      Column({ space: 8 }) {
        Text(group.name)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
        ForEach(group.banks, (bank: QuizBank) => {
          this.bankCard(bank)
        }, (bank: QuizBank): string => bank.id)
      }
      .width('100%')
    }, (group: BankGroup): string => `group-${group.name}`)
  }

  @Builder
  bankCard(bank: QuizBank) {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Column({ space: 3 }) {
          Row({ space: 8 }) {
            Text(bank.name)
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
            if (bank.id === this.repo.activeBankId) {
              Text('当前')
                .fontSize(11)
                .fontColor(MisakaColors.ON_BRAND)
                .backgroundColor(MisakaColors.PRIMARY)
                .borderRadius(6)
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            }
          }
          Text(`${this.questionCount(bank)} 题`)
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .onClick((): void => {
        router.pushUrl({ url: 'pages/BankDetailPage', params: { bankId: bank.id } });
      })
      Row({ space: 8 }) {
        if (bank.id !== this.repo.activeBankId) {
          PillButton({ label: '设为当前', primary: false, isEnabled: true, onTap: (): void => {
            this.repo.setActiveBank(bank.id);
            this.tick += 1;
          } })
        }
        PillButton({ label: '改名', primary: false, isEnabled: true, onTap: (): void => {
          this.renamingBankId = bank.id;
          this.renameText = bank.name;
          this.showRename = true;
        } })
        PillButton({ label: '删除', primary: false, isEnabled: true, onTap: (): void => {
          this.getUIContext().showAlertDialog({
            message: `删除题库「${bank.name}」（${this.questionCount(bank)} 题）？不可恢复。`,
            primaryButton: {
              value: '删除',
              action: (): void => {
                this.repo.deleteBank(bank.id);
                this.tick += 1;
              }
            },
            secondaryButton: { value: '取消', action: (): void => {} }
          });
        } })
      }
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
  }

  @Builder
  renameSheet() {
    Column({ space: 14 }) {
      Text('重命名题库')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
      TextInput({ text: this.renameText, placeholder: '题库名称' })
        .onChange((value: string) => {
          this.renameText = value;
        })
      Row({ space: 10 }) {
        PillButton({ label: '取消', primary: false, isEnabled: true, onTap: (): void => {
          this.showRename = false;
        } })
        PillButton({ label: '保存', primary: true, isEnabled: true, onTap: (): void => {
          if (this.renameText.trim().length > 0) {
            this.repo.renameBank(this.renamingBankId, this.renameText.trim());
          }
          this.showRename = false;
          this.tick += 1;
        } })
      }
    }
    .padding(20)
    .width('100%')
  }

  @Builder
  aiBankPickRow(bank: QuizBank) {
    Row({ space: 10 }) {
      Checkbox()
        .select(this.aiSelected[bank.id] === true)
        .onChange((_value: boolean): void => {
          this.toggleAiBank(bank.id);
        })
      Column({ space: 2 }) {
        Text(bank.name)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(MisakaColors.TEXT)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(bank.questions.length > AI_BANK_ANALYSIS_MAX_QUESTIONS
          ? `${bank.questions.length} 题（分析取前 ${AI_BANK_ANALYSIS_MAX_QUESTIONS} 题）`
          : `${bank.questions.length} 题`)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ top: 6, bottom: 6 })
  }

  @Builder
  aiBankResultBody(panel: BankAiPanel) {
    if (panel.result !== null) {
      Column({ space: 10 }) {
        Text('概述')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(MisakaColors.PRIMARY)
        Text(panel.result.overview)
          .fontSize(13)
          .lineHeight(20)
          .fontColor(MisakaColors.TEXT)
          .width('100%')

        if (panel.result.clusters.length > 0) {
          Text('知识点聚类')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.PRIMARY)
          ForEach(panel.result.clusters, (cluster: AiBankCluster, index?: number) => {
            Column({ space: 3 }) {
              Text(`${(index ?? 0) + 1}. ${cluster.topic}（${cluster.questionNumbers.join('、')}）`)
                .fontSize(13)
                .fontColor(MisakaColors.TEXT)
              if (cluster.reason.length > 0) {
                Text(cluster.reason)
                  .fontSize(12)
                  .fontColor(MisakaColors.TEXT_SUB)
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }, (cluster: AiBankCluster): string => `${panel.bankId}-c-${cluster.topic}`)
        }

        if (panel.result.confusingPairs.length > 0) {
          Text('易混淆题对')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.PRIMARY)
          ForEach(panel.result.confusingPairs, (pair: AiConfusingPair) => {
            Text(`题 ${pair.questionA} ↔ 题 ${pair.questionB}${pair.reason.length > 0 ? `：${pair.reason}` : ''}`)
              .fontSize(12)
              .lineHeight(19)
              .fontColor(MisakaColors.TEXT_SUB)
              .width('100%')
          }, (pair: AiConfusingPair): string => `${panel.bankId}-p-${pair.questionA}-${pair.questionB}`)
        }

        if (panel.result.progressions.length > 0) {
          Text('知识递进链')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.PRIMARY)
          ForEach(panel.result.progressions, (prog: AiProgression) => {
            Text(`${prog.chain.join(' → ')}${prog.description.length > 0 ? `：${prog.description}` : ''}`)
              .fontSize(12)
              .lineHeight(19)
              .fontColor(MisakaColors.TEXT_SUB)
              .width('100%')
          }, (prog: AiProgression): string => `${panel.bankId}-g-${prog.chain.join('-')}`)
        }

        if (panel.result.memoryTips.length > 0) {
          Text('记忆技巧')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.PRIMARY)
          ForEach(panel.result.memoryTips, (tip: string, tipIndex?: number) => {
            Text(`${(tipIndex ?? 0) + 1}. ${tip}`)
              .fontSize(12)
              .lineHeight(19)
              .fontColor(MisakaColors.TEXT_SUB)
              .width('100%')
          }, (_tip: string, tipIndex?: number): string => `${panel.bankId}-t-${tipIndex ?? 0}`)
        }

        if (panel.result.reviewStrategy.length > 0) {
          Text('复习策略')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.PRIMARY)
          Text(panel.result.reviewStrategy)
            .fontSize(12)
            .lineHeight(19)
            .fontColor(MisakaColors.TEXT_SUB)
            .width('100%')
        }

        if (panel.result.entityKnowledgeMap.length > 0) {
          Text('知识点关联图谱')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.PRIMARY)
          ForEach(panel.result.entityKnowledgeMap, (entity: AiEntityKnowledge) => {
            Column({ space: 3 }) {
              Row({ space: 6 }) {
                Text(entity.entity)
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(MisakaColors.TEXT)
                if (entity.category.length > 0) {
                  StatusChip({ label: entity.category, tone: 'primary' })
                }
              }
              ForEach(entity.appearances, (app: AiEntityAppearance) => {
                Text(`题 ${app.questionNumber}${app.knowledgePoint.length > 0 ? `：${app.knowledgePoint}` : ''}`)
                  .fontSize(12)
                  .fontColor(MisakaColors.TEXT_SUB)
                  .width('100%')
              }, (app: AiEntityAppearance): string => `${panel.bankId}-e-${entity.entity}-${app.questionNumber}`)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }, (entity: AiEntityKnowledge): string => `${panel.bankId}-ent-${entity.entity}`)
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  aiBankPanel(panel: BankAiPanel) {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(panel.bankName)
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(MisakaColors.PRIMARY)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (panel.status === 'done' && panel.result !== null && !this.aiQueueRunning) {
          Text(panel.fromCache ? '缓存' : '已完成')
            .fontSize(11)
            .fontColor(MisakaColors.TEXT_SUB)
          Text('重新分析')
            .fontSize(12)
            .fontColor(MisakaColors.ACCENT_PURPLE)
            .onClick((): void => {
              this.reanalyzeOne(panel.bankId);
            })
        }
      }
      .width('100%')

      if (panel.status === 'analyzing') {
        AiReasoningLine({
          reasoning: this.aiStreamBankId === panel.bankId ? this.aiReasoningPreview : '',
          waitingText: `AI 正在分析 ${panel.sentCount} 题…`
        })
      }
      if (panel.status === 'error') {
        InfoNotice({ text: `AI 分析失败：${panel.error}`, warning: true })
      }
      if (panel.status === 'done' && panel.result === null) {
        InfoNotice({ text: '还没有分析结果，勾选后点「开始 AI 分析」。', warning: false })
      }
      this.aiBankResultBody(panel)
    }
    .padding(12)
    .borderRadius(12)
    .backgroundColor(MisakaColors.CARD)
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  aiSheet() {
    Column() {
      Text('AI 题库分析')
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor(MisakaColors.TEXT)
        .padding({ top: 6, bottom: 10 })
      Scroll() {
        Column({ space: 12 }) {
          Column({ space: 4 }) {
            ForEach(this.repo.banks, (bank: QuizBank) => {
              this.aiBankPickRow(bank)
            }, (bank: QuizBank): string => `pick-${bank.id}`)
          }
          .width('100%')
          if (this.aiErrorText.length > 0) {
            InfoNotice({ text: this.aiErrorText, warning: true })
          }
          Row({ space: 10 }) {
            PillButton({
              label: this.aiQueueRunning ? 'AI 分析中…' : `开始 AI 分析（${this.selectedAiBankCount()}）`,
              primary: true, grow: true, isEnabled: !this.aiQueueRunning && this.selectedAiBankCount() > 0,
              onTap: (): void => {
                this.startAiAnalysis();
              }
            })
            PillButton({ label: '关闭', primary: false, isEnabled: !this.aiQueueRunning, onTap: (): void => {
              this.showAiSheet = false;
            } })
          }
          .width('100%')
          InfoNotice({
            text: '从记忆和学习角度通览题库：知识点聚类、易混淆题对、递进链、记忆技巧、复习策略与知识点关联图谱。结果缓存在本地，重新分析会覆盖。',
            warning: false
          })
          ForEach(this.aiPanels, (panel: BankAiPanel) => {
            this.aiBankPanel(panel)
          }, (panel: BankAiPanel): string => `${panel.bankId}-${panel.status}-${panel.result !== null ? 'r' : 'n'}`)
        }
        .padding({ left: 16, right: 16, bottom: 24 })
        .width('100%')
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
  }
}
