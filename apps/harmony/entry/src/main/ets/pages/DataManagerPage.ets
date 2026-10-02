/**
 * M6 数据管理 — 导入备份（ZIP/JSON）、多选题库导出、完整备份导出、清除数据。
 * 1:1 对齐 Android DataManagementScreen（MeScreen.kt）；ZIP 经系统 picker 保存。
 */
import { router } from '@kit.ArkUI';
import { picker } from '@kit.CoreFileKit';
import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { QuizRepository } from '../state/QuizRepository';
import { QuizBank } from '../domain/Models';
import { readUriBytes, baseNameOf } from '../importer/ImportDecoder';
import { MisakaColors, PillButton, InfoNotice } from './common/QuizWidgets';

function backupTimeStamp(): string {
  const now = new Date();
  const p = (v: number): string => v.toString().padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function writeBytesToUri(uri: string, bytes: ArrayBuffer): boolean {
  try {
    const file: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    try {
      fileIo.writeSync(file.fd, bytes);
    } finally {
      fileIo.closeSync(file);
    }
    return true;
  } catch (_err) {
    return false;
  }
}

@Entry
@Component
struct DataManagerPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State busy: boolean = false;
  @State statusText: string = '';
  @State statusWarning: boolean = false;
  @State showBankSheet: boolean = false;
  @State showClearDialog: boolean = false;
  @State selectedBanks: Record<string, boolean> = {};

  onPageShow(): void {
    this.tick += 1;
  }

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private allBankIdsSelected(): boolean {
    for (const bank of this.repo.banks) {
      if (!this.selectedBanks[bank.id]) {
        return false;
      }
    }
    return this.repo.banks.length > 0;
  }

  private selectedBankIdSet(): Set<string> {
    const ids = new Set<string>();
    for (const bank of this.repo.banks) {
      if (this.selectedBanks[bank.id]) {
        ids.add(bank.id);
      }
    }
    return ids;
  }

  private report(message: string, warning: boolean): void {
    this.statusText = message;
    this.statusWarning = warning;
    this.tick += 1;
  }

  private async saveZipBytes(bytes: ArrayBuffer | null, fileName: string): Promise<void> {
    if (bytes === null) {
      this.report('导出失败：备份构建失败。', true);
      return;
    }
    try {
      const savePicker = new picker.DocumentViewPicker(this.context());
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = [fileName];
      // 打开 picker 前清状态：picker 是模态的；且系统 picker 被返回键取消时
      // save() 的 promise 可能不落地，不能把 busy/提示押在它身上
      this.statusText = '';
      this.tick += 1;
      const uris: string[] = await savePicker.save(options);
      if (uris.length === 0) {
        // 取消保存不是失败，对齐 Android：picker 取消不提示
        return;
      }
      const ok = writeBytesToUri(uris[0], bytes);
      this.report(ok ? `已导出 ZIP 备份：${fileName}` : '导出失败：无法写入文件。', !ok);
    } catch (_err) {
      this.report('导出失败：无法写入文件。', true);
    }
  }

  private async exportFull(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.report('正在构建完整备份…', false);
    const bytes = await this.repo.exportFullBackupZip();
    this.busy = false;
    await this.saveZipBytes(bytes, `misaka_full_backup_${backupTimeStamp()}.zip`);
  }

  private async exportSelected(): Promise<void> {
    const ids = this.selectedBankIdSet();
    if (ids.size === 0) {
      this.report('请至少选择一个题库。', true);
      return;
    }
    this.showBankSheet = false;
    this.busy = true;
    this.report('正在构建题库备份…', false);
    const bytes = await this.repo.exportBanksBackupZip(ids);
    this.busy = false;
    await this.saveZipBytes(bytes, `misaka_selected_banks_${backupTimeStamp()}.zip`);
  }

  private async importBackup(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const docPicker = new picker.DocumentViewPicker(this.context());
      const options: picker.DocumentSelectOptions = {
        fileSuffixFilters: ['.zip', '.json'],
        maxSelectNumber: 1
      };
      this.busy = false;
      const uris: string[] = await docPicker.select(options);
      if (uris.length === 0) {
        return;
      }
      this.busy = true;
      const bytes = readUriBytes(uris[0]);
      if (bytes === null || bytes.byteLength === 0) {
        this.report('导入失败：没有读取到有效内容。', true);
        return;
      }
      const message = await this.repo.importBackupBytes(baseNameOf(uris[0]), bytes);
      this.report(message, message.indexOf('失败') >= 0);
    } catch (_err) {
      this.report('导入失败：选择文件取消或读取失败。', true);
    }
    this.busy = false;
  }

  private confirmClear(): void {
    this.getUIContext().showAlertDialog({
      message: '确认清除本地全部数据？这会删除本地题库、错题本、学习记录和当前状态。操作不可撤销，建议先导出全部数据。',
      primaryButton: {
        value: '确认清除',
        action: (): void => {
          this.repo.clearAllLocalData();
          this.selectedBanks = {};
          this.report('已清除本地全部数据。', true);
        }
      },
      secondaryButton: { value: '取消', action: (): void => {} }
    });
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('数据管理')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        Text(this.tick >= 0 ? `${this.repo.banks.length} 个题库 · ${this.repo.totalQuestionCount()} 题` : '')
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
    .bindSheet($$this.showBankSheet, this.bankSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true
    })
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      Column({ space: 12 }) {
        Text('题库与备份')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Row({ space: 10 }) {
          this.actionTile('导入题库', '导入 ZIP / JSON', (): void => {
            this.importBackup();
          })
          this.actionTile('导出题库', '多选导出', (): void => {
            const initial: Record<string, boolean> = {};
            for (const bank of this.repo.banks) {
              initial[bank.id] = true;
            }
            this.selectedBanks = initial;
            this.showBankSheet = true;
          })
        }
        .width('100%')
        Row({ space: 10 }) {
          this.actionTile('导出全部', '完整备份', (): void => {
            this.exportFull();
          }, !this.busy && this.repo.banks.length > 0)
          this.actionTile('清除数据', '需二次确认', (): void => {
            this.confirmClear();
          }, !this.busy && this.repo.banks.length + this.repo.wrongBook.length > 0, true)
        }
        .width('100%')
        if (this.statusText.length > 0) {
          InfoNotice({ text: this.statusText, warning: this.statusWarning })
        }
      }
      .constraintSize({ maxWidth: 760 })
      .backgroundColor(MisakaColors.CARD)
      .borderRadius(12)
      .padding(14)
      .width('100%')

      InfoNotice({
        text: '完整备份包含题库、错题本、收藏夹和学习记录（含图片）；练习与外观等偏好设置不包含在备份内。导出的 ZIP 可在 Web、Android 与鸿蒙端互相导入。',
        warning: false
      })

      PillButton({
        label: '返回', primary: false, isEnabled: true, onTap: (): void => {
          router.back();
        }
      })
    }
    .width('100%')
  }

  @Builder
  actionTile(title: string, desc: string, onTap: () => void, enabled: boolean = !this.busy, warning: boolean = false) {
    Column({ space: 6 }) {
      Text(title)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(warning ? '#D05A2A' : MisakaColors.TEXT)
      Text(desc)
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
    }
    .layoutWeight(1)
    .padding({ top: 16, bottom: 16 })
    .borderRadius(10)
    .backgroundColor(warning ? '#FBE9E1' : '#F0F1F6')
    .opacity(enabled ? 1 : 0.45)
    .onClick((): void => {
      if (enabled) {
        onTap();
      }
    })
  }

  @Builder
  bankSheet() {
    Column({ space: 12 }) {
      Text('选择要导出的题库')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .width('100%')
      if (this.repo.banks.length === 0) {
        Text('当前没有可导出的题库。')
          .fontSize(14)
          .fontColor(MisakaColors.TEXT_SUB)
          .padding(12)
      } else {
        Row({ space: 10 }) {
          Text(this.allBankIdsSelected() ? '取消全选' : '全选')
            .fontSize(14)
            .fontColor(MisakaColors.PRIMARY)
            .onClick((): void => {
              const next: Record<string, boolean> = {};
              const selectAll = !this.allBankIdsSelected();
              for (const bank of this.repo.banks) {
                next[bank.id] = selectAll;
              }
              this.selectedBanks = next;
              this.tick += 1;
            })
          Blank()
          Text(`已选 ${this.selectedBankIdSet().size} 个`)
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
        }
        .width('100%')
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.repo.banks, (bank: QuizBank) => {
              Row({ space: 10 }) {
                Checkbox()
                  .select(this.selectedBanks[bank.id] ?? false)
                  .selectedColor(MisakaColors.PRIMARY)
                  .onChange((checked: boolean): void => {
                    this.selectedBanks[bank.id] = checked;
                    this.tick += 1;
                  })
                Column({ space: 2 }) {
                  Text(bank.name)
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(`${bank.groupName} · ${bank.questions.length} 题`)
                    .fontSize(12)
                    .fontColor(MisakaColors.TEXT_SUB)
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
              }
              .width('100%')
              .padding({ top: 8, bottom: 8 })
            }, (bank: QuizBank): string => bank.id)
          }
          .width('100%')
        }
        .layoutWeight(1)
        .constraintSize({ maxHeight: 420 })
        .scrollBar(BarState.Off)
      }
      PillButton({
        label: '导出选中', primary: true, isEnabled: this.selectedBankIdSet().size > 0, onTap: (): void => {
          this.exportSelected();
        }
      })
    }
    .width('100%')
    .padding(16)
    .backgroundColor(MisakaColors.BG)
  }
}
