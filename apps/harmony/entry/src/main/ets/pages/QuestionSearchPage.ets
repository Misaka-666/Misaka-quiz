/**
 * M5 题目搜索 — 关键词（题干/选项/答案/解析）、范围（当前库/全部/指定库）、结果展开与定位到题库。
 * 1:1 对齐 Android QuestionSearchScreen。搜索框在 parity 重建区外，输入焦点不受 bump 影响。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { QuestionSearchResult, searchQuestions } from '../state/QuestionSearch';
import { Question, QuizBank, Option, DEFAULT_BANK_GROUP_NAME } from '../domain/Models';
import { hasStructuredAnswers, expectedAnswerText } from '../importer/model/MultiBlankSupport';
import {
  MisakaColors, PillButton, StatusChip, typeLabel
} from './common/QuizWidgets';

class BankGroupEntry {
  name: string;
  banks: QuizBank[];
  constructor(name: string) {
    this.name = name;
    this.banks = [];
  }
}

@Entry
@Component
struct QuestionSearchPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State query: string = '';
  @State scopeKey: string = 'active';
  @State showScopeSheet: boolean = false;
  @State expandedKeys: string[] = [];

  aboutToAppear(): void {
    this.scopeKey = this.repo.activeBank() !== null ? 'active' : 'all';
  }

  onPageShow(): void {
    this.tick += 1;
  }

  private results(): QuestionSearchResult[] {
    const active = this.repo.activeBank();
    return searchQuestions(this.repo.banks, active !== null ? active.id : null, this.query, this.scopeKey);
  }

  private scopeLabel(): string {
    const active = this.repo.activeBank();
    if (this.scopeKey === 'active' && active !== null) {
      return `当前题库：${active.name}`;
    }
    if (this.scopeKey === 'all') {
      return '全部题库';
    }
    if (this.scopeKey.startsWith('bank:')) {
      const bankId = this.scopeKey.substring('bank:'.length);
      const bank = this.repo.banks.find((item): boolean => item.id === bankId);
      return bank !== undefined ? `指定题库：${bank.name}` : '指定题库';
    }
    return '全部题库';
  }

  private groupedBanks(): BankGroupEntry[] {
    const entries: BankGroupEntry[] = [];
    for (const bank of this.repo.banks) {
      const group = bank.groupName.trim().length > 0 ? bank.groupName : DEFAULT_BANK_GROUP_NAME;
      let entry = entries.find((item): boolean => item.name === group);
      if (entry === undefined) {
        entry = new BankGroupEntry(group);
        entries.push(entry);
      }
      entry.banks.push(bank);
    }
    entries.sort((a: BankGroupEntry, b: BankGroupEntry): number => {
      if ((a.name === DEFAULT_BANK_GROUP_NAME) !== (b.name === DEFAULT_BANK_GROUP_NAME)) {
        return a.name === DEFAULT_BANK_GROUP_NAME ? 1 : -1;
      }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return entries;
  }

  private answerText(question: Question): string {
    if (hasStructuredAnswers(question)) {
      return expectedAnswerText(question.blankAnswers);
    }
    return question.answer.join('、');
  }

  private isExpanded(result: QuestionSearchResult): boolean {
    return this.expandedKeys.includes(result.resultKey());
  }

  private toggleExpanded(result: QuestionSearchResult): void {
    const key = result.resultKey();
    this.expandedKeys = this.isExpanded(result)
      ? this.expandedKeys.filter((item): boolean => item !== key)
      : this.expandedKeys.concat([key]);
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
        Text('题目搜索')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
      }
      .width('100%')
      .padding(16)

      Column({ space: 10 }) {
        Row({ space: 10 }) {
          Column({ space: 2 }) {
            Text(this.scopeLabel())
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .maxLines(1)
              .width('100%')
            Text('可切换当前题库、全部题库或指定题库')
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
              .maxLines(1)
              .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('▾')
            .fontSize(14)
            .fontColor(MisakaColors.PRIMARY)
        }
        .padding(12)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(12)
        .border({ width: 1, color: MisakaColors.BORDER })
        .width('100%')
        .onClick((): void => {
          this.showScopeSheet = true;
        })

        TextInput({ text: this.query, placeholder: '搜题干、选项、答案或解析' })
          .fontSize(14)
          .backgroundColor(MisakaColors.CARD)
          .borderRadius(12)
          .onChange((value: string): void => {
            this.query = value;
          })
      }
      .constraintSize({ maxWidth: 760 })
      .width('100%')
      .padding({ left: 16, right: 16 })

      Scroll() {
        Column() {
          if (this.tick % 2 === 0) {
            this.resultBody()
          } else {
            this.resultBody()
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ left: 16, right: 16, top: 12, bottom: 24 })
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
  resultBody() {
    Column({ space: 14 }) {
      if (this.query.trim().length === 0) {
        Column({ space: 8 }) {
          Text('输入关键词开始搜索')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Text('可以输入题干片段、选项内容、答案或解析里的关键词。')
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
        }
        .padding(20)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')
      } else if (this.results().length === 0) {
        Column({ space: 8 }) {
          Text('没有找到相关题目')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Text('可以换一个关键词，或切换到全部题库搜索。')
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
        }
        .padding(20)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')
      } else {
        Text(`共找到 ${this.results().length} 题`)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        ForEach(this.results(), (result: QuestionSearchResult) => {
          this.resultCard(result)
        }, (result: QuestionSearchResult): string => result.resultKey())
      }
    }
    .constraintSize({ maxWidth: 760 })
    .width('100%')
  }

  @Builder
  resultCard(result: QuestionSearchResult) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          Text(`${result.groupName} / ${result.bankName}`)
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
            .maxLines(1)
            .width('100%')
          Text(`第 ${result.questionIndex} 题 · ${typeLabel(result.question.type)}`)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        StatusChip({ label: this.isExpanded(result) ? '收起' : '展开', tone: this.isExpanded(result) ? 'primary' : 'neutral' })
      }
      .width('100%')

      Text(result.question.question.trim().length > 0 ? result.question.question : '（空题干）')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .maxLines(this.isExpanded(result) ? 10 : 3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')

      Text(`命中：${result.matchedFields.join('、')}`)
        .fontSize(12)
        .fontColor(MisakaColors.PRIMARY)
        .width('100%')

      if (this.answerText(result.question).length > 0) {
        Text(`答案：${this.answerText(result.question)}`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
          .maxLines(this.isExpanded(result) ? 10 : 1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }

      if (this.isExpanded(result)) {
        Divider().color(MisakaColors.BORDER)
        ForEach(result.question.options, (option: Option) => {
          Text(`${option.key}. ${option.text}`)
            .fontSize(13)
            .width('100%')
        }, (option: Option): string => option.key)
        if (result.question.analysis.trim().length > 0) {
          Text(`解析：${result.question.analysis}`)
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
            .width('100%')
        }
        if (result.question.category.trim().length > 0) {
          Text(`分类：${result.question.category}`)
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
            .width('100%')
        }
        Row() {
          PillButton({ label: '查看所在题库', primary: false, isEnabled: true, grow: false, onTap: (): void => {
            router.pushUrl({ url: 'pages/BankDetailPage', params: { bankId: result.bankId } });
          } })
        }
        .width('100%')
      }
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
    .onClick((): void => {
      this.toggleExpanded(result);
    })
  }

  @Builder
  scopeSheet() {
    Column({ space: 8 }) {
      Text('选择搜索范围')
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
        PillButton({ label: '关闭', primary: false, isEnabled: true, grow: true, onTap: (): void => {
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
        this.scopeRow(`当前题库：${(this.repo.activeBank() as QuizBank).name}`,
          `${(this.repo.activeBank() as QuizBank).questions.length} 题`, this.scopeKey === 'active', (): void => {
            this.scopeKey = 'active';
            this.showScopeSheet = false;
            this.tick += 1;
          })
      }
      this.scopeRow('全部题库', '搜索所有分组和题库', this.scopeKey === 'all', (): void => {
        this.scopeKey = 'all';
        this.showScopeSheet = false;
        this.tick += 1;
      })
      ForEach(this.groupedBanks(), (group: BankGroupEntry) => {
        Column({ space: 4 }) {
          Text(group.name)
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
            .padding({ top: 6, left: 4 })
            .width('100%')
          ForEach(group.banks, (bank: QuizBank) => {
            this.scopeRow(bank.name, `${bank.questions.length} 题`, this.scopeKey === `bank:${bank.id}`, (): void => {
              this.scopeKey = `bank:${bank.id}`;
              this.showScopeSheet = false;
              this.tick += 1;
            })
          }, (bank: QuizBank): string => bank.id)
        }
        .width('100%')
      }, (group: BankGroupEntry): string => `search-${group.name}`)
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
