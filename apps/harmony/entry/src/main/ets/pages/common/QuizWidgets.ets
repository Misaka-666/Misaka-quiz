/**
 * M4 共享 UI 组件 — @Component + @Prop（状态可响应；全局 @Builder 按值传参不会随状态刷新，
 * 故所有含动态文案/配色的组件一律用组件形式）。
 */

// 主题 Token — M7 起为 base/dark 双份 color.json 同名资源，setColorMode 切换后整树重绘自动生效；
// 暗色取值对齐 Android Tokens.kt（MisakaColors dark 分支），切换入口见 AppSettings.applyAppColorMode
export class MisakaColors {
  static get PRIMARY(): ResourceColor { return $r('app.color.misaka_primary'); }
  static get PRIMARY_SOFT(): ResourceColor { return $r('app.color.misaka_primary_soft'); }
  static get ON_BRAND(): ResourceColor { return $r('app.color.misaka_on_brand'); }
  static get ON_BRAND_SUB(): ResourceColor { return $r('app.color.misaka_on_brand_sub'); }
  static get BG(): ResourceColor { return $r('app.color.misaka_bg'); }
  static get CARD(): ResourceColor { return $r('app.color.misaka_card'); }
  static get TEXT(): ResourceColor { return $r('app.color.misaka_text'); }
  static get TEXT_SUB(): ResourceColor { return $r('app.color.misaka_text_sub'); }
  static get TEXT_TERTIARY(): ResourceColor { return $r('app.color.misaka_text_tertiary'); }
  static get TEXT_DISABLED(): ResourceColor { return $r('app.color.misaka_text_disabled'); }
  static get MUTED(): ResourceColor { return $r('app.color.misaka_muted'); }
  static get BORDER(): ResourceColor { return $r('app.color.misaka_border'); }
  static get GREEN(): ResourceColor { return $r('app.color.misaka_green'); }
  static get GREEN_SOFT(): ResourceColor { return $r('app.color.misaka_green_soft'); }
  static get RED(): ResourceColor { return $r('app.color.misaka_red'); }
  static get RED_SOFT(): ResourceColor { return $r('app.color.misaka_red_soft'); }
  static get AMBER(): ResourceColor { return $r('app.color.misaka_amber'); }
  static get AMBER_SOFT(): ResourceColor { return $r('app.color.misaka_amber_soft'); }
  static get WARN(): ResourceColor { return $r('app.color.misaka_warn'); }
  static get ACCENT_PURPLE(): ResourceColor { return $r('app.color.misaka_accent_purple'); }
}

export const TYPE_LABELS: Record<string, string> = {
  'SINGLE': '单选题', 'MULTIPLE': '多选题', 'JUDGE': '判断题', 'BLANK': '填空题', 'SHORT': '简答题'
};

/** 应用版本标签（与 AppScope/app.json5 versionName 同步 bump） */
export const APP_VERSION_LABEL = 'v0.9.4-harmony';

export const TYPE_COMPACT_LABELS: Record<string, string> = {
  'SINGLE': '单选', 'MULTIPLE': '多选', 'JUDGE': '判断', 'BLANK': '填空', 'SHORT': '简答'
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] !== undefined ? TYPE_LABELS[type] : '题目';
}

export function formatClockSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** MM-dd HH:mm（对齐 Android RecordsScreen.formatRecordTime） */
export function formatShortTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 得分 4 → "4"、4.5 → "4.5"（对齐 Android Double.trimScore） */
export function formatScoreValue(value: number): string {
  return value % 1.0 === 0.0 ? `${value}` : value.toFixed(1);
}

@Component
export struct TypeBadge {
  @Prop type: string;
  build() {
    Text(typeLabel(this.type))
      .fontSize(11)
      .fontColor(MisakaColors.PRIMARY)
      .backgroundColor(MisakaColors.PRIMARY_SOFT)
      .borderRadius(6)
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
  }
}

