import { normalizeQuestionIndex, isJudgeOptionPair } from '../importer/parser/ParserUtils';
import { runZlibSpike } from '../spike/ZlibSpike';
import { runSseSpike } from '../spike/HttpSpike';
import { common } from '@kit.AbilityKit';

@Entry
@Component
struct Index {
  private versionLabel: string = 'v0.1.0-harmony';
  @State parserCheck: string = '未运行';
  @State zlibCheck: string = '未运行';
  @State sseCheck: string = '未运行';

  // M0 spike③: .ts 解析器源码被 hvigor 编译并调用，行为与 Android/Node 对齐
  private parserSelfCheck(): void {
    const ok = normalizeQuestionIndex('一百二十三') === '123' &&
      isJudgeOptionPair(['a', 'b'], ['正确', '错误']);
    this.parserCheck = ok ? '解析器自检通过' : '解析器自检失败';
  }

  private async runZlibSpike(): Promise<void> {
    this.zlibCheck = '运行中…';
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.zlibCheck = await runZlibSpike(context.filesDir);
  }

  aboutToAppear(): void {
    this.parserSelfCheck();
  }

  build() {
    Column({ space: 12 }) {
      Text('Misaka Quiz')
        .fontSize(32)
        .fontWeight(FontWeight.Bold)
      Text(this.versionLabel)
        .fontSize(14)
        .opacity(0.6)
      Text(this.parserCheck)
        .fontSize(14)
        .opacity(0.6)
      Button('zlib 压缩解压往返')
        .onClick(() => {
          this.runZlibSpike();
        })
      Text(this.zlibCheck)
        .fontSize(12)
        .opacity(0.8)
        .textAlign(TextAlign.Center)
      Button('SSE 流式接收')
        .onClick(() => {
          this.sseCheck = '运行中…';
          runSseSpike().then((r: string): void => {
            this.sseCheck = r;
          });
        })
      Text(this.sseCheck)
        .fontSize(12)
        .opacity(0.8)
        .textAlign(TextAlign.Center)
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
  }
}
