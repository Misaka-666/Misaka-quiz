/**
 * M4 题库列表 — 按分组展示，设为当前/改名/删除/进详情。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { QuizBank } from '../domain/Models';
import { MisakaColors, PillButton } from './common/QuizWidgets';

class BankGroup {
  name: string;
  banks: QuizBank[];
  constructor(name: string) {
    this.name = name;
    this.banks = [];
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
        Text('搜索')
          .fontSize(14)
          .fontColor(MisakaColors.PRIMARY)
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .onClick((): void => {
            router.pushUrl({ url: 'pages/QuestionSearchPage' });
          })
        Text(`共 ${this.repo.banks.length} 库`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column({ space: 14 }) {
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
        .padding({ left: 16, right: 16, bottom: 24 })
        .width('100%')
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
    .bindSheet($$this.showRename, this.renameSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true
    })
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

  private renameTextFor(bank: QuizBank): string {
    if (this.renamingBankId === bank.id && this.renameText.trim().length > 0) {
      return this.renameText.trim();
    }
    return bank.name;
  }

  @Builder
  renameSheet() {
    Column({ space: 14 }) {
      Text('重命名题库')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
      TextInput({ text: this.renameText, placeholder: '题库名称' })
        .onChange((value: string): void => {
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
}
