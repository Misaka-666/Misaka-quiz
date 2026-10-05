/**
 * M8 AI 设置页 — 对齐 Android AiSettingsScreen/AiSettingsPanel。
 * 接口配置（服务商预设 DeepSeek/OpenAI 兼容/自定义 + 地址/Key/模型 + 保存/测试连接/清除）、
 * AI 辅助策略开关 ×6、成本与安全（单次题数/超时/重构原文上限）。
 * 连通测试走 MisakaAiClient.testConnection（真实 https POST）。
 */
import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { QuizRepository } from '../state/QuizRepository';
import { MisakaAiClient } from '../ai/MisakaAiClient';
import { MisakaColors, PillButton, SmallChip, SettingToggleRow, InfoNotice } from './common/QuizWidgets';

class AiProviderPreset {
  apiBaseUrl: string;
  modelName: string;
  hint: string;
  constructor(apiBaseUrl: string, modelName: string, hint: string) {
    this.apiBaseUrl = apiBaseUrl;
    this.modelName = modelName;
    this.hint = hint;
  }
}

function aiProviderPreset(provider: string): AiProviderPreset | null {
  if (provider === 'DeepSeek') {
    return new AiProviderPreset('https://api.deepseek.com', 'deepseek-chat',
      'DeepSeek 推荐地址：https://api.deepseek.com；默认模型：deepseek-chat。');
  }
  if (provider === 'OpenAI 兼容') {
    return new AiProviderPreset('https://api.openai.com/v1', 'gpt-4o-mini',
      'OpenAI 兼容接口通常填写到 /v1，程序会自动拼接 /chat/completions。');
  }
  return null;
}

function shouldReplaceAiEndpoint(value: string): boolean {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.length === 0 || ['https://api.example.com/v1', 'https://api.deepseek.com',
    'https://api.deepseek.com/v1', 'https://api.openai.com/v1'].includes(trimmed);
}

function shouldReplaceAiModel(value: string): boolean {
  const clean = value.trim();
  return clean.length === 0 || ['deepseek-chat', 'gpt-4o-mini'].includes(clean);
}

function digitsOnly(value: string, maxLen: number): string {
  let out = '';
  for (const ch of value) {
    if (ch >= '0' && ch <= '9' && out.length < maxLen) {
      out += ch;
    }
  }
  return out;
}

