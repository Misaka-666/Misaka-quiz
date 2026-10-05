/**
 * M4 主壳（M7 体验完整度） — 底部四 Tab（首页/练习/导入/我的），对齐 Android MisakaAppShell。
 * 首页：数据快照 + 快捷入口 + 练习/考试入口；练习：设置面板（顺序/题量/题型/模式/背题）；
 * 导入：内嵌 ImportPage 面板 + 内置 C1 题库；我的：外观/数据/关于入口 + 刷题偏好 + 版本。
 * M7：暗色模式（资源 Token 自切，入口在外观偏好/我的快速切换）；阔折叠展开态（≥600vp 且开关开）
 * 侧边导航替代底部栏；Misaka 模式开屏浮层（1450ms 保持 + 420ms 淡出，对齐 Android MisakaMotion）。
 * 注意：全局 @Builder 调用后不能链修饰符，宽/边距参数经 PillButton 的 grow/fixedWidth 传入。
 */
import { router, mediaquery } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { resourceManager } from '@kit.LocalizationKit';
import { common } from '@kit.AbilityKit';
import { QuizRepository } from '../state/QuizRepository';
import { QuestionType } from '../domain/Models';
import {
  PRACTICE_MODE_INSTANT, PRACTICE_MODE_BATCH, PRACTICE_ORDER_RANDOM, PRACTICE_ORDER_SEQUENTIAL,
  SEQUENTIAL_START_LAST, SEQUENTIAL_START_FIRST, SEQUENTIAL_START_CUSTOM, OBJECTIVE_QUESTION_TYPES,
  PracticeQuestionSource
} from '../state/PracticeSessionCore';
import {
  MisakaColors, PillButton, SmallChip, SettingToggleRow, InfoNotice, TYPE_COMPACT_LABELS, APP_VERSION_LABEL
} from './common/QuizWidgets';
import { ImportPage } from './ImportPage';
import {
  KEY_PRACTICE_RECITE_MODE_ENABLED, KEY_PRACTICE_OPTION_SHUFFLE_ENABLED, KEY_PRACTICE_SLASH_ENABLED,
  KEY_PRACTICE_QUICK_EDIT_ENABLED, KEY_SWIPE_NAVIGATION_ENABLED, KEY_PRACTICE_AUTO_SUBMIT_ENABLED,
  KEY_PRACTICE_AUTO_NEXT_ENABLED, KEY_PRACTICE_BATCH_AUTO_NEXT_ENABLED,
  KEY_PRACTICE_PREFERRED_COUNT_MODE, KEY_PRACTICE_PREFERRED_CUSTOM_COUNT,
  KEY_PRACTICE_PREFERRED_ORDER_MODE, KEY_PRACTICE_PREFERRED_MODE, KEY_PRACTICE_PREFERRED_BATCH_SIZE_MODE,
  KEY_PRACTICE_PREFERRED_BATCH_CUSTOM_SIZE, KEY_PRACTICE_PREFERRED_TYPE_NAMES,
  KEY_DARK_THEME_ENABLED, applyAppColorMode
} from '../state/AppSettings';

// 对齐 Android MisakaMotion：开屏保持/淡出时长
const SPLASH_HOLD_MILLIS = 1450;
const SPLASH_FADE_MILLIS = 420;

@Entry
@Component
struct Index {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State currentTab: number = 0;
  @State tick: number = 0;
  @State isWide: boolean = false;
  // 开屏浮层（Misaka 模式 + 保留开屏图时冷启动显示一次）
  @State splashVisible: boolean = false;
  @State splashOpacity: number = 1;
  @State splashProgress: number = 0;
  private wideListener: mediaquery.MediaQueryListener | null = null;
  private splashLaunched: boolean = false;
  // 练习设置态（记住偏好）
  @State orderMode: string = PRACTICE_ORDER_RANDOM;
  @State startMode: string = SEQUENTIAL_START_LAST;
  @State customStart: number = 1;
  @State countMode: string = 'custom';
  @State customCount: number = 20;
  @State practiceMode: string = PRACTICE_MODE_INSTANT;
  @State batchSizeMode: string = '10';
  @State customBatchSize: number = 10;
  @State selectedTypes: string[] = [];
  @State reciteMode: boolean = false;
  @State c1Status: string = '';

  private bump(): void {
    this.tick += 1;
  }

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private sideNavActive(): boolean {
    return this.isWide && this.repo.settings.tabletSideNavigationEnabled;
  }

  // ---------- 深浅色 ----------

  private toggleDarkTheme(): void {
    const s = this.repo.settings;
    s.darkThemeEnabled = !s.darkThemeEnabled;
    s.putBool(KEY_DARK_THEME_ENABLED, s.darkThemeEnabled);
    applyAppColorMode(this.context(), s.darkThemeEnabled);
    this.bump();
  }

