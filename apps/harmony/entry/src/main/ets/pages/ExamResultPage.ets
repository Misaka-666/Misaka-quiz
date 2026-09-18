/**
 * M4 考试成绩页 — 总分/正确率/用时 + 逐题明细（对错/得分/答案对照）。
 * 数据源：repo.exam（交卷后保持 finished 态与 lastRecord 直到离开）。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { Question, StudyQuestionResult } from '../domain/Models';
import { hasStructuredAnswers } from '../importer/model/MultiBlankSupport';
import { MisakaColors, TypeBadge, PillButton, formatClockSeconds } from './common/QuizWidgets';

@Entry
@Component
struct ExamResultPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;

  private hasResult(): boolean {
    return this.repo.exam.finished && this.repo.exam.questions.length > 0;
  }

  private scoreText(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  private resultAt(index: number): StudyQuestionResult | null {
    const record = this.repo.exam.lastRecord;
    if (record === null || index >= record.questionResults.length) {
      return null;
    }
    return record.questionResults[index];
  }

  aboutToAppear(): void {
    if (!this.hasResult()) {
      router.back();
    }
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('成绩报告')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column({ space: 14 }) {
          if (this.hasResult()) {
            Column({ space: 6 }) {
              Text(`${this.scoreText(this.repo.exam.earnedScore())} / ${this.scoreText(this.repo.exam.totalScore())}`)
                .fontSize(40)
                .fontWeight(FontWeight.Bold)
                .fontColor(MisakaColors.PRIMARY)
              Text(`答对 ${this.repo.exam.correctCount()} / ${this.repo.exam.questions.length} 题 · ` +
                `正确率 ${Math.round(this.repo.exam.correctCount() * 100 / Math.max(1, this.repo.exam.questions.length))}%`)
                .fontSize(14)
                .fontColor(MisakaColors.TEXT_SUB)
              Text(`用时 ${formatClockSeconds(this.repo.exam.durationSeconds - this.repo.exam.remainingSeconds)}` +
                (this.repo.exam.autoSubmitted ? ' · 已到时自动交卷' : ''))
                .fontSize(13)
                .fontColor(MisakaColors.TEXT_SUB)
            }
            .width('100%')
            .padding(20)
            .backgroundColor(MisakaColors.CARD)
            .borderRadius(16)

            ForEach(this.repo.exam.questions, (question: Question, index: number) => {
              this.resultRow(question, index)
            }, (question: Question, index: number): string => `res-${question.id}-${index}`)

            Column() {
              PillButton({ label: '返回', primary: true, isEnabled: true, onTap: (): void => {
                this.repo.exam.reset();
                router.back();
              } })
            }
            .width('100%')
            .margin({ bottom: 24 })
          }
        }
        .padding({ left: 16, right: 16 })
        .width('100%')
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
  }

  @Builder
  resultRow(question: Question, index: number) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Text(`${index + 1}`)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
        TypeBadge({ type: question.type })
        if (this.resultAt(index) !== null && (this.resultAt(index) as StudyQuestionResult).autoScored) {
          if ((this.resultAt(index) as StudyQuestionResult).correct) {
            Text('✓ 正确')
              .fontSize(13)
              .fontColor(MisakaColors.GREEN)
          } else {
            Text('✗ 错误')
              .fontSize(13)
              .fontColor(MisakaColors.RED)
          }
          Text(`${this.scoreText((this.resultAt(index) as StudyQuestionResult).earnedScore !== null ? (this.resultAt(index) as StudyQuestionResult).earnedScore as number : 0)}/${this.scoreText((this.resultAt(index) as StudyQuestionResult).maxScore !== null ? (this.resultAt(index) as StudyQuestionResult).maxScore as number : 0)} 分`)
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
        } else {
          Text('主观题 · 不自动判分')
            .fontSize(13)
            .fontColor(MisakaColors.AMBER)
        }
        Blank()
        Text(`本题 ${this.scoreText(this.repo.exam.scoreForQuestion(question))} 分`)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .width('100%')
      Text(question.question)
        .fontSize(14)
        .fontColor(MisakaColors.TEXT)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      if (this.resultAt(index) !== null) {
        Text(`你的答案：${(this.resultAt(index) as StudyQuestionResult).userAnswer.length > 0 ? (this.resultAt(index) as StudyQuestionResult).userAnswer.join('、') : '未作答'}`)
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
      }
      Text(`正确答案：${this.referenceAnswer(question)}`)
        .fontSize(13)
        .fontColor(MisakaColors.GREEN)
        .width('100%')
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(12)
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  private referenceAnswer(question: Question): string {
    if (hasStructuredAnswers(question)) {
      const expected = question.blankAnswers.map((blanks: string[]): string => blanks[0]).join(' / ');
      return expected.length > 0 ? expected : '—';
    }
    return question.answer.join(' / ').length > 0 ? question.answer.join(' / ') : '—';
  }
}
