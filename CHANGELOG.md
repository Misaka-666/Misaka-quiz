# Changelog

## Web 版

| 版本             | 日期         | 变更                                                                             |
| -------------- | ---------- | ------------------------------------------------------------------------------ |
| `v0.7.5-alpha` | 2026-06-20 | 简答题独立答案头多行识别，避免多行答案被误判为新题 |
| `v0.7.4-alpha` | 2026-06-20 | 练习新增起点选择（从头开始/继续上次/自选题号）与顺序练习进度记忆，删除标准题库格式示例文档 |
| `v0.7.3-alpha` | 2026-06-16 | 随原生 v0.8.4 发布，无独立 Web 变更 |
| `v0.7.2-alpha` | 2026-06-16 | 多空填空题识别、逐空输入与判分；判分归一化对齐（NFKC+全角标点+边界修剪）；跨端 blankAnswers/userBlankAnswers 记录同步修复；招聘类真题解析回归修复（选项二次拆分防护）；多空编辑器 hidden 样式补全 |
| `v0.7.1-alpha` | 2026-06-15 | V35 版本标签同步（分组练习与学习体验优化版） |
| `v0.7.0-alpha` | 2026-06-15 | 分组练习范围（跨题库出题、练习统计按分组聚合）；sessionKey 重构解决跨题库重复题冲突；分组徽标与练习范围 UI；TDZ 初始化顺序修复 |
| `v0.6.0-alpha` | 2026-06-14 | 解析架构升级：原文区间局部修复（漏题补回/粘题拆分）；过度拆题局部合并；答案解析区分区感知匹配（卷/章/分组）；局部修复守卫与审计增强（序列对齐/富内容保留）；英文题干勘误（A/a开头句子不误判）；首页版本标签动态同步 |
| `v0.5.3-alpha` | 2026-06-13 | 导入预览工具栏响应式排版优化；导出流程分离（题库导出与完整备份独立）；英文文本解析优化（小写字母不再误判为选项） |
| `v0.5.2-alpha` | 2026-06-09 | 收藏夹升级为独立导航页面（原错题本附属区），含单题练习入口和快捷操作；练习页热键从字母 A-G 改为数字 1-7；刷题统计收起按钮透明化与 UI 风格统一  |
| `v0.5.1-alpha` | 2026-06-06 | 练习页与错题重练新增"自定义"题量选项，可任意输入题数；题量控件改为下拉+输入框联动布局；错题本答错时立即重置正确次数并置为"未掌握"，避免后续误判为已掌握 |
| `v0.5.0-alpha` | 2026-06-03 | 题库卡片样式修复；简答/填空误判修复；DOCX 富文本空行误拆修复；题型检测逻辑增强                                     |
| `v0.4.7-alpha` | 2026-06-01 | 导入追加模式、ID 生成改进，版本同步                                                            |
| `v0.4.7-alpha` | 2026-06-01 | 导入追加模式、ID 生成改进，版本同步                                                            |
| `v0.4.6-alpha` | 2026-05-20 | WebView 壳版独立版本号同步；保留 Web 基础刷题流程与离线资源打包能力                                       |
| `v0.4.5-alpha` | 2026-05-16 | JSON 导入导出标准化；ZIP 备份导入及图片自动转换；文件上传支持 xlsx/xls/xlsm；导入预览新增移动端列表；题目图片响应式样式        |
| `v0.4.4-alpha` | 2026-05-12 | Web 壳样式增强，首页 UI 趋于稳定                                                           |
| `v0.4.3-alpha` | 2026-05-12 | 答题体验优化，题库可二次编辑                                                                 |
| `v0.4.2-alpha` | 2026-05-11 | 增强导入题目解析，UI 布局优化，考试模式完善答题卡                                                     |
| `v0.3.8-alpha` | 2026-05-10 | 修复导航栏显示 bug                                                                    |
| `v0.3.7-alpha` | 2026-05-10 | Web 壳子独立构建，独立版本号管理；自适应图标 Safe Zone；图片素材全面换成 WebP                               |
| `v0.3.6-alpha` | 2026-05-10 | 引入 productFlavors 架构；原生 Compose 初始接入；首页与导入链路并行推进                               |
| `v0.3.5-alpha` | 2026-05-09 | 接入原生导入链与考试页；清理冗余素材；优化 Web UI                                                   |
| `v0.3.4-alpha` | 2026-05-09 | 修复 AndroidManifest 合并冲突；轻量开屏动画                                                 |
| `v0.2.0-alpha` | 2026-05-09 | 安卓端切换为 WebView 壳方案；Web 端完整练习、考试、错题、刷题记录、双文件导入、PDF/docx                         |
| `v0.1.1-alpha` | 2026-05-08 | 批量导出与备份 JSON 导入流程优化；README 与目录结构整理                                             |
| `v0.1.0-alpha` | 2026-05-08 | 首次公开仓库整理                                                                       |

## 原生 Compose 版

