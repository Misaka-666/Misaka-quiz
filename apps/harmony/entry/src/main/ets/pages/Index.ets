import { parseStandardText } from '../importer/parser/QuizImportParser';
import { runZlibSpike } from '../spike/ZlibSpike';
import { runSseSpike } from '../spike/HttpSpike';
import { QuizRepository } from '../state/QuizRepository';
import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

@Entry
@Component
struct Index {
  private versionLabel: string = 'v0.4.1-harmony';
  @State parserCheck: string = '未运行';
  @State zlibCheck: string = '未运行';
  @State sseCheck: string = '未运行';
  @State storeCheck: string = '未运行';

  // M2: 完整解析器链路（18 个组件）在 HAP 内运行，行为与 Android 回归口径一致
  private parserSelfCheck(): void {
    const result = parseStandardText('1.下列哪项正确？\nA.第一项\nB.第二项\n答案：A\n解析：A正确');
    const q = result.questions.length === 1 ? result.questions[0] : null;
    const ok = q !== null && q.type === 'SINGLE' && q.answer.length === 1 && q.answer[0] === 'A' &&
      q.analysis === 'A正确';
    this.parserCheck = ok ? `解析器自检通过（${result.strategyName}）` : '解析器自检失败';
  }

  // M1：领域层持久化自检（创建示例题库→重启后仍可读到）
  private storeSelfCheck(): void {
    const repo = QuizRepository.getInstance();
    if (repo.banks.length === 0) {
      repo.createDemoBank();
    }
    const bank = repo.activeBank();
    if (bank === null) {
      this.storeCheck = '无题库';
      return;
    }
    this.storeCheck = `题库=${repo.banks.length}(${bank.name}) 总题数=${repo.totalQuestionCount()}`;
  }

  private async runZlibSpike(): Promise<void> {
    this.zlibCheck = '运行中…';
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.zlibCheck = await runZlibSpike(context.filesDir);
  }

  aboutToAppear(): void {
    // Repository 已在 EntryAbility onCreate 初始化，这里只做展示层自检
    this.parserSelfCheck();
  }

  onPageShow(): void {
    // 从导入页返回时刷新题库状态
    this.storeSelfCheck();
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
      Text(this.storeCheck)
        .fontSize(14)
        .opacity(0.6)
      Button('导入题库（M3）')
        .onClick(() => {
          router.pushUrl({ url: 'pages/ImportPage' });
        })
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
