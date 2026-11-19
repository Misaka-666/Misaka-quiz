import { PracticeContinuation } from '../state/PracticeContinuation';
/*
 * Copyright (c) 2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { SettingsStore } from '../state/SettingsStore';
import { applyAppColorMode, applyAppWindowColors } from '../state/AppSettings';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    QuizRepository.getInstance().init(this.context);
    PracticeContinuation.init(this.context).setAvailable(false);
    this.handleContinuation(want, launchParam);
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  private restoring: boolean = false;

  private handleContinuation(want: Want, param: AbilityConstant.LaunchParam): void {
    if (param.launchReason !== AbilityConstant.LaunchReason.CONTINUATION) { return; }
    this.restoring = true;
    PracticeContinuation.init(this.context).stage(want);
    this.context.restoreWindowStage(new LocalStorage());
  }

  onNewWant(want: Want, param: AbilityConstant.LaunchParam): void {
    this.handleContinuation(want, param);
  }

  onContinue(params: Record<string, Object>): Promise<AbilityConstant.OnContinueResult> {
    return PracticeContinuation.init(this.context).send(params);
  }

  onWindowStageRestore(windowStage: window.WindowStage): void {
    this.onWindowStageCreate(windowStage);
  }

  onDestroy(): void {
    PracticeContinuation.get()?.cancel();
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');
    // preferences 是异步打开的：先就绪并回灌设置，再加载首页——
    // 保证首帧即为已存色模式（不闪浅色），开屏浮层决策也读到真实设置
    const loadMainPage = (): void => {
      windowStage.loadContent(this.restoring ? 'pages/ContinuationPage' : 'pages/Index', (err) => {
        if (err.code) {
          hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
          return;
        }
        void applyAppWindowColors(this.context, QuizRepository.getInstance().settings.darkThemeEnabled);
        if (this.restoring) { this.restoring = false; PracticeContinuation.get()?.receive(); }
        hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
      });
    };
    SettingsStore.init(this.context).then((): void => {
      QuizRepository.getInstance().loadSettings();
      applyAppColorMode(this.context, QuizRepository.getInstance().settings.darkThemeEnabled);
      loadMainPage();
    }).catch((): void => {
      loadMainPage();
    });
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    QuizRepository.getInstance().persist();
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