@Component
export struct PillButton {
  @Prop label: string;
  @Prop primary: boolean;
  @Prop isEnabled: boolean = true;
  @Prop grow: boolean = false;
  @Prop fixedWidth: number = 0;
  onTap: () => void = (): void => {};
  build() {
    Text(this.label)
      .fontSize(15)
      .fontWeight(this.primary ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(!this.isEnabled ? MisakaColors.TEXT_DISABLED : (this.primary ? MisakaColors.ON_BRAND : MisakaColors.TEXT))
      .backgroundColor(!this.isEnabled ? MisakaColors.MUTED : (this.primary ? MisakaColors.PRIMARY : MisakaColors.CARD))
      .borderRadius(22)
      .border({
        width: 1,
        color: !this.isEnabled ? MisakaColors.BORDER : (this.primary ? MisakaColors.PRIMARY : MisakaColors.BORDER)
      })
      .height(44)
      .padding({ left: 16, right: 16 })
      .constraintSize({ minWidth: 72 })
      .textAlign(TextAlign.Center)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .width(this.fixedWidth > 0 ? this.fixedWidth : 'auto')
      .layoutWeight(this.grow ? 1 : 0)
      .onClick((): void => {
        if (this.isEnabled) {
          this.onTap();
        }
      })
  }
}

@Component
export struct SmallChip {
  @Prop label: string;
  @Prop active: boolean;
  onTap: () => void = (): void => {};
  build() {
    Text(this.label)
      .fontSize(13)
      .fontColor(this.active ? MisakaColors.PRIMARY : MisakaColors.TEXT)
      .backgroundColor(this.active ? MisakaColors.PRIMARY_SOFT : MisakaColors.CARD)
      .borderRadius(18)
      .border({ width: 1, color: this.active ? MisakaColors.PRIMARY : MisakaColors.BORDER })
      .padding({ left: 14, right: 14, top: 8, bottom: 8 })
      .maxLines(1)
      .margin(4)
      .onClick((): void => {
        this.onTap();
      })
  }
}

/** 只读状态标签（对齐 Android StatusChip） */
@Component
export struct StatusChip {
  @Prop label: string;
  @Prop tone: string = 'neutral'; // neutral / primary / green / red
  build() {
    Text(this.label)
      .fontSize(11)
      .fontColor(this.toneColor())
      .backgroundColor(this.toneBg())
      .borderRadius(6)
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
      .maxLines(1)
  }

  private toneColor(): ResourceColor {
    if (this.tone === 'primary') {
      return MisakaColors.PRIMARY;
    }
    if (this.tone === 'green') {
      return MisakaColors.GREEN;
    }
    if (this.tone === 'red') {
      return MisakaColors.RED;
    }
    return MisakaColors.TEXT_SUB;
  }

  private toneBg(): ResourceColor {
    if (this.tone === 'primary') {
      return MisakaColors.PRIMARY_SOFT;
    }
    if (this.tone === 'green') {
      return MisakaColors.GREEN_SOFT;
    }
    if (this.tone === 'red') {
      return MisakaColors.RED_SOFT;
    }
    return MisakaColors.MUTED;
  }
}

@Component
export struct ChoiceCard {
  @Prop label: string;
  @Prop text: string;
  @Prop selected: boolean;
  @Prop state: string;
  @Prop fontSize: number;
  @Prop lineHeight: number;
  onTap: () => void = (): void => {};

  private bgTone(): ResourceColor {
    if (this.state === 'correct') {
      return MisakaColors.GREEN_SOFT;
    }
    if (this.state === 'wrong') {
      return MisakaColors.RED_SOFT;
    }
    if (this.state === 'missed') {
      return MisakaColors.AMBER_SOFT;
    }
    if (this.selected) {
      return MisakaColors.PRIMARY_SOFT;
    }
    return MisakaColors.CARD;
  }

