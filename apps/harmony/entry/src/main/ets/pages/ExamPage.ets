/**
 * M4 考试页 — 倒计时/答题/答题卡/交卷。阔折叠宽屏：左答题卡常驻。
 * 交卷（手动/到点自动）后跳 ExamResultPage。
 */
import { mediaquery, router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { Question, QuestionType, QuestionImage } from '../domain/Models';
import { hasStructuredAnswers } from '../importer/model/MultiBlankSupport';
import { ExamSessionCore } from '../state/ExamSessionCore';
import { practiceDisplayOptions, PracticeDisplayOption } from '../state/OptionShuffle';
import {
  MisakaColors, TypeBadge, PillButton, ChoiceCard, formatClockSeconds
} from './common/QuizWidgets';

@Entry
@Component
struct ExamPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  private exam: ExamSessionCore = QuizRepository.getInstance().exam;
  @State tick: number = 0;
  // 秒级时钟专用：只驱动 header 倒计时/已答数/进度条表达式。此前每秒 bump 走奇偶换支
  // 会整树销毁重建（滚动复位/输入中断）。升级路径：会话核心 @ObservedV2/@Trace 化后可删。
  @State clockTick: number = 0;
  @State textAnswer: string = '';
  @State blankAnswers: string[] = [];
  @State showSheet: boolean = false;
  @State isWide: boolean = false;
  private timerId: number = -1;
  // 阔折叠双栏断点监听（对齐 PracticePage/Index 已验证模式）：考试中折叠/展开实时切换单双栏
  private wideListener: mediaquery.MediaQueryListener | null = null;

  private bump(): void {
    this.tick += 1;
  }

  private sessionKey(): string {
    const question = this.exam.currentQuestion();
    return question !== null ? `${question.id}#${this.exam.index}` : '';
  }

  private currentDisplayOptions(): PracticeDisplayOption[] {
    const question = this.exam.currentQuestion();
    if (question === null) {
      return [];
    }
    const options = practiceDisplayOptions(question, this.exam.optionShuffleSessionEnabled,
      this.exam.optionShuffleSeed, this.sessionKey());
    if (options.length === 0 && question.type === QuestionType.JUDGE) {
      return [new PracticeDisplayOption('A', 'A', '正确'), new PracticeDisplayOption('B', 'B', '错误')];
    }
    return options;
  }

  private isSelectedKey(option: PracticeDisplayOption): boolean {
    const question = this.exam.currentQuestion();
    if (question === null) {
      return false;
    }
    return this.exam.answerOf(question).some((value): boolean => value.trim().toUpperCase() === option.originalKey.trim().toUpperCase());
  }

  private syncTextMirrors(): void {
    const question = this.exam.currentQuestion();
    if (question === null) {
      return;
    }
    const answer = this.exam.answerOf(question);
    if (hasStructuredAnswers(question)) {
      const next: string[] = [];
      for (let i = 0; i < question.blankAnswers.length; i++) {
        next.push(i < answer.length ? answer[i] : '');
      }
      this.blankAnswers = next;
      this.textAnswer = '';
    } else {
      this.textAnswer = answer.length > 0 ? answer[0] : '';
      this.blankAnswers = [];
    }
  }

  private onOptionTap(option: PracticeDisplayOption): void {
    const question = this.exam.currentQuestion();
    if (question === null || this.exam.finished) {
      return;
    }
    this.exam.toggleAnswer(option.originalKey, question.type === QuestionType.MULTIPLE);
    this.bump();
  }

  private submitExam(autoSubmitted: boolean): void {
    if (this.exam.finished) {
      return;
    }
    this.exam.submit(autoSubmitted);
    router.replaceUrl({ url: 'pages/ExamResultPage' });
  }

  private confirmSubmit(): void {
    const unanswered = this.exam.questions.length - this.exam.answeredCount();
    const ui = this.getUIContext();
    if (unanswered > 0) {
      ui.showAlertDialog({
        message: `还有 ${unanswered} 题未作答，确定交卷吗？`,
        primaryButton: {
          value: '交卷',
          action: (): void => {
            this.submitExam(false);
          }
        },
        secondaryButton: {
          value: '继续作答',
          action: (): void => {
          }
        }
      });
    } else {
      this.submitExam(false);
    }
  }

  aboutToAppear(): void {
    if (this.exam.questions.length === 0 || this.exam.finished) {
      router.replaceUrl({ url: 'pages/ExamResultPage' });
      return;
    }
    this.syncTextMirrors();
    this.wideListener = mediaquery.matchMediaSync('(min-width: 540vp)');
    this.isWide = this.wideListener.matches;
    this.wideListener.on('change', (result: mediaquery.MediaQueryResult): void => {
      this.isWide = result.matches;
      this.bump();
    });
    this.timerId = setInterval((): void => {
      if (this.exam.finished) {
        return;
      }
      this.exam.tick();
      this.clockTick += 1;
      if (this.exam.finished) {
        router.replaceUrl({ url: 'pages/ExamResultPage' });
      }
    }, 1000);
  }

  aboutToDisappear(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
    if (this.wideListener !== null) {
      this.wideListener.off('change');
      this.wideListener = null;
    }
  }

  @Builder
  questionPane() {
    Scroll() {
      Column({ space: 14 }) {
        Row({ space: 10 }) {
          TypeBadge({ type: this.exam.currentQuestion()?.type ?? QuestionType.SINGLE })
          Text(`第 ${this.exam.index + 1}/${this.exam.questions.length} 题`)
            .fontSize(14)
            .fontColor(MisakaColors.TEXT_SUB)
        }
        .width('100%')
        ForEach(this.exam.questions, (question: Question, index: number) => {
          if (index === this.exam.index) {
            Column({ space: 14 }) {
              Text(question.question)
                .fontSize(this.repo.settings.questionFontSizeSp())
                .lineHeight(this.repo.settings.questionLineHeightSp())
                .width('100%')
              ForEach(question.images, (image: QuestionImage) => {
                Image('file://' + image.localPath)
                  .width('100%')
                  .height(220)
                  .objectFit(ImageFit.Contain)
                  .borderRadius(10)
                  .backgroundColor(MisakaColors.MUTED)
              }, (image: QuestionImage): string => image.id)
              this.answerArea(question);
            }
            .width('100%')
          }
        }, (question: Question, index: number): string => `exam-${question.id}-${index}`)
      }
      .padding(16)
      .width('100%')
    }
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
    .width('100%')
    .layoutWeight(1)
    .gesture(PanGesture({ fingers: 1, direction: PanDirection.Horizontal })
      .onActionEnd((event: GestureEvent): void => {
        if (Math.abs(event.offsetX) < 60) {
          return;
        }
        if (event.offsetX < 0) {
          this.exam.nextQuestion();
        } else {
          this.exam.previousQuestion();
        }
        this.syncTextMirrors();
        this.bump();
      }))
  }

  @Builder
  answerArea(question: Question) {
    Column({ space: 10 }) {
      if (question.type === QuestionType.SINGLE || question.type === QuestionType.MULTIPLE ||
        question.type === QuestionType.JUDGE) {
        ForEach(this.currentDisplayOptions(), (option: PracticeDisplayOption) => {
          ChoiceCard({ label: option.displayKey, text: option.text, selected: this.isSelectedKey(option), state: 'idle', fontSize: this.repo.settings.optionFontSizeSp(), lineHeight: this.repo.settings.optionLineHeightSp(), onTap: (): void => {
              this.onOptionTap(option);
            } })
        }, (option: PracticeDisplayOption): string => option.displayKey + option.originalKey)
      } else if (question.type === QuestionType.BLANK && hasStructuredAnswers(question)) {
        ForEach(question.blankAnswers, (_blanks: string[], blankIndex: number) => {
          Row({ space: 10 }) {
            Text(`第 ${blankIndex + 1} 空`)
              .fontSize(14)
              .fontColor(MisakaColors.TEXT_SUB)
              .width(56)
            TextInput({
              text: blankIndex < this.blankAnswers.length ? this.blankAnswers[blankIndex] : '',
              placeholder: '输入答案'
            })
              .fontSize(15)
              .layoutWeight(1)
              .onChange((value: string): void => {
                this.exam.updateBlankAnswer(blankIndex, value);
              })
          }
          .width('100%')
        }, (_blanks: string[], blankIndex: number): string => `exam-blank-${blankIndex}`)
      } else {
        TextArea({ text: this.textAnswer, placeholder: question.type === QuestionType.BLANK ? '输入答案' : '输入你的回答' })
          .fontSize(15)
          .height(96)
          .width('100%')
          .onChange((value: string): void => {
            this.textAnswer = value;
            this.exam.updateTextAnswer(value);
          })
      }
    }
    .width('100%')
  }

  @Builder
  sheetGrid() {
    Grid() {
      ForEach(this.exam.questions, (_question: Question, index: number) => {
        GridItem() {
          Text(`${index + 1}`)
            .fontSize(15)
            .fontColor(this.tick >= 0 && this.exam.isAnswered(this.exam.questions[index])
              ? MisakaColors.ON_BRAND : MisakaColors.TEXT)
            .backgroundColor(this.tick >= 0 && this.exam.isAnswered(this.exam.questions[index])
              ? MisakaColors.PRIMARY : MisakaColors.CARD)
            .borderRadius(10)
            .width('100%')
            .constraintSize({ maxWidth: 40 })
            .height(40)
            .textAlign(TextAlign.Center)
            .border({
              width: this.tick >= 0 && index === this.exam.index ? 2 : 1,
              color: this.tick >= 0 && index === this.exam.index ? MisakaColors.PRIMARY : MisakaColors.BORDER
            })
            .onClick((): void => {
              this.exam.jumpToQuestion(index);
              this.syncTextMirrors();
              this.showSheet = false;
              this.bump();
            })
        }
      }, (_question: Question, index: number): string => `exam-sheet-${index}`)
    }
    .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr')
    .columnsGap(8)
    .rowsGap(8)
    .scrollBar(this.isWide ? BarState.Off : BarState.Auto)
    .width('100%')
  }

  build() {
    Column() {
      this.examBody()
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
    .bindSheet($$this.showSheet, this.sheetBuilder(), {
      height: SheetSize.MEDIUM,
      dragBar: true
    })
  }

  @Builder
  examBody() {
    Row({ space: 12 }) {
      Text('‹ 放弃')
        .fontSize(16)
        .onClick((): void => {
          const ui = this.getUIContext();
          ui.showAlertDialog({
            message: '放弃本次考试？已答内容不会保存。',
            primaryButton: {
              value: '放弃考试',
              action: (): void => {
                this.exam.reset();
                router.back();
              }
            },
            secondaryButton: {
              value: '继续作答',
              action: (): void => {
              }
            }
          });
        })
      Column({ space: 2 }) {
        Text(this.tick >= 0 && this.clockTick >= 0 ? `已答 ${this.exam.answeredCount()}/${this.exam.questions.length}` : '')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
        Progress({
          value: this.tick >= 0 && this.clockTick >= 0 ? this.exam.answeredCount() : 0,
          total: Math.max(1, this.exam.questions.length),
          type: ProgressType.Linear
        })
          .color(MisakaColors.PRIMARY)
          .height(4)
      }
      .layoutWeight(1)
      Text(this.clockTick >= 0 ? formatClockSeconds(this.exam.remainingSeconds) : '')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.clockTick >= 0 && this.exam.remainingSeconds <= 60 ? MisakaColors.RED : MisakaColors.TEXT)
      if (!this.isWide) {
        Text('☰ 答题卡')
          .fontSize(14)
          .fontColor(MisakaColors.PRIMARY)
          .onClick((): void => {
            this.showSheet = true;
          })
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 6 })

    if (this.isWide) {
      Row() {
        Scroll() {
          Column({ space: 10 }) {
            Text('答题卡')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
            this.sheetGrid()
          }
          .width('100%')
          .padding(12)
        }
        .scrollBar(BarState.Off)
        .width(300)
        .height('100%')
        .backgroundColor(MisakaColors.BG)
        Divider()
          .vertical(true)
        Column() {
          this.liveQuestionBody()
        }
        .layoutWeight(1)
        .height('100%')
      }
      .layoutWeight(1)
    } else {
      Column() {
        this.liveQuestionBody()
      }
      .layoutWeight(1)
    }
  }

  // ponytail: 纯 TS 会话靠 tick 刷新。仅重建题目和操作区，保留答题卡的滚动容器。
  @Builder
  liveQuestionBody() {
    if (this.tick % 2 === 0) {
      this.questionPane()
      this.bottomActions()
    } else {
      this.questionPane()
      this.bottomActions()
    }
  }

  @Builder
  bottomActions() {
    Row({ space: 10 }) {
      PillButton({ label: '上一题', primary: false, isEnabled: this.exam.index > 0, onTap: (): void => {
        this.exam.previousQuestion();
        this.syncTextMirrors();
        this.bump();
      } })
      PillButton({ label: this.exam.index >= this.exam.questions.length - 1 ? '已是最后一题' : '下一题', primary: false, isEnabled: this.exam.index < this.exam.questions.length - 1, onTap: (): void => {
          this.exam.nextQuestion();
          this.syncTextMirrors();
          this.bump();
        } })
      PillButton({ label: '交卷', primary: true, isEnabled: true, onTap: (): void => {
        this.confirmSubmit();
      } })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 8, bottom: 8 })
  }

  @Builder
  sheetBuilder() {
    Column({ space: 12 }) {
      Text('答题卡')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
      Scroll() {
        this.sheetGrid()
      }
      .layoutWeight(1)
      Column() {
        PillButton({ label: '交卷', primary: true, isEnabled: true, onTap: (): void => {
          this.showSheet = false;
          this.confirmSubmit();
        } })
      }
      .margin({ bottom: 16 })
    }
    .padding(16)
    .width('100%')
    .height('100%')
  }
}
