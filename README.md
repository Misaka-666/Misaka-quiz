# Misaka Quiz

轻量、开源的刷题工具 — 把不规范的题库文件自动识别导入，变成可练习、可考试、可错题复盘的私人题库。

> Fork from [reiqr/shiroha-quiz](https://github.com/reiqr/shiroha-quiz)，增加了 AI 解析、AI 单题分析、问 AI 等功能。

---

## 快速开始

| 方式 | 入口 |
|------|------|
| **Web 版** | [misaka-666.github.io/Misaka-quiz/apps/web](https://misaka-666.github.io/Misaka-quiz/apps/web/) |
| **Android APK** | [GitHub Releases 下载](https://github.com/Misaka-666/Misaka-quiz/releases) |

首次使用内置了 C1 驾照科目一题库，无需导入即可体验。

---

## 两个版本

### Web 版
纯静态 HTML/CSS/JS，无框架、零构建、打开即用。支持题库导入、刷题考试、错题复习、分组练习、收藏夹、数据备份与跨端互通。适合桌面端整理题库和快速体验。

### Android 原生版
Kotlin + Jetpack Compose + Material3 实现。在 Web 版基础上增加了平板侧边导航、暗夜模式、多空填空、背题模式、斩题、选项打乱、智能复习、图片题、（问）AI 等功能，安装包体验更好。

---

## 核心能力

**智能导入** — 拖入 Word / Excel / TXT / JSON 文件或文件夹，自动识别题型、题干、选项、答案、解析。支持双文件分离导入（题目+答案）、PDF 文字层提取、DOCX 图片转换。

**练习模式** — 随机抽题或顺序练习，单选/多选/判断/填空/简答全覆盖。即时判题或批量提交，选项打乱防记答案，背题模式直接显示解析，斩题移除一眼就会的题。字号可调，支持滑动切题。

**考试模式** — 按题型自定义题量与分值，设置倒计时，到时自动交卷。答题卡跳题、未答提醒、交卷后成绩报告和明细。

**错题本** — 答错自动收录，记录错误次数。连续答对自动标记为已掌握。可按题库、题型、掌握状态筛选，支持错题重练。

**AI 增强** — 导入后 AI 核对题目识别结果；AI 批量补解析；练习中 AI 单题分析（参考答案对照、可信度评估）；练习中「问 AI」针对当前题目自由追问答疑。

**数据互通** — Web 和 Android 导出格式互认，支持 ZIP 备份含图片，跨端迁移无需手动处理。

---

## 本地运行

```bash
# Web 版
npx serve apps/web

# Android 原生版
cd apps/android
./gradlew assembleNativeDebug
```

---

## 测试

解析器回归测试覆盖 40 个场景，运行方式：

```bash
cd test/native-parser-regression
# 详见 README.md（Kotlin runner 内嵌运行，无需 Python）
```

---

## 项目结构

```
├── apps/
│   ├── web/                 # Web SPA (index.html + app.js + styles.css)
│   └── android/             # Android Gradle 工程
│       └── app/src/
│           ├── main/        # Manifest、主题、启动图标
│           ├── native/      # Native Compose 版（Kotlin 源码）
│           └── web/         # WebView 壳版
├── test/
│   └── native-parser-regression/  # 解析器回归测试
├── docs/                    # 使用文档、开发计划、架构说明
└── CHANGELOG.md             # 版本更新记录
```

---

## 许可证

[GPL-3.0](LICENSE)
