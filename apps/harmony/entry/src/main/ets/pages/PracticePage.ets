/**
 * M4 练习页 — 会话态全屏页（自 Index「练习」tab 开始后 push 进入）。
 * 行为对齐 Android PracticeScreen：即时反馈/批量做题/背题/斩题/收藏/快速编辑/
 * 字号档位/滑动切题/未提交补答/顺序进度保存退出。阔折叠（宽屏）双栏：左答题卡+右题目。
 * 共享组件用 @Component（@Prop 状态可响应；全局 @Builder 按值传参不刷新，勿回退）。
 */
import { router, display } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { Question, QuestionType, Option, QuestionImage } from '../domain/Models';
import { hasStructuredAnswers } from '../importer/model/MultiBlankSupport';
import { PracticeSessionCore, PRACTICE_MODE_BATCH, PRACTICE_MODE_INSTANT } from '../state/PracticeSessionCore';
import { practiceDisplayOptions, PracticeDisplayOption } from '../state/OptionShuffle';
import {
  MisakaColors, TypeBadge, PillButton, ChoiceCard, AnswerResultBlock, InfoNotice
} from './common/QuizWidgets';

@Entry
@Component
struct PracticePage {
  private repo: QuizRepository = QuizRepository.getInstance();
  private session: PracticeSessionCore = QuizRepository.getInstance().practice;
  @State tick: number = 0;
  @State textAnswer: string = '';
  @State blankAnswers: string[] = [];
  @State showSheet: boolean = false;
  @State showQuickEdit: boolean = false;
  @State editStem: string = '';
  @State editAnswer: string = '';
  @State editAnalysis: string = '';
  @State completed: boolean = false;
  @State completedTotal: number = 0;
  @State completedCorrect: number = 0;
  @State isWide: boolean = false;
  private autoNextTimer: number = -1;

  private bump(): void {
    this.tick += 1;
  }

  private sessionKey(): string {
    const key = this.session.currentSessionKey();
    return key !== null ? key : '';
  }

  private isSubmittedNow(): boolean {
    if (this.session.lastResult !== null) {
      return true;
    }
    if (this.session.mode === PRACTICE_MODE_BATCH && this.session.batchSubmitted) {
      const key = this.session.currentSessionKey();
      return key !== null && this.session.answerResults.has(key);
    }
    return false;
  }

  private currentDisplayOptions(): PracticeDisplayOption[] {
    const question = this.session.currentQuestion();
    if (question === null) {
      return [];
    }
    const options = practiceDisplayOptions(question, this.repo.settings.practiceOptionShuffleEnabled,
      this.session.optionShuffleSeed, this.sessionKey());
    if (options.length === 0 && question.type === QuestionType.JUDGE) {
      return [new PracticeDisplayOption('A', 'A', '正确'), new PracticeDisplayOption('B', 'B', '错误')];
    }
    return options;
  }

  private isSelectedKey(option: PracticeDisplayOption): boolean {
    return this.session.selectedAnswer.some((value): boolean => value.trim().toUpperCase() === option.originalKey.trim().toUpperCase());
  }

  private optionState(option: PracticeDisplayOption, question: Question, reveal: boolean): string {
    if (!reveal) {
      return 'idle';
    }
    const isCorrectKey = question.answer.some((value): boolean => value.trim().toUpperCase() === option.originalKey.trim().toUpperCase());
    if (isCorrectKey) {
      return 'correct';
    }
    return this.isSelectedKey(option) ? 'wrong' : 'idle';
  }

