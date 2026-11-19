# Project memory

## Notes

- 每次版本改动都要增加版本号，并将改动内容写在md文件里

---

# 项目协作规则（AI 协作入口）

> `plan.md`（当前任务计划）与 `memory.md`（跨会话项目事实）是本仓库约定的辅助文档，**不会被工具自动加载**，须按下方「上下文维护」在任务开始时主动读取。

## 项目概况

- **项目**：Misaka Quiz —— 轻量开源刷题工具（GPL-3.0，fork 自 reiqr/shiroha-quiz）：把不规范题库文件自动识别导入，变成可练习/考试/错题复盘的私人题库。
- **三端**：
  - `apps/web/`：纯静态 HTML/CSS/JS，零构建；
  - `apps/android/`：Kotlin + Jetpack Compose（`app/src/native/`），**行为基准 v1.3.4-native**；
  - `apps/harmony/`：ArkTS/ArkUI（API 26）移植工程，单 HAP，bundleName `com.reqir.misakaquiz`，**着重阔折叠（widefold）适配**。
- **基准纪律**：鸿蒙版一切行为语义以 Android native 版为唯一基准（Web 只作数据互通对象，不替代功能语义）；解析器行为以 `test/native-parser-regression` 用例为准。
- **关键文档**：`CHANGELOG.md`（版本记录）、`docs/harmony/移植进度.md`（鸿蒙 M0–M8 里程碑与进度）、`docs/harmony/实施方案/`（M4–M8 实施计划）、`README.md`。

## 模块路径补充

- 鸿蒙接续：`apps/harmony/entry/src/main/ets/state/ContinuationCodec.ts`（纯逻辑）、同目录 `ContinuationFiles.ets`（文件资产）和 `PracticeContinuation.ets`（系统生命周期）。接收页在 `pages/ContinuationPage.ets`。
- 接续验证：`test/harmony-parser-regression/continuation.mjs`。使用规则和真机验收见 `docs/harmony/练习接续.md`。模拟器不能验证系统接续。

## 已核实的命令

| 用途 | 命令（在仓库根，除非另注明） |
| --- | --- |
| 鸿蒙构建 | `cd apps/harmony && devecocli build`（产物 `entry/build/default/outputs/default/entry-default-unsigned.hap`，**未签名**，`build/` 下每次覆盖、不入库） |
| 鸿蒙装机运行 | `devecocli run --device 127.0.0.1:5555`（WideFoldM4 阔折叠模拟器为主力 UI 验证环境） |
| 鸿蒙 Node 自检（8 项） | `node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/<name>.mjs`，name ∈ `run-regression`（解析回归 39 用例）/ `ai-client` / `theme-tokens`（含版本一致性）/ `session-core` / `study-ops` / `backup-roundtrip` / `models-roundtrip` / `continuation` |
| Android 构建 | `cd apps/android && ./gradlew assembleNativeDebug` |
| Android 解析器回归 | 见 `test/native-parser-regression/README.md`（Kotlin runner 内嵌运行） |
| Web 本地预览 | `npx serve apps/web` |

未配置项（如实说明）：鸿蒙侧无接入命令流的 lint 任务（`code-linter.json5` 仅存配置）；无跑测试的 CI（`.github/workflows/` 仅 `pages.yml` 部署 Web 版）。

## 编码与架构约束（源自现有代码）

- **ArkTS 禁 `delete` 操作符**（arkts-no-delete）：删 Record 键用「重建新 Record、过滤目标键、整体赋值」（先例：`QuizRepository.ets` 的 `deleteBank`）。
- **.ts/.ets 分层**：可测纯逻辑放 `entry/src/main/ets/importer/**/*.ts` 或 `domain/Models.ts`（ArkTS 兼容 TS 子集，Node 24 原生 type-stripping 直跑，测试见 `test/harmony-parser-regression/*.mjs`）；平台壳（文件 IO/网络/UI）放 `.ets`。新逻辑优先落 .ts 以便自检。
- **UI 刷新模式**：`@Prop` 不随引用变化刷新——列表用 `tick` 奇偶重建（`if (this.tick % 2 === 0) { this.listBody() } else { this.listBody() }`）、表达式用「接 `tick >= 0` 引用」（先例：WrongBookPage / BankListPage / ExamPage `clockTick`）；宽窄屏切换用 `mediaquery.matchMediaSync('(min-width: 540vp)')` + `on('change')` + `aboutToDisappear` off（PracticePage / ExamPage 先例）。
- **持久化映射**：题库等大 JSON → `filesDir/misaka/state.json`（临时文件 + rename 原子写）；轻量设置 → `@ohos.data.preferences`；图片 → `filesDir/question_assets/`（与 Android 同名目录，保 ZIP 备份三端互通）。
- **Uint8Array 落盘安全**：`data.buffer` 可能是底层 buffer 的子视图——未对齐（byteOffset≠0 或长度不等）时用 `data.slice().buffer`（先例：`writeBytesToFile`）。
- **版本同步（每次版本改动，落实 Notes 条目）**：`apps/harmony/AppScope/app.json5`（versionCode/versionName）+ `pages/common/QuizWidgets.ets` 的 `APP_VERSION_LABEL` + `CHANGELOG.md` HarmonyOS 段 + `docs/harmony/移植进度.md`，四处一起改。

## 修改原则

- 最小必要改动；不顺手重构无关模块；不擅自新增依赖（`apps/harmony/oh-package.json5` 运行时依赖保持为空）。
- Bug 修复对齐 Android 基准：先读 Android 对应函数与全部调用者，再改鸿蒙侧共享实现。
- 有意简化标注 `ponytail:` 注释（规则见文末 Ponytail）。

## 安全边界

- 不读取、不输出 `.env`、密钥、令牌、签名凭据（`.gitignore` 已排除 `.env`、keystore 等）。
- 删除文件、破坏性 git 操作（`reset --hard` / `clean` / 强制检出 / 强推）、部署、发布、git commit/push：先获得用户明确授权。
- git 提交排除会话/工具文件：`.zcode/`、`.zcodeignore`、`.reasonix/`、`reasonix.toml` 不入库。

## 验证要求

- 修改后实际执行相关检查并如实报告，区分「通过 / 失败 / 未执行」；不得把未运行的测试写成通过。
- 鸿蒙代码改动至少：`devecocli build` + 受影响的 Node 自检；UI 改动在 WideFoldM4 模拟器实测；版本 bump 后重跑 `theme-tokens`（版本一致性）。
- 非平凡逻辑留一个可运行检查（Ponytail 要求；先例：`models-roundtrip.mjs` 分节断言）。

## 上下文维护

1. 开始任务时先读 `plan.md` 与 `memory.md`（仓库根）；不存在时向用户说明。
2. 多步骤任务先更新 `plan.md`，再实施。
3. 阶段结束（版本提交/里程碑完成）时更新：`plan.md`（实际进度+验证结果）、`memory.md`（长期决策与踩坑）、`CHANGELOG.md`、`docs/harmony/移植进度.md`。
4. 用户新要求优先于旧计划；发现冲突时明确指出并同步更新文档，不静默改写。

---

# Ponytail — lazy senior dev mode (installed)

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark intentional simplifications with a `ponytail:` comment. If the shortcut has a known ceiling (global lock, O(n²) scan, naive heuristic), the comment names the ceiling and the upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.
