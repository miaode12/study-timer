# 🍅 番茄学习计时器 (Study Timer)

SillyTavern 第三方扩展 —— 手机专用的番茄钟学习计时器，集成倒计时、正计时、每日统计与 AI 角色互动。

> **Mobile-First 设计**：专为手机触摸操作优化，大按钮、底部抽屉面板、流畅动画。

## ✨ 功能

- 🍅 **番茄钟模式**：经典 25 分钟专注 + 5 分钟休息，支持长休息间隔
- ⏱ **倒计时模式**：自定义科目和分钟数（15/25/30/45/60），倒计时结束自动记录
- ▶ **正计时模式**：不限时长，自由记录学习时间
- 📊 **每日/每周统计**：按科目汇总，进度条可视化
- 🎯 **目标追踪**：可配置各科目每日目标（分钟），自动计算完成率
- 🤖 **AI 角色互动**：计时开始/结束时角色自动发言（AI 生成 / 固定模板 / 关闭）
- 🎉 **里程碑庆祝**：达到 4/6/8/10/12 小时自动触发角色赞美
- 💬 **丰富斜杠命令**：`/study`、`/study-forward`、`/timer-pause` 等 10+ 命令
- 🔧 **全局 API**：其他扩展可通过 `window.StudyTimerAPI` 查询和控制计时器
- 🎨 **浮动按钮**：右下角悬浮按钮，显示实时倒计时，呼吸灯动画
- ☕ **休息模式**：自动/手动休息，休息结束提醒
- 💾 **状态持久化**：刷新页面自动恢复计时，90 天历史记录

## 📦 安装

### 方法一：GitHub URL 安装（推荐）

1. 在 SillyTavern 中打开 **扩展管理** 面板
2. 点击 **安装扩展**
3. 输入仓库 GitHub URL
4. 确认安装，刷新页面

### 方法二：手动安装

将仓库所有文件放入以下目录：

```
SillyTavern/public/scripts/extensions/third-party/study-timer/
```

刷新 SillyTavern 页面即可。

## 🎮 使用

### 面板操作

1. 点击右下角 🍅 **浮动按钮** 打开控制面板
2. **选择科目** — 点击科目标签（数学/英语/编程等）
3. **开始计时** — 点击快捷时间按钮（25/15/30/45/60 分钟）或「正计时」
4. 计时中可 **暂停/继续/停止**
5. 工具栏：📊 查看统计 | ⚙ 设置 | 🤖 切换 AI 模式

### 斜杠命令速查

| 命令 | 说明 | 示例 |
|------|------|------|
| `/study 科目 分钟` | 开始倒计时 | `/study 数学 30` |
| `/study-forward 科目` | 开始正计时 | `/study-forward 编程` |
| `/timer-stop` | 停止当前计时 | |
| `/timer-pause` | 暂停计时 | |
| `/timer-resume` | 恢复计时 | |
| `/timer-status` | 查看计时状态 | |
| `/study-stats` | 查看今日统计 | |
| `/study-now` | 查看当前时间和进度 | |
| `/study-subjects` | 查看科目列表 | |
| `/study-add-subject 科目` | 添加新科目 | `/study-add-subject 物理` |
| `/study-remove-subject 科目` | 删除科目 | `/study-remove-subject 物理` |

## ⚙ 设置

在面板中点击 ⚙ **设置**，可自定义：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 番茄钟时长 | 25 分钟 | 1-120 分钟 |
| 短休息时长 | 5 分钟 | 1-30 分钟 |
| 长休息时长 | 15 分钟 | 5-60 分钟 |
| 长休息间隔 | 4 个番茄 | 每 N 个番茄后长休息 |
| 科目列表 | 数学,英语,编程,阅读,写作,其他 | 逗号分隔 |
| 每日目标 | 无 | 格式: `数学=60,英语=30` |
| AI 角色互动 | 开启 | 开关 |
| AI 消息模式 | 自动 | 自动/固定模板/关闭 |
| 自动开始休息 | 关闭 | 番茄结束自动进入休息 |
| 提示音量 | 0.7 | 0-1.0 |

## 🔌 API

其他扩展或 Function Calling 可通过全局 API 调用：

```javascript
// 获取当前状态
window.StudyTimerAPI.getStatus();

// 获取今日统计
window.StudyTimerAPI.getTodayStats();

// 获取本周统计
window.StudyTimerAPI.getWeeklyStats();

// 程序化控制
window.StudyTimerAPI.startCountdown('数学', 25);
window.StudyTimerAPI.startStopwatch('编程');
window.StudyTimerAPI.pauseTimer();
window.StudyTimerAPI.resumeTimer();
window.StudyTimerAPI.stopTimer();
```

## 📱 手机适配

- 浮动按钮位于右下角，方便拇指点击
- 面板从底部滑出，符合手机操作习惯
- 所有按钮最小 44px 触摸区域
- 科目标签自适应换行
- 手柄拖拽可关闭面板
- 支持横屏自适应
- `-webkit-tap-highlight-color` 消除点击高亮

## 📄 许可

MIT
