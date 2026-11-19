import { router } from '@kit.ArkUI';
import { PracticeContinuation } from '../state/PracticeContinuation';
import { MisakaColors, PillButton } from './common/QuizWidgets';

@Entry
@Component
struct ContinuationPage {
  @StorageLink('continuationMessage') message: string = '正在接收练习';
  @StorageLink('continuationFailed') failed: boolean = false;

  private leave(): void {
    PracticeContinuation.get()?.cancel();
    router.replaceUrl({ url: 'pages/Index' });
  }

  onBackPress(): boolean { this.leave(); return true; }

  build() {
    Column({ space: 20 }) {
      if (!this.failed) { LoadingProgress().width(32).height(32) }
      Text(this.message).fontSize(16).fontColor(MisakaColors.TEXT).textAlign(TextAlign.Center)
      if (this.failed) {
        PillButton({ label: '重试', primary: true, onTap: (): void => { PracticeContinuation.get()?.receive(); } })
      }
      PillButton({ label: '返回', onTap: (): void => this.leave() })
    }
    .width('100%').height('100%').padding(24).justifyContent(FlexAlign.Center)
    .backgroundColor(MisakaColors.BG)
  }
}
