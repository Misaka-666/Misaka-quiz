/**
 * M4 考试设置页 — 题量（总/按题型）/时长/分值，对齐 Android ExamScreen 设置段。
 * 注意：全局 @Builder 调用后不能链修饰符（SmallChip 已内建 margin）。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { QuestionType } from '../domain/Models';
import { defaultExamTypeScores } from '../state/ExamSessionCore';
import {
  KEY_EXAM_PREFERRED_COUNT_MODE, KEY_EXAM_PREFERRED_CUSTOM_COUNT, KEY_EXAM_PREFERRED_DURATION_MINUTES,
  KEY_EXAM_PREFERRED_GROUP_MODE, KEY_EXAM_PREFERRED_TYPE_COUNTS, KEY_EXAM_PREFERRED_TYPE_SCORES
} from '../state/AppSettings';
import {
  MisakaColors, TypeBadge, PillButton, SmallChip, SettingToggleRow, InfoNotice
} from './common/QuizWidgets';

const DURATION_OPTIONS: number[] = [10, 15, 20, 30, 45, 60, 90];
const COUNT_OPTIONS: number[] = [10, 20, 50, 100];

@Entry
@Component
struct ExamSetupPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State countMode: string = '100';       // '100' | '50' | 'all' | 'custom'
  @State customCount: number = 20;
  @State byType: boolean = false;         // 按题型配比出题
  @State typeCounts: string[] = [];
  @State typeScores: string[] = [];
  @State durationMinutes: number = 30;
  @State shuffleEnabled: boolean = false;
  @State errorText: string = '';

  private allTypes(): string[] {
    return [QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT];
  }

  // 考试可用数与 Android ExamScreen 同口径：全量 bank.questions（斩题过滤只作用于练习池），
  // 否则这里显示的可用数与 startExam 组卷源（bank.questions 全量）不一致
  private availableCount(type: string): number {
    const bank = this.repo.activeBank();
    if (bank === null) {
      return 0;
    }
    let count = 0;
    for (const question of bank.questions) {
      if (question.type === type) {
        count += 1;
      }
    }
    return count;
  }

  private poolTotal(): number {
    return this.repo.activeBank()?.questions.length ?? 0;
  }

  private parsedCountAt(index: number): number {
    const value = Number(this.typeCounts[index]);
    return Number.isNaN(value) ? 0 : Math.max(0, Math.min(Math.floor(value), this.availableCount(this.allTypes()[index])));
  }

  private parsedScoreAt(index: number): number {
    const defaults = defaultExamTypeScores();
    const type = this.allTypes()[index];
    const text = this.typeScores[index];
    const value = Number(text);
    return (text.trim().length === 0 || Number.isNaN(value)) ? defaults.get(type) as number : Math.max(0, value);
  }

  private selectedTotal(): number {
    if (this.byType) {
      let total = 0;
      for (let i = 0; i < this.allTypes().length; i++) {
        total += this.parsedCountAt(i);
      }
      return total;
    }
    const available = this.poolTotal();
    if (this.countMode === 'all') {
      return available;
    }
    if (this.countMode === '50' || this.countMode === '100') {
      return Math.min(Number(this.countMode), available);
    }
    return Math.min(Math.max(1, this.customCount), Math.max(1, available));
  }

  private startExam(): void {
    const bank = this.repo.activeBank();
    if (bank === null || this.selectedTotal() <= 0) {
      this.errorText = '没有可用的考试题目';
      return;
    }
    const scores = new Map<string, number>();
    for (let i = 0; i < this.allTypes().length; i++) {
      scores.set(this.allTypes()[i], this.parsedScoreAt(i));
    }
    let started = false;
    if (this.byType) {
      const counts = new Map<string, number>();
      for (let i = 0; i < this.allTypes().length; i++) {
        counts.set(this.allTypes()[i], this.parsedCountAt(i));
      }
      started = this.repo.exam.startByTypeCounts(bank.questions, counts, this.durationMinutes, scores);
    } else {
      started = this.repo.exam.start(bank.questions, this.selectedTotal(), this.durationMinutes,
        this.allTypes(), scores, true,
        [QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE]);
    }
    if (!started) {
      this.errorText = '组卷失败，请调整题量';
      return;
    }
    this.persistPreferences(scores);
    router.replaceUrl({ url: 'pages/ExamPage' });
  }

  private persistPreferences(scores: Map<string, number>): void {
    const s = this.repo.settings;
    if (!s.rememberExamSettingsEnabled) {
      return;
    }
    s.preferredExamQuestionCountMode = this.countMode;
    s.preferredExamCustomQuestionCount = this.customCount;
    s.preferredExamDurationMinutes = this.durationMinutes;
    if (this.byType) {
      const counts = new Map<string, number>();
      for (let i = 0; i < this.allTypes().length; i++) {
        counts.set(this.allTypes()[i], this.parsedCountAt(i));
      }
      s.rememberExamTypeCounts(counts);
      s.preferredExamGroupMode = 'custom';
    } else {
      s.preferredExamGroupMode = 'random';
    }
    s.rememberExamTypeScores(scores);
    s.putString(KEY_EXAM_PREFERRED_COUNT_MODE, this.countMode);
    s.putNumber(KEY_EXAM_PREFERRED_CUSTOM_COUNT, this.customCount);
    s.putNumber(KEY_EXAM_PREFERRED_DURATION_MINUTES, this.durationMinutes);
    s.putString(KEY_EXAM_PREFERRED_GROUP_MODE, s.preferredExamGroupMode);
    s.putString(KEY_EXAM_PREFERRED_TYPE_COUNTS, s.encodedExamTypeCountsText());
    s.putString(KEY_EXAM_PREFERRED_TYPE_SCORES, s.encodedExamTypeScoresText());
  }

  aboutToAppear(): void {
    const s = this.repo.settings;
    this.countMode = s.preferredExamQuestionCountMode;
    this.customCount = s.preferredExamCustomQuestionCount;
    this.durationMinutes = s.preferredExamDurationMinutes;
    this.byType = s.preferredExamGroupMode === 'custom';
    this.shuffleEnabled = s.examOptionShuffleEnabled;
    const types = this.allTypes();
    const available = new Map<string, number>();
    for (const type of types) {
      available.set(type, this.availableCount(type));
    }
    const savedCounts = s.preferredExamTypeCounts(available);
    const savedScores = s.preferredExamTypeScores();
    this.typeCounts = types.map((type): string => String(savedCounts.get(type) !== undefined ? savedCounts.get(type) as number : 0));
    this.typeScores = types.map((type): string => String(savedScores.get(type) !== undefined ? savedScores.get(type) as number : 1));
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('开始考试')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column({ space: 14 }) {
          InfoNotice({ text: `当前题库：${this.repo.activeBank()?.name ?? '无'} · 可用 ${this.poolTotal()} 题`, warning: false })

          Row({ space: 10 }) {
            PillButton({ label: '按总量抽题', primary: !this.byType, isEnabled: true, onTap: (): void => {
              this.byType = false;
              this.tick += 1;
            }, grow: true })
            PillButton({ label: '按题型配比', primary: this.byType, isEnabled: true, onTap: (): void => {
              this.byType = true;
              this.tick += 1;
            }, grow: true })
          }
          .width('100%')

          if (!this.byType) {
            Text('题量')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(COUNT_OPTIONS, (option: number) => {
                SmallChip({ label: `${option} 题`, active: this.countMode === String(option) && this.poolTotal() >= option, onTap: (): void => {
                  if (this.poolTotal() >= option) {
                    this.countMode = String(option);
                    this.tick += 1;
                  }
                } })
              }, (option: number): string => `count-${option}`)
              SmallChip({ label: `全部 ${this.poolTotal()} 题`, active: this.countMode === 'all', onTap: (): void => {
                this.countMode = 'all';
                this.tick += 1;
              } })
              SmallChip({ label: `自定义 ${this.customCount} 题`, active: this.countMode === 'custom', onTap: (): void => {
                this.countMode = 'custom';
                this.tick += 1;
              } })
            }
            if (this.countMode === 'custom') {
              Row({ space: 10 }) {
                PillButton({ label: '-5', primary: false, isEnabled: this.customCount > 5, onTap: (): void => {
                  this.customCount = Math.max(1, this.customCount - 5);
                  this.tick += 1;
                }, grow: false, fixedWidth: 64 })
                Text(`${Math.min(this.customCount, this.poolTotal())} 题`)
                  .fontSize(16)
                  .fontWeight(FontWeight.Medium)
                PillButton({ label: '+5', primary: false, isEnabled: true, onTap: (): void => {
                  this.customCount = Math.min(this.poolTotal(), this.customCount + 5);
                  this.tick += 1;
                }, grow: false, fixedWidth: 64 })
              }
              .width('100%')
              .justifyContent(FlexAlign.Center)
            }
          }

          if (this.byType) {
            Text('各题型题量与分值')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
            ForEach(this.allTypes(), (type: string, index: number) => {
              Row({ space: 10 }) {
                TypeBadge({ type: type })
                Text(`可用 ${this.availableCount(type)}`)
                  .fontSize(12)
                  .fontColor(MisakaColors.TEXT_SUB)
                  .width(64)
                TextInput({ text: this.typeCounts[index], placeholder: '0' })
                  .type(InputType.Number)
                  .width(72)
                  .onChange((value: string): void => {
                    this.typeCounts[index] = value;
                  })
                Text('题 ×')
                  .fontSize(12)
                  .fontColor(MisakaColors.TEXT_SUB)
                TextInput({ text: this.typeScores[index], placeholder: '分' })
                  .type(InputType.Number)
                  .width(64)
                  .onChange((value: string): void => {
                    this.typeScores[index] = value;
                  })
                Text('分')
                  .fontSize(12)
                  .fontColor(MisakaColors.TEXT_SUB)
              }
              .width('100%')
            }, (type: string): string => `type-row-${type}`)
          }

          Text('考试时长')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(DURATION_OPTIONS, (minutes: number) => {
              SmallChip({ label: `${minutes} 分钟`, active: this.durationMinutes === minutes, onTap: (): void => {
                this.durationMinutes = minutes;
                this.tick += 1;
              } })
            }, (minutes: number): string => `dur-${minutes}`)
          }

          Text('选项顺序')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Column() {
            SettingToggleRow({ title: '打乱选项顺序', subtitle: '单选/多选题开考后随机打乱选项', value: this.shuffleEnabled, onToggle: (): void => {
              this.shuffleEnabled = !this.shuffleEnabled;
              this.repo.settings.examOptionShuffleEnabled = this.shuffleEnabled;
              this.repo.settings.putBool('exam_option_shuffle_enabled', this.shuffleEnabled);
              this.repo.exam.examOptionShufflePrefEnabled = this.shuffleEnabled;
              this.tick += 1;
            } })
          }
          .backgroundColor(MisakaColors.CARD)
          .borderRadius(12)
          .padding(8)
          .width('100%')

          if (this.errorText.length > 0) {
            InfoNotice({ text: this.errorText, warning: true })
          }

          // layoutWeight 按钮直挂 Column 会作用于纵向主轴（M4 教训），必须包 Row
          Row() {
            PillButton({ label: `开始考试（${this.selectedTotal()} 题 / ${this.durationMinutes} 分钟）`, primary: true, isEnabled: this.selectedTotal() > 0, onTap: (): void => {
              this.startExam();
            }, grow: true })
          }
          .width('100%')
        }
        .padding({ left: 16, right: 16, bottom: 24 })
        .width('100%')
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
  }
}
