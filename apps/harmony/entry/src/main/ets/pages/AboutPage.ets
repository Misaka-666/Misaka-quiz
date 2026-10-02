/**
 * M7 关于页 — 对齐 Android AboutScreen：项目地址（GitHub）/ 项目说明 / 开源与数据 / 版本标签。
 */
import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { QuizRepository } from '../state/QuizRepository';
import { MisakaColors, PillButton, InfoNotice, APP_VERSION_LABEL } from './common/QuizWidgets';

const PROJECT_URL = 'https://github.com/reiqr/misaka-quiz';

@Entry
@Component
struct AboutPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State openStatus: string = '';
  @State openWarning: boolean = false;

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private openProject(): void {
    try {
      this.context().openLink(PROJECT_URL).catch((): void => {
        this.openStatus = '无法打开外部链接，请复制项目地址访问。';
        this.openWarning = true;
      });
    } catch (_err) {
      this.openStatus = '无法打开外部链接，请复制项目地址访问。';
      this.openWarning = true;
    }
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('关于 Misaka Quiz')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        Text('About')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column({ space: 14 }) {
          Column({ space: 10 }) {
            Text('我是 Misaka，欢迎关注。')
              .fontSize(14)
              .fontColor(MisakaColors.TEXT_SUB)
              .width('100%')
            if (this.repo.settings.misakaModeEnabled) {
              Image($r('app.media.illus_me'))
                .width(140)
                .height(140)
                .objectFit(ImageFit.Contain)
                .borderRadius(16)
            }
          }
          .width('100%')

          Column({ space: 10 }) {
            Text('项目地址')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .width('100%')
            Text(PROJECT_URL)
              .fontSize(14)
              .fontColor(MisakaColors.PRIMARY)
              .width('100%')
            PillButton({ label: '打开 GitHub 项目页', primary: true, isEnabled: true, onTap: (): void => {
              this.openProject();
            }, grow: true })
          }
          .padding(14)
          .backgroundColor(MisakaColors.CARD)
          .borderRadius(14)
          .width('100%')

          Column({ space: 10 }) {
            Text('项目说明')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .width('100%')
            Text('Misaka Quiz 是一个面向本地题库导入、练习、考试、错题复习和学习记录管理的刷题工具。鸿蒙原生版本重点优化阔折叠展开态与平板大屏体验。')
              .fontSize(14)
              .fontColor(MisakaColors.TEXT_SUB)
              .lineHeight(22)
              .width('100%')
          }
          .padding(14)
          .backgroundColor(MisakaColors.CARD)
          .borderRadius(14)
          .width('100%')

          Column({ space: 10 }) {
            Text('开源与数据')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .width('100%')
            Text('题库、错题本和学习记录默认保存在本机。发布包不应包含用户本地导入数据。')
              .fontSize(14)
              .fontColor(MisakaColors.TEXT_SUB)
              .lineHeight(22)
              .width('100%')
          }
          .padding(14)
          .backgroundColor(MisakaColors.CARD)
          .borderRadius(14)
          .width('100%')

          InfoNotice({ text: `版本 ${APP_VERSION_LABEL} · 鸿蒙原生（ArkTS/ArkUI）`, warning: false })

          if (this.openStatus.length > 0) {
            InfoNotice({ text: this.openStatus, warning: this.openWarning })
          }

          PillButton({ label: '返回设置', primary: false, isEnabled: true, onTap: (): void => {
            router.back();
          } })
        }
        .constraintSize({ maxWidth: 760 })
        .width('100%')
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