| 版本              | 日期         | 变更                                                                                               |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `v1.3.4-native` | 2026-06-28 | 收藏夹/错题本分组选择器新增二级分组（具体题库）+ replace `!!!!` 无 NPE 风险 + 错题本 range 切换兼容性处理 |
| `v1.3.3-native` | 2026-06-28 | 错题本界面直接加分组切换按钮（Tune），无需去设置页切换范围 |
| `v1.3.2-native` | 2026-06-28 | 收藏夹新增按一级分组筛选功能，可只查看某个分组下的收藏题 |
| `v1.3.1-native` | 2026-06-28 | 修复批量多题库同步流式更新竞态：Map 改为 SnapshotStateMap，单 key 写入原子化 |
| `v1.3.0-native` | 2026-06-28 | 多选题库 AI 分析改为分别分析，每个题库独立流式面板（各自思维链+结果摘要+重新分析） |
| `v1.2.7-native` | 2026-06-28 | 修复批量 AI 分析对话框不渲染的阻断性 bug + 防重复点击 + 流式状态清洗 |
| `v1.2.5-native` | 2026-06-28 | 修复分屏/小窗模式 AI 分析中断（configChanges 加 smallestScreenSize） |
| `v1.2.4-native` | 2026-06-28 | 修复 AI 分析时旋转屏幕或切后台导致分析中断：添加 configChanges 阻止旋转重建 Activity，流式 readTimeout 改为 0 防止后台超时 |
| `v1.2.3-native` | 2026-06-28 | 多选 AI 分析题库：批量选择多个题库后一键 AI 分析，结果带缓存 |
| `v1.2.2-native` | 2026-06-27 | 错题本新增「按分组」筛选：可选择一个题库分组，仅查看该分组下的错题 |
| `v1.2.1-native` | 2026-06-27 | 修复 SSE 流式思维链显示 "null" 的问题（org.json optString 对 JSON null 返回字面字符串） |
| `v1.2.0-native` | 2026-06-26 | AI 流式输出 + 分析结果持久化缓存 + 知识点关联图谱 + 题库分析等多个 AI 功能整合 |
| `v1.1.4-native` | 2026-06-26 | AI 流式输出：AI 分析题库、AI 补解析、问 AI 均改为 SSE 流式请求，等待时实时展示思维链（reasoning_content）和正文生成过程 |
| `v1.1.3-native` | 2026-06-26 | AI 分析题库新增「知识点关联图谱」：同一实体（药物/疾病/法律条款等）在不同题目中的知识点分布索引 |
| `v1.1.2-native` | 2026-06-26 | 题库管理「更多」菜单新增「AI 分析题库」：将整份题库交给 AI 分析题目间的知识点聚类、易混淆题对、知识递进链，并给出记忆技巧与复习策略建议 |
| `v1.1.1-native` | 2026-06-26 | 练习模式新增「问 AI」：AI 单题分析下方可展开追问输入框，针对当前题目自由提问获取 AI 答疑 |
| `v1.1.0-native` | 2026-06-26 | Web 资源移至 web flavor（native APK 不再包含 3.2MB Web 资源）；project 清理（删除遗留 shiroha 批处理、未使用 peeking.png、源设计素材 27MB） |
| `v1.0.0-native` | 2026-06-26 | 版本号升级至 1.0.0 |
| `v0.9.0-native` | 2026-06-21 | 背题模式开关、题目合并功能、全面改名 Misaka Quiz |
| `v0.8.9-native` | 2026-06-20 | 多空题解析增强；修复 docx 导入 OOM/ANR |
| `v0.8.8-native` | 2026-06-19 | 多空题解析增强（内联多空结构、分区多空继承、守卫误判）；修复 docx 导入 OOM/ANR 闪退；回归测试内嵌对比去 Python 依赖 |
| `v0.8.7-native` | 2026-06-18 | 新增 CodeLikeTextGuard 守卫，防止代码表达式被误判为选项或题目 |
| `v0.8.6-native` | 2026-06-18 | 固定考试状态标签为单行布局，避免换行 |
| `v0.8.5-native` | 2026-06-16 | 学习记录支持单条删除 |
| `v0.8.4-native` | 2026-06-16 | 平板侧边导航（宽屏底部导航切换为左侧）；题目ID完整性迁移（缺失/重复ID自动修复UUID）；练习退出时未答题目自动判空（避免跳题卡进度）；题库管理标签对齐练习范围 |
| `v0.8.3-native` | 2026-06-16 | 多空填空题全链路（解析/练习/考试/搜索/编辑）；判分归一化（NFKC+全角标点+边界修剪）；图片选项标签行识别；招聘答案清理；DOCX紧凑选项修复；score/aiConfidence防NaN；题库审阅插入新题；导入/练习系统返回键 |
| `v0.8.2-native` | 2026-06-15 | 考试结果页可直接查看成绩详情；路由回退按页面类型条件恢复；编辑/移动分组对话框分离；无插图卡片文字居中优化 |
| `v0.8.1-native` | 2026-06-15 | 分组练习范围（跨题库出题、sessionKey重构）；路由系统升级（子页面回退到上级）；跨端互通增强（备份格式升级v3） |
| `v0.8.0-native` | 2026-06-14 | 解析稳定性收口：紧凑答案(A,B)/(A B)归一化提取；前言/注意事项过滤防止伪题；主观题防误判增强；英文缩写防误判回归保护；回归测试21/21全部通过 |
| `v0.7.6-native` | 2026-06-14 | 导入解析器重构，选项检测逻辑集中管理；修复英文单词内字母误判为选项标记；回归测试补充依赖目录 |
| `v0.7.5-native` | 2026-06-13 | 选项打乱改为固定A/B/C/D标签仅随机内容映射；考试模式新增独立的选项打乱开关；AI单题分析使用映射后题面 |
| `v0.7.4-native` | 2026-06-13 | JSON导入全面兼容多题库数组/题目数组/单题库对象/Web备份包等格式；选项解析支持key-value对象格式；答案解析兼容多字段别名；Web备份导入仅取题库不恢复状态 |
| `v0.7.3-native` | 2026-06-12 | 练习偏好新增选项顺序打乱开关；题库编辑/审阅/导入预览/快速编辑四个入口集成AI补解析；修复图片标记被选项拆分误入及英文单词内字母误判为选项                           |
| `v0.7.2-native` | 2026-06-09 | 错题本支持按当前题库/全部题库切换作用域；记录页和记录详情新增只看错题筛选；练习页新增AI单题分析（提交后或背题模式下可触发，独立判断参考答案并与题库对照）；Question云端字段完整序列化 |
| `v0.7.1-native` | 2026-06-03 | 题库管理返回按钮左对齐                                                                                      |
| `v0.7.0-native` | 2026-06-03 | 新增题目搜索功能；退出按钮改为圆形图标；导入和考试文案优化；错题本排序标签改为掌握程度                                                      |
| `v0.6.9-native` | 2026-05-31 | 填空题可作答并自动判分（多答案分隔、标点归一化），简答题支持输入作答仅展示参考答案，正确率仅计入自动判分题目                                           |
| `v0.6.8-native` | 2026-05-31 | AI 提示词收紧（不解题不推断答案，残留答案标记检测）；修复 DOCX 图片标记绑定；收口导入解析边界；标准格式说明同步                                     |
| `v0.6.7-native` | 2026-05-30 | 导入预览应用数学公式格式化（题干、选项、解析均渲染 LaTeX 符号）；cases 环境显示优化（"值（条件）"格式，分号分隔）                                 |
| `v0.6.6-native` | 2026-05-29 | 新增题库一二级分组管理，导入新题库可选新建或并入现有题库，同分组内批量导入自动去重                                                        |
| `v0.6.5-native` | 2026-05-29 | 强化 LaTeX 和 OMML 数学公式识别                                                                           |
| `v0.6.4-native` | 2026-05-28 | 修复英文缩写开头选项被误判为行内枚举的问题                                                                            |
| `v0.6.3-native` | 2026-05-28 | 新增共用题干/材料题兜底解析器，收紧解析边界                                                                           |
| `v0.6.2-native` | 2026-05-28 | 退出顺序练习时可选择保存当前位置，下次继续练习可从保存进度恢复                                                                  |
| `v0.6.1-native` | 2026-05-27 | 修复显示异常设备上题目文本被截断问题，允许自动换行显示                                                                      |
| `v0.6.0-native` | 2026-05-27 | 修复题干中包含“格式”时被误识别为分区来源的问题                                                                         |
| `v0.5.9-native` | 2026-05-26 | 首页紧凑布局触发高度下调至 760dp，改善小屏和异常显示设备兼容性                                                               |
| `v0.5.8-native` | 2026-05-25 | 优化更新功能后的练习页布局；同步当前原生版发布版本                                                                        |
| `v0.5.7-native` | 2026-05-26 | 新增顺序练习进度记忆，继续练习时可恢复上次进度                                                                          |
| `v0.5.6-native` | 2026-05-26 | 首页针对显示异常设备增加紧凑布局兜底                                                                               |
| `v0.5.5-native` | 2026-05-22 | 新增批量选后自动下一题；偏好页文案精简优化                                                                            |
| `v0.5.4-native` | 2026-05-22 | 紧凑选项模式重构为扁平 Row 布局；阅读显示从数据管理移至外观偏好；答对后自动下一题仅答对跳转                                                 |
| `v0.5.3-native` | 2026-05-21 | 刷题页面新增字号缩放功能                                                                                     |
| `v0.5.2-native` | 2026-05-21 | 新增题目收藏功能；练习中可一键收藏并集中查看                                                                           |
| `v0.5.1-native` | 2026-05-21 | 新增题目快速编辑；练习时可从题目右上角直接修改                                                                          |
| `v0.5.0-native` | 2026-05-20 | 危险操作增加二次确认弹窗；新增智能复习模式与错题本偏好页；关于页新增 GitHub 入口；开启 Gradle 构建缓存                                      |
| `v0.4.9-native` | 2026-05-20 | 危险操作增加二次确认；新增智能复习模式；优化错题本布局；开启 Gradle 构建缓存                                                       |
| `v0.4.8-native` | 2026-05-19 | 原生刷题与复盘体验完善：长选项完整显示；错题本连续答对两次掌握；即时练习、自动下一题和复盘规则进一步收口                                             |
| `v0.4.7-native` | 2026-05-19 | 背题/斩题体验优化，区分自动提交和自动切题                                                                            |
| `v0.4.6-native` | 2026-05-19 | 强化图片题库兼容：题型命名变体全面适配，两端导出格式标准化                                                                    |
| `v0.4.5-native` | 2026-05-19 | 新增背题模式和斩题功能；BankDetail 界面重做                                                                      |
| `v0.4.4-native` | 2026-05-18 | 修复二级页面左滑退回桌面问题                                                                                   |
| `v0.4.3-native` | 2026-05-17 | [31.5] 双图标统一至 native 源集；插画文件重命名消除歧义；WebP 素材压缩至 q70                                               |
| `v0.4.2-native` | 2026-05-17 | [31.5] 新增 ShirohaClick 组件；UI 组件与页面交互优化；素材 PNG→WebP                                               |
| `v0.4.1-native` | 2026-05-17 | [31.4] 批量编辑页面返回视觉中心点优化                                                                           |
| `v0.4.0-native` | 2026-05-16 | [31.2] 导入编辑器新增查找/替换（支持正则）；优化填空题识别规则，扩展关键词覆盖；核对页筛选器按需显示，空分类自动隐藏                                   |
| `v0.3.9-native` | 2026-05-16 | [31.3] 含图片题的题库互通：原生端解析内嵌 base64 图片，Web 端导入 ZIP 备份自动转换                                            |
| `v0.3.8-native` | 2026-05-16 | [31.1] 新增 Shiroha 模式（插画开关、图标切换）；偏好页拆分为外观与刷题                                                      |
| `v0.3.7-native` | 2026-05-16 | [30.8] 新增表格格式导入；强化数学化学符号识别；移除错误 AI 建议                                                            |
| `v0.3.6-native` | 2026-05-15 | [30.8] UI 布局微调                                                                                   |
| `v0.3.5-native` | 2026-05-15 | [30.5/30.7] 答题后选项着色；练习/考试上方卡片可收起；可切换批量做题与即时反馈                                                    |
| `v0.3.4-native` | 2026-05-15 | [30.6/30.7] 考试设置支持自动记住；滑动切题                                                                      |
| `v0.3.3-native` | 2026-05-15 | [30.8] 解析器增强，覆盖更多题型格式                                                                            |
| `v0.3.2-native` | 2026-05-15 | [31.0] 进一步完善 AI 核对与解析能力                                                                          |
| `v0.3.0-native` | 2026-05-15 | [30.2/30.3/30.4] 暗夜模式、新增开屏图、主题 Token 系统整理                                                        |
| `v0.2.9-native` | 2026-05-14 | [30.1] 视觉风格统一，新增视觉规范文档                                                                           |
| `v0.2.8-native` | 2026-05-14 | [30.1] 页面与状态管理调整，后续功能分级规划                                                                        |
| `v0.2.7-native` | 2026-05-12 | [29.0~30] 卡片入场动画统一，首页去滚动化，考试页面卡片等高，步骤胶囊收紧                                                        |
| `v0.2.6-native` | 2026-05-12 | [29.0~30] 导航扁平化收口 MainTab；组件令牌统一；ListAlt 图标修复                                                    |
| `v0.2.5-native` | 2026-05-12 | [29.0~30] 页面插画 PNG 转 WebP；新增 3 个页面；导入后台协程处理；练习设置紧凑化；考试新增答题卡；学习记录逐题复盘；启用 R8 与签名                   |
| `v0.2.4-native` | 2026-05-12 | [29.0~30] 首页紧凑化；题库列表视觉重构；导入协程化；答题体验优化                                                            |
| `v0.2.3-native` | 2026-05-12 | [29.0~30] 题库重命名；二次核对；核对页面排版优化                                                                    |
| `v0.2.2-native` | 2026-05-11 | [29.0~30] 导入导出、刷题体验、卡片布局优化                                                                       |
| `v0.2.0-native` | 2026-05-10 | [29.0~30] 原生 Compose 初始版本，UI 设计与功能实现                                                             |

