/**
 * M5 记录详情 — 摘要（题量/时间/用时/正确率/得分）+ 逐题结果（题目/选项/你的答案/正确答案/解析），
 * 支持只看错题。1:1 对齐 Android RecordDetailScreen。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { StudyRecord, StudyQuestionResult, Option } from '../domain/Models';
import { hasStructuredAnswers, expectedAnswerText, userAnswerText } from '../importer/model/MultiBlankSupport';
import {
  MisakaColors, PillButton, StatusChip, TypeBadge, InfoNotice,
  formatShortTimestamp, formatClockSeconds, formatScoreValue
} from './common/QuizWidgets';

@Entry
@Component
struct RecordDetailPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State recordId: string = '';
  @State wrongOnly: boolean = false;

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    if (params !== null && params !== undefined && typeof params['recordId'] === 'string') {
      this.recordId = params['recordId'];
    }
  }

  private record(): StudyRecord | null {
    return this.repo.findStudyRecord(this.recordId);
  }

  private visibleResults(): StudyQuestionResult[] {
    const record = this.record();
    if (record === null) {
      return [];
    }
    if (!this.wrongOnly) {
      return record.questionResults;
    }
    return record.questionResults.filter((result): boolean => !result.correct);
  }

  private userAnswerDisplay(result: StudyQuestionResult): string {
    const question = result.question;
    if (hasStructuredAnswers(question)) {
      const blanks = result.userBlankAnswers.length > 0 ? result.userBlankAnswers : result.userAnswer;
      return `你的答案：\n${userAnswerText(blanks)}`;
    }
    const text = result.userAnswer.join(' / ');
    return `你的答案：${text.length > 0 ? text : '未作答'}`;
  }

  private correctAnswerDisplay(result: StudyQuestionResult): string {
    const question = result.question;
    if (hasStructuredAnswers(question)) {
      const text = result.answerText.trim().length > 0
        ? result.answerText : expectedAnswerText(question.blankAnswers);
      return `正确答案：\n${text}`;
    }
    const text = result.answerText.length > 0 ? result.answerText : question.answer.join(' / ');
    return `正确答案：${text.length > 0 ? text : '未识别答案'}`;
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('记录详情')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
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
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      if (this.record() === null) {
        Column({ space: 12 }) {
          InfoNotice({ text: '没有找到这条学习记录。', warning: true })
          Row() {
            PillButton({ label: '返回记录', primary: false, isEnabled: true, grow: false, onTap: (): void => {
              router.back();
            } })
          }
          .width('100%')
        }
        .width('100%')
      } else {
        this.summaryCard(this.record() as StudyRecord)
        if ((this.record() as StudyRecord).questionResults.length === 0) {
          InfoNotice({ text: '这是一条旧记录，当时没有保存逐题详情，只能查看摘要。' })
        } else {
          Row({ space: 8 }) {
            PillButton({ label: '全部题目', primary: !this.wrongOnly, isEnabled: true, grow: true, onTap: (): void => {
              this.wrongOnly = false;
              this.tick += 1;
            } })
            PillButton({ label: '只看错题', primary: this.wrongOnly, isEnabled: true, grow: true, onTap: (): void => {
              this.wrongOnly = true;
              this.tick += 1;
            } })
          }
          .width('100%')

          if (this.visibleResults().length === 0) {
            InfoNotice({ text: '这条记录里没有错题。' })
          } else {
            ForEach(this.visibleResults(), (result: StudyQuestionResult, index: number) => {
              this.questionCard(index, result)
            }, (result: StudyQuestionResult, index: number): string => `${index}-${result.question.id}`)
          }
        }
      }
    }
    .constraintSize({ maxWidth: 760 })
    .width('100%')
  }

  @Builder
  summaryCard(record: StudyRecord) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Row({ space: 8 }) {
          StatusChip({ label: record.source, tone: 'primary' })
          StatusChip({ label: record.bankName })
        }
        .layoutWeight(1)
      }
      .width('100%')
      Text(record.title.trim().length > 0 ? record.title : '学习记录')
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .maxLines(2)
        .width('100%')
      Text(`题量：${record.total} 题`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(`进入时间：${formatShortTimestamp(record.startedAt !== null ? record.startedAt : record.timestamp)}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(`完成时间：${formatShortTimestamp(record.timestamp)}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(`用时：${record.durationSeconds !== null ? formatClockSeconds(record.durationSeconds) : '未记录'}${record.autoSubmitted ? ' · 自动交卷' : ''}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(`正确：${record.correct} 题 · 错误：${Math.max(0, record.total - record.correct)} 题 · 正确率：${record.total === 0 ? 0 : Math.floor(record.correct * 100 / record.total)}%`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      if (record.totalScore !== null && record.earnedScore !== null) {
        Text(`得分：${formatScoreValue(record.earnedScore)} / ${formatScoreValue(record.totalScore)} 分`)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(MisakaColors.PRIMARY)
          .width('100%')
      }
    }
    .padding(16)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
  }

  @Builder
  questionCard(index: number, result: StudyQuestionResult) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Row({ space: 8 }) {
          StatusChip({ label: `第 ${index + 1} 题`, tone: 'primary' })
          TypeBadge({ type: result.question.type })
        }
        .layoutWeight(1)
        StatusChip({ label: result.correct ? '正确' : '错误', tone: result.correct ? 'green' : 'red' })
      }
      .width('100%')
      if (result.sourceBankName !== null && result.sourceBankName.length > 0) {
        Text(`来源：${result.sourceBankName}`)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
      }
      Text(result.question.question)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .width('100%')
      ForEach(result.question.options, (option: Option) => {
        Text(`${option.key}. ${option.text}`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
      }, (option: Option): string => option.key)
      Text(this.userAnswerDisplay(result))
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      Text(this.correctAnswerDisplay(result))
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')
      if (result.maxScore !== null && result.earnedScore !== null) {
        Text(`得分：${formatScoreValue(result.earnedScore)} / ${formatScoreValue(result.maxScore)} 分`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
      }
      if (result.question.analysis.trim().length > 0) {
        Text(`解析：${result.question.analysis}`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
      }
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
  }
}
