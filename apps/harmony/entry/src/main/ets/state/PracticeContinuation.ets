import { AbilityConstant, common, wantConstant, Want } from '@kit.AbilityKit';
import { distributedDataObject, commonType } from '@kit.ArkData';
import { router, promptAction } from '@kit.ArkUI';
import { ContinuationFiles } from './ContinuationFiles';
import { QuizRepository } from './QuizRepository';
import { CONTINUATION_VERSION } from './ContinuationCodec';

class TransferData {
  asset: commonType.Asset | undefined = undefined;
  receipt: string | undefined = undefined;
}

/** 仅处理练习接续。数据对象活到回执/超时；接收端字段必须初始为 undefined。 */
export class PracticeContinuation {
  private static singleton: PracticeContinuation | null = null;
  private context: common.UIAbilityContext;
  private files: ContinuationFiles;
  private object: distributedDataObject.DataObject | null = null;
  private token: string = '';
  private timer: number = -1;
  private generation: number = 0;
  private receiving: boolean = false;
  private handling: boolean = false;
  private pendingWant: Want | null = null;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    this.files = new ContinuationFiles(context);
    AppStorage.setOrCreate('continuationBusy', false);
    AppStorage.setOrCreate('continuationMessage', '正在接收练习');
    AppStorage.setOrCreate('continuationFailed', false);
  }

  static init(context: common.UIAbilityContext): PracticeContinuation {
    if (PracticeContinuation.singleton === null || PracticeContinuation.singleton.context !== context) {
      PracticeContinuation.singleton?.cancel();
      PracticeContinuation.singleton = new PracticeContinuation(context);
    }
    return PracticeContinuation.singleton;
  }

  static get(): PracticeContinuation | null { return PracticeContinuation.singleton; }

  setAvailable(available: boolean): void {
    try {
      this.context.setMissionContinueState(available ? AbilityConstant.ContinueState.ACTIVE : AbilityConstant.ContinueState.INACTIVE)
        .catch((): void => {});
    } catch (_err) { }
  }

  private setBusy(busy: boolean): void {
    QuizRepository.getInstance().continuationBusy = busy;
    AppStorage.setOrCreate('continuationBusy', busy);
  }

  private detach(): void {
    if (this.timer >= 0) { clearTimeout(this.timer); this.timer = -1; }
    const object = this.object;
    this.object = null;
    if (object !== null) {
      try {
        object.off('status');
        object.off('change');
        object.revokeSave().catch((): void => {}).finally((): void => { object.setSessionId('').catch((): void => {}); });
      } catch (_err) { }
    }
    this.handling = false;
  }

  cancel(): void {
    this.generation += 1;
    this.detach();
    this.setBusy(false);
    this.files.cleanup(this.token);
  }

  private fail(message: string): void {
    const receiving = this.receiving;
    this.generation += 1;
    this.detach();
    this.setBusy(false);
    if (!receiving) { this.files.cleanup(this.token); }
    if (receiving) {
      AppStorage.setOrCreate('continuationMessage', message);
      AppStorage.setOrCreate('continuationFailed', true);
    } else {
      promptAction.showToast({ message: message });
      this.setAvailable(true);
    }
  }

  async send(params: Record<string, Object>): Promise<AbilityConstant.OnContinueResult> {
    const repo = QuizRepository.getInstance();
    if (repo.continuationBusy || router.getState().path !== 'pages/PracticePage' && router.getState().name !== 'PracticePage') {
      return AbilityConstant.OnContinueResult.REJECT;
    }
    if (typeof params['version'] !== 'number' || (params['version'] as number) < 21) {
      promptAction.showToast({ message: '请先更新另一台设备上的应用' });
      return AbilityConstant.OnContinueResult.MISMATCH;
    }
    if (typeof params['targetDevice'] !== 'string') { return AbilityConstant.OnContinueResult.REJECT; }
    this.cancel();
    this.receiving = false;
    this.setBusy(true);
    this.setAvailable(false);
    const generation = this.generation;
    try {
      this.token = distributedDataObject.genSessionId();
      const token = this.token;
      this.timer = setTimeout((): void => this.fail('接续超时，练习仍保留在本机'), 60000);
      const payload = repo.continuationPayload();
      const id = payload.snapshot['sessionId'] as string;
      const revision = payload.snapshot['revision'] as string;
      const data = new TransferData();
      data.asset = await this.files.exportAsset(payload, token);
      if (generation !== this.generation) { await this.files.cleanup(token); return AbilityConstant.OnContinueResult.REJECT; }
      data.receipt = '';
      const object = distributedDataObject.create(this.context, data);
      this.object = object;
      object.on('change', (_session: string, fields: string[]): void => {
        if (generation !== this.generation || !fields.includes('receipt')) { return; }
        const values = object;
        if (values['receipt'] !== token) { return; }
        if (!repo.markPracticeTransferred(id, revision)) { this.fail('接收端已保存，本机状态保存失败，请勿重复作答'); return; }
        values['receipt'] = `confirmed_${token}`;
        this.setBusy(false);
        this.setAvailable(false);
        router.replaceUrl({ url: 'pages/Index' }).catch((): void => {});
        if (this.timer >= 0) { clearTimeout(this.timer); }
        this.timer = setTimeout((): void => { this.cancel(); }, 2000);
      });
      await object.setSessionId(token);
      await object.save(params['targetDevice'] as string);
      if (generation !== this.generation) { await object.revokeSave(); return AbilityConstant.OnContinueResult.REJECT; }
      params['misakaProtocol'] = CONTINUATION_VERSION;
      params['misakaSession'] = token;
      params[wantConstant.Params.SUPPORT_CONTINUE_PAGE_STACK_KEY] = false;
      // 收到接收端落盘回执后才退出练习，系统搬完文件不代表业务保存成功。
      params[wantConstant.Params.SUPPORT_CONTINUE_SOURCE_EXIT_KEY] = false;
      return AbilityConstant.OnContinueResult.AGREE;
    } catch (_err) {
      if (generation === this.generation) { this.fail('接续失败，请检查连接、题图和剩余空间后重试'); }
      return AbilityConstant.OnContinueResult.REJECT;
    }
  }

  stage(want: Want): void {
    this.cancel();
    this.pendingWant = want;
    this.receiving = true;
    this.setBusy(true);
    this.setAvailable(false);
    QuizRepository.getInstance().beforeContinuation();
    AppStorage.setOrCreate('continuationMessage', '正在接收练习');
    AppStorage.setOrCreate('continuationFailed', false);
  }

  async receive(): Promise<void> {
    const want = this.pendingWant;
    if (want === null || this.object !== null) { return; }
    const params = want.parameters;
    if (params?.['misakaProtocol'] !== CONTINUATION_VERSION || typeof params?.['misakaSession'] !== 'string' ||
      !/^[a-zA-Z0-9_]{1,128}$/.test(params['misakaSession'] as string)) {
      this.fail('接续版本不兼容，请更新两台设备的应用'); return;
    }
    this.setBusy(true);
    this.receiving = true;
    AppStorage.setOrCreate('continuationFailed', false);
    AppStorage.setOrCreate('continuationMessage', '正在接收练习');
    this.token = params['misakaSession'] as string;
    const token = this.token;
    const generation = this.generation;
    try {
      const object = distributedDataObject.create(this.context, new TransferData());
      this.object = object;
      this.timer = setTimeout((): void => this.fail('接收超时，原有练习已保留。可重试或从源设备重新接续。'), 60000);
      object.on('change', (): void => {
        if (object['receipt'] === `confirmed_${token}` && generation === this.generation) {
          this.cancel();
        }
      });
      object.on('status', (_session: string, _network: string, status: string): void => {
        if (status === 'restored' && !this.handling && generation === this.generation) {
          this.handling = true;
          this.finishReceive(object, token, generation);
        }
      });
      await object.setSessionId(token);
    }
    catch (_err) { if (generation === this.generation) { this.fail('无法连接源设备，请重新接续'); } }
  }

  private async finishReceive(object: distributedDataObject.DataObject, token: string, generation: number): Promise<void> {
    try {
      const asset = object['asset'] as commonType.Asset;
      if (asset === undefined || asset === null || asset.name !== `misaka_${token}.mqp`) { throw new Error('缺少接续文件'); }
      const received = await this.files.importAsset(asset);
      if (generation !== this.generation) { return; }
      await QuizRepository.getInstance().acceptContinuation(received, this.files, (): boolean => generation === this.generation);
      if (generation !== this.generation) { return; }
      object['receipt'] = token;
      if (this.timer >= 0) { clearTimeout(this.timer); }
      this.timer = setTimeout((): void => this.cancel(), 15000);
      this.setBusy(false);
      try {
        await router.replaceUrl({ url: 'pages/Index' });
        router.clear();
        await router.pushUrl({ url: 'pages/PracticePage' });
      } catch (_routeErr) {
        AppStorage.setOrCreate('continuationMessage', '练习已保存，请返回后继续练习');
        AppStorage.setOrCreate('continuationFailed', true);
      }
    } catch (_err) {
      if (generation === this.generation) { this.fail('接收未完成，原有练习已保留。请检查版本、题图和剩余空间后重试。'); }
    }
  }
}
