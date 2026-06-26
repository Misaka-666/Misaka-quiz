@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === 创建 GitHub Releases ===

gh release create v1.1.1 "apps/android/releases/Misaka-Quiz-v1.1.1-debug.apk" ^
  --title "v1.1.1 - 练习模式「问 AI」" ^
  --notes "练习模式新增「问 AI」功能：AI 单题分析下方可展开追问输入框，针对当前题目自由提问获取 AI 答疑。"

gh release create v1.1.0 "apps/android/releases/Misaka-Quiz-v1.1.0-debug.apk" ^
  --title "v1.1.0 - Web 资源优化 & Project 清理" ^
  --notes "Web 资源移至 web flavor（native APK 不再包含 3.2MB Web 资源）；Project 清理（删除遗留 shiroha 批处理、未使用 peeking.png、源设计素材 27MB）。"

gh release create v1.0.0 "apps/android/releases/Misaka-Quiz-v1.0.0-debug.apk" ^
  --title "v1.0.0 - 正式版号" ^
  --notes "版本号升级至 1.0.0。"

gh release create v0.9.0 "apps/android/releases/Misaka-Quiz-v0.9.0-debug.apk" ^
  --title "v0.9.0 - 背题模式 & 全面改名" ^
  --notes "背题模式开关、题目合并功能、全面改名 Misaka Quiz。"

gh release create v0.8.9 "apps/android/releases/Misaka-Quiz-v0.8.9-debug.apk" ^
  --title "v0.8.9 - 解析增强 & DOCX 修复" ^
  --notes "多空题解析增强（内联多空结构、分区多空继承、守卫误判）；修复 docx 导入 OOM/ANR 闪退。"

echo === 完成 ===
pause