@Entry
@Component
struct AiSettingsPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;
  @State provider: string = 'DeepSeek';
  @State apiBaseUrl: string = '';
  @State apiKey: string = '';
  @State modelName: string = '';
  @State maxQuestionsText: string = '';
  @State timeoutText: string = '';
  @State refactorMaxCharsText: string = '';
  @State statusText: string = '';
  @State statusWarn: boolean = false;
  @State limitStatusText: string = '';
  @State testing: boolean = false;

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private bump(): void {
    this.tick += 1;
  }

  aboutToAppear(): void {
    const s = this.repo.settings;
    this.provider = s.aiProvider;
    const preset = aiProviderPreset(s.aiProvider);
    this.apiBaseUrl = s.aiApiBaseUrl.length > 0 ? s.aiApiBaseUrl : (preset !== null ? preset.apiBaseUrl : '');
    this.apiKey = s.aiApiKey;
    this.modelName = s.aiModelName.length > 0 ? s.aiModelName : (preset !== null ? preset.modelName : '');
    this.maxQuestionsText = String(s.aiMaxQuestions);
    this.timeoutText = String(s.aiTimeoutSeconds);
    this.refactorMaxCharsText = String(s.aiRefactorMaxChars);
  }

  onPageShow(): void {
    this.bump();
  }

  private chooseProvider(next: string): void {
    this.provider = next;
    const preset = aiProviderPreset(next);
    if (preset !== null) {
      if (shouldReplaceAiEndpoint(this.apiBaseUrl)) {
        this.apiBaseUrl = preset.apiBaseUrl;
      }
      if (shouldReplaceAiModel(this.modelName)) {
        this.modelName = preset.modelName;
      }
      this.statusText = `已切换到 ${next}，并填入推荐地址和模型；如使用代理或兼容服务，可继续手动修改。`;
      this.statusWarn = false;
    } else {
      this.statusText = '已切换到自定义接口，请按服务商要求填写 API 地址和模型名称。';
      this.statusWarn = false;
    }
    this.bump();
  }

  private saveConfig(): void {
    this.repo.setAiInterfaceConfig(this.provider, this.apiBaseUrl, this.apiKey, this.modelName);
    this.statusText = 'AI 接口配置已保存。';
    this.statusWarn = false;
    this.bump();
  }

  private testConnection(): void {
    if (this.apiBaseUrl.trim().length === 0 || this.apiKey.trim().length === 0 || this.modelName.trim().length === 0) {
      this.statusText = '请先填写 API 地址、API Key 和模型名称。';
      this.statusWarn = true;
      this.bump();
      return;
    }
    this.testing = true;
    this.statusText = '正在测试 AI 接口连接……';
    this.statusWarn = false;
    this.bump();
    const timeout = parseInt(this.timeoutText, 10);
    MisakaAiClient.testConnection(this.apiBaseUrl, this.apiKey, this.modelName,
      Number.isNaN(timeout) ? this.repo.settings.aiTimeoutSeconds : timeout)
      .then((message: string): void => {
        this.statusText = message.length > 0 ? message : 'AI 接口连接成功。';
        this.statusWarn = false;
        this.testing = false;
        this.bump();
      })
      .catch((err: Error): void => {
        this.statusText = `AI 接口连接失败：${err.message.length > 0 ? err.message : '请检查配置'}`;
        this.statusWarn = true;
        this.testing = false;
        this.bump();
      });
  }

  private confirmClearConfig(): void {
    this.getUIContext().showAlertDialog({
      message: '确认清除 AI 配置？这会清除当前保存的 API 地址、API Key 和模型名称，并关闭所有 AI 功能开关。清除后需要重新填写才能继续使用 AI。',
      primaryButton: {
        value: '确认清除',
        fontColor: MisakaColors.RED,
        action: (): void => {
          this.repo.clearAiConfig();
          this.apiBaseUrl = '';
          this.apiKey = '';
          this.modelName = '';
          this.statusText = 'AI 配置已清除。';
          this.statusWarn = true;
          this.bump();
        }
      },
      secondaryButton: { value: '取消', action: (): void => {} }
    });
  }

  private saveLimits(): void {
    const maxQ = parseInt(this.maxQuestionsText, 10);
    const timeout = parseInt(this.timeoutText, 10);
    const maxChars = parseInt(this.refactorMaxCharsText, 10);
    this.repo.setAiProcessingLimits(
      Number.isNaN(maxQ) ? this.repo.settings.aiMaxQuestions : maxQ,
      Number.isNaN(timeout) ? this.repo.settings.aiTimeoutSeconds : timeout,
      Number.isNaN(maxChars) ? this.repo.settings.aiRefactorMaxChars : maxChars);
    const s = this.repo.settings;
    this.maxQuestionsText = String(s.aiMaxQuestions);
    this.timeoutText = String(s.aiTimeoutSeconds);
    this.refactorMaxCharsText = String(s.aiRefactorMaxChars);
    this.limitStatusText = `处理限制已保存：单次 ${s.aiMaxQuestions} 题，超时 ${s.aiTimeoutSeconds} 秒，AI重构原文上限 ${s.aiRefactorMaxChars} 字。`;
    this.bump();
  }

  @Builder
  providerRow() {
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        SmallChip({ label: 'DeepSeek', active: this.provider === 'DeepSeek', onTap: (): void => {
          this.chooseProvider('DeepSeek');
        } })
        SmallChip({ label: 'OpenAI 兼容', active: this.provider === 'OpenAI 兼容', onTap: (): void => {
          this.chooseProvider('OpenAI 兼容');
        } })
      }
      .width('100%')
      SmallChip({ label: '自定义接口', active: this.provider === '自定义接口', onTap: (): void => {
        this.chooseProvider('自定义接口');
      } })
      .alignSelf(ItemAlign.Start)
    }
    .width('100%')
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      Column({ space: 12 }) {
        Text('接口配置')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        this.providerRow()
        if (aiProviderPreset(this.provider) !== null) {
          Text(aiProviderPreset(this.provider)?.hint ?? '')
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
            .width('100%')
        }
        TextInput({ text: this.apiBaseUrl, placeholder: 'API 地址（https://api.example.com/v1）' })
          .fontSize(14)
          .width('100%')
          .onChange((value: string): void => {
            this.apiBaseUrl = value;
          })
        TextInput({ text: this.apiKey, placeholder: 'API Key（sk-...）' })
          .fontSize(14)
          .width('100%')
          .type(InputType.Password)
          .onChange((value: string): void => {
            this.apiKey = value;
          })
        TextInput({ text: this.modelName, placeholder: '模型名称（deepseek-chat / gpt-4o-mini）' })
          .fontSize(14)
          .width('100%')
          .onChange((value: string): void => {
            this.modelName = value;
          })
        Row({ space: 10 }) {
          PillButton({ label: '保存配置', primary: true, grow: true, onTap: (): void => {
            this.saveConfig();
          } })
          PillButton({ label: this.testing ? '测试中…' : '测试连接', primary: false, grow: true,
            isEnabled: !this.testing, onTap: (): void => {
              this.testConnection();
            } })
          PillButton({ label: '清除配置', primary: false, grow: true, onTap: (): void => {
            this.confirmClearConfig();
          } })
        }
        .width('100%')
        if (this.statusText.length > 0) {
          Text(this.statusText)
            .fontSize(12)
            .fontColor(this.statusWarn ? MisakaColors.RED : MisakaColors.PRIMARY)
            .width('100%')
        }
      }
      .padding(16)
      .borderRadius(14)
      .backgroundColor(MisakaColors.CARD)
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 12 }) {
        Text('AI 辅助策略')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        SettingToggleRow({ title: '启用 AI 重构', subtitle: '题量异常、切题混乱时，根据原文重整待核对结果。',
          value: this.repo.settings.aiRefactorEnabled, onToggle: (): void => {
            this.repo.setAiFeatureEnabled('refactor', !this.repo.settings.aiRefactorEnabled);
            this.bump();
          } })
        SettingToggleRow({ title: '启用 AI 核对', subtitle: '检查题型、答案、选项和解析异常。',
          value: this.repo.settings.aiReviewEnabled, onToggle: (): void => {
            this.repo.setAiFeatureEnabled('review', !this.repo.settings.aiReviewEnabled);
            this.bump();
          } })
        SettingToggleRow({ title: '启用导入页 AI 解析', subtitle: '导入核对阶段，优先为缺少解析或解析过短的题目生成建议。',
          value: this.repo.settings.aiAnalysisEnabled, onToggle: (): void => {
            this.repo.setAiFeatureEnabled('analysis', !this.repo.settings.aiAnalysisEnabled);
            this.bump();
          } })
        SettingToggleRow({ title: '启用题目页 AI 分析', subtitle: '练习提交后显示单题 AI 分析入口，AI 只给参考答案和解析，不自动修改题库。',
          value: this.repo.settings.aiSingleQuestionAnalysisEnabled, onToggle: (): void => {
            this.repo.setAiFeatureEnabled('single', !this.repo.settings.aiSingleQuestionAnalysisEnabled);
            this.bump();
          } })
        SettingToggleRow({ title: '仅处理异常题', subtitle: '减少请求数量，优先处理导入异常和疑似错误。',
          value: this.repo.settings.aiOnlyAnomaly, onToggle: (): void => {
            this.repo.setAiFeatureEnabled('onlyAnomaly', !this.repo.settings.aiOnlyAnomaly);
            this.bump();
          } })
        SettingToggleRow({ title: '结果需人工确认', subtitle: 'AI 结果只作为建议，不直接写入题库。',
          value: this.repo.settings.aiRequireConfirm, onToggle: (): void => {
            this.repo.setAiFeatureEnabled('requireConfirm', !this.repo.settings.aiRequireConfirm);
            this.bump();
          } })
      }
      .padding(16)
      .borderRadius(14)
      .backgroundColor(MisakaColors.CARD)
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Column({ space: 12 }) {
        Text('成本与安全')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Row({ space: 10 }) {
          Column({ space: 4 }) {
            Text('单次题数')
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
            TextInput({ text: this.maxQuestionsText, placeholder: '20' })
              .fontSize(14)
              .type(InputType.Number)
              .onChange((value: string): void => {
                this.maxQuestionsText = digitsOnly(value, 3);
              })
          }
          .layoutWeight(1)
          Column({ space: 4 }) {
            Text('超时秒数')
              .fontSize(12)
              .fontColor(MisakaColors.TEXT_SUB)
            TextInput({ text: this.timeoutText, placeholder: '60' })
              .fontSize(14)
              .type(InputType.Number)
              .onChange((value: string): void => {
                this.timeoutText = digitsOnly(value, 3);
              })
          }
          .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
        Column({ space: 4 }) {
          Text('AI 重构原文上限')
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
          TextInput({ text: this.refactorMaxCharsText, placeholder: '30000' })
            .fontSize(14)
            .type(InputType.Number)
            .onChange((value: string): void => {
              this.refactorMaxCharsText = digitsOnly(value, 5);
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        Text('保存范围：单次题数 5–100，超时 15–180 秒，AI重构原文上限 5000–80000 字；超出范围会自动修正。')
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .width('100%')
        Row() {
          PillButton({ label: '保存处理限制', primary: false, grow: true, onTap: (): void => {
            this.saveLimits();
          } })
        }
        .width('100%')
        if (this.limitStatusText.length > 0) {
          Text(this.limitStatusText)
            .fontSize(12)
            .fontColor(MisakaColors.PRIMARY)
            .width('100%')
        }
      }
      .padding(16)
      .borderRadius(14)
      .backgroundColor(MisakaColors.CARD)
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      InfoNotice({
        text: 'AI 功能会消耗接口额度。AI 重构会优先清洗原文并重新本地解析，必要时才使用 AI 直接重构题目；原文不足上限时会全部发送。AI 核对只生成核对提示；AI 解析会写入待核对解析，最终仍需手动保存题库。',
        warning: false
      })
    }
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
        Text('AI 设置')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        Text('导入核对 / 题目分析 / 接口配置')
          .fontSize(12)
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
