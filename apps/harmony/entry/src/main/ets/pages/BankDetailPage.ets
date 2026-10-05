/**
 * M4 题库详情 — 题目浏览（点击看全题）/斩题恢复/设为当前。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { Question, QuizBank, QuestionImage, Option } from '../domain/Models';
import { hasStructuredAnswers } from '../importer/model/MultiBlankSupport';
import { MisakaColors, TypeBadge, PillButton, InfoNotice } from './common/QuizWidgets';

@Entry
@Component
struct BankDetailPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State bankId: string = '';
  @State previewIndex: number = -1;
  @State showPreview: boolean = false;
  @State onlySlashed: boolean = false;

  private bank(): QuizBank | null {
    return this.repo.banks.find((item): boolean => item.id === this.bankId) ?? null;
  }

  private slashedOfBank(): Question[] {
    const bank = this.bank();
    if (bank === null) {
      return [];
    }
    return bank.questions.filter((question: Question): boolean => this.repo.isQuestionSlashed(bank.id, question));
  }

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    if (params !== null && params !== undefined && typeof params['bankId'] === 'string') {
      this.bankId = params['bankId'];
    }
  }

  private referenceAnswer(question: Question): string {
    if (hasStructuredAnswers(question)) {
      return question.blankAnswers.map((blanks: string[]): string => blanks[0]).join(' / ');
    }
    return question.answer.join(' / ');
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text(this.bank()?.name ?? '题库详情')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.bank() !== null && this.bankId !== this.repo.activeBankId) {
          Text('设为当前')
            .fontSize(14)
            .fontColor(MisakaColors.PRIMARY)
            .onClick((): void => {
              this.repo.setActiveBank(this.bankId);
              this.tick += 1;
            })
        }
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column({ space: 10 }) {
          InfoNotice({ text: `${this.bank()?.questions.length ?? 0} 题 · 分组「${this.bank()?.groupName ?? ''}」` +
            (this.slashedOfBank().length > 0 ? ` · 已斩 ${this.slashedOfBank().length} 题` : ''), warning: false })

          ForEach(this.bank()?.questions ?? [], (question: Question, index: number) => {
            this.questionRow(question, index)
          }, (question: Question): string => question.id)

          if (this.slashedOfBank().length > 0) {
            Text('已斩题目（可恢复）')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .margin({ top: 8 })
            ForEach(this.slashedOfBank(), (question: Question, index: number) => {
              this.slashedRow(question, index)
            }, (question: Question): string => `slashed-${question.id}`)
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
    .bindSheet($$this.showPreview, this.previewSheet(), {
      height: SheetSize.LARGE,
      dragBar: true
    })
  }

  @Builder
  questionRow(question: Question, index: number) {
    Row({ space: 10 }) {
      Text(`${index + 1}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width(32)
      TypeBadge({ type: question.type })
      Text(question.question)
        .fontSize(14)
        .fontColor(MisakaColors.TEXT)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text('›')
        .fontSize(16)
        .fontColor(MisakaColors.TEXT_SUB)
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(12)
    .width('100%')
    .onClick((): void => {
      this.previewIndex = index;
      this.showPreview = true;
    })
  }

  @Builder
  slashedRow(question: Question, _index: number) {
    Row({ space: 10 }) {
      Text(question.question)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      PillButton({ label: '恢复', primary: false, isEnabled: true, onTap: (): void => {
        const bank = this.bank();
        if (bank !== null) {
          this.repo.restoreSlashed(bank.id, question);
          this.tick += 1;
        }
      } })
    }
    .padding(10)
    .backgroundColor(MisakaColors.MUTED)
    .borderRadius(10)
    .width('100%')
  }

  @Builder
  previewSheet() {
    Scroll() {
      Column({ space: 12 }) {
        if (this.bank() !== null && this.previewIndex >= 0 && this.previewIndex < (this.bank() as QuizBank).questions.length) {
          this.previewDetail((this.bank() as QuizBank).questions[this.previewIndex])
        }
      }
      .padding(16)
      .width('100%')
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  previewDetail(question: Question) {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        TypeBadge({ type: question.type })
        if (question.number.length > 0) {
          Text(question.number)
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
        }
      }
      Text(question.question)
        .fontSize(18)
        .lineHeight(26)
        .width('100%')
      ForEach(question.images, (image: QuestionImage) => {
        Image('file://' + image.localPath)
          .width('100%')
          .height(240)
          .objectFit(ImageFit.Contain)
          .borderRadius(10)
          .backgroundColor(MisakaColors.MUTED)
      }, (image: QuestionImage): string => image.id)
      ForEach(question.options, (option: Option) => {
        Row({ space: 8 }) {
          Text(option.key)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(question.answer.some((value): boolean => value.toUpperCase() === option.key.toUpperCase())
              ? MisakaColors.GREEN : MisakaColors.TEXT)
          Text(option.text)
            .fontSize(15)
            .layoutWeight(1)
        }
        .width('100%')
      }, (option: Option): string => `${question.id}-${option.key}`)
      Text(`答案：${this.referenceAnswer(question)}`)
        .fontSize(15)
        .fontColor(MisakaColors.GREEN)
        .width('100%')
      if (question.analysis.length > 0) {
        Text('解析')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
        Text(question.analysis)
          .fontSize(14)
          .lineHeight(22)
          .width('100%')
      }
    }
    .width('100%')
  }
}
