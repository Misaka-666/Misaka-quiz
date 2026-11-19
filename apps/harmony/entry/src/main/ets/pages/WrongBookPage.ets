/**
 * 错题本 — 题库范围、掌握状态与题型筛选、手动复习排序、今日到期复习。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import {
  WrongQuestionEntry, WrongStatus, Question, QuestionType, QuizBank, DEFAULT_BANK_GROUP_NAME
} from '../domain/Models';
import {
  filterWrongEntries, sortWrongEntries,
  WRONG_FILTER_NOT_MASTERED, WRONG_FILTER_MASTERED, WRONG_FILTER_ALL,
  WRONG_SORT_RECENT, WRONG_SORT_COUNT, WRONG_SORT_MASTERY, WRONG_SORT_RANDOM,
  WRONG_BOOK_SCOPE_CURRENT_BANK, WRONG_BOOK_SCOPE_ALL_BANKS, WRONG_BOOK_SCOPE_GROUP, WRONG_BOOK_SCOPE_BANK
} from '../state/WrongBookOps';
import { hasStructuredAnswers, expectedAnswerText } from '../importer/model/MultiBlankSupport';
import {
  MisakaColors, PillButton, SmallChip, StatusChip, TypeBadge, InfoNotice, SettingToggleRow,
  TYPE_COMPACT_LABELS, formatShortTimestamp
} from './common/QuizWidgets';

const WRONG_BOOK_QUESTION_TYPES: string[] = ['', QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE];

class ScopeGroupInfo {
  name: string;
  banks: QuizBank[];
  wrongCount: number;
  constructor(name: string) {
    this.name = name;
    this.banks = [];
    this.wrongCount = 0;
  }
}

@Entry
@Component
struct WrongBookPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State filter: string = WRONG_FILTER_NOT_MASTERED;
  @State questionType: string = '';
  @State sort: string = WRONG_SORT_RECENT;
  @State showScopeSheet: boolean = false;
  @State expandedScopeGroups: string[] = [];

  onPageShow(): void {
    // 从练习页返回时刷新到期计数/列表
    this.tick += 1;
  }

  private scopedEntries(): WrongQuestionEntry[] {
    return this.repo.wrongBookEntriesForScope();
  }

  private filteredEntries(): WrongQuestionEntry[] {
    return sortWrongEntries(filterWrongEntries(this.scopedEntries(), this.filter, this.questionType), this.sort);
  }

  private notMasteredCount(): number {
    let count = 0;
    for (const entry of this.scopedEntries()) {
      if (entry.status !== WrongStatus.MASTERED) {
        count += 1;
      }
    }
    return count;
  }

  private scopeGroups(): ScopeGroupInfo[] {
    const infos: ScopeGroupInfo[] = [];
    const countOf = (group: string): number => this.repo.wrongBook.filter((entry): boolean => {
      const bank = this.repo.banks.find((item): boolean => item.id === entry.bankId);
      return bank !== undefined && bank.groupName === group;
    }).length;
    for (const bank of this.repo.banks) {
      const group = bank.groupName.trim().length > 0 ? bank.groupName : DEFAULT_BANK_GROUP_NAME;
      if (group !== DEFAULT_BANK_GROUP_NAME && !this.repo.wrongBook.some((entry): boolean => entry.bankId === bank.id)) {
        continue; // 无错题的分组不展示
      }
      let info = infos.find((item): boolean => item.name === group);
      if (info === undefined) {
        info = new ScopeGroupInfo(group);
        infos.push(info);
      }
      info.banks.push(bank);
    }
    for (const info of infos) {
      info.wrongCount = countOf(info.name);
    }
    infos.sort((a: ScopeGroupInfo, b: ScopeGroupInfo): number => {
      if ((a.name === DEFAULT_BANK_GROUP_NAME) !== (b.name === DEFAULT_BANK_GROUP_NAME)) {
        return a.name === DEFAULT_BANK_GROUP_NAME ? 1 : -1;
      }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return infos;
  }

  private wrongCountOfBank(bankId: string): number {
    return this.repo.wrongBook.filter((entry): boolean => entry.bankId === bankId).length;
  }

  private correctAnswerText(question: Question): string {
    if (hasStructuredAnswers(question)) {
      return `正确答案：\n${expectedAnswerText(question.blankAnswers)}`;
    }
    const text = question.answer.join(' / ');
    return `正确答案：${text.length > 0 ? text : '未识别答案'}`;
  }

  private startFilteredPractice(): void {
    if (this.repo.startWrongBookPractice(this.filteredEntries(), false, '错题本', this.sort === WRONG_SORT_RANDOM)) {
      router.pushUrl({ url: 'pages/PracticePage' });
    }
  }

  private startTodayReview(): void {
    if (this.repo.startTodayWrongBookReview()) {
      router.pushUrl({ url: 'pages/PracticePage' });
    }
  }

  private confirmClear(): void {
    const scopeLabel = this.repo.currentWrongBookScopeLabel();
    const mode = this.repo.settings.wrongBookScopeMode;
    const isSpecific = mode === WRONG_BOOK_SCOPE_CURRENT_BANK || mode === WRONG_BOOK_SCOPE_BANK;
    const label = isSpecific ? scopeLabel : '全部';
    this.getUIContext().showAlertDialog({
      message: isSpecific
        ? `确认清空${label}错题？将移除错题记录与复习统计，其他题库不受影响。`
        : '确认清空全部题库的错题记录？包括错题次数、掌握状态和复习统计，不可撤销。',
      primaryButton: {
        value: isSpecific ? `清空${label}` : '清空全部',
        action: (): void => {
          this.repo.clearWrongBookForScope();
          this.tick += 1;
        }
      },
      secondaryButton: { value: '取消', action: (): void => {} }
    });
  }

  private confirmRemove(entry: WrongQuestionEntry): void {
    this.getUIContext().showAlertDialog({
      message: '确认移出这道错题？将清除本题的错题复习状态，原题库中的题目不会被删除。',
      primaryButton: {
        value: '确认移出',
        action: (): void => {
          this.repo.removeWrongQuestion(entry.bankId, entry.question.id);
          this.tick += 1;
        }
      },
      secondaryButton: { value: '取消', action: (): void => {} }
    });
  }

  private isGroupExpanded(group: string): boolean {
    return this.expandedScopeGroups.includes(group);
  }

  private toggleGroupExpanded(group: string): void {
    this.expandedScopeGroups = this.isGroupExpanded(group)
      ? this.expandedScopeGroups.filter((name): boolean => name !== group)
      : this.expandedScopeGroups.concat([group]);
    this.tick += 1;
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('错题本')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        // 引用 tick 使作用域切换时 header 范围标签随 parity 重建一起刷新
        Text(this.tick >= 0 ? this.repo.currentWrongBookScopeLabel() : '')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
          .maxLines(1)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column() {
          if (this.tick % 2 === 0) {
            this.pageBody()
          } else {
            this.pageBody()
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ left: 16, right: 16, bottom: 24 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
    .bindSheet($$this.showScopeSheet, this.scopeSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true
    })
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      if (this.scopedEntries().length === 0) {
        Column({ space: 12 }) {
          Text('错题本还是空的')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
          Text('继续练习或考试后，错题会自动进入这里。')
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
          Row({ space: 10 }) {
            Row() {
              PillButton({ label: '返回首页', primary: false, isEnabled: true, grow: false, onTap: (): void => {
                router.back();
              } })
            }
          }
          .width('100%')
        }
        .padding(24)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')
      } else {
        this.summaryCard(this.repo.wrongBookPracticeEntries(this.filteredEntries(), false).length)
        ForEach(this.filteredEntries(), (entry: WrongQuestionEntry) => {
          this.wrongCard(entry)
        }, (entry: WrongQuestionEntry): string => `${entry.bankId}#${entry.question.id}`)
        if (this.filteredEntries().length === 0) {
          InfoNotice({ text: '当前筛选下没有错题。' })
        }
      }
    }
    .constraintSize({ maxWidth: 760 })
    .width('100%')
  }

  @Builder
  summaryCard(reviewCount: number) {
    Column({ space: 12 }) {
      Row({ space: 10 }) {
        Column({ space: 5 }) {
          Row({ space: 8 }) {
            Text(`错题 ${this.scopedEntries().length} 条`)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
            StatusChip({ label: this.repo.currentWrongBookScopeLabel(), tone: 'primary' })
          }
          Text(`未掌握 ${this.notMasteredCount()} · 已掌握 ${this.scopedEntries().length - this.notMasteredCount()}`)
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')

      Row({ space: 8 }) {
        Row() {
          PillButton({ label: `范围：${this.repo.currentWrongBookScopeLabel()}`, primary: false, isEnabled: true, grow: false, onTap: (): void => {
            this.showScopeSheet = true;
          } })
        }
        Row() {
          PillButton({ label: '清空', primary: false, isEnabled: true, grow: false, onTap: (): void => {
            this.confirmClear();
          } })
        }
      }
      .width('100%')

      this.smartReviewSection()

      Text('掌握筛选')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
      Flex({ wrap: FlexWrap.Wrap }) {
        SmallChip({ label: '未掌握', active: this.filter === WRONG_FILTER_NOT_MASTERED, onTap: (): void => {
          this.filter = WRONG_FILTER_NOT_MASTERED;
          this.tick += 1;
        } })
        SmallChip({ label: '已掌握', active: this.filter === WRONG_FILTER_MASTERED, onTap: (): void => {
          this.filter = WRONG_FILTER_MASTERED;
          this.tick += 1;
        } })
        SmallChip({ label: '全部', active: this.filter === WRONG_FILTER_ALL, onTap: (): void => {
          this.filter = WRONG_FILTER_ALL;
          this.tick += 1;
        } })
      }
      .width('100%')

      Text('题型')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(WRONG_BOOK_QUESTION_TYPES, (type: string) => {
          SmallChip({ label: type === '' ? '全部题型' : TYPE_COMPACT_LABELS[type], active: this.questionType === type,
            onTap: (): void => {
              this.questionType = type;
              this.tick += 1;
            } })
        }, (type: string): string => `wrong-type-${type}`)
      }
      .width('100%')

      Text('复习排序')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
      Flex({ wrap: FlexWrap.Wrap }) {
        SmallChip({ label: '最近错', active: this.sort === WRONG_SORT_RECENT, onTap: (): void => {
          this.sort = WRONG_SORT_RECENT;
          this.tick += 1;
        } })
        SmallChip({ label: '错误次数', active: this.sort === WRONG_SORT_COUNT, onTap: (): void => {
          this.sort = WRONG_SORT_COUNT;
          this.tick += 1;
        } })
        SmallChip({ label: '掌握程度', active: this.sort === WRONG_SORT_MASTERY, onTap: (): void => {
          this.sort = WRONG_SORT_MASTERY;
          this.tick += 1;
        } })
        SmallChip({ label: '随机', active: this.sort === WRONG_SORT_RANDOM, onTap: (): void => {
          this.sort = WRONG_SORT_RANDOM;
          this.tick += 1;
        } })
      }
      .width('100%')

      Row({ space: 10 }) {
        PillButton({ label: reviewCount > 0 ? `刷当前筛选（${reviewCount} 题）` : '当前筛选无可刷题',
          primary: true, isEnabled: reviewCount > 0, grow: true, onTap: (): void => {
            this.startFilteredPractice();
          } })
        PillButton({ label: '返回', primary: false, isEnabled: true, grow: true, onTap: (): void => {
          router.back();
        } })
      }
      .width('100%')

      if (reviewCount === 0) {
        InfoNotice({ text: this.filter === WRONG_FILTER_MASTERED
          ? '已掌握题不会进入刷错题。需要复习时可先标为未掌握。' : '当前筛选下没有需要复习的错题。' })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
  }

  @Builder
  smartReviewSection() {
    Column({ space: 10 }) {
      SettingToggleRow({ title: '智能复习', subtitle: '按 1/3/7/15/30 天排期，到期题进入今日复习',
        value: this.repo.settings.wrongBookSmartReviewEnabled, onToggle: (): void => {
          this.repo.setWrongBookSmartReviewEnabled(!this.repo.settings.wrongBookSmartReviewEnabled);
          this.tick += 1;
        } })
      if (this.repo.settings.wrongBookSmartReviewEnabled) {
        Divider().color(MisakaColors.BORDER)
        Text('今日复习')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
        Text(`未掌握 ${this.repo.todaySmartReviewSummary().notMastered} · 已掌握回顾 ${this.repo.todaySmartReviewSummary().masteredReview}`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
        Row() {
          PillButton({ label: this.repo.todaySmartReviewSummary().total > 0
            ? `开始今日复习（${this.repo.todaySmartReviewSummary().total} 题）` : '今日暂无到期',
            primary: this.repo.todaySmartReviewSummary().total > 0,
            isEnabled: this.repo.todaySmartReviewSummary().total > 0, grow: false, onTap: (): void => {
              this.startTodayReview();
            } })
        }
        .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  wrongCard(entry: WrongQuestionEntry) {
    Column({ space: 10 }) {
      Row({ space: 6 }) {
        StatusChip({ label: entry.status === WrongStatus.MASTERED ? '已掌握' : '未掌握',
          tone: entry.status === WrongStatus.MASTERED ? 'green' : 'red' })
        TypeBadge({ type: entry.question.type })
        StatusChip({ label: entry.bankName })
      }
      Text(`${entry.question.number}. ${entry.question.question}`)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      Text(this.correctAnswerText(entry.question))
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(`上次答案：${entry.lastAnswer.length > 0 ? entry.lastAnswer.join(' / ') : '未作答'}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(`错 ${entry.wrongCount} 次 · 对 ${entry.rightCount} 次 · 最近错误 ${formatShortTimestamp(entry.lastWrongAt)}`)
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
      Row({ space: 10 }) {
        PillButton({ label: entry.status === WrongStatus.MASTERED ? '重新复习' : '标记掌握',
          primary: entry.status !== WrongStatus.MASTERED, isEnabled: true, grow: true, onTap: (): void => {
            this.repo.markWrongQuestionMastered(entry.bankId, entry.question.id,
              entry.status !== WrongStatus.MASTERED);
            this.tick += 1;
          } })
        PillButton({ label: '移出', primary: false, isEnabled: true, grow: true, onTap: (): void => {
          this.confirmRemove(entry);
        } })
      }
      .width('100%')
      Row() {
        PillButton({ label: '打开本题', primary: false, isEnabled: true, grow: false, onTap: (): void => {
          if (this.repo.openWrongQuestion(entry)) {
            router.pushUrl({ url: 'pages/PracticePage' });
          }
        } })
      }
      .width('100%')
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
  }

  @Builder
  scopeSheet() {
    Column({ space: 8 }) {
      Text('错题范围')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .padding({ top: 8 })
      Scroll() {
        Column({ space: 4 }) {
          if (this.tick % 2 === 0) {
            this.scopeSheetBody()
          } else {
            this.scopeSheetBody()
          }
        }
        .constraintSize({ maxWidth: 640 })
        .width('100%')
      }
      .constraintSize({ maxHeight: 460 })
      .scrollBar(BarState.Auto)
      .width('100%')
      Row({ space: 10 }) {
        PillButton({ label: '取消', primary: false, isEnabled: true, grow: true, onTap: (): void => {
          this.showScopeSheet = false;
        } })
      }
      .width('100%')
      .padding({ top: 4 })
    }
    .padding(20)
    .width('100%')
  }

  @Builder
  scopeSheetBody() {
    Column({ space: 4 }) {
      if (this.repo.activeBank() !== null) {
        this.scopeRow('当前题库', (this.repo.activeBank() as QuizBank).name,
          this.repo.settings.wrongBookScopeMode === WRONG_BOOK_SCOPE_CURRENT_BANK, (): void => {
            this.repo.setWrongBookScopeMode(WRONG_BOOK_SCOPE_CURRENT_BANK, '');
            this.showScopeSheet = false;
            this.tick += 1;
          })
      }
      this.scopeRow('全部题库', `${this.repo.wrongBook.length} 题`,
        this.repo.settings.wrongBookScopeMode === WRONG_BOOK_SCOPE_ALL_BANKS, (): void => {
          this.repo.setWrongBookScopeMode(WRONG_BOOK_SCOPE_ALL_BANKS, '');
          this.showScopeSheet = false;
          this.tick += 1;
        })
      ForEach(this.scopeGroups(), (group: ScopeGroupInfo) => {
        Column({ space: 4 }) {
          Row({ space: 6 }) {
            Text(this.isGroupExpanded(group.name) ? '▾' : '▸')
              .fontSize(14)
              .fontColor(MisakaColors.TEXT_SUB)
              .width(28)
              .height(28)
              .textAlign(TextAlign.Center)
              .onClick((): void => {
                this.toggleGroupExpanded(group.name);
              })
            this.scopeRow(group.name, `${group.wrongCount} 题`,
              this.repo.settings.wrongBookScopeMode === WRONG_BOOK_SCOPE_GROUP &&
              this.repo.settings.wrongBookScopeGroupName === group.name, (): void => {
                this.repo.setWrongBookScopeMode(WRONG_BOOK_SCOPE_GROUP, group.name);
                this.showScopeSheet = false;
                this.tick += 1;
              })
          }
          .width('100%')
          if (this.isGroupExpanded(group.name)) {
            ForEach(group.banks, (bank: QuizBank) => {
              Row() {
                this.scopeRow(bank.name, `${this.wrongCountOfBank(bank.id)} 题`,
                  this.repo.settings.wrongBookScopeMode === WRONG_BOOK_SCOPE_BANK &&
                  this.repo.settings.wrongBookScopeBankId === bank.id, (): void => {
                    this.repo.setWrongBookScopeMode(WRONG_BOOK_SCOPE_BANK, bank.id);
                    this.showScopeSheet = false;
                    this.tick += 1;
                  })
              }
              .padding({ left: 34 })
              .width('100%')
            }, (bank: QuizBank): string => bank.id)
          }
        }
        .width('100%')
      }, (group: ScopeGroupInfo): string => `scope-${group.name}`)
    }
    .width('100%')
  }

  @Builder
  scopeRow(title: string, sub: string, selected: boolean, onTap: () => void) {
    Row({ space: 10 }) {
      Column({ space: 2 }) {
        Text(title)
          .fontSize(15)
          .fontWeight(selected ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(MisakaColors.TEXT)
          .maxLines(1)
        Text(sub)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      if (selected) {
        Text('✓')
          .fontSize(14)
          .fontColor(MisakaColors.PRIMARY)
      }
    }
    .padding(12)
    .borderRadius(12)
    .backgroundColor(selected ? MisakaColors.PRIMARY_SOFT : Color.Transparent)
    .width('100%')
    .onClick((): void => {
      onTap();
    })
  }
}