## HarmonyOS 版

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| `v0.9.1-harmony` | 2026-10-03 | 修复：练习设置页与答题页阔折叠 UI 缺陷（用户反馈 p1/p3）——①顺序刷题「开始练习」不可达的复合根因：(a) 按钮在滚动区最底部，顺序模式比随机多 ~250vp 设置行，展开态矮屏溢出——对齐 Android PracticeScreen 首卡结构在顶部新增 header 卡（题库名+可用题数左、开始练习按钮右，不滚动永远可见），底部大按钮保留；(b) **PillButton(grow:true) 直挂 Column 时内部 layoutWeight(1) 作用于纵向主轴**（M4 已记录的坑在设置页复发）：按钮宽度塌成 ~440px、高度虚增 62px，且 Scroll 内容高度测量被污染 ~134px → max scroll 永远差一个按钮高度、底部按钮滚到底也只露 1-4px（uitest/fling/drag 三种注入手势一致复现，meTab 对照正常定位）；包 Row 修复。同坑全仓扫荡共 7 处：practiceTab 开始练习、ExamSetupPage 开始考试、PracticePage AI 分析本题/问 AI、AboutPage 打开 GitHub、AiSettingsPage 保存处理限制、ImportPage 编辑器 AI 补解析；②答题页折叠切换布局陈旧（isWide 仅 aboutToAppear 用 display 宽度算一次无监听：展开态进入练习再合上折叠仍按宽屏双栏渲染，答题卡固定 300vp 挤占窄屏、题干一行五六字、上一题/下一题截断「上…」「下…」）——改 mediaquery matchMediaSync(min-width:540vp)+on(change) 实时切换（对齐 Index wideListener 模式）；③题干上方孤立题号裸文本（「79」）移除（Android 答题主视图不显示 question.number）；附带：Index 三 tab Scroll 由 height(100%) 统一为 importTab 已验证的 layoutWeight(1)；WideFoldM4 实测：顺序模式 header 按钮不滚动可见、底部按钮滚到底全宽全高可见（布局树 [287,1587,2540,1708] + 像素扫描双证）、练习中折叠↔展开实时单双栏切换（折叠态题干全宽、按钮完整、答题卡入口回到 header）、无孤立题号 |
| `v0.9.0-harmony` | 2026-10-05 | M8：AI 全家桶——纯逻辑层 ai/*.ts（Node 可测）：AiPrompts.ts 六条系统提示词逐字移植、AiSse.ts SSE 流式累积器（行缓冲跨块边界/「data:」行提取/[DONE] 停止/delta reasoning_content+content 解析/onContent 传累计全文/坏行静默跳过）、AiCodec.ts（配置校验与 https-only 端点规整、HTTP 错误格式化含 401/403/404/429/5xx 中文提示与 API error.message 提取、非流式 choices 解析、六类 userPayload 构建含题库分析 200 题截断+题型统计、五类结果解析：核对建议 canApply/needHumanReview 默认规则与 hard_error 强制、补解析、单题分析三态 matchesLocalAnswer/LOW 默认复核、AI 重构 clean_text/direct_questions 双模式含中文题型映射与多空 compatibilityAnswer、题库分析链长≥2/实体出现≥2 过滤）、AiSuggestions.ts（isActionable/canApply/merge、缺解析判定 <20 字/无/暂无、建议采纳应用含判断题正确→A 与多选去重排序、练习页选项乱序映射 aiDisplayQuestionWithAnswer 让 AI 看到用户所见字母）；平台层 MisakaAiClient.ets（@ohos.net.http：非流式 request expectDataType STRING + 流式 requestInStream + on('dataReceive') TextDecoder stream 模式跨块解码喂 AiSse；流式错误体保留前 8KB 供 HTTP 错误格式化；超时 15-180s 钳制；BusinessError 2300028 超时/2300006-7 域名中文映射）；题库分析缓存 AiBankAnalysisCache.ets（filesDir/misaka/ai_cache.json 整表原子写替代 Android SharedPreferences，内存 Map 一级缓存）；AppSettings +13 个 ai_* 键（与 Android KEY_* 一致，默认值与钳制范围对齐）+ QuizRepository setAiInterfaceConfig/setAiFeatureEnabled/setAiProcessingLimits/clearAiConfig/isAiConfigured；AiSettingsPage（服务商预设 DeepSeek/OpenAI 兼容/自定义含推荐地址模型回填与预设覆盖判定、API 地址/Key 密码框/模型三输入、保存/测试连接/清除配置二次确认、AI 辅助策略六开关、成本与安全三限额输入与保存、消耗额度提示）；ImportPage 接入 AI 核对（仅异常题/全部范围 × 单次题数分批、进度文案、建议合并与逐题建议卡：原因/建议/可采纳摘要/采纳按钮/硬错误警示、AI已核对·未发现重点问题·AI已补解析·缺/短解析标签行）、AI 补解析（异常题优先回退全部、写入待核对解析）、AI 重构（原文上限校验、clean_text 重新本地解析/direct_questions 直接替换、notes 附注）、题目编辑器补解析字段 + AI 补解析/优化解析流式生成采纳块；PracticePage AI 面板（单题 AI 分析：选项乱序映射 + 参考答案/与题库答案一致性/可信度 chip/需复核警示卡；问 AI：展开输入 + 流式回答预览与 AI 回答卡；换题自动重置）；BankListPage AI 题库分析（多库勾选 sheet + 顺序流式面板：思维链尾迹预览、错误面板不中断后续库、重新分析单库、结果六段渲染：概述/知识点聚类/易混淆题对/知识递进链/记忆技巧/复习策略/知识点关联图谱，>200 题截断提示）；附带修复 M4 遗留 bug：Index 导入 tab 的 ImportPage 被 layoutWeight 挤在矮区致「选择文件/粘贴文本」不可见不可滚（改外层 Scroll + 固定面板高度）+ 内置 C1 大按钮全宽 grow 误触温床（收窄 360）；ai-client.mjs 自检（SSE 边界/DONE/累计语义/坏行、端点规整与 https 拒绝、六类载荷、非流式解析、五类结果解析默认规则、建议应用与乱序映射）；WideFoldM4 实测：真实 DeepSeek 端点五通道 401 全通（连通测试/导入 AI 核对/练习单题分析/题库分析流式/问 AI 流式，含 request_id 的鉴权失败消息证明 TLS+POST+Bearer+错误格式化整链）、配置与开关跨强杀重启持久化、题库分析 sheet 勾选/空态/错误面板/关闭、练习页 AI 面板与问 AI 展开收起、导入工具条三按钮与编辑器解析框渲染；未验项（无可用 API Key）：真实 200 成功路径与题库分析缓存 save→load 设备端往返，由 Node 全逻辑回归 + 401 链路 + FileStore 同机制覆盖；39 用例回归 + ai-client + theme-tokens + backup-roundtrip + study-ops + session-core + models 全绿 |
| `v0.8.0-harmony` | 2026-10-02 | M7：体验完整度——暗色模式（20 个 MisakaColors Token 改 base/dark 双份 color.json 同名资源 + static getter 返回 $r 引用，切换走 ApplicationContext.setColorMode(LIGHT/DARK) 官方手动深浅色通道，整树重绘自动换色；dark_theme_enabled 偏好键与 Android 一致；EntryAbility 改为 SettingsStore 就绪→回灌设置→应用色模式→loadContent，冷启动首帧即暗色不闪浅）；全页面内联十六进制色与 Color.White 语境扫荡 token 化（含 ImportPage 状态色系归并 RED/WARN/GREEN/PRIMARY/ACCENT_PURPLE、禁用态、答题卡、对话框卡片底）；阔折叠展开态侧边导航（mediaquery matchMediaSync ≥600vp 断点 + tablet_side_navigation_enabled 开关【鸿蒙端默认开，Android 默认关的主动偏差：本端以阔折叠为主力环境】；Rail 88vp 四根 Tab emoji+文字、选中 PRIMARY_SOFT 胶囊，折叠自动回落底部栏实测无缝）；外观偏好页（主题浅/暗 chips、Misaka 模式【开屏图+页面插画；鸿蒙不支持动态换图标未移植该子项】、保留开屏启动图片条件行、平板侧边导航开关、阅读显示：题干/选项字号小标准大 + 紧凑选项模式）；关于页（项目地址 github.com/reiqr/misaka-quiz + openLink 打开按钮含失败回退、项目说明、开源与数据、版本标签行）；我的 Tab 重构对齐 Android MeScreen（Me/设置与资料 header + 🌙/☀️ 快速主题切换、「我是Misaka」hero 卡含 illus_me 插画、功能与档案 strips：外观偏好/数据管理/关于）；Misaka 模式开屏浮层（复用 Android splash_screen_study.webp + Misaka/Quiz 品牌字 + 口号 + 粉色进度条动画，1450ms 保持 + 420ms 淡出对齐 MisakaMotion，仅冷启动一次）；应用图标换 Misaka 吉祥物（ic_launcher_misaka 1024 webp→PNG，AppScope+entry 双份，startWindowIcon 同步，模板分层图标三件套移除）；版本标签常量收敛 APP_VERSION_LABEL（Index/关于页共用，theme-tokens.mjs 校验与 app.json5 一致）；新增 theme-tokens.mjs 自检（base/dark token 名集合奇偶、QuizWidgets 引用资源齐备、pages/state 内联色残留守卫、版本一致性）；模拟器实测（展开态 rail 四项 + 切暗色全局生效 + 强杀重启首帧即暗 + 外观页条件行/字号 chips + Misaka 模式开屏 1.9s 消失 + 折叠 rail→底部栏回落 + 关于页全卡片 + 切回浅色无残留）；39 用例回归 + backup-roundtrip + study-ops + session-core + models + theme-tokens 全绿 |
| `v0.7.0-harmony` | 2026-10-02 | M6：备份互通——BackupCodec.ts（纯逻辑双端，Node 可测）1:1 移植 Android 备份段：buildBackupJson（kind=misaka_quiz_full_backup/selected_banks、version/schemaVersion 3、exportedBy=harmony、图片注册回调改写 localPath 为 assets/ 相对路径）、isWebBackupJson（misaka_quiz_web*/shiroha_quiz_web*/crossPlatform/schemaVersion 等 6 特征）、parseStandaloneJsonPreview（多题库数组/题目数组/单库对象/banks 对象四形态 + kind 文案）、题目 id 修复链（questionMigrationFingerprint NFKC 指纹 + sanitizeBankWithQuestionIdRepair 空白/重复 id 重生成 + resolveRepairedQuestion 指纹→题干→题号→旧 id 四级回退）、stripEmbeddedAnswerBracket（内嵌答案括号剥离，含全角括号/正确错误√×/区间重建）、sanitizeWrongEntry/FavoriteEntry（掌握状态与计数归一）、parseBackupTimeMillis（毫秒/数字串/ISO 三形态 UTC）、data URI 双通道（题干内嵌 `![alt](data:image/...)` 落地+【alt】占位、images[].dataUrl 落地回写，纯 TS base64 解码）、remapQuestionAssets（ZIP assets 落地回写）、uniqueImportedBankName（组内重名追加「 导入2」，跨组不冲突）、importBackupText 完整导入映射（bank_<now>_<i> id 重映射 + activeBankId 跟随、错题/收藏/记录题目引用按 id→修复链→快照资产归一三级解析、web_backup 走 crossPlatform 原生结构或旧对象结构（wrongBook 按 bankId 键 + favorites id 数组 + records details 逐题 questionId 回解）双路径、孤儿条目丢弃不炸包）；BackupFiles.ets 平台层（zlib.compressFile 目录压缩产 ZIP 根 backup.json + assets/、解包限额 1000 条/20MB/100MB 对齐 Android SafeZipReader）；QuizRepository 补 exportFullBackupZip/exportBanksBackupZip/importBackupBytes（PK 魔数或 .zip 后缀走 ZIP，否则 JSON 文本；资产落地 question_assets/backup_<ts> 会话目录；错题/收藏/记录前插合并 + 会话重置 + 持久化）与 clearAllLocalData；DataManagerPage（导入 ZIP/JSON、多选题库导出 sheet（全选/组名·题数）、完整备份导出（picker.save 写 misaka_full_backup_yyyyMMdd_HHmmss.zip）、清除数据二次确认、备份范围说明（偏好设置不在备份内））；我的 Tab 增数据管理入口；首页 VERSION_LABEL 常量同步 v0.7.0；修复系统 picker 被返回键取消时 save()/select() 的 promise 不落地导致 busy 永久卡死（打开 picker 前释放 busy 并清进行中提示）；WideFoldM4 实测：完整备份导出（129 错题/1 收藏/6 记录/C1 393 题）→宿主 Info-ZIP 解开核验协议字段（backup.json 在 ZIP 根、null 键省略、assets/ 前缀）→web_backup 新旧双结构导入（state.json 实证 id 重映射、记录逐题回解、correct 缺省按 details 统计）→清除数据→导入 own ZIP 恢复闭环（129 错题 bankId 全量重映射、activeBankId 跟随、排期字段保留）→选择题库导出（三状态键省略）；backup-roundtrip.mjs 自检 40+ 断言（导出字段/键省略/选择性导出、往返 id 重映射+资产落地+引用跟随、重名去重与重复导入、空白/重复 id 修复+错题指纹解析、web crossPlatform/旧结构双路径含 correct 缺省按 details 统计与逐题回解、data URI 双通道、base64/时间解析单元、边界与孤儿条目）；39 用例回归 + study-ops + session-core + models 全绿 |
| `v0.6.0-harmony` | 2026-09-20 | M5：学习管理闭环——QuestionSearch.ts（题干/选项/答案/解析四字段多关键词 AND + 全角标点归一，Node 可测）与 WrongBookOps 作用域/到期/手动掌握纯函数（study-ops.mjs 自检）；QuizRepository 补错题本（作用域过滤 current_bank/all_banks/group/bank 四模式、今日复习到期排序摘要、标记/移出/作用域清空、刷当前筛选、单题打开）、收藏（去重练习）、记录（find/delete）薄入口；PracticeSessionCore.start 补 sourceLabel 语义（记录来源映射 错题练习/今日复习/收藏练习）；四新页：WrongBookPage（作用域 sheet 分组二级展开、掌握筛选/三种排序、智能复习开关+今日复习入口、清空/移出确认）、FavoritePage（分组筛选 sheet、取消收藏、收藏练习）、RecordsPage（来源徽章/正确率/用时/得分/占位标题过滤/删除确认）+ RecordDetailPage（摘要+逐题你的答案/正确答案/解析/只看错题）、QuestionSearchPage（范围切换、即时搜索、命中字段标注、展开全量、定位所在题库）；AppSettings 增错题作用域与智能复习键（与 Android KEY_* 一致）；四页 onPageShow + header tick 引用修复返回/删除后计数刷新；BankList 增搜索入口、首页三个快捷卡接真实路由、main_pages.json 注册；宽屏 760vp 限宽居中 + 折叠单栏均实测；模拟器实证：答对复习题排期次日、连对 2 次自动掌握（40 号题两轮收藏练习）、今日复习计数随答题归零、跨天会话用时计算、删除后首页/页内计数刷新；39 用例回归 + study-ops + session-core + models 往返全绿 |
| `v0.5.0-harmony` | 2026-09-18 | M4：练习+考试会话全功能——会话逻辑层 5 个双端 .ts（AnswerJudge 判分/NFKC 归一化、WrongBookOps 错题收录+智能复习排期（连对 2 次掌握、1/3/7/15/30 天）、OptionShuffle 含 JavaRandom 48 位 LCG 复刻（选项打乱确定性）、PracticeSessionCore（随机/顺序+三起点+进度保存恢复回绕、即时/批量分组、背题、斩题、收藏、快速编辑、补答未提交）、ExamSessionCore（按总量/题型配比组卷、倒计时到点自动交卷、分值统计））、AppSettings（键名/默认值与 Android KEY_* 一致）经 SettingsStore 落盘、Index 四 Tab 壳重构（首页/练习设置含顺序区间预览/导入/我的字号与偏好）、PracticePage/ExamSetupPage/ExamPage/ExamResultPage/BankListPage/BankDetailPage、内置 C1 题库 393 题（rawfile）；阔折叠双栏（display 宽 ≥540vp 左答题卡右题目）与折叠态单栏均实测；修复三个 ArkUI 深坑：①@State tick 若未被 build 引用则整页永不重渲染（会话纯数据对象读取无依赖收集，用 if 奇偶翻转强制重建子树，Index/Practice/Exam 三页同修）②@Builder 内空 else-if 分支运行时静默炸掉整个子树（批量模式题目区消失的根因，合并条件消除）③PillButton 的 layoutWeight 在 Column 容器中变纵向撑满挤死题目 Scroll（Column 直挂按钮包 Row）；Node 自检全绿（39/39 回归 + session-core ALL PASS + models 往返），模拟器实测完整闭环：即时判分配色/答题卡状态色/批量两组提交/背题/顺序进度断点续刷（state.json 实证 progress=20）/收藏/错题入库/考试倒计时答题卡交卷成绩报告/强杀重装数据保留 |
| `v0.4.1-harmony` | 2026-09-12 | 修复：FileStore.readText 逐字节 fromCharCode 导致持久化中文读回乱码（题库名/题干等所有存储文本受影响）——改用 util.TextDecoder UTF-8 解码，同时消除大 state.json 的 spread 传参栈溢出风险；写入侧本就正确（UTF-8 字节），存量数据无需迁移，模拟器实测重启后题库名中文显示正常 |
| `v0.4.0-harmony` | 2026-09-12 | M3：导入链路闭环——XmlDecoders.ts（Word 段落/OMML 公式/上下标/XLSX sharedStrings 表格的纯 XML 变换，Node 可测）、ImportDecoder.ets（zlib 解 ZIP + 目录遍历限额 + GB18030 回退 + 图片提取降采样 @ohos.multimedia.image）、QuestionImageBinder.ts（图片标记移除/题目绑定/材料题共享）、ImportPage 导入页（文件选择器含双文件、粘贴文本、rawfile 内置示例、预览列表 + 题干/答案/题型手动修正 + 删除题、入库）；题库重名自动加序号、导入即激活；模拟器实测：构造 docx（OMML/下标/图片）4 题全通、真实 Word docx 整卷兜底 9 题、xlsx 表格 2 题、入库后强杀重启数据保留；39 用例回归保持全绿 |
| `v0.3.0-harmony` | 2026-09-12 | M2：解析器全量移植（18 组件 ≈5400 行 Kotlin → ArkTS 兼容 .ts）——叶子工具/题型标签/分区标题/答案解析/代码外形守卫/紧凑排版修复/题块拆分/多空填空/标准题解析/混合策略/答案区拆分/双文件合并/共享题干兜底/Excel 表格/整卷兜底/策略评分/导入校验/导入编排器；Node 回归 runner 复用 native-parser-regression 的 samples/expected，39 用例全绿（判定口径对齐 compare_regression.py：摘要级 + 逐题断言）；Index 页接入完整解析链路，ArkTS 编译 + 模拟器实测“解析器自检通过” |
| `v0.2.0-harmony` | 2026-09-11 | M1：领域层落地——Models.ts 全套模型与序列化（字段/键省略规则与 Android backup.json 逐一对齐，null 即省略键）、FileStore 原子写 JSON 状态仓、QuizRepository 骨架（加载/持久化/题库 CRUD）、SettingsStore preferences 设置层；Node 往返测试 + 模拟器持久化实测（强杀重启数据保留） |
| `v0.1.0-harmony` | 2026-09-11 | M0：`apps/harmony` 工程脚手架（ArkTS/ArkUI，API 26，bundleName `com.reqir.misakaquiz`）；三 spike 全通过——ParserUtils.ts 双端编译（hvigor + Node 24 + 真机）、@ohos.zlib ZIP 往返且产物过 Info-ZIP 跨端核验、requestInStream SSE 流式（模拟器经 10.0.2.2 访问宿主）；阔折叠模拟器（Pura X widefold）首启运行成功；着重阔折叠适配的移植计划落档（docs/harmony/移植进度.md） |