  // ---------- 开屏浮层 ----------

  private startSplashIfNeeded(): void {
    const s = this.repo.settings;
    if (!(s.misakaModeEnabled && s.startupSplashEnabled)) {
      return;
    }
    this.splashVisible = true;
    this.splashProgress = 0;
    this.getUIContext().animateTo({ duration: SPLASH_HOLD_MILLIS, curve: Curve.Linear }, (): void => {
      this.splashProgress = 100;
    });
    setTimeout((): void => {
      this.getUIContext().animateTo({ duration: SPLASH_FADE_MILLIS, curve: Curve.EaseOut }, (): void => {
        this.splashOpacity = 0;
      });
    }, SPLASH_HOLD_MILLIS);
    setTimeout((): void => {
      this.splashVisible = false;
    }, SPLASH_HOLD_MILLIS + SPLASH_FADE_MILLIS);
  }

  // ---------- 数据快照 ----------

  private activeBankName(): string {
    const bank = this.repo.activeBank();
    return bank !== null ? bank.name : '无题库';
  }

  private poolCount(): number {
    return this.repo.poolSources().length;
  }

  private poolTypeCount(type: string): number {
    const counts = this.repo.poolTypeCounts();
    return counts.get(type) !== undefined ? counts.get(type) as number : 0;
  }

  private selectedAvailable(): number {
    let total = 0;
    for (const type of this.selectedTypes) {
      total += this.poolTypeCount(type);
    }
    return total;
  }

  private resolvedCount(): number {
    const available = Math.max(1, this.selectedAvailable());
    if (this.countMode === 'all') {
      return this.selectedAvailable();
    }
    if (this.countMode === '50' || this.countMode === '100') {
      return Math.min(Number(this.countMode), available);
    }
    if (this.countMode === 'half') {
      return Math.max(1, Math.floor(this.selectedAvailable() / 2));
    }
    return Math.min(Math.max(1, this.customCount), available);
  }

  private sequentialRangeText(): string {
    if (this.orderMode !== PRACTICE_ORDER_SEQUENTIAL) {
      return '';
    }
    const types = this.effectiveTypes();
    let size = 0;
    for (const source of this.repo.poolSources()) {
      if (types.includes(source.question.type)) {
        size += 1;
      }
    }
    if (size <= 0) {
      return '';
    }
    let progress = 0;
    if (this.startMode === SEQUENTIAL_START_FIRST) {
      progress = 0;
    } else if (this.startMode === SEQUENTIAL_START_CUSTOM) {
      progress = Math.min(Math.max(0, this.customStart - 1), size - 1);
    } else {
      progress = Math.min(this.repo.sequentialProgressValue(), size - 1);
    }
    const end = Math.min(progress + this.resolvedCount(), size);
    return `将从第 ${progress + 1} 题做到第 ${end} 题（可用 ${size} 题）`;
  }

  private effectiveTypes(): string[] {
    if (this.selectedTypes.length === 0) {
      return OBJECTIVE_QUESTION_TYPES.slice();
    }
    return this.selectedTypes;
  }

  // ---------- 启动练习 ----------

  private startPractice(): void {
    const pool = this.repo.poolSources();
    if (pool.length === 0 || this.selectedAvailable() <= 0) {
      return;
    }
    const types = this.effectiveTypes();
    const batchGroupSize = this.batchSizeMode === '20' ? 20 :
      (this.batchSizeMode === 'custom' ? Math.max(1, this.customBatchSize) : 10);
    let started = false;
    const bank = this.repo.activeBank();
    const scopeLabel = bank !== null ? bank.name : '当前题库';
    if (this.orderMode === PRACTICE_ORDER_SEQUENTIAL) {
      started = this.repo.practice.startSequential(pool, types, this.resolvedCount(), this.startMode,
        this.customStart, this.repo.sequentialProgressKey(), this.repo.sequentialProgressValue(),
        this.practiceMode, batchGroupSize, scopeLabel);
    } else {
      const picked = this.pickRandom(pool, types, this.resolvedCount());
      started = this.repo.practice.start(picked, types, true, this.practiceMode, batchGroupSize, null, scopeLabel);
    }
    if (!started) {
      return;
    }
    this.persistPracticePreferences();
    router.pushUrl({ url: 'pages/PracticePage' });
  }

