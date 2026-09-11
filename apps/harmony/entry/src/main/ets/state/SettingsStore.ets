import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

/**
 * 轻量设置层 — 对应 Android SharedPreferences("misaka_quiz_native") 的设置键。
 * 仅存小键值（开关/模式字符串）；大数据一律走 FileStore（见 FileStore.ets 注释）。
 * key 常量随 M4/M5 功能接入逐步补充，命名与 Android 端 KEY_ 常量保持一致。
 */
export class SettingsStore {
  private static store: preferences.Preferences | null = null;

  static async init(context: common.UIAbilityContext): Promise<void> {
    if (SettingsStore.store !== null) {
      return;
    }
    SettingsStore.store = await preferences.getPreferences(context, 'misaka_settings');
  }

  static getString(key: string, def: string): string {
    const store = SettingsStore.store;
    if (store === null) {
      return def;
    }
    return store.getSync(key, def) as string;
  }

  static getBool(key: string, def: boolean): boolean {
    const store = SettingsStore.store;
    if (store === null) {
      return def;
    }
    return store.getSync(key, def) as boolean;
  }

  static getNumber(key: string, def: number): number {
    const store = SettingsStore.store;
    if (store === null) {
      return def;
    }
    return store.getSync(key, def) as number;
  }

  static async put(key: string, value: preferences.ValueType): Promise<void> {
    const store = SettingsStore.store;
    if (store === null) {
      return;
    }
    await store.put(key, value);
    await store.flush();
  }
}