## 统一发布

| 版本            | 日期         | 说明                                                                  |
| ------------- | ---------- | ------------------------------------------------------------------- |
| `v2.6.3-beta` | 2026-06-20 | 统一发布：Web 端简答题独立答案头多行识别；原生端多空题解析增强、DOCX 导入 OOM/ANR 修复、回归测试内嵌对比去 Python 依赖 |
| `v2.6.2-beta` | 2026-06-18 | 统一发布：原生端 CodeLikeTextGuard 守卫与考试状态标签单行布局；Web 端随版本线同步 |
| `v2.6.1-beta` | 2026-06-16 | 统一发布：原生端学习记录支持单条删除；Web 端随原生 v0.8.4 发布同步 |
| `v2.6.0-beta` | 2026-06-16 | 考试体验优化 + V35 版本升级 |
| `v2.5.0-beta` | 2026-06-15 | 分组练习范围（双端跨题库出题）+ 路由系统升级 |
| `v2.4.0-beta` | 2026-06-14 | 统一发布：原生端解析稳定性收口（紧凑答案归一化/前言过滤/主观题防误判）、回归 21/21；Web 端解析架构升级至 V34 |
| `v2.3.0-beta` | 2026-06-14 | 统一发布：原生端导入解析器重构、选项检测逻辑集中管理；Web 端解析架构升级（原文区间修复、拆题合并、分区感知、审计守卫） |
| `v2.2.1-beta` | 2026-06-13 | 统一发布：原生端 JSON 导入格式全面兼容、选项解析支持对象格式、答案解析兼容多字段；Web 端导入预览工具栏响应式优化、导出流程分离、英文解析优化 |
| `v2.2.0-beta` | 2026-06-09 | 统一发布：原生端错题作用域切换、记录只看错题筛选、题目页 AI 单题分析、云端字段序列化；Web 端收藏夹独立页面、练习热键改为数字键 |
| `v2.1.0-beta` | 2026-06-03 | 统一发布：原生端题目搜索、UI 优化、错题标签；Web 端题型误判修复、DOCX 兼容增强、卡片样式修复                |
| `v2.0.1-beta` | 2026-05-31 | 统一发布：原生端填空题/简答题作答与自动判分；Web 端导入追加模式与 ID 生成优化                         |
| `v2.0.0-beta` | 2026-05-31 | 统一发布：原生端 AI 提示词收紧与解析边界收口；Web 端 DOCX 富文本导入、表格图片显示、MathJax 公式支持、题库分组  |
| `v1.1.2-beta` | 2026-05-19 | 统一发布：原生端新增背题模式和斩题功能，完善即时判题、自动下一题、长选项显示与错题掌握规则；Web 端与原生端题型兼容增强       |
| `v1.1.1-beta` | 2026-05-16 | 统一发布：原生端导入编辑器查找替换、填空题识别优化；Web 端 xlsx 表格导入、移动端预览；两端功能同步              |
| `v1.1.0-beta` | 2026-05-16 | 统一发布：Web 端与原生端最新功能同步，支持题库 JSON 相互导入，含图片题完全互通                        |
| `v1.0.0-beta` | 2026-05-12 | 首个公开测试版，Web 壳版、原生 Compose 版、Web 离线包一并发布                             |
| `v1.0.0-test` | 2026-05-08 | 首次本地公开测试                                                            |