  private borderTone(): ResourceColor {
    if (this.state === 'correct') {
      return MisakaColors.GREEN;
    }
    if (this.state === 'wrong') {
      return MisakaColors.RED;
    }
    if (this.state === 'missed') {
      return MisakaColors.AMBER;
    }
    if (this.selected) {
      return MisakaColors.PRIMARY;
    }
    return MisakaColors.BORDER;
  }

  private labelBgTone(): ResourceColor {
    if (this.state === 'correct') {
      return MisakaColors.GREEN;
    }
    if (this.state === 'wrong') {
      return MisakaColors.RED;
    }
    if (this.state === 'missed') {
      return MisakaColors.AMBER;
    }
    if (this.selected) {
      return MisakaColors.PRIMARY;
    }
    return MisakaColors.MUTED;
  }

  private labelFgTone(): ResourceColor {
    if (this.state === 'correct' || this.state === 'wrong' || this.state === 'missed' || this.selected) {
      return MisakaColors.ON_BRAND;
    }
    return MisakaColors.TEXT;
  }

  build() {
    Row({ space: 10 }) {
      Text(this.label)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.labelFgTone())
        .backgroundColor(this.labelBgTone())
        .borderRadius(16)
        .width(32)
        .height(32)
        .textAlign(TextAlign.Center)
      Text(this.text.length > 0 ? this.text : '（空）')
        .fontSize(this.fontSize)
        .lineHeight(this.lineHeight)
        .fontColor(MisakaColors.TEXT)
        .layoutWeight(1)
    }
    .alignItems(VerticalAlign.Top)
    .padding(12)
    .backgroundColor(this.bgTone())
    .borderRadius(14)
    .border({ width: 1.5, color: this.borderTone() })
    .onClick((): void => {
      this.onTap();
    })
  }
}

@Component
export struct SettingToggleRow {
  @Prop title: string;
  @Prop subtitle: string;
  @Prop value: boolean;
  onToggle: () => void = (): void => {};
  build() {
    Row({ space: 12 }) {
      Column({ space: 2 }) {
        Text(this.title)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(MisakaColors.TEXT)
        Text(this.subtitle)
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .maxLines(2)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text(this.value ? '已开启' : '已关闭')
        .fontSize(13)
        .fontColor(this.value ? MisakaColors.PRIMARY : MisakaColors.TEXT_SUB)
        .backgroundColor(this.value ? MisakaColors.PRIMARY_SOFT : MisakaColors.MUTED)
        .borderRadius(16)
        .padding({ left: 14, right: 14, top: 7, bottom: 7 })
        .onClick((): void => {
          this.onToggle();
        })
    }
    .padding({ top: 8, bottom: 8 })
  }
}

@Component
export struct AnswerResultBlock {
  @Prop correct: boolean;
  @Prop title: string;
  @Prop body: string;
  build() {
    Column({ space: 8 }) {
      Text(this.correct ? '回答正确' : '回答错误')
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.correct ? MisakaColors.GREEN : MisakaColors.RED)
        .backgroundColor(this.correct ? MisakaColors.GREEN_SOFT : MisakaColors.RED_SOFT)
        .borderRadius(14)
        .padding({ left: 14, right: 14, top: 6, bottom: 6 })
        .alignSelf(ItemAlign.Start)
      if (this.title.length > 0) {
        Text(this.title)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(MisakaColors.TEXT)
      }
      if (this.body.length > 0) {
        Text(this.body)
          .fontSize(14)
          .lineHeight(22)
          .fontColor(MisakaColors.TEXT)
          .width('100%')
          .textAlign(TextAlign.Start)
      }
    }
    .width('100%')
  }
}

@Component
export struct InfoNotice {
  @Prop text: string;
  @Prop warning: boolean;
  build() {
    Text(this.text)
      .fontSize(13)
      .fontColor(this.warning ? MisakaColors.AMBER : MisakaColors.TEXT_SUB)
      .backgroundColor(this.warning ? MisakaColors.AMBER_SOFT : MisakaColors.MUTED)
      .borderRadius(10)
      .padding(12)
      .width('100%')
  }
}
