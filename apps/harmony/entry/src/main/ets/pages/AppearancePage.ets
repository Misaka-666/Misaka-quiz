/**
 * M7 外观偏好页 — 对齐 Android AppearancePreferenceScreen。
 * 主题（浅/暗，setColorMode 全局切换）、Misaka 模式（开屏图+页面插画；鸿蒙无法动态切换应用图标，
 * ponytail: 图标切换部分未移植，如需可在发布时更换静态图标）、保留开屏图、平板侧边导航、
 * 阅读显示（题干/选项字号、紧凑选项）。
 */
import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { QuizRepository } from '../state/QuizRepository';
import { MisakaColors, PillButton, SmallChip, SettingToggleRow } from './common/QuizWidgets';
import {
  KEY_DARK_THEME_ENABLED, KEY_TABLET_SIDE_NAVIGATION_ENABLED, KEY_MISAKA_MODE_ENABLED,
  KEY_STARTUP_SPLASH_ENABLED, KEY_QUESTION_FONT_SIZE_MODE, KEY_OPTION_FONT_SIZE_MODE,
  KEY_COMPACT_OPTIONS_ENABLED, applyAppColorMode
} from '../state/AppSettings';

@Entry
@Component
struct AppearancePage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private bump(): void {
    this.tick += 1;
  }

  private chooseTheme(dark: boolean): void {
    const s = this.repo.settings;
    if (s.darkThemeEnabled === dark) {
      return;
    }
    s.darkThemeEnabled = dark;
    s.putBool(KEY_DARK_THEME_ENABLED, dark);
    applyAppColorMode(this.context(), dark);
    this.bump();
  }

  private toggleBool(field: string, key: string): void {
    const s = this.repo.settings;
    let value = false;
    if (field === 'misaka') {
      value = !s.misakaModeEnabled;
      s.misakaModeEnabled = value;
    } else if (field === 'splash') {
      value = !s.startupSplashEnabled;
      s.startupSplashEnabled = value;
    } else {
      value = !s.tabletSideNavigationEnabled;
      s.tabletSideNavigationEnabled = value;
    }
    s.putBool(key, value);
    this.bump();
  }

  private chooseFontMode(kind: string, mode: string): void {
    const s = this.repo.settings;
    if (kind === 'question') {
      s.questionFontSizeMode = mode;
      s.putString(KEY_QUESTION_FONT_SIZE_MODE, mode);
    } else {
      s.optionFontSizeMode = mode;
      s.putString(KEY_OPTION_FONT_SIZE_MODE, mode);
    }
    this.bump();
  }

  private currentFontMode(kind: string): string {
    return kind === 'question' ? this.repo.settings.questionFontSizeMode : this.repo.settings.optionFontSizeMode;
  }

  onPageShow(): void {
    this.bump();
  }

  @Builder
  fontSizeRow(label: string, desc: string, kind: string) {
    Column({ space: 8 }) {
      Text(label)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(MisakaColors.TEXT)
      Text(desc)
        .fontSize(12)
        .fontColor(MisakaColors.TEXT_SUB)
      Row({ space: 10 }) {
        ForEach(['small', 'standard', 'large'], (mode: string) => {
          SmallChip({ label: mode === 'small' ? '小' : (mode === 'large' ? '大' : '标准'), active: this.currentFontMode(kind) === mode, onTap: (): void => {
            this.chooseFontMode(kind, mode);
          } })
        }, (mode: string): string => `font-${kind}-${mode}`)
      }
      .width('100%')
    }
    .width('100%')
    .padding({ top: 6, bottom: 6 })
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      Column({ space: 12 }) {
        Text('外观设置')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Column({ space: 8 }) {
          Text('主题')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(MisakaColors.TEXT)
          Row({ space: 10 }) {
            SmallChip({ label: '浅色', active: !this.repo.settings.darkThemeEnabled, onTap: (): void => {
              this.chooseTheme(false);
            } })
            SmallChip({ label: '暗色', active: this.repo.settings.darkThemeEnabled, onTap: (): void => {
              this.chooseTheme(true);
            } })
          }
          .width('100%')
        }
        .width('100%')
        .padding({ top: 6, bottom: 6 })

        SettingToggleRow({ title: 'Misaka 模式', subtitle: '显示开屏图与「我的」页面插画。', value: this.repo.settings.misakaModeEnabled, onToggle: (): void => {
          this.toggleBool('misaka', KEY_MISAKA_MODE_ENABLED);
        } })
        if (this.repo.settings.misakaModeEnabled) {
          SettingToggleRow({ title: '保留开屏启动图片', subtitle: '开启后下次启动显示学习主题开屏图。', value: this.repo.settings.startupSplashEnabled, onToggle: (): void => {
            this.toggleBool('splash', KEY_STARTUP_SPLASH_ENABLED);
          } })
        }
        SettingToggleRow({ title: '平板侧边导航', subtitle: '在较宽屏幕（如阔折叠展开态）上将底部导航移到左侧。', value: this.repo.settings.tabletSideNavigationEnabled, onToggle: (): void => {
          this.toggleBool('sideNav', KEY_TABLET_SIDE_NAVIGATION_ENABLED);
        } })
      }
      .padding(14)
      .backgroundColor(MisakaColors.CARD)
      .borderRadius(14)
      .width('100%')

      Column({ space: 12 }) {
        Text('阅读显示')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        this.fontSizeRow('题干字号', '调整练习和考试中的题干阅读大小。', 'question')
        this.fontSizeRow('选项字号', '调整练习和考试中的选项文字大小。', 'option')
        SettingToggleRow({ title: '紧凑选项模式', subtitle: '减少选项卡片背景和间距，适合长题快速阅读。', value: this.repo.settings.compactOptionsEnabled, onToggle: (): void => {
          const s = this.repo.settings;
          s.compactOptionsEnabled = !s.compactOptionsEnabled;
          s.putBool(KEY_COMPACT_OPTIONS_ENABLED, s.compactOptionsEnabled);
          this.bump();
        } })
      }
      .padding(14)
      .backgroundColor(MisakaColors.CARD)
      .borderRadius(14)
      .width('100%')

      PillButton({ label: '返回设置', primary: false, isEnabled: true, onTap: (): void => {
        router.back();
      } })
    }
    .constraintSize({ maxWidth: 760 })
    .width('100%')
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('外观偏好')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        Text(this.tick >= 0 ? 'Appearance' : '')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column() {
          if (this.tick % 2 === 0) {
            this.pageBody();
          } else {
            this.pageBody();
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
}
