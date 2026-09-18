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
import { attachImages, ExtractedImportImage } from '../importer/assets/QuestionImageBinder';
import { ImportResult, ImportWarning } from '../importer/model/ImportModels';
import { Question, QuestionType, DEFAULT_BANK_GROUP_NAME } from '../domain/Models';
import { QuizRepository } from '../state/QuizRepository';

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
  @State editTypeIndex: number = 0;
  private typeOrder: string[] = [QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT];

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  private typeBadgeColor(type: string): ResourceColor {
    if (type === QuestionType.SINGLE) {
      return '#4C7DFF';
    }
    if (type === QuestionType.MULTIPLE) {
      return '#9A5CE0';
    }
    if (type === QuestionType.JUDGE) {
      return '#12A67A';
    }
    if (type === QuestionType.BLANK) {
      return '#D07A2A';
    }
    return '#8A8A8A';
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
    this.editTypeIndex = Math.max(0, this.typeOrder.indexOf(q.type));
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
        .fontColor(Color.White)
        .backgroundColor(warning.level === 'ERROR' ? '#D0483A' : '#D0902A')
        .borderRadius(4)
        .padding({ left: 5, right: 5, top: 1, bottom: 1 })
      Text(`${warning.questionNumber ?? ''} ${warning.message}`)
        .fontSize(11)
        .fontColor('#8A8A8A')
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  questionRow(q: Question, index: number) {
    Column({ space: 4 }) {
      Row({ space: 8 }) {
        Text(this.typeLabel(q.type))
          .fontSize(11)
          .fontColor(Color.White)
          .backgroundColor(this.typeBadgeColor(q.type))
          .borderRadius(4)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        Text(`第 ${q.number.length > 0 ? q.number : String(index + 1)} 题`)
          .fontSize(11)
          .fontColor('#666666')
        if (q.images.length > 0) {
          Text(`图×${q.images.length}`)
            .fontSize(11)
            .fontColor('#D07A2A')
        }
        Blank()
        Text('编辑')
          .fontSize(12)
          .fontColor('#4C7DFF')
          .onClick(() => {
            this.openEditor(index);
          })
        Text('删除')
          .fontSize(12)
          .fontColor('#D0483A')
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
          .fontColor('#12A67A')
          .width('100%')
      } else {
        Text('未识别到答案')
          .fontSize(12)
          .fontColor('#D0483A')
          .width('100%')
      }
    }
    .padding(10)
    .borderRadius(10)
    .backgroundColor('#F5F6F8')
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
        .fontColor('#666666')
        .alignSelf(ItemAlign.Start)
      Row({ space: 8 }) {
        ForEach(this.typeOrder, (type: string, typeIndex?: number) => {
          Text(this.typeLabel(type))
            .fontSize(13)
            .fontColor(this.editTypeIndex === typeIndex ? Color.White : '#333333')
            .backgroundColor(this.editTypeIndex === typeIndex ? '#4C7DFF' : '#E8EAF0')
            .borderRadius(14)
            .padding({ left: 12, right: 12, top: 5, bottom: 5 })
            .onClick(() => {
              this.editTypeIndex = typeIndex ?? 0;
            })
        }, (type: string) => type)
      }
      Text('题干')
        .fontSize(12)
        .fontColor('#666666')
        .alignSelf(ItemAlign.Start)
      TextArea({ text: this.editStem, placeholder: '题干文本' })
        .height(88)
        .fontSize(13)
        .onChange((value: string) => {
          this.editStem = value;
        })
      Text('答案（多个用顿号或逗号分隔）')
        .fontSize(12)
        .fontColor('#666666')
        .alignSelf(ItemAlign.Start)
      TextInput({ text: this.editAnswer, placeholder: '如 A 或 A、B、C' })
        .fontSize(13)
        .onChange((value: string) => {
          this.editAnswer = value;
        })
      Row({ space: 12 }) {
        Button('取消')
          .layoutWeight(1)
          .backgroundColor('#E8EAF0')
          .fontColor('#333333')
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
    .backgroundColor(Color.White)
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
            .backgroundColor('#E8EAF0')
            .fontColor('#333333')
            .enabled(!this.busy)
            .onClick(() => {
              this.showPaste = !this.showPaste;
            })
        }
        .width('100%')
        Row({ space: 8 }) {
          Button('内置示例 docx')
            .layoutWeight(1)
            .backgroundColor('#E8EAF0')
            .fontColor('#333333')
            .fontSize(12)
            .enabled(!this.busy)
            .onClick(() => {
              this.importRawfile('sample_bank.docx', 'sample_bank.docx');
            })
          Button('测试 docx')
            .layoutWeight(1)
            .backgroundColor('#E8EAF0')
            .fontColor('#333333')
            .fontSize(12)
            .enabled(!this.busy)
            .onClick(() => {
              this.importRawfile('m3_test.docx', 'm3_test.docx');
            })
          Button('测试 xlsx')
            .layoutWeight(1)
            .backgroundColor('#E8EAF0')
            .fontColor('#333333')
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
          .fontColor('#666666')
          .width('100%')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

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
        Column() {
          this.editorPanel()
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.editingIndex = -1;
        })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F0F1F4')
  }
}