  private syncTextMirrors(): void {
    const question = this.session.currentQuestion();
    const answer = this.session.selectedAnswer;
    if (question !== null && hasStructuredAnswers(question)) {
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

  private isRecite(): boolean {
    return this.repo.settings.practiceReciteModeEnabled;
  }

  private goNext(): void {
    if (this.autoNextTimer >= 0) {
      clearTimeout(this.autoNextTimer);
      this.autoNextTimer = -1;
    }
    this.session.nextQuestion();
    this.syncTextMirrors();
    this.bump();
  }

  private goPrev(): void {
    if (this.autoNextTimer >= 0) {
      clearTimeout(this.autoNextTimer);
      this.autoNextTimer = -1;
    }
    this.session.previousQuestion();
    this.syncTextMirrors();
    this.bump();
  }

  private submitCurrent(): void {
    const result = this.session.submitQuestion();
    this.bump();
    if (result !== null && result.correct && this.repo.settings.practiceAutoNextEnabled) {
      this.autoNextTimer = setTimeout((): void => {
        this.autoNextTimer = -1;
        this.goNext();
      }, 500);
    }
  }

  private onOptionTap(option: PracticeDisplayOption): void {
      const question = this.session.currentQuestion();
    if (question === null) {
      return;
    }
    if (this.isSubmittedNow() || this.isRecite()) {
      return;
    }
    const multiple = question.type === QuestionType.MULTIPLE;
    const instantAuto = question.type === QuestionType.SINGLE || question.type === QuestionType.JUDGE;
    this.session.toggleAnswer(option.originalKey, multiple);
    if (!instantAuto) {
      this.bump();
      return;
    }
    const inBatch = this.session.mode === PRACTICE_MODE_BATCH && !this.session.batchSubmitted;
    if (inBatch) {
      this.bump();
      if (this.repo.settings.practiceBatchAutoNextEnabled) {
        this.autoNextTimer = setTimeout((): void => {
          this.autoNextTimer = -1;
          if (this.session.mode === PRACTICE_MODE_BATCH && !this.session.batchSubmitted) {
            this.goNext();
          }
        }, 250);
      }
      return;
    }
    if (this.repo.settings.practiceAutoSubmitEnabled) {
      this.submitCurrent();
    } else {
      this.bump();
    }
  }

  private unsubmittedCount(): number {
    return this.session.unsubmittedQuestionIndexes().length;
  }

  private tryExit(): void {
    const ui = this.getUIContext();
    if (this.unsubmittedCount() > 0 && this.session.mode === PRACTICE_MODE_INSTANT) {
      ui.showAlertDialog({
        message: `还有 ${this.unsubmittedCount()} 题未提交。补答未提交的题按未作答计分并计入错题。`,
        primaryButton: {
          value: '补答并结束',
          action: (): void => {
            this.completePractice(true);
          }
        },
        secondaryButton: {
          value: '直接结束',
          action: (): void => {
            this.finishAndBack(false);
          }
        }
      });
      return;
    }
    if (this.session.canSaveSequentialProgressOnExit(this.repo.settings.practiceReciteModeEnabled)) {
      ui.showAlertDialog({
        message: '是否保存顺序练习进度？下次可从当前位置继续。',
        primaryButton: {
          value: '保存退出',
          action: (): void => {
            this.finishAndBack(true);
          }
        },
        secondaryButton: {
          value: '不保存退出',
          action: (): void => {
            this.finishAndBack(false);
          }
        }
      });
      return;
    }
    this.finishAndBack(false);
  }

  private finishAndBack(saveSequential: boolean): void {
    if (saveSequential) {
      this.session.endSessionSavingSequentialProgress(this.repo.settings.practiceReciteModeEnabled);
    } else {
      this.session.endSession();
    }
    router.back();
  }

  private completePractice(submitBlanksFirst: boolean): void {
    if (submitBlanksFirst) {
      this.session.submitUnansweredAsBlank();
    }
    this.completedTotal = this.session.answerResults.size;
    let correct = 0;
    for (const result of this.session.answerResults.values()) {
      if (result.autoScored && result.correct) {
        correct += 1;
      }
    }
    this.completedCorrect = correct;
    this.session.completeSession();
    this.completed = true;
    this.bump();
  }

  private sheetStateAt(index: number): string {
    const sessionKey = this.session.sessionKeyAt(index);
    if (sessionKey === null) {
      return '';
    }
    const result = this.session.answerResults.get(sessionKey);
    if (result !== undefined) {
      if (!result.autoScored) {
        return 'subjective';
      }
      return result.correct ? 'correct' : 'wrong';
    }
    return this.session.isDraftAnswered(index) ? 'draft' : '';
  }

  private sheetGridColor(index: number): string {
    const state = this.sheetStateAt(index);
    if (state === 'correct') {
      return MisakaColors.GREEN;
    }
    if (state === 'wrong') {
      return MisakaColors.RED;
    }
    if (state === 'subjective') {
      return MisakaColors.AMBER;
    }
    if (state === 'draft') {
      return MisakaColors.PRIMARY;
    }
    return MisakaColors.TEXT;
  }

  private sheetGridBg(index: number): string {
    const state = this.sheetStateAt(index);
    if (state === 'correct') {
      return MisakaColors.GREEN_SOFT;
    }
    if (state === 'wrong') {
      return MisakaColors.RED_SOFT;
    }
    if (state === 'subjective') {
      return MisakaColors.AMBER_SOFT;
    }
    if (state === 'draft') {
      return MisakaColors.PRIMARY_SOFT;
    }
    return MisakaColors.CARD;
  }

  private saveQuickEdit(): void {
    const question = this.session.currentQuestion();
    if (question === null) {
      return;
    }
    const updated = new Question(question.id, question.type, this.editStem.trim());
    updated.number = question.number;
    updated.category = question.category;
    updated.images = question.images;
    updated.score = question.score;
    updated.analysis = this.editAnalysis;
    updated.options = question.options.map((option): Option => new Option(option.key, option.text));
    updated.blankAnswers = question.blankAnswers.map((blanks): string[] => blanks.slice());
    const rawAnswer = this.editAnswer.trim();
    if (rawAnswer.length === 0) {
      updated.answer = [];
    } else if (question.type === QuestionType.SINGLE || question.type === QuestionType.MULTIPLE ||
      question.type === QuestionType.JUDGE) {
      updated.answer = rawAnswer.toUpperCase().split(/[\s,，、/|;；]+/).filter((token): boolean => token.length > 0);
    } else {
      updated.answer = [rawAnswer];
    }
    if (this.session.updateCurrentQuestion(updated)) {
      this.syncTextMirrors();
    }
    this.showQuickEdit = false;
    this.bump();
  }

  private reciteAnswerText(question: Question): string {
    if (hasStructuredAnswers(question)) {
      const expected = question.blankAnswers.map((blanks): string => blanks[0]).join(' / ');
      return expected.length > 0 ? expected : '（无参考答案）';
    }
    return question.answer.join(' / ').length > 0 ? question.answer.join(' / ') : '（无参考答案）';
  }

  private nextButtonLabel(): string {
    const maxIndex = this.session.mode === PRACTICE_MODE_BATCH ? this.session.batchEndIndex() : this.session.questions.length - 1;
    return this.session.index >= maxIndex ? '已是最后一题' : '下一题';
  }

  private canGoNext(): boolean {
    const maxIndex = this.session.mode === PRACTICE_MODE_BATCH ? this.session.batchEndIndex() : this.session.questions.length - 1;
    return this.session.index < maxIndex;
  }

  aboutToAppear(): void {
    if (this.session.questions.length === 0) {
      router.back();
      return;
    }
    this.syncTextMirrors();
    try {
      const d: display.Display = display.getDefaultDisplaySync();
      this.isWide = d.width / d.densityPixels >= 540;
    } catch (_err) {
      this.isWide = false;
    }
  }

  aboutToDisappear(): void {
    if (this.autoNextTimer >= 0) {
      clearTimeout(this.autoNextTimer);
      this.autoNextTimer = -1;
    }
  }

  build() {
    Column() {
      if (this.completed) {
        this.completedView();
      } else if (this.tick % 2 === 0) {
        this.liveBody();
      } else {
        this.liveBody();
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
    .bindSheet($$this.showSheet, this.sheetBuilder(), {
      height: SheetSize.MEDIUM,
      dragBar: true,
      onDisappear: (): void => {
        this.showSheet = false;
      }
    })
    .bindSheet($$this.showQuickEdit, this.quickEditBuilder(), {
      height: SheetSize.LARGE,
      dragBar: true
    })
  }

  // tick 奇偶翻转强制重建子树：会话核心是纯 .ts 数据对象，ArkUI 不对其方法读取做依赖收集，
  // 只有真正引用 @State tick 的表达式会更新。升级路径：会话核心 @ObservedV2/@Trace 化（需解 Node 双端编译）。
  @Builder
  liveBody() {
    Row({ space: 12 }) {
      Text('‹ 退出')
        .fontSize(16)
        .fontColor(MisakaColors.TEXT)
        .onClick((): void => {
          this.tryExit();
        })
      Column({ space: 2 }) {
        Row({ space: 8 }) {
          Text(`${this.session.index + 1} / ${this.session.questions.length}`)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
          if (this.session.mode === PRACTICE_MODE_BATCH) {
            Text(`第 ${this.session.batchGroupNumber()}/${this.session.batchGroupCount()} 组`)
              .fontSize(13)
              .fontColor(MisakaColors.TEXT_SUB)
          }
        }
        Progress({ value: this.session.index + 1, total: Math.max(1, this.session.questions.length), type: ProgressType.Linear })
          .color(MisakaColors.PRIMARY)
          .height(4)
      }
      .layoutWeight(1)
      Text(`正确 ${this.session.autoScoredCorrectCount()}`)
        .fontSize(13)
        .fontColor(MisakaColors.GREEN)
      if (!this.isWide) {
        Text('答题卡')
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
      Row({ space: 0 }) {
        Scroll() {
          Column({ space: 10 }) {
            Text('答题卡')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
            this.sheetGrid()
            Text(`已答 ${this.session.answeredCount()} · 正确 ${this.session.autoScoredCorrectCount()}`)
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
          }
          .width('100%')
          .padding(12)
        }
        .width(300)
        .height('100%')
        .backgroundColor(MisakaColors.BG)
        Divider()
          .vertical(true)
        Column() {
          this.questionPane()
          this.bottomActions()
        }
        .layoutWeight(1)
        .height('100%')
      }
      .layoutWeight(1)
    } else {
      Column() {
        this.questionPane()
        this.bottomActions()
      }
      .layoutWeight(1)
    }
  }

  @Builder
  completedView() {
    Column({ space: 14 }) {
      Text('练习完成')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
      Text(`共作答 ${this.completedTotal} 题 · 答对 ${this.completedCorrect} 题`)
        .fontSize(16)
        .fontColor(MisakaColors.TEXT_SUB)
      if (this.completedTotal > 0) {
        Text(`正确率 ${Math.round(this.completedCorrect * 100 / this.completedTotal)}%`)
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor(MisakaColors.PRIMARY)
      }
      Row() {
        PillButton({
          label: '返回', primary: true, isEnabled: true,
          onTap: (): void => {
            router.back();
          }, grow: true })
      }
      .width('100%')
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
  }

  @Builder
  questionPane() {
    if (this.session.questions.length === 0) {
      Column({ space: 12 }) {
        Text('题目已全部斩完')
          .fontSize(16)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .justifyContent(FlexAlign.Center)
      .layoutWeight(1)
    } else {
      Scroll() {
        Column({ space: 12 }) {
          this.questionHeader();
          this.questionContent();
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(16)
      }
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
      .width('100%')
      .layoutWeight(1)
      .gesture(PanGesture({ fingers: 1, direction: PanDirection.Horizontal })
        .onActionEnd((event: GestureEvent): void => {
          if (!this.repo.settings.swipeNavigationEnabled) {
            return;
          }
          const dx = event.offsetX;
          if (Math.abs(dx) < 60) {
            return;
          }
          if (dx < 0) {
            this.goNext();
          } else {
            this.goPrev();
          }
        }))
    }
  }

  @Builder
  questionHeader() {
    Row({ space: 10 }) {
      TypeBadge({ type: this.currentQuestionType() })
      Text(`第 ${this.session.index + 1}/${this.session.questions.length} 题`)
        .fontSize(14)
        .fontColor(MisakaColors.TEXT_SUB)
      Blank()
      Text(this.session.isCurrentFavorited() ? '★ 已收藏' : '☆ 收藏')
        .fontSize(13)
        .fontColor(this.session.isCurrentFavorited() ? MisakaColors.AMBER : MisakaColors.TEXT_SUB)
        .onClick((): void => {
          this.session.toggleCurrentFavorite();
          this.bump();
        })
      if (this.repo.settings.practiceSlashEnabled && this.session.canSlashCurrent(true)) {
        Text('✂ 斩题')
          .fontSize(13)
          .fontColor(MisakaColors.RED)
          .onClick((): void => {
            this.session.slashCurrent();
            this.syncTextMirrors();
            this.bump();
          })
      }
      if (this.repo.settings.practiceQuickEditEnabled) {
        Text('✎ 编辑')
          .fontSize(13)
          .fontColor(MisakaColors.PRIMARY)
          .onClick((): void => {
            const question = this.session.currentQuestion();
            if (question === null) {
              return;
            }
            this.editStem = question.question;
            this.editAnswer = question.answer.join('');
            this.editAnalysis = question.analysis;
            this.showQuickEdit = true;
          })
      }
    }
    .width('100%')
  }

  private currentQuestionType(): string {
    const question = this.session.currentQuestion();
    return question !== null ? question.type : QuestionType.SINGLE;
  }

  @Builder
  questionContent() {
    if (this.session.questions.length > 0) {
      ForEach(this.session.questions, (question: Question, index: number) => {
        if (index === this.session.index) {
          Column({ space: 14 }) {
            this.stemBlock(question);
            this.answerArea(question);
            this.resultBlock(question);
          }
          .width('100%')
        }
      }, (question: Question, index: number): string => this.session.sessionKeyAt(index) !== null
        ? this.session.sessionKeyAt(index) as string : question.id)
    }
  }

  @Builder
  stemBlock(question: Question) {
    Column({ space: 10 }) {
      if (question.number.length > 0) {
        Text(question.number)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      Text(question.question.length > 0 ? question.question : '（无题干）')
        .fontSize(this.repo.settings.questionFontSizeSp())
        .lineHeight(this.repo.settings.questionLineHeightSp())
        .fontColor(MisakaColors.TEXT)
        .width('100%')
      ForEach(question.images, (image: QuestionImage) => {
        Image('file://' + image.localPath)
          .width('100%')
          .height(220)
          .objectFit(ImageFit.Contain)
          .borderRadius(10)
          .backgroundColor('#F0F1F6')
      }, (image: QuestionImage): string => image.id)
    }
    .width('100%')
  }

  @Builder
  answerArea(question: Question) {
    Column({ space: 10 }) {
      if (question.type === QuestionType.SINGLE || question.type === QuestionType.MULTIPLE ||
        question.type === QuestionType.JUDGE) {
        this.choiceOptions(question);
      } else if (this.isRecite()) {
        InfoNotice({ text: '背题模式下直接查看参考答案和解析。', warning: false })
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
              .enabled(!this.isSubmittedNow())
              .onChange((value: string): void => {
                this.session.updateBlankAnswer(blankIndex, value);
              })
          }
          .width('100%')
        }, (_blanks: string[], blankIndex: number): string => `blank-${blankIndex}`)
      } else {
        if (this.isSubmittedNow()) {
          Text(this.textAnswer.length > 0 ? this.textAnswer : '（未作答）')
            .fontSize(15)
            .fontColor(MisakaColors.TEXT)
            .padding(12)
            .backgroundColor('#F0F1F6')
            .borderRadius(10)
            .width('100%')
        } else {
          TextArea({ text: this.textAnswer, placeholder: question.type === QuestionType.BLANK ? '输入答案' : '输入你的回答' })
            .fontSize(15)
            .height(96)
            .width('100%')
            .onChange((value: string): void => {
              this.textAnswer = value;
              this.session.updateTextAnswer(value);
            })
        }
      }
    }
    .width('100%')
  }

  @Builder
  choiceOptions(question: Question) {
    Column({ space: this.repo.settings.compactOptionsEnabled ? 8 : 10 }) {
      ForEach(this.currentDisplayOptions(), (option: PracticeDisplayOption) => {
        ChoiceCard({
          label: option.displayKey,
          text: option.text,
          selected: this.isSelectedKey(option),
          state: this.optionState(option, question, this.isSubmittedNow() || this.isRecite()),
          fontSize: this.repo.settings.optionFontSizeSp(),
          lineHeight: this.repo.settings.optionLineHeightSp(),
          onTap: (): void => {
            this.onOptionTap(option);
          }
        })
      }, (option: PracticeDisplayOption): string => option.displayKey + option.originalKey)
    }
    .width('100%')
  }

  @Builder
  resultBlock(question: Question) {
    if (this.isRecite()) {
      AnswerResultBlock({ correct: true, title: '参考答案', body: this.reciteAnswerText(question) })
      if (question.analysis.length > 0) {
        AnswerResultBlock({ correct: true, title: '解析', body: question.analysis })
      }
    } else if (this.session.lastResult !== null && !(this.session.mode === PRACTICE_MODE_BATCH && !this.session.batchSubmitted)) {
      AnswerResultBlock({
        correct: this.session.lastResult.correct,
        title: `正确答案：${this.session.lastResult.answerText}`,
        body: this.session.lastResult.userAnswer.length > 0
          ? `你的答案：${this.session.lastResult.userAnswer.join('、')}` : '未作答'
      })
      if (question.analysis.length > 0) {
        AnswerResultBlock({ correct: true, title: '解析', body: question.analysis })
      }
    }
  }

  @Builder
  sheetGrid() {
    Grid() {
      ForEach(this.session.questions, (_question: Question, index: number) => {
        GridItem() {
          Text(`${index + 1}`)
            .fontSize(15)
            .fontColor(this.sheetGridColor(index))
            .backgroundColor(this.sheetGridBg(index))
            .borderRadius(10)
            .width(40)
            .height(40)
            .textAlign(TextAlign.Center)
            .border({
              width: index === this.session.index ? 2 : 1,
              color: index === this.session.index ? MisakaColors.PRIMARY : MisakaColors.BORDER
            })
            .onClick((): void => {
              this.session.goToQuestion(index);
              this.syncTextMirrors();
              this.showSheet = false;
              this.bump();
            })
        }
      }, (_question: Question, index: number): string => `sheet-${index}`)
    }
    .columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr')
    .columnsGap(8)
    .rowsGap(8)
    .width('100%')
  }

  @Builder
  bottomActions() {
    Column({ space: 10 }) {
      if (this.session.mode === PRACTICE_MODE_BATCH && !this.session.batchSubmitted && !this.isRecite()) {
        Row() {
          PillButton({
            label: `提交本组（已答 ${this.session.draftAnsweredCount()}/${this.session.batchIndexes().length}）`,
            primary: true, isEnabled: true,
            onTap: (): void => {
              this.session.submitBatch();
              this.syncTextMirrors();
              this.bump();
            }, grow: true })
        }
        .width('100%')
      } else if (!this.isRecite()) {
        Row({ space: 10 }) {
          PillButton({
            label: '查看解析', primary: false, isEnabled: !this.isSubmittedNow(),
            onTap: (): void => {
              this.submitCurrent();
            }, grow: true })
          PillButton({
            label: this.isSubmittedNow() ? '已提交' : '提交答案',
            primary: !this.isSubmittedNow(), isEnabled: !this.isSubmittedNow(),
            onTap: (): void => {
              this.submitCurrent();
            }, grow: true })
        }
        .width('100%')
      }
      Row({ space: 10 }) {
        PillButton({
          label: '上一题', primary: false,
          isEnabled: this.session.index > (this.session.mode === PRACTICE_MODE_BATCH ? this.session.batchStartIndex() : 0),
          onTap: (): void => {
            this.goPrev();
          }, grow: true })
        PillButton({
          label: this.nextButtonLabel(), primary: false, isEnabled: this.canGoNext(),
          onTap: (): void => {
            this.goNext();
          }, grow: true })
      }
      .width('100%')
      if (this.session.mode === PRACTICE_MODE_BATCH && this.session.batchSubmitted) {
        Row() {
          PillButton({
            label: this.session.canStartNextBatchGroup()
            ? `进入下一组（第 ${this.session.batchGroupNumber() + 1}/${this.session.batchGroupCount()} 组）`
            : '完成练习',
          primary: true, isEnabled: true,
          onTap: (): void => {
            if (this.session.canStartNextBatchGroup()) {
              this.session.startNextBatchGroup();
              this.syncTextMirrors();
              this.bump();
            } else {
              this.completePractice(false);
            }
          }, grow: true })
        }
        .width('100%')
      }
      if (this.session.mode === PRACTICE_MODE_INSTANT && this.unsubmittedCount() > 0 &&
        this.session.index >= this.session.questions.length - 1) {
        Row() {
          PillButton({
            label: `补答未提交（${this.unsubmittedCount()}）`, primary: true, isEnabled: true,
            onTap: (): void => {
              const next = this.session.unsubmittedQuestionIndexes()[0];
              if (next !== undefined) {
                this.session.goToQuestion(next);
                this.syncTextMirrors();
                this.bump();
              }
            }, grow: true })
        }
        .width('100%')
      }
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
      Row({ space: 12 }) {
        Text('■ 正确').fontSize(12).fontColor(MisakaColors.GREEN)
        Text('■ 错误').fontSize(12).fontColor(MisakaColors.RED)
        Text('■ 已答未交').fontSize(12).fontColor(MisakaColors.PRIMARY)
        Text('■ 主观题').fontSize(12).fontColor(MisakaColors.AMBER)
      }
      Scroll() {
        this.sheetGrid()
      }
      .layoutWeight(1)
      Column() {
        PillButton({
          label: '收起', primary: false, isEnabled: true,
          onTap: (): void => {
            this.showSheet = false;
          }
        })
      }
      .margin({ bottom: 16 })
    }
    .padding(16)
    .width('100%')
    .height('100%')
  }

  @Builder
  quickEditBuilder() {
    Scroll() {
      Column({ space: 12 }) {
        Text('快速编辑本题')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
        Text('题干')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
        TextArea({ text: this.editStem, placeholder: '题干' })
          .height(96)
          .onChange((value: string): void => {
            this.editStem = value;
          })
        Text('答案（选择题填字母，多选用空格或逗号分隔）')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
        TextInput({ text: this.editAnswer, placeholder: '答案' })
          .onChange((value: string): void => {
            this.editAnswer = value;
          })
        Text('解析')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
        TextArea({ text: this.editAnalysis, placeholder: '解析' })
          .height(80)
          .onChange((value: string): void => {
            this.editAnalysis = value;
          })
        Row({ space: 10 }) {
          PillButton({
            label: '取消', primary: false, isEnabled: true,
            onTap: (): void => {
              this.showQuickEdit = false;
            }, grow: true })
          PillButton({
            label: '保存', primary: true, isEnabled: true,
            onTap: (): void => {
              this.saveQuickEdit();
            }, grow: true })
        }
        .width('100%')
      }
      .padding(16)
      .width('100%')
    }
    .width('100%')
    .height('100%')
  }
}