---

## 阶段号速查

| 阶段      | 关键字                                                         |
| ------- | ----------------------------------------------------------- |
| 1～29    | Web 主线开发（纯网页 + WebView 壳），同时原生 Compose 打地基（架构、模块、parser 初版） |
| 29.0～30 | 原生 Compose 框架成型、首个可用版本、核心页面搭建、R8/签名                         |
| 30.1    | 视觉风格统一、页面状态管理、动画                                            |
| 30.2    | 开屏图定制                                                       |
| 30.3    | 主题 Token 整理收尾                                               |
| 30.4    | 暗夜模式                                                        |
| 30.5    | 答题着色、卡片收起                                                   |
| 30.6    | 滑动切题、自定义题量                                                  |
| 30.7    | 偏好记忆、批量做题                                                   |
| 30.8    | 解析器增强、表格导入、符号识别                                             |
| 31.0    | AI 核对与解析                                                    |
| 31.1    | Shiroha 模式、偏好页拆分                                            |
| 31.2    | 查找替换、填空识别、筛选器                                               |
| 31.3    | 图片互通 JSON/ZIP、WebP 净化                                       |
| 31.4    | 单题编辑、分区识别、聚焦联动                                              |
| 31.5    | 双图标、ShirohaClick、素材整理                                       |
