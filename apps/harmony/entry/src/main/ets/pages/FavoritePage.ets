/**
 * M5 收藏夹 — 分组/题库二级筛选、取消收藏、收藏练习。1:1 对齐 Android FavoriteScreen。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { FavoriteQuestionEntry, Question, QuizBank, DEFAULT_BANK_GROUP_NAME } from '../domain/Models';
import { hasStructuredAnswers, expectedAnswerText } from '../importer/model/MultiBlankSupport';
import {
  MisakaColors, PillButton, StatusChip, TypeBadge, formatShortTimestamp
} from './common/QuizWidgets';

class FavGroupInfo {
  name: string;
  banks: QuizBank[];
  favCount: number;
  constructor(name: string) {
    this.name = name;
    this.banks = [];
    this.favCount = 0;
  }
}

@Entry
@Component
struct FavoritePage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State favGroupFilter: string | null = null;
  @State favBankFilter: string | null = null;
  @State showGroupSheet: boolean = false;
  @State expandedGroups: string[] = [];

  onPageShow(): void {
    this.tick += 1;
  }

  private favorites(): FavoriteQuestionEntry[] {
    return this.repo.favoriteQuestions;
  }

  private groupNameOf(entry: FavoriteQuestionEntry): string {
    const bank = this.repo.banks.find((item): boolean => item.id === entry.bankId);
    if (bank !== undefined && bank.groupName.trim().length > 0) {
      return bank.groupName;
    }
    return DEFAULT_BANK_GROUP_NAME;
  }

  private filtered(): FavoriteQuestionEntry[] {
    if (this.favBankFilter !== null) {
      return this.favorites().filter((entry): boolean => entry.bankId === this.favBankFilter);
    }
    if (this.favGroupFilter !== null) {
      return this.favorites().filter((entry): boolean => this.groupNameOf(entry) === this.favGroupFilter);
    }
    return this.favorites();
  }

  private filterLabel(): string {
    if (this.favBankFilter !== null) {
      const bank = this.repo.banks.find((item): boolean => item.id === this.favBankFilter);
      return bank !== undefined ? bank.name : '题库';
    }
    if (this.favGroupFilter !== null) {
      return this.favGroupFilter as string;
    }
    return '按分组';
  }

  private favCountOfBank(bankId: string): number {
    return this.favorites().filter((entry): boolean => entry.bankId === bankId).length;
  }

  private favGroups(): FavGroupInfo[] {
    const infos: FavGroupInfo[] = [];
    for (const bank of this.repo.banks) {
      if (!this.favorites().some((entry): boolean => entry.bankId === bank.id)) {
        continue;
      }
      const group = bank.groupName.trim().length > 0 ? bank.groupName : DEFAULT_BANK_GROUP_NAME;
      let info = infos.find((item): boolean => item.name === group);
      if (info === undefined) {
        info = new FavGroupInfo(group);
        infos.push(info);
      }
      info.banks.push(bank);
    }
    for (const info of infos) {
      info.favCount = this.favorites().filter((entry): boolean => this.groupNameOf(entry) === info.name).length;
    }
    infos.sort((a: FavGroupInfo, b: FavGroupInfo): number => {
      if ((a.name === DEFAULT_BANK_GROUP_NAME) !== (b.name === DEFAULT_BANK_GROUP_NAME)) {
        return a.name === DEFAULT_BANK_GROUP_NAME ? 1 : -1;
      }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return infos;
  }

  private correctAnswerText(question: Question): string {
    if (hasStructuredAnswers(question)) {
      return expectedAnswerText(question.blankAnswers);
    }
    const text = question.answer.join(' / ');
    return text.length > 0 ? text : '未识别答案';
  }

  private startPractice(): void {
    if (this.repo.startFavoritePractice(this.filtered())) {
      router.pushUrl({ url: 'pages/PracticePage' });
    }
  }

  private isGroupExpanded(group: string): boolean {
    return this.expandedGroups.includes(group);
  }

  private toggleGroupExpanded(group: string): void {
    this.expandedGroups = this.isGroupExpanded(group)
      ? this.expandedGroups.filter((name): boolean => name !== group)
      : this.expandedGroups.concat([group]);
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
        Text('收藏夹')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        // 引用 tick 使仓库计数变更（取消收藏）时随 parity 重建一起刷新
        Text(this.tick >= 0 ? `共 ${this.repo.favoriteQuestions.length} 题` : '')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
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
    .bindSheet($$this.showGroupSheet, this.groupSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true
    })
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      if (this.favorites().length === 0) {
        Column({ space: 12 }) {
          Text('收藏夹还是空的')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
          Text('练习时点击题目右上角星标即可收藏。')
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
          Row() {
            PillButton({ label: '返回首页', primary: false, isEnabled: true, grow: false, onTap: (): void => {
              router.back();
            } })
          }
          .width('100%')
        }
        .padding(24)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')
      } else {
        Column({ space: 12 }) {
          Row({ space: 10 }) {
            Text(`收藏 ${this.filtered().length} 题`)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .layoutWeight(1)
            Row() {
              PillButton({ label: this.filterLabel(), primary: this.favGroupFilter !== null || this.favBankFilter !== null,
                isEnabled: true, grow: false, onTap: (): void => {
                  this.showGroupSheet = true;
                } })
            }
          }
          .width('100%')
          Text('收藏夹由你手动标记，可用于集中回看和再次练习。')
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
          Row({ space: 10 }) {
            PillButton({ label: '练习收藏题', primary: true, isEnabled: this.filtered().length > 0, grow: true, onTap: (): void => {
              this.startPractice();
            } })
            PillButton({ label: '返回', primary: false, isEnabled: true, grow: true, onTap: (): void => {
              router.back();
            } })
          }
          .width('100%')
        }
        .padding(16)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')

        ForEach(this.filtered(), (entry: FavoriteQuestionEntry) => {
          this.favCard(entry)
        }, (entry: FavoriteQuestionEntry): string => `${entry.bankId}#${entry.question.id}`)
      }
    }
    .constraintSize({ maxWidth: 760 })
    .width('100%')
  }

  @Builder
  favCard(entry: FavoriteQuestionEntry) {
    Column({ space: 10 }) {
      Row({ space: 6 }) {
        Row({ space: 6 }) {
          TypeBadge({ type: entry.question.type })
          StatusChip({ label: entry.bankName })
          StatusChip({ label: `收藏 ${formatShortTimestamp(entry.favoritedAt)}` })
        }
        .layoutWeight(1)
        Text('★')
          .fontSize(18)
          .fontColor(MisakaColors.PRIMARY)
          .onClick((): void => {
            this.repo.removeFavoriteQuestion(entry.bankId, entry.question.id);
            this.tick += 1;
          })
      }
      .width('100%')
      Text(`${entry.question.number}. ${entry.question.question}`)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      Text(`正确答案：${this.correctAnswerText(entry.question)}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      if (entry.question.analysis.trim().length > 0) {
        Text(`解析：${entry.question.analysis}`)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
      }
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
  }

  @Builder
  groupSheet() {
    Column({ space: 8 }) {
      Text('选择分组')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .padding({ top: 8 })
      Scroll() {
        Column({ space: 4 }) {
          if (this.tick % 2 === 0) {
            this.groupSheetBody()
          } else {
            this.groupSheetBody()
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
          this.showGroupSheet = false;
        } })
      }
      .width('100%')
      .padding({ top: 4 })
    }
    .padding(20)
    .width('100%')
  }

  @Builder
  groupSheetBody() {
    Column({ space: 4 }) {
      this.groupRow('全部', `${this.favorites().length} 题`,
        this.favGroupFilter === null && this.favBankFilter === null, (): void => {
          this.favGroupFilter = null;
          this.favBankFilter = null;
          this.showGroupSheet = false;
          this.tick += 1;
        })
      ForEach(this.favGroups(), (group: FavGroupInfo) => {
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
            this.groupRow(group.name, `${group.favCount} 题`,
              this.favGroupFilter === group.name && this.favBankFilter === null, (): void => {
                this.favGroupFilter = group.name;
                this.favBankFilter = null;
                this.showGroupSheet = false;
                this.tick += 1;
              })
          }
          .width('100%')
          if (this.isGroupExpanded(group.name)) {
            ForEach(group.banks, (bank: QuizBank) => {
              Row() {
                this.groupRow(bank.name, `${this.favCountOfBank(bank.id)} 题`,
                  this.favBankFilter === bank.id, (): void => {
                    this.favGroupFilter = null;
                    this.favBankFilter = bank.id;
                    this.showGroupSheet = false;
                    this.tick += 1;
                  })
              }
              .padding({ left: 34 })
              .width('100%')
            }, (bank: QuizBank): string => bank.id)
          }
        }
        .width('100%')
      }, (group: FavGroupInfo): string => `fav-${group.name}`)
    }
    .width('100%')
  }

  @Builder
  groupRow(title: string, sub: string, selected: boolean, onTap: () => void) {
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