  private pickRandom(pool: PracticeQuestionSource[], types: string[], count: number): PracticeQuestionSource[] {
    const filtered = pool.filter((source): boolean => types.includes(source.question.type));
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = filtered[i];
      filtered[i] = filtered[j];
      filtered[j] = tmp;
    }
    return filtered.slice(0, Math.min(count, filtered.length));
  }

  private persistPracticePreferences(): void {
    const s = this.repo.settings;
    if (!s.rememberPracticeSettingsEnabled) {
      return;
    }
    s.preferredPracticeOrderMode = this.orderMode;
    s.preferredPracticeMode = this.practiceMode;
    s.preferredPracticeQuestionCountMode = this.countMode;
    s.preferredPracticeCustomQuestionCount = this.customCount;
    s.preferredPracticeBatchSizeMode = this.batchSizeMode;
    s.preferredPracticeBatchCustomSize = this.customBatchSize;
    s.rememberPracticeTypes(this.selectedTypes);
    s.putString(KEY_PRACTICE_PREFERRED_ORDER_MODE, this.orderMode);
    s.putString(KEY_PRACTICE_PREFERRED_MODE, this.practiceMode);
    s.putString(KEY_PRACTICE_PREFERRED_COUNT_MODE, this.countMode);
    s.putNumber(KEY_PRACTICE_PREFERRED_CUSTOM_COUNT, this.customCount);
    s.putString(KEY_PRACTICE_PREFERRED_BATCH_SIZE_MODE, this.batchSizeMode);
    s.putNumber(KEY_PRACTICE_PREFERRED_BATCH_CUSTOM_SIZE, this.customBatchSize);
    s.putString(KEY_PRACTICE_PREFERRED_TYPE_NAMES, s.preferredPracticeTypeNames);
  }

  private loadPracticePreferences(): void {
    const s = this.repo.settings;
    this.orderMode = s.preferredPracticeOrderMode;
    this.practiceMode = s.preferredPracticeMode === PRACTICE_MODE_BATCH ? PRACTICE_MODE_BATCH : PRACTICE_MODE_INSTANT;
    this.countMode = s.preferredPracticeQuestionCountMode;
    this.customCount = s.preferredPracticeCustomQuestionCount;
    this.batchSizeMode = s.preferredPracticeBatchSizeMode;
    this.customBatchSize = s.preferredPracticeBatchCustomSize;
    this.reciteMode = s.practiceReciteModeEnabled;
    this.selectedTypes = s.preferredPracticeTypes();
  }

  // ---------- 内置 C1 ----------

  private importC1(): void {
    this.c1Status = '导入中…';
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const rm: resourceManager.ResourceManager = context.resourceManager;
      const bytes = rm.getRawFileContentSync('c1-full.json');
      const text = util.TextDecoder.create('utf-8').decodeWithStream(bytes);
      const bank = this.repo.importWebBankJson(text, 'C1 科目一题库');
      this.c1Status = bank !== null ? `已导入「${bank.name}」（${bank.questions.length} 题）` : 'C1 题库解析失败';
      this.bump();
    } catch (err) {
      this.c1Status = `导入失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private hasC1(): boolean {
    return this.repo.banks.some((bank): boolean => bank.name.includes('C1'));
  }

  aboutToAppear(): void {
    this.loadPracticePreferences();
    // 阔折叠展开态（≥600vp）启用侧边导航；折叠/半开自动回落底部栏
    this.wideListener = mediaquery.matchMediaSync('(min-width: 600vp)');
    this.isWide = this.wideListener.matches;
    this.wideListener.on('change', (result: mediaquery.MediaQueryResult): void => {
      this.isWide = result.matches;
    });
  }

  aboutToDisappear(): void {
    if (this.wideListener !== null) {
      this.wideListener.off('change');
    }
  }

  onPageShow(): void {
    this.loadPracticePreferences();
    this.bump();
    // 仅冷启动决策一次，避免会话中途开启 Misaka 模式后返回首页又弹开屏
    if (!this.splashLaunched) {
      this.splashLaunched = true;
      this.startSplashIfNeeded();
    }
  }

  // ---------- Tab 内容 ----------

  @Builder
  homeTab() {
    Scroll() {
      Column({ space: 14 }) {
        Column({ space: 8 }) {
          Text('Misaka Quiz')
            .fontSize(26)
            .fontWeight(FontWeight.Bold)
            .fontColor(MisakaColors.ON_BRAND)
          Text(`${APP_VERSION_LABEL} · 鸿蒙原生`)
            .fontSize(13)
            .fontColor(MisakaColors.ON_BRAND_SUB)
        }
        .width('100%')
        .padding(24)
        .backgroundColor(MisakaColors.PRIMARY)
        .borderRadius(20)
        .alignItems(HorizontalAlign.Start)

        if (this.tick % 2 === 0) {
          this.homeDataCards();
        } else {
          this.homeDataCards();
        }
      }
      .padding(16)
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  // tick 奇偶翻转重建：这些卡片读 repo 纯数据，需在 onPageShow bump 后刷新
  @Builder
  homeDataCards() {
    Row({ space: 10 }) {
      this.metricCard('当前题库', this.activeBankName(), 2)
      this.metricCard('可用题目', `${this.poolCount()}`, 1)
      this.metricCard('错题', `${this.repo.wrongBook.length}`, 1)
    }
    .width('100%')

    Row({ space: 10 }) {
      PillButton({ label: '开始练习', primary: true, isEnabled: this.poolCount() > 0, onTap: (): void => {
        this.currentTab = 1;
        this.bump();
      }, grow: true })
      PillButton({ label: '开始考试', primary: true, isEnabled: this.poolCount() > 0, onTap: (): void => {
        router.pushUrl({ url: 'pages/ExamSetupPage' });
      }, grow: true })
    }
    .width('100%')

    Row({ space: 10 }) {
      this.shortcutCard('题库管理', `${this.repo.banks.length} 库`, (): void => {
        router.pushUrl({ url: 'pages/BankListPage' });
      })
      this.shortcutCard('错题本', `${this.repo.wrongBook.length} 题`, (): void => {
            router.pushUrl({ url: 'pages/WrongBookPage' });
      })
    }
    .width('100%')
    Row({ space: 10 }) {
      this.shortcutCard('收藏夹', `${this.repo.favoriteQuestions.length} 题`, (): void => {
            router.pushUrl({ url: 'pages/FavoritePage' });
      })
      this.shortcutCard('学习记录', `${this.repo.studyRecords.length} 条`, (): void => {
            router.pushUrl({ url: 'pages/RecordsPage' });
      })
    }    .width('100%')


  }

  @Builder
  metricCard(label: string, value: string, maxLines: number) {
    Column({ space: 4 }) {
      Text(value)
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor(MisakaColors.TEXT)
        .maxLines(maxLines)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(label)
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  shortcutCard(label: string, value: string, onTap: () => void) {
    Column({ space: 4 }) {
      Text(label)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(MisakaColors.TEXT)
      Text(value)
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
    }
    .padding(14)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .onClick((): void => {
      onTap();
    })
  }

  @Builder
  practiceTab() {
    Scroll() {
      Column({ space: 14 }) {
        // header 卡对齐 Android PracticeScreen 首卡：题库名左、开始练习右（矮屏不滚动也永远可见）
        Row({ space: 12 }) {
          Column({ space: 4 }) {
            Text(this.activeBankName())
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor(MisakaColors.TEXT)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(`可用 ${this.poolCount()} 题 · 可在首页-题库管理切换`)
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          PillButton({ label: '开始练习', primary: this.selectedAvailable() > 0, isEnabled: this.selectedAvailable() > 0, onTap: (): void => {
            this.startPractice();
          } })
        }
        .width('100%')
        .padding(14)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .alignItems(VerticalAlign.Center)

        Text('练习范围')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
        Row({ space: 10 }) {
          PillButton({ label: '随机抽题', primary: this.orderMode === PRACTICE_ORDER_RANDOM, isEnabled: true, onTap: (): void => {
            this.orderMode = PRACTICE_ORDER_RANDOM;
            this.bump();
          }, grow: true })
          PillButton({ label: '顺序刷题', primary: this.orderMode === PRACTICE_ORDER_SEQUENTIAL, isEnabled: true, onTap: (): void => {
            this.orderMode = PRACTICE_ORDER_SEQUENTIAL;
            this.bump();
          }, grow: true })
        }
        .width('100%')
        Text(this.orderMode === PRACTICE_ORDER_RANDOM ? '从已选题型中随机抽题。' : '按当前题库顺序从指定起点取题。')
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)

        if (this.orderMode === PRACTICE_ORDER_SEQUENTIAL) {
          Text('顺序起点')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Row({ space: 10 }) {
            PillButton({ label: '继续上次', primary: this.startMode === SEQUENTIAL_START_LAST, isEnabled: true, onTap: (): void => {
              this.startMode = SEQUENTIAL_START_LAST;
              this.bump();
            }, grow: true })
            PillButton({ label: '从头开始', primary: this.startMode === SEQUENTIAL_START_FIRST, isEnabled: true, onTap: (): void => {
              this.startMode = SEQUENTIAL_START_FIRST;
              this.bump();
            }, grow: true })
          }
          .width('100%')
          Row({ space: 10 }) {
            PillButton({ label: `自选：第 ${this.customStart} 题`, primary: this.startMode === SEQUENTIAL_START_CUSTOM, isEnabled: true, onTap: (): void => {
              this.startMode = SEQUENTIAL_START_CUSTOM;
              this.bump();
            }, grow: true })
            PillButton({ label: '+1', primary: false, isEnabled: true, onTap: (): void => {
              this.customStart += 1;
              this.bump();
            }, grow: false, fixedWidth: 56 })
            PillButton({ label: '-1', primary: false, isEnabled: this.customStart > 1, onTap: (): void => {
              this.customStart = Math.max(1, this.customStart - 1);
              this.bump();
            }, grow: false, fixedWidth: 56 })
          }
          .width('100%')
          if (this.tick % 2 === 0) {
            Text(this.sequentialRangeText())
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
          } else {
            Text(this.sequentialRangeText())
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
          }
          PillButton({ label: '清除顺序进度', primary: false, isEnabled: true, onTap: (): void => {
            this.repo.resetSequentialProgress();
            this.bump();
          } })
        }

        Column() {
          SettingToggleRow({ title: '背题模式', subtitle: '直接显示答案和解析，不计入正确率和错题', value: this.reciteMode, onToggle: (): void => {
            this.reciteMode = !this.reciteMode;
            this.repo.settings.practiceReciteModeEnabled = this.reciteMode;
            this.repo.settings.putBool(KEY_PRACTICE_RECITE_MODE_ENABLED, this.reciteMode);
            this.bump();
          } })
        }
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(12)
        .padding(8)
        .width('100%')

        if (!this.reciteMode) {
          Text('答题方式')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Row({ space: 10 }) {
            PillButton({ label: '即时反馈', primary: this.practiceMode === PRACTICE_MODE_INSTANT, isEnabled: true, onTap: (): void => {
              this.practiceMode = PRACTICE_MODE_INSTANT;
              this.bump();
            }, grow: true })
            PillButton({ label: '批量做题', primary: this.practiceMode === PRACTICE_MODE_BATCH, isEnabled: true, onTap: (): void => {
              this.practiceMode = PRACTICE_MODE_BATCH;
              this.bump();
            }, grow: true })
          }
          .width('100%')
          Text(this.practiceMode === PRACTICE_MODE_BATCH ? '按每组题数连续做题，提交本组后统一看解析。' : '每题提交后立即查看结果和解析。')
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
          if (this.practiceMode === PRACTICE_MODE_BATCH) {
            Text('每组题数')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
            Row({ space: 10 }) {
              PillButton({ label: '10 题', primary: this.batchSizeMode === '10', isEnabled: true, onTap: (): void => {
                this.batchSizeMode = '10';
                this.bump();
              } })
              PillButton({ label: '20 题', primary: this.batchSizeMode === '20', isEnabled: true, onTap: (): void => {
                this.batchSizeMode = '20';
                this.bump();
              } })
              PillButton({ label: `自定义 ${this.customBatchSize}`, primary: this.batchSizeMode === 'custom', isEnabled: true, onTap: (): void => {
                this.batchSizeMode = 'custom';
                this.bump();
              } })
            }
            .width('100%')
            if (this.batchSizeMode === 'custom') {
              Row({ space: 10 }) {
                PillButton({ label: '-1', primary: false, isEnabled: this.customBatchSize > 1, onTap: (): void => {
                  this.customBatchSize = Math.max(1, this.customBatchSize - 1);
                  this.bump();
                }, grow: false, fixedWidth: 56 })
                Text(`${this.customBatchSize} 题/组`)
                  .fontSize(15)
                PillButton({ label: '+1', primary: false, isEnabled: true, onTap: (): void => {
                  this.customBatchSize += 1;
                  this.bump();
                }, grow: false, fixedWidth: 56 })
              }
              .width('100%')
              .justifyContent(FlexAlign.Center)
            }
          }
        }

        this.typeChips();
        this.countChips();

        if (this.selectedAvailable() <= 0) {
          InfoNotice({ text: this.poolCount() > 0
            ? '当前筛选范围内没有可练习题目。若题目已被斩题，可到题库详情恢复后继续。'
            : '当前题库没有可练习题目，请先到「导入」添加题库。', warning: true })
        }

        // M4 教训：layoutWeight 按钮直挂 Column 会作用于纵向主轴（宽度塌成内容宽、高度虚增、
        // Scroll 内容高度测量被污染 → max scroll 差一个按钮高度，底部按钮永远够不到）。必须包 Row。
        Row() {
          PillButton({ label: `开始练习（${this.resolvedCount()} 题）`, primary: true, isEnabled: this.selectedAvailable() > 0, onTap: (): void => {
            this.startPractice();
          }, grow: true })
        }
        .width('100%')
      }
      .padding(16)
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  @Builder
  typeChips() {
    Column({ space: 8 }) {
      Text('题型')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach([QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT],
          (type: string) => {
            if (this.poolTypeCount(type) > 0) {
              SmallChip({ label: `${TYPE_COMPACT_LABELS[type]} ${this.poolTypeCount(type)}`, active: this.selectedTypes.includes(type), onTap: (): void => {
                if (this.selectedTypes.includes(type)) {
                  this.selectedTypes = this.selectedTypes.filter((item): boolean => item !== type);
                } else {
                  this.selectedTypes = this.selectedTypes.concat([type]);
                }
                this.bump();
              } })
            }
          }, (type: string): string => `type-${type}`)
      }
    }
    .width('100%')
  }

  @Builder
  countChips() {
    Column({ space: 8 }) {
      Row() {
        Text('题量')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
        Blank()
        Text(`可用 ${this.selectedAvailable()} 题`)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .width('100%')
      if (this.selectedAvailable() > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          SmallChip({ label: '自定义', active: this.countMode === 'custom', onTap: (): void => {
            this.countMode = 'custom';
            this.bump();
          } })
          if (this.selectedAvailable() >= 50) {
            SmallChip({ label: '50 题', active: this.countMode === '50', onTap: (): void => {
              this.countMode = '50';
              this.bump();
            } })
          }
          if (this.selectedAvailable() >= 100) {
            SmallChip({ label: '100 题', active: this.countMode === '100', onTap: (): void => {
              this.countMode = '100';
              this.bump();
            } })
          }
          if (this.selectedAvailable() > 1) {
            SmallChip({ label: `一半 ${Math.max(1, Math.floor(this.selectedAvailable() / 2))} 题`, active: this.countMode === 'half', onTap: (): void => {
              this.countMode = 'half';
              this.bump();
            } })
          }
          SmallChip({ label: `全部 ${this.selectedAvailable()} 题`, active: this.countMode === 'all', onTap: (): void => {
            this.countMode = 'all';
            this.bump();
          } })
        }
        if (this.countMode === 'custom') {
          Row({ space: 10 }) {
            PillButton({ label: '-5', primary: false, isEnabled: this.customCount > 5, onTap: (): void => {
              this.customCount = Math.max(1, this.customCount - 5);
              this.bump();
            }, grow: false, fixedWidth: 64 })
            Text(`${Math.min(this.customCount, this.selectedAvailable())} 题`)
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
            PillButton({ label: '+5', primary: false, isEnabled: true, onTap: (): void => {
              this.customCount = Math.min(this.selectedAvailable(), this.customCount + 5);
              this.bump();
            }, grow: false, fixedWidth: 64 })
          }
          .width('100%')
          .justifyContent(FlexAlign.Center)
        }
      }
    }
    .width('100%')
  }

  @Builder
  meTab() {
    Scroll() {
      Column({ space: 14 }) {
        Row({ space: 12 }) {
          Column({ space: 4 }) {
            Text('Me')
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(MisakaColors.PRIMARY)
            Text('设置与资料')
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(MisakaColors.TEXT)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text(this.repo.settings.darkThemeEnabled ? '☀️ 浅色' : '🌙 暗色')
            .fontSize(13)
            .fontColor(MisakaColors.PRIMARY)
            .backgroundColor(MisakaColors.PRIMARY_SOFT)
            .borderRadius(18)
            .padding({ left: 14, right: 14, top: 8, bottom: 8 })
            .onClick((): void => {
              this.toggleDarkTheme();
            })
        }
        .width('100%')

        // hero 卡：Misaka 模式开启时显示插画（对齐 Android IllustrationHeroCard + misaka 模式开关）
        Row({ space: 14 }) {
          Column({ space: 6 }) {
            Text('我是Misaka')
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor(MisakaColors.TEXT)
            Text('欢迎关注，喜欢的话请给我⭐️⭐️')
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          if (this.repo.settings.misakaModeEnabled) {
            Image($r('app.media.illus_me'))
              .width(84)
              .height(84)
              .objectFit(ImageFit.Contain)
              .borderRadius(12)
          }
        }
        .width('100%')
        .padding(16)
        .backgroundColor(MisakaColors.PRIMARY_SOFT)
        .borderRadius(18)
        .alignItems(VerticalAlign.Center)

        Text('功能与档案')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
        Column({ space: 4 }) {
          this.meStrip('外观偏好', '主题、Misaka 模式、开屏图和侧边导航。', (): void => {
            router.pushUrl({ url: 'pages/AppearancePage' });
          })
          this.meStrip('AI 设置', '接口配置、导入核对、题目页分析和成本限制。', (): void => {
            router.pushUrl({ url: 'pages/AiSettingsPage' });
          })
          this.meStrip('数据管理', '导入、导出、备份和清除本地数据。', (): void => {
            router.pushUrl({ url: 'pages/DataManagerPage' });
          })
          this.meStrip('关于 Misaka Quiz', '项目地址、版本说明和开源信息。', (): void => {
            router.pushUrl({ url: 'pages/AboutPage' });
          })
        }
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(12)
        .padding(4)
        .width('100%')

        Text('刷题偏好')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
        // tick 奇偶翻转重建：开关值读 repo.settings 纯数据，bump 后需换支重建子树刷新（同 homeTab/WrongBook 模式）
        if (this.tick % 2 === 0) {
          this.prefToggles()
        } else {
          this.prefToggles()
        }

        InfoNotice({ text: `Misaka Quiz ${APP_VERSION_LABEL} · 鸿蒙原生\n解析器回归 39/39 · M8 AI 全家桶（核对/解析/重构/单题分析/问 AI/题库分析）`, warning: false })
      }
      .padding(16)
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  @Builder
  meStrip(title: string, desc: string, onTap: () => void) {
    Row() {
      Column({ space: 2 }) {
        Text(title)
          .fontSize(15)
          .fontColor(MisakaColors.TEXT)
        Text(desc)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text('›')
        .fontSize(18)
        .fontColor(MisakaColors.TEXT_SUB)
    }
    .width('100%')
    .padding(12)
    .onClick((): void => {
      onTap();
    })
  }

  @Builder
  prefToggles() {
    Column({ space: 4 }) {
      this.prefToggle('选项打乱', '单选/多选练习时随机打乱选项顺序', 'practiceOptionShuffleEnabled', KEY_PRACTICE_OPTION_SHUFFLE_ENABLED);
      this.prefToggle('斩题开关', '练习页显示斩题按钮，斩掉的题不再出现', 'practiceSlashEnabled', KEY_PRACTICE_SLASH_ENABLED);
      this.prefToggle('快速编辑', '练习页可随手修正题干/答案/解析', 'practiceQuickEditEnabled', KEY_PRACTICE_QUICK_EDIT_ENABLED);
      this.prefToggle('滑动切题', '练习页左右滑动切换题目', 'swipeNavigationEnabled', KEY_SWIPE_NAVIGATION_ENABLED);
      this.prefToggle('选项自动提交', '单选/判断选中后立即提交', 'practiceAutoSubmitEnabled', KEY_PRACTICE_AUTO_SUBMIT_ENABLED);
      this.prefToggle('自动下一题', '答对后自动进入下一题', 'practiceAutoNextEnabled', KEY_PRACTICE_AUTO_NEXT_ENABLED);
      this.prefToggle('批量自动下一题', '批量模式选完单选/判断自动跳下一题', 'practiceBatchAutoNextEnabled', KEY_PRACTICE_BATCH_AUTO_NEXT_ENABLED);
    }
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(12)
    .padding(8)
    .width('100%')
  }

  @Builder
  prefToggle(title: string, subtitle: string, field: string, key: string) {
    SettingToggleRow({ title: title, subtitle: subtitle, value: this.prefValue(field), onToggle: (): void => {
      const value = !this.prefValue(field);
      this.setPrefValue(field, value);
      this.repo.settings.putBool(key, value);
      this.bump();
    } })
  }

  private prefValue(field: string): boolean {
    const s = this.repo.settings;
    if (field === 'practiceOptionShuffleEnabled') {
      return s.practiceOptionShuffleEnabled;
    }
    if (field === 'practiceSlashEnabled') {
      return s.practiceSlashEnabled;
    }
    if (field === 'practiceQuickEditEnabled') {
      return s.practiceQuickEditEnabled;
    }
    if (field === 'swipeNavigationEnabled') {
      return s.swipeNavigationEnabled;
    }
    if (field === 'practiceAutoSubmitEnabled') {
      return s.practiceAutoSubmitEnabled;
    }
    if (field === 'practiceAutoNextEnabled') {
      return s.practiceAutoNextEnabled;
    }
    return s.practiceBatchAutoNextEnabled;
  }

  private setPrefValue(field: string, value: boolean): void {
    const s = this.repo.settings;
    if (field === 'practiceOptionShuffleEnabled') {
      s.practiceOptionShuffleEnabled = value;
    } else if (field === 'practiceSlashEnabled') {
      s.practiceSlashEnabled = value;
    } else if (field === 'practiceQuickEditEnabled') {
      s.practiceQuickEditEnabled = value;
    } else if (field === 'swipeNavigationEnabled') {
      s.swipeNavigationEnabled = value;
    } else if (field === 'practiceAutoSubmitEnabled') {
      s.practiceAutoSubmitEnabled = value;
    } else if (field === 'practiceAutoNextEnabled') {
      s.practiceAutoNextEnabled = value;
    } else {
      s.practiceBatchAutoNextEnabled = value;
    }
  }

  @Builder
  importTab() {
    // M8 修复：ImportPage 原先被 layoutWeight(1) 挤在内置题库卡下方的矮区，
    // 「选择文件/粘贴文本」与 AI 工具条不可见不可滚；改外层 Scroll + 固定面板高度
    Scroll() {
      Column({ space: 12 }) {
        Column({ space: 8 }) {
          Text('内置题库')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
          Text('C1 驾照科目一模拟题库（393 题），来自 Web 端默认题库。')
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
          PillButton({ label: this.hasC1() ? '再次导入 C1 题库' : '导入内置 C1 题库', primary: !this.hasC1(), isEnabled: true, onTap: (): void => {
            this.importC1();
          }, fixedWidth: 360 })
          if (this.c1Status.length > 0) {
            Text(this.c1Status)
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
          }
        }
        .padding(14)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')

        Column() {
          ImportPage()
        }
        .width('100%')
        .height(900)
      }
      .padding(16)
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  @Builder
  tabContent() {
    if (this.currentTab === 0) {
      this.homeTab()
    } else if (this.currentTab === 1) {
      this.practiceTab()
    } else if (this.currentTab === 2) {
      this.importTab()
    } else {
      this.meTab()
    }
  }

  // 开屏浮层（对齐 Android MisakaSplashArtwork：整图 + 底部标题/进度条）
  @Builder
  splashOverlay() {
    Stack() {
      Image($r('app.media.illus_splash'))
        .width('100%')
        .height('100%')
        .objectFit(ImageFit.Cover)
      Column({ space: 10 }) {
        Row({ space: 8 }) {
          Text('Misaka')
            .fontSize(41)
            .fontWeight(FontWeight.Bold)
            .fontColor('#1F5EA8')
          Text('Quiz')
            .fontSize(41)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FF78AD')
        }
        Text('让自律成为习惯，让成长看得见')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor('#7C9ED6')
        Progress({ value: this.splashProgress, total: 100, type: ProgressType.Linear })
          .width('54%')
          .height(18)
          .color('#FF6EA7')
          .backgroundColor('#FFFFFF76')
          .borderRadius(9)
          .margin({ top: 20, bottom: 24 })
        Text('正在加载中…')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor('#7C9ED6')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
    .alignContent(Alignment.Bottom)
    .padding({ bottom: 60 })
    .opacity(this.splashOpacity)
  }

  build() {
    Stack() {
      if (this.sideNavActive()) {
        Row() {
          this.sideRail()
          Divider()
            .vertical(true)
            .height('100%')
          Column() {
            this.tabContent()
          }
          .layoutWeight(1)
          .width('100%')
        }
        .width('100%')
        .height('100%')
        .backgroundColor(MisakaColors.BG)
      } else {
        Column() {
          Column() {
            this.tabContent()
          }
          .layoutWeight(1)
          .width('100%')

          Divider()
          Row() {
            this.tabItem(0, '首页')
            this.tabItem(1, '练习')
            this.tabItem(2, '导入')
            this.tabItem(3, '我的')
          }
          .width('100%')
          .height(56)
          .backgroundColor(MisakaColors.CARD)
        }
        .width('100%')
        .height('100%')
        .backgroundColor(MisakaColors.BG)
      }

      if (this.splashVisible) {
        this.splashOverlay()
      }
    }
    .width('100%')
    .height('100%')
  }

  // 展开态侧边导航（对齐 Android MisakaSideNavigation：88dp Rail + 四根 Tab）
  @Builder
  sideRail() {
    Column({ space: 4 }) {
      this.railItem(0, '首页', '🏠')
      this.railItem(1, '练习', '🎓')
      this.railItem(2, '导入', '📥')
      this.railItem(3, '我的', '⚙️')
    }
    .width(88)
    .height('100%')
    .backgroundColor(MisakaColors.CARD)
    .padding({ top: 16, bottom: 16 })
    .justifyContent(FlexAlign.Start)
  }

  @Builder
  railItem(index: number, label: string, icon: string) {
    Column({ space: 4 }) {
      Text(icon)
        .fontSize(20)
      Text(label)
        .fontSize(12)
        .fontWeight(this.currentTab === index ? FontWeight.Medium : FontWeight.Normal)
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
    .borderRadius(14)
    .backgroundColor(this.currentTab === index ? MisakaColors.PRIMARY_SOFT : Color.Transparent)
    .onClick((): void => {
      this.currentTab = index;
      this.bump();
    })
  }

  @Builder
  tabItem(index: number, label: string) {
    Column({ space: 2 }) {
      Text(label)
        .fontSize(14)
        .fontWeight(this.currentTab === index ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.currentTab === index ? MisakaColors.PRIMARY : MisakaColors.TEXT_SUB)
    }
    .justifyContent(FlexAlign.Center)
    .layoutWeight(1)
    .height('100%')
    .onClick((): void => {
      this.currentTab = index;
      this.bump();
    })
  }
}
