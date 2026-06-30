/**
 * 🍅 番茄学习计时器 - SillyTavern 手机专用扩展
 * Pomodoro Study Timer Extension for SillyTavern (Mobile-First)
 */

// ============ 常量 & 默认配置 ============
const STUDY_TIMER_DEFAULTS = {
    defaultMinutes: 25,           // 默认番茄钟 25 分钟
    shortBreakMinutes: 5,         // 短休息 5 分钟
    longBreakMinutes: 15,         // 长休息 15 分钟
    longBreakInterval: 4,         // 每4个番茄后长休息
    alertVolume: 0.7,
    aiInteractionEnabled: true,   // AI 角色互动
    aiMessageMode: 'auto',        // 'auto' | 'template' | 'off'
    autoStartBreak: false,
    subjects: ['数学', '英语','408', '其他'],
    dailyGoals: {}               // { subject: minutes }
};

// ============ 全局状态 ============
const StudyTimer = {
    // 计时状态
    timerType: null,        // 'countdown' | 'stopwatch' | 'break' | null
    running: false,
    paused: false,
    remainingSeconds: 0,
    elapsedSeconds: 0,
    totalDuration: 0,       // 倒计时总时长(秒)
    currentSubject: '其他',
    
    // 番茄计数
    pomodoroCount: 0,
    sessionPomodoros: 0,
    
    // 统计 (按日期存储)
    dailyRecords: {},       // { 'YYYY-MM-DD': { subject: totalSeconds } }
    
    // 里程碑提示（避免重复）
    milestonesTriggered: {},
    
    // 通知
    audioCtx: null,
    
    // UI 引用
    panelVisible: false,
    settingsVisible: false,
    statsVisible: false,
    
    // interval ID
    tickInterval: null,
    
    // 设置
    settings: { ...STUDY_TIMER_DEFAULTS },
    
    // 初始化标记
    initialized: false
};

// ============ 工具函数 ============

/** 获取今天的日期键 YYYY-MM-DD */
function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 获取本周的日期范围 */
function getWeekKeys() {
    const keys = [];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return keys;
}

/** 格式化时间 mm:ss */
function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 格式化小时 */
function formatHours(totalSeconds) {
    return (totalSeconds / 3600).toFixed(1);
}

/** 安全地从 localStorage 读取 */
function lsGet(key, fallback = null) {
    try {
        const v = localStorage.getItem(`study_timer_${key}`);
        return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
}

/** 安全地写入 localStorage */
function lsSet(key, value) {
    try {
        localStorage.setItem(`study_timer_${key}`, JSON.stringify(value));
    } catch { /* ignore quota */ }
}

// ============ 持久化 ============

function saveSettings() {
    lsSet('settings', StudyTimer.settings);
}

function loadSettings() {
    const saved = lsGet('settings');
    if (saved && typeof saved === 'object') {
        StudyTimer.settings = { ...STUDY_TIMER_DEFAULTS, ...saved };
    }
    // 确保 subjects 是数组
    if (!Array.isArray(StudyTimer.settings.subjects)) {
        StudyTimer.settings.subjects = [...STUDY_TIMER_DEFAULTS.subjects];
    }
}

function saveDailyRecords() {
    lsSet('dailyRecords', StudyTimer.dailyRecords);
}

function loadDailyRecords() {
    const saved = lsGet('dailyRecords');
    if (saved && typeof saved === 'object') {
        StudyTimer.dailyRecords = saved;
    }
}

function saveTimerState() {
    lsSet('timerState', {
        timerType: StudyTimer.timerType,
        running: StudyTimer.running,
        paused: StudyTimer.paused,
        remainingSeconds: StudyTimer.remainingSeconds,
        elapsedSeconds: StudyTimer.elapsedSeconds,
        totalDuration: StudyTimer.totalDuration,
        currentSubject: StudyTimer.currentSubject,
        pomodoroCount: StudyTimer.pomodoroCount,
        sessionPomodoros: StudyTimer.sessionPomodoros,
        lastSaveTime: Date.now()
    });
}

function loadTimerState() {
    const saved = lsGet('timerState');
    if (!saved) return;
    
    // 如果之前是运行状态，根据时间差恢复
    if (saved.running && !saved.paused) {
        const elapsedReal = Math.floor((Date.now() - (saved.lastSaveTime || Date.now())) / 1000);
        if (saved.timerType === 'countdown' || saved.timerType === 'break') {
            saved.remainingSeconds = Math.max(0, saved.remainingSeconds - elapsedReal);
            if (saved.remainingSeconds <= 0) {
                // 计时器已过期，不恢复运行状态
                StudyTimer.timerType = saved.timerType;
                StudyTimer.remainingSeconds = 0;
                StudyTimer.totalDuration = saved.totalDuration;
                StudyTimer.currentSubject = saved.currentSubject;
                StudyTimer.pomodoroCount = saved.pomodoroCount;
                StudyTimer.sessionPomodoros = saved.sessionPomodoros;
                handleTimerComplete();
                return;
            }
        } else if (saved.timerType === 'stopwatch') {
            saved.elapsedSeconds += elapsedReal;
        }
    }
    
    StudyTimer.timerType = saved.timerType;
    StudyTimer.running = saved.running;
    StudyTimer.paused = saved.paused;
    StudyTimer.remainingSeconds = saved.remainingSeconds;
    StudyTimer.elapsedSeconds = saved.elapsedSeconds;
    StudyTimer.totalDuration = saved.totalDuration;
    StudyTimer.currentSubject = saved.currentSubject || '其他';
    StudyTimer.pomodoroCount = saved.pomodoroCount || 0;
    StudyTimer.sessionPomodoros = saved.sessionPomodoros || 0;
    
    if (StudyTimer.running && !StudyTimer.paused) {
        startTick();
    }
}

// ============ 音效 ============

function playBeep(freq = 800, duration = 150, type = 'sine') {
    try {
        if (!StudyTimer.audioCtx) {
            StudyTimer.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = StudyTimer.audioCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = StudyTimer.settings.alertVolume;
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration / 1000);
    } catch { /* 静默失败 */ }
}

function playAlarm() {
    // 简单的叮叮声
    playBeep(880, 100);
    setTimeout(() => playBeep(1100, 100), 120);
    setTimeout(() => playBeep(1320, 150), 240);
}

function playStartSound() {
    playBeep(660, 80, 'triangle');
    setTimeout(() => playBeep(880, 120, 'triangle'), 100);
}

// ============ AI 角色互动 ============

function getContext() {
    return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) 
        ? SillyTavern.getContext() 
        : null;
}

function sendSystemMessage(text) {
    const ctx = getContext();
    if (ctx && typeof ctx.sendSystemMessage === 'function') {
        ctx.sendSystemMessage('generic', text);
    } else {
        // Fallback: 尝试通过 toast 或 console 显示
        try {
            if (typeof toastr !== 'undefined') toastr.info(text, '🍅 番茄钟');
        } catch { console.log('[StudyTimer]', text); }
    }
}

async function sendAIInteraction(scene) {
    if (!StudyTimer.settings.aiInteractionEnabled) return;
    if (StudyTimer.settings.aiMessageMode === 'off') return;
    
    const subject = StudyTimer.currentSubject;
    const duration = StudyTimer.timerType === 'stopwatch' 
        ? formatTime(StudyTimer.elapsedSeconds)
        : formatTime(StudyTimer.totalDuration);
    
    const templates = {
        start: [
            `📚 开始学习 ${subject}！设定时长 ${duration}，加油！`,
            `⏰ ${subject} 学习时间到！专注 ${duration}，开始吧~`,
            `🎯 进入 ${subject} 学习模式，目标 ${duration}，集中注意力！`
        ],
        complete: [
            `🎉 ${subject} 学习完成！坚持了 ${duration}，太棒了！`,
            `✅ ${subject} 计时结束！${duration} 的努力不会白费~`,
            `🏆 恭喜完成 ${subject} 的 ${duration} 学习！休息一下吧~`
        ],
        breakStart: [
            `☕ 休息时间 ${duration}，放松一下~`,
            `😌 休息 ${duration}，喝口水活动活动~`
        ],
        breakEnd: [
            `⏰ 休息结束！准备开始下一个番茄吧~`,
            `🔔 休息时间到，继续加油！`
        ],
        milestone: [
            `🌟 太厉害了！今天已经学习了 {hours} 小时！你是最棒的！`,
            `💪 {hours} 小时的学习！这个成就令人敬佩！`,
            `🔥 {hours} 小时的专注！你的毅力让人惊叹！`
        ]
    };
    
    let message;
    if (StudyTimer.settings.aiMessageMode === 'template') {
        // 固定模板模式
        const pool = templates[scene] || templates.start;
        message = pool[Math.floor(Math.random() * pool.length)];
        message = message.replace('{hours}', formatHours(getTodayTotalSeconds()));
        sendSystemMessage(message);
    } else {
        // auto 模式：尝试触发 AI 生成消息
        const pool = templates[scene] || templates.start;
        message = pool[Math.floor(Math.random() * pool.length)];
        message = message.replace('{hours}', formatHours(getTodayTotalSeconds()));
        
        // 如果 ST 支持，构造提示词让 AI 生成
        const ctx = getContext();
        if (ctx && typeof ctx.generateRaw === 'function') {
            try {
                const prompt = scene === 'start'
                    ? `[系统提示：用户刚刚开始了${subject}的番茄钟学习，时长${duration}。请作为角色
                    ，用自然的话语鼓励用户，回复要简短（1-2句话），语气温柔鼓励。不要用任何格式标记。]`
                    : scene === 'complete'
                        ? `[系统提示：用户完成了${subject}的${duration}学习。请作为角色回复用户，回复要简短（1-2句话），表达认可和鼓励。不要用任何格式标记。]`
                        : scene === 'milestone'
                            ? `[系统提示：用户今天已经学习了${formatHours(getTodayTotalSeconds())}小时！请作为角色赞美用户的毅力，回复简短有力（1-2句话）。不要用任何格式标记。]`
                            : `[系统提示：学习计时器触发事件：${scene}，科目：${subject}。请简短回应（1句话）。不要用任何格式标记。]`;
                
                const result = await ctx.generateRaw(prompt, '', false, false, '');
                if (result && typeof result === 'string' && result.trim()) {
                    sendSystemMessage(result.trim());
                    return;
                }
            } catch { /* 回退到模板 */ }
        }
        sendSystemMessage(message);
    }
}

// ============ 统计 ============

function getTodayTotalSeconds() {
    const key = getTodayKey();
    const todayData = StudyTimer.dailyRecords[key] || {};
    return Object.values(todayData).reduce((sum, s) => sum + s, 0);
}

function getSubjectTodaySeconds(subject) {
    const key = getTodayKey();
    const todayData = StudyTimer.dailyRecords[key] || {};
    return todayData[subject] || 0;
}

function recordStudyTime(subject, seconds) {
    const key = getTodayKey();
    if (!StudyTimer.dailyRecords[key]) {
        StudyTimer.dailyRecords[key] = {};
    }
    StudyTimer.dailyRecords[key][subject] = (StudyTimer.dailyRecords[key][subject] || 0) + seconds;
    
    // 清理90天前的旧记录
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    Object.keys(StudyTimer.dailyRecords).forEach(k => {
        if (k < cutoffKey) delete StudyTimer.dailyRecords[k];
    });
    
    saveDailyRecords();
    checkMilestones();
}

function checkMilestones() {
    const totalHours = getTodayTotalSeconds() / 3600;
    const milestones = [4, 6, 8, 10, 12];
    const todayKey = getTodayKey();
    if (!StudyTimer.milestonesTriggered[todayKey]) {
        StudyTimer.milestonesTriggered[todayKey] = {};
    }
    
    for (const m of milestones) {
        if (totalHours >= m && !StudyTimer.milestonesTriggered[todayKey][m]) {
            StudyTimer.milestonesTriggered[todayKey][m] = true;
            sendAIInteraction('milestone');
        }
    }
    // 清理旧日期的里程碑记录
    Object.keys(StudyTimer.milestonesTriggered).forEach(k => {
        if (k !== todayKey) delete StudyTimer.milestonesTriggered[k];
    });
}

function getWeeklyStats() {
    const weekKeys = getWeekKeys();
    const stats = {};
    for (const key of weekKeys) {
        stats[key] = StudyTimer.dailyRecords[key] || {};
    }
    return { weekKeys, stats };
}

// ============ 计时核心 ============

function startTick() {
    stopTick();
    StudyTimer.tickInterval = setInterval(tick, 1000);
}

function stopTick() {
    if (StudyTimer.tickInterval) {
        clearInterval(StudyTimer.tickInterval);
        StudyTimer.tickInterval = null;
    }
}

function tick() {
    if (!StudyTimer.running || StudyTimer.paused) return;
    
    if (StudyTimer.timerType === 'countdown' || StudyTimer.timerType === 'break') {
        StudyTimer.remainingSeconds--;
        updateTimerDisplay();
        if (StudyTimer.remainingSeconds <= 0) {
            handleTimerComplete();
        }
    } else if (StudyTimer.timerType === 'stopwatch') {
        StudyTimer.elapsedSeconds++;
        updateTimerDisplay();
    }
    
    // 每30秒自动保存
    if (StudyTimer.elapsedSeconds % 30 === 0 || StudyTimer.remainingSeconds % 30 === 0) {
        saveTimerState();
    }
}

function handleTimerComplete() {
    stopTick();
    playAlarm();
    
    if (StudyTimer.timerType === 'countdown') {
        // 番茄钟完成
        const studySeconds = StudyTimer.totalDuration;
        recordStudyTime(StudyTimer.currentSubject, studySeconds);
        StudyTimer.pomodoroCount++;
        StudyTimer.sessionPomodoros++;
        
        sendAIInteraction('complete');
        
        // 判断是否需要长休息
        const isLongBreak = (StudyTimer.sessionPomodoros % StudyTimer.settings.longBreakInterval === 0);
        const breakDuration = isLongBreak 
            ? StudyTimer.settings.longBreakMinutes * 60 
            : StudyTimer.settings.shortBreakMinutes * 60;
        
        if (StudyTimer.settings.autoStartBreak) {
            startBreak(breakDuration, isLongBreak);
        } else {
            StudyTimer.running = false;
            StudyTimer.timerType = null;
            StudyTimer.remainingSeconds = 0;
            saveTimerState();
            updateTimerDisplay();
            updatePanelUI();
        }
    } else if (StudyTimer.timerType === 'break') {
        // 休息结束
        StudyTimer.timerType = null;
        StudyTimer.running = false;
        StudyTimer.remainingSeconds = 0;
        sendAIInteraction('breakEnd');
        saveTimerState();
        updateTimerDisplay();
        updatePanelUI();
    }
}

function startCountdown(subject, minutes) {
    stopTick();
    const totalSeconds = minutes * 60;
    StudyTimer.timerType = 'countdown';
    StudyTimer.currentSubject = subject;
    StudyTimer.totalDuration = totalSeconds;
    StudyTimer.remainingSeconds = totalSeconds;
    StudyTimer.elapsedSeconds = 0;
    StudyTimer.running = true;
    StudyTimer.paused = false;
    saveTimerState();
    startTick();
    updateTimerDisplay();
    updatePanelUI();
    playStartSound();
    sendAIInteraction('start');
}

function startStopwatch(subject) {
    stopTick();
    StudyTimer.timerType = 'stopwatch';
    StudyTimer.currentSubject = subject;
    StudyTimer.elapsedSeconds = 0;
    StudyTimer.remainingSeconds = 0;
    StudyTimer.totalDuration = 0;
    StudyTimer.running = true;
    StudyTimer.paused = false;
    saveTimerState();
    startTick();
    updateTimerDisplay();
    updatePanelUI();
    playStartSound();
    sendAIInteraction('start');
}

function startBreak(seconds, isLong) {
    stopTick();
    StudyTimer.timerType = 'break';
    StudyTimer.totalDuration = seconds;
    StudyTimer.remainingSeconds = seconds;
    StudyTimer.elapsedSeconds = 0;
    StudyTimer.running = true;
    StudyTimer.paused = false;
    saveTimerState();
    startTick();
    updateTimerDisplay();
    updatePanelUI();
    sendAIInteraction('breakStart');
}

function pauseTimer() {
    StudyTimer.paused = true;
    saveTimerState();
    updatePanelUI();
}

function resumeTimer() {
    if (!StudyTimer.running) return;
    StudyTimer.paused = false;
    saveTimerState();
    updatePanelUI();
}

function stopTimer() {
    if (StudyTimer.timerType === 'stopwatch' && StudyTimer.elapsedSeconds > 0) {
        recordStudyTime(StudyTimer.currentSubject, StudyTimer.elapsedSeconds);
        sendAIInteraction('complete');
    }
    stopTick();
    StudyTimer.running = false;
    StudyTimer.paused = false;
    StudyTimer.timerType = null;
    StudyTimer.remainingSeconds = 0;
    StudyTimer.elapsedSeconds = 0;
    StudyTimer.totalDuration = 0;
    saveTimerState();
    updateTimerDisplay();
    updatePanelUI();
}

function resetPomodoroSession() {
    StudyTimer.sessionPomodoros = 0;
    saveTimerState();
}

// ============ UI ============

function createStyles() {
    const css = `
/* ===== 番茄学习计时器 - 手机专用样式 ===== */
#study-timer-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 2147483644;
    background: rgba(60,50,40,0.25);
    display: none;
    pointer-events: none;
}
#study-timer-overlay.visible {
    display: block;
    pointer-events: auto;
}

#study-timer-floating-btn {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 2147483646;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, #c4a0a0, #c4b0a0);
    border: none;
    box-shadow: 0 4px 15px rgba(180, 155, 145, 0.4);
    cursor: grab;
    font-size: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: box-shadow 0.2s;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
}
#study-timer-floating-btn:active {
    box-shadow: 0 2px 8px rgba(180, 155, 145, 0.3);
}
#study-timer-floating-btn.dragging {
    cursor: grabbing;
    transition: none;
    box-shadow: 0 8px 25px rgba(180, 155, 145, 0.5);
}
#study-timer-floating-btn.running {
    background: linear-gradient(135deg, #a8b8a0, #a0b8b0);
    box-shadow: 0 4px 15px rgba(155, 175, 155, 0.4);
    animation: pulse-green 2s infinite;
}
#study-timer-floating-btn.running.dragging {
    animation: none;
}
#study-timer-floating-btn.paused {
    background: linear-gradient(135deg, #c4b0a0, #c4a0a0);
    animation: none;
}
@keyframes pulse-green {
    0%, 100% { box-shadow: 0 4px 15px rgba(155, 175, 155, 0.4); }
    50% { box-shadow: 0 4px 25px rgba(155, 175, 155, 0.7); }
}

#study-timer-floating-btn .mini-time {
    display: none;
    font-size: 11px;
    color: #fff;
    font-weight: 700;
    letter-spacing: 0.5px;
}
#study-timer-floating-btn.running .mini-time,
#study-timer-floating-btn.paused .mini-time {
    display: block;
}
#study-timer-floating-btn:not(.running):not(.paused) .btn-icon {
    display: block;
}
#study-timer-floating-btn.running .btn-icon,
#study-timer-floating-btn.paused .btn-icon {
    display: none;
}

/* ===== 主面板 ===== */
#study-timer-panel {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2147483645;
    background: #f5f0eb;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 30px rgba(100,80,60,0.15);
    padding: 20px 16px 28px;
    transform: translateY(100%);
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    max-height: 85vh;
    overflow-y: auto;
    color: #4a3f35;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
#study-timer-panel.visible {
    transform: translateY(0);
}

/* 面板手柄 */
#study-timer-panel .panel-handle {
    width: 40px;
    height: 5px;
    border-radius: 3px;
    background: #d4ccc4;
    margin: 0 auto 16px;
    cursor: grab;
}

/* 关闭按钮 */
.panel-close-btn {
    position: absolute;
    top: 10px;
    right: 14px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #a89888;
    cursor: pointer;
    border-radius: 50%;
    border: none;
    background: rgba(180,170,160,0.5);
    transition: background 0.2s, color 0.2s;
    z-index: 10;
    line-height: 1;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
}
.panel-close-btn:hover,
.panel-close-btn:active {
    background: #c4b8ac;
    color: #4a3f35;
}

/* 计时显示 */
#study-timer-panel .timer-display {
    text-align: center;
    padding: 10px 0 16px;
}
#study-timer-panel .timer-display .time {
    font-size: 64px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 2px;
    color: #4a3f35;
    line-height: 1.1;
}
#study-timer-panel .timer-display .time.countdown-active { color: #c4a0a0; }
#study-timer-panel .timer-display .time.stopwatch-active { color: #a8b8a0; }
#study-timer-panel .timer-display .time.break-active { color: #a0aec0; }
#study-timer-panel .timer-display .label {
    font-size: 13px;
    color: #a89888;
    margin-top: 4px;
}

/* 科目选择 */
#study-timer-panel .subject-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 14px;
    justify-content: center;
}
#study-timer-panel .subject-chip {
    padding: 8px 16px;
    border-radius: 20px;
    border: 1.5px solid #d4ccc4;
    background: #ede7e0;
    color: #4a3f35;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
}
#study-timer-panel .subject-chip:active {
    transform: scale(0.95);
}
#study-timer-panel .subject-chip.selected {
    border-color: #b8a8c0;
    background: #ece4f0;
    color: #8a7a96;
    font-weight: 600;
}

/* 快捷时间按钮 */
#study-timer-panel .quick-time-row {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 14px;
    flex-wrap: wrap;
}
#study-timer-panel .quick-time-btn {
    padding: 10px 18px;
    border-radius: 16px;
    border: 1.5px solid #d4ccc4;
    background: #ede7e0;
    color: #4a3f35;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    -webkit-tap-highlight-color: transparent;
}
#study-timer-panel .quick-time-btn:active {
    transform: scale(0.93);
}
#study-timer-panel .quick-time-btn.pomodoro {
    border-color: #b8a8c0;
    color: #8a7a96;
}

/* 操作按钮 */
#study-timer-panel .action-row {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
}
#study-timer-panel .btn {
    padding: 12px 24px;
    border-radius: 25px;
    border: none;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    -webkit-tap-highlight-color: transparent;
    display: flex;
    align-items: center;
    gap: 6px;
}
#study-timer-panel .btn:active {
    transform: scale(0.94);
}
#study-timer-panel .btn-start {
    background: #a8b8a0;
    color: #fff;
}
#study-timer-panel .btn-pause {
    background: #c4b0a0;
    color: #fff;
}
#study-timer-panel .btn-resume {
    background: #a8b8a0;
    color: #fff;
}
#study-timer-panel .btn-stop {
    background: #c4a0a0;
    color: #fff;
}
#study-timer-panel .btn-forward {
    background: #a0aec0;
    color: #fff;
}
#study-timer-panel .btn-break {
    background: #a0aec0;
    color: #fff;
}

/* 底部工具栏 */
#study-timer-panel .bottom-toolbar {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
}
#study-timer-panel .tool-btn {
    padding: 8px 16px;
    border-radius: 14px;
    border: 1px solid #d4ccc4;
    background: #ede7e0;
    color: #8c8075;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}
#study-timer-panel .tool-btn:active {
    background: #e6dfd6;
}

/* 统计面板 */
#study-timer-stats-panel {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2147483645;
    background: #f5f0eb;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 30px rgba(100,80,60,0.12);
    padding: 20px 16px 28px;
    transform: translateY(100%);
    transition: transform 0.35s ease;
    max-height: 80vh;
    overflow-y: auto;
    color: #4a3f35;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
#study-timer-stats-panel.visible {
    transform: translateY(0);
}
#study-timer-stats-panel .stats-title {
    font-size: 18px;
    font-weight: 700;
    text-align: center;
    margin-bottom: 16px;
    color: #c0b090;
}
#study-timer-stats-panel .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #e6dfd6;
    font-size: 14px;
}
#study-timer-stats-panel .stat-subject { font-weight: 600; }
#study-timer-stats-panel .stat-time { color: #a8b8a0; }
#study-timer-stats-panel .progress-bar {
    width: 100%;
    height: 6px;
    background: #e6dfd6;
    border-radius: 3px;
    margin: 4px 0;
    overflow: hidden;
}
#study-timer-stats-panel .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a8b8a0, #a0b8b0);
    border-radius: 3px;
    transition: width 0.3s ease;
}
#study-timer-stats-panel .goal-indicator {
    font-size: 11px;
    color: #a89888;
    text-align: right;
}
#study-timer-stats-panel .total-row {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 2px solid #d4ccc4;
    font-size: 16px;
    font-weight: 700;
}
#study-timer-stats-panel .close-btn {
    display: block;
    margin: 16px auto 0;
    padding: 10px 40px;
    border-radius: 20px;
    border: none;
    background: #d4ccc4;
    color: #4a3f35;
    font-size: 14px;
    cursor: pointer;
}

/* 设置面板 */
#study-timer-settings-panel {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2147483645;
    background: #f5f0eb;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 30px rgba(100,80,60,0.12);
    padding: 20px 16px 28px;
    transform: translateY(100%);
    transition: transform 0.35s ease;
    max-height: 80vh;
    overflow-y: auto;
    color: #4a3f35;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
#study-timer-settings-panel.visible {
    transform: translateY(0);
}
#study-timer-settings-panel .settings-title {
    font-size: 18px;
    font-weight: 700;
    text-align: center;
    margin-bottom: 16px;
}
#study-timer-settings-panel .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #e6dfd6;
    font-size: 14px;
}
#study-timer-settings-panel .setting-item input[type="number"] {
    width: 65px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid #d4ccc4;
    background: #ede7e0;
    color: #4a3f35;
    font-size: 14px;
    text-align: center;
}
#study-timer-settings-panel .setting-item input[type="text"] {
    width: 120px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid #d4ccc4;
    background: #ede7e0;
    color: #4a3f35;
    font-size: 13px;
}
#study-timer-settings-panel .setting-item select {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid #d4ccc4;
    background: #ede7e0;
    color: #4a3f35;
    font-size: 13px;
}
#study-timer-settings-panel .toggle-switch {
    width: 48px;
    height: 26px;
    border-radius: 13px;
    background: #d4ccc4;
    position: relative;
    cursor: pointer;
    transition: background 0.3s;
}
#study-timer-settings-panel .toggle-switch.on {
    background: #a8b8a0;
}
#study-timer-settings-panel .toggle-switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.3s;
}
#study-timer-settings-panel .toggle-switch.on::after {
    transform: translateX(22px);
}
#study-timer-settings-panel .btn-row {
    display: flex;
    gap: 10px;
    margin-top: 16px;
    justify-content: center;
}
#study-timer-settings-panel .save-btn {
    padding: 10px 30px;
    border-radius: 20px;
    border: none;
    background: #a8b8a0;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
}
#study-timer-settings-panel .cancel-btn {
    padding: 10px 30px;
    border-radius: 20px;
    border: none;
    background: #d4ccc4;
    color: #4a3f35;
    font-size: 14px;
    cursor: pointer;
}

/* Toast */
.study-timer-toast {
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #ede7e0;
    color: #4a3f35;
    padding: 12px 24px;
    border-radius: 25px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(100,80,60,0.15);
    opacity: 0;
    transition: opacity 0.3s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    pointer-events: none;
}
.study-timer-toast.show {
    opacity: 1;
}

/* ===== 响应式适配 ===== */

/* ---------- 桌面端 (≥1024px) ---------- */
@media (min-width: 1024px) {
    /* 面板变为居中浮窗，不再是底部抽屉 */
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        position: absolute;
        top: 50%;
        left: 50%;
        bottom: auto;
        right: auto;
        width: 420px;
        max-width: 90vw;
        max-height: 80vh;
        border-radius: 20px;
        transform: translate(-50%, -50%) scale(0.9);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.3s ease, opacity 0.3s ease;
    }
    #study-timer-panel.visible,
    #study-timer-stats-panel.visible,
    #study-timer-settings-panel.visible {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
        pointer-events: auto;
    }

    /* 桌面端面板手柄隐藏 */
    #study-timer-panel .panel-handle {
        display: none;
    }

    /* 桌面端关闭按钮 */
    #study-timer-panel .panel-close-btn,
    #study-timer-stats-panel .panel-close-btn,
    #study-timer-settings-panel .panel-close-btn {
        top: 14px;
        right: 18px;
        width: 38px;
        height: 38px;
        font-size: 22px;
    }

    /* 桌面端面板内边距加大 */
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        padding: 28px 24px 32px;
    }

    /* 桌面端计时数字更大 */
    #study-timer-panel .timer-display .time {
        font-size: 72px;
    }

    /* 桌面端悬浮按钮稍大 */
    #study-timer-floating-btn {
        width: 60px;
        height: 60px;
        font-size: 28px;
    }

    /* 桌面端 Toast 定位调整 */
    .study-timer-toast {
        top: 80px;
        font-size: 15px;
        padding: 14px 28px;
    }
}

/* ---------- 平板端 (768px-1023px) ---------- */
@media (min-width: 768px) and (max-width: 1023px) {
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        max-height: 70vh;
        border-radius: 24px 24px 0 0;
    }

    #study-timer-panel .timer-display .time {
        font-size: 56px;
    }

    /* 平板端快捷按钮 */
    #study-timer-panel .quick-time-row {
        gap: 10px;
    }
    #study-timer-panel .quick-time-btn {
        padding: 12px 22px;
        font-size: 16px;
    }

    /* 平板端操作按钮 */
    #study-timer-panel .btn {
        padding: 14px 28px;
        font-size: 16px;
    }

    #study-timer-floating-btn {
        width: 56px;
        height: 56px;
    }
}

/* ---------- 手机竖屏 (≤450px) ---------- */
@media (max-width: 450px) {
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        border-radius: 16px 16px 0 0;
    }

    #study-timer-settings-panel .setting-item input[type="text"] {
        width: 100px;
    }
    #study-timer-settings-panel .setting-item input[type="number"] {
        width: 55px;
    }
    #study-timer-settings-panel .setting-item {
        font-size: 13px;
    }

    #study-timer-stats-panel .stat-row {
        font-size: 13px;
    }
}

/* ---------- 超小屏 (≤360px) ---------- */
@media (max-width: 360px) {
    #study-timer-panel .timer-display .time {
        font-size: 44px;
    }

    #study-timer-panel .quick-time-btn {
        padding: 7px 12px;
        font-size: 13px;
        border-radius: 14px;
    }

    #study-timer-panel .quick-time-row {
        gap: 5px;
    }

    #study-timer-panel .btn {
        padding: 10px 18px;
        font-size: 13px;
    }

    #study-timer-panel .subject-chip {
        padding: 6px 12px;
        font-size: 12px;
    }

    #study-timer-panel .tool-btn {
        padding: 6px 12px;
        font-size: 12px;
    }

    .study-timer-toast {
        font-size: 12px;
        padding: 10px 18px;
    }

    #study-timer-floating-btn {
        width: 44px;
        height: 44px;
        font-size: 20px;
    }
}

/* ---------- 手机横屏 ---------- */
@media (max-width: 900px) and (orientation: landscape) {
    #study-timer-panel .timer-display .time {
        font-size: 38px;
    }
    #study-timer-panel .timer-display {
        padding: 4px 0 8px;
    }
    #study-timer-panel .quick-time-row {
        gap: 5px;
        margin-bottom: 8px;
    }
    #study-timer-panel .quick-time-btn {
        padding: 7px 12px;
        font-size: 13px;
    }
    #study-timer-panel .subject-row {
        margin-bottom: 8px;
    }
    #study-timer-panel .action-row {
        margin-bottom: 8px;
    }
    #study-timer-panel .btn {
        padding: 8px 16px;
        font-size: 13px;
    }
    #study-timer-panel .tool-btn {
        padding: 6px 12px;
        font-size: 11px;
    }
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        max-height: 90vh;
        padding: 12px 16px 20px;
    }
    #study-timer-panel .panel-handle {
        margin-bottom: 10px;
    }
}

/* ---------- 安全区域 (刘海屏/底部指示条) ---------- */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        padding-bottom: calc(28px + env(safe-area-inset-bottom));
    }
}

/* ---------- 减少动画 (用户偏好) ---------- */
@media (prefers-reduced-motion: reduce) {
    #study-timer-panel,
    #study-timer-stats-panel,
    #study-timer-settings-panel {
        transition: none;
    }
    #study-timer-floating-btn {
        animation: none;
        transition: none;
    }
    @keyframes pulse-green {
        0%, 100% { box-shadow: 0 4px 15px rgba(166, 227, 161, 0.45); }
        50% { box-shadow: 0 4px 15px rgba(166, 227, 161, 0.45); }
    }
}
`;

    const styleEl = document.createElement('style');
    styleEl.id = 'study-timer-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}

function showToast(msg, duration = 2000) {
    let toast = document.getElementById('study-timer-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'study-timer-toast';
        toast.className = 'study-timer-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}

// ============ 悬浮球拖拽 ============

function setupDrag(btn) {
    let dragging = false;
    let startX, startY, startLeft, startTop;
    let hasMoved = false; // 区分点击和拖拽

    function getClientPos(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    function onStart(e) {
        // 忽略多点触控
        if (e.touches && e.touches.length > 1) return;

        dragging = true;
        hasMoved = false;
        const pos = getClientPos(e);
        startX = pos.x;
        startY = pos.y;

        const rect = btn.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        btn.classList.add('dragging');

        // 注意：不在这里调用 preventDefault()！
        // 移动端 touchstart 的 preventDefault 会阻止后续 click 事件，
        // 导致点击悬浮球无法打开面板。
        // 只在 onMove 中确认拖拽后才阻止默认行为。
    }

    function onMove(e) {
        if (!dragging) return;

        const pos = getClientPos(e);
        const dx = pos.x - startX;
        const dy = pos.y - startY;

        // 移动超过 3px 才算拖拽
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            if (!hasMoved) {
                hasMoved = true;
                // 确认是拖拽后才阻止默认行为（防止页面滚动等）
                e.preventDefault();
            }
        }

        if (!hasMoved) return; // 还没超过阈值，不移动

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // 边界限制：不超出视口
        const btnW = btn.offsetWidth;
        const btnH = btn.offsetHeight;
        newLeft = Math.max(0, Math.min(window.innerWidth - btnW, newLeft));
        newTop = Math.max(0, Math.min(window.innerHeight - btnH, newTop));

        btn.style.left = newLeft + 'px';
        btn.style.top = newTop + 'px';
    }

    function onEnd(e) {
        if (!dragging) return;
        dragging = false;
        btn.classList.remove('dragging');

        // 如果发生了拖拽，阻止随后的 click 事件
        if (hasMoved) {
            const preventClick = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                btn.removeEventListener('click', preventClick, true);
            };
            btn.addEventListener('click', preventClick, true);
            // 下一帧清除（防止多次拖拽后堆积）
            setTimeout(() => btn.removeEventListener('click', preventClick, true), 50);
        }

        // 保存拖拽位置到 localStorage
        try {
            const rect = btn.getBoundingClientRect();
            localStorage.setItem('study_timer_btnPos', JSON.stringify({
                left: rect.left,
                top: rect.top
            }));
        } catch { /* ignore */ }
    }

    // 鼠标事件
    btn.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    // 触屏事件
    btn.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    // 窗口大小变化时确保按钮不超出边界
    window.addEventListener('resize', () => {
        const rect = btn.getBoundingClientRect();
        const btnW = btn.offsetWidth;
        const btnH = btn.offsetHeight;
        let left = rect.left;
        let top = rect.top;

        if (left + btnW > window.innerWidth) left = window.innerWidth - btnW;
        if (top + btnH > window.innerHeight) top = window.innerHeight - btnH;
        if (left < 0) left = 0;
        if (top < 0) top = 0;

        btn.style.left = left + 'px';
        btn.style.top = top + 'px';
    });

    // 恢复上次保存的位置，否则默认居中
    restorePosition(btn);
}

function restorePosition(btn) {
    // 先设置默认居中（CSS top:50%; left:50% 已经处理），
    // 再检查是否有保存的位置
    try {
        const saved = localStorage.getItem('study_timer_btnPos');
        if (saved) {
            const pos = JSON.parse(saved);
            const btnW = btn.offsetWidth || 52;
            const btnH = btn.offsetHeight || 52;
            // 确保保存的位置仍在可视范围内
            const left = Math.max(0, Math.min(window.innerWidth - btnW, pos.left));
            const top = Math.max(0, Math.min(window.innerHeight - btnH, pos.top));
            btn.style.left = left + 'px';
            btn.style.top = top + 'px';
            return;
        }
    } catch { /* ignore */ }

    // 默认居中：计算精确的居中位置
    const btnW = btn.offsetWidth || 52;
    const btnH = btn.offsetHeight || 52;
    btn.style.left = ((window.innerWidth - btnW) / 2) + 'px';
    btn.style.top = ((window.innerHeight - btnH) / 2) + 'px';
}

function createUI() {
    console.log('[StudyTimer] 🏗 开始创建 UI...');

    // 浮动按钮 — 挂在 body 上，使用 position:fixed
    // （ST 的 html 元素有 -webkit-transform 会导致 position:fixed 失效，但在 body 上正常工作）
    const floatingBtn = document.createElement('button');
    floatingBtn.id = 'study-timer-floating-btn';
    floatingBtn.innerHTML = '<span class="btn-icon">🍅</span><span class="mini-time"></span>';
    floatingBtn.addEventListener('click', togglePanel);
    document.body.appendChild(floatingBtn);

    // ===== 拖拽功能：鼠标 + 触屏 =====
    setupDrag(floatingBtn);

    // 遮罩层 — 同样挂在 body 上
    const overlay = document.createElement('div');
    overlay.id = 'study-timer-overlay';
    overlay.addEventListener('click', closeAllPanels);
    document.body.appendChild(overlay);

    // 主面板 — 挂在 body 上（抽屉面板不需要 fixed 到视口，跟着 body 滚动没问题）
    const panel = document.createElement('div');
    panel.id = 'study-timer-panel';
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);
    bindPanelEvents(panel);

    // 统计面板
    const statsPanel = document.createElement('div');
    statsPanel.id = 'study-timer-stats-panel';
    document.body.appendChild(statsPanel);

    // 设置面板
    const settingsPanel = document.createElement('div');
    settingsPanel.id = 'study-timer-settings-panel';
    document.body.appendChild(settingsPanel);

    console.log('[StudyTimer] ✅ UI 创建完成');

    return { floatingBtn, panel, statsPanel, settingsPanel, overlay };
}

function buildPanelHTML() {
    const subjects = StudyTimer.settings.subjects;
    const subjectChips = subjects.map(s => 
        `<span class="subject-chip" data-subject="${escapeHTML(s)}">${escapeHTML(s)}</span>`
    ).join('');

    return `
        <button class="panel-close-btn" id="st-panel-close" title="关闭">✕</button>
        <div class="panel-handle" id="st-panel-handle"></div>
        <div class="timer-display">
            <div class="time" id="st-time-display">00:00</div>
            <div class="label" id="st-time-label">选择科目开始学习</div>
        </div>
        <div class="subject-row" id="st-subject-row">
            ${subjectChips}
        </div>
        <div class="quick-time-row">
            <button class="quick-time-btn pomodoro" data-min="25">🍅 25分钟</button>
            <button class="quick-time-btn" data-min="15">15分钟</button>
            <button class="quick-time-btn" data-min="30">30分钟</button>
            <button class="quick-time-btn" data-min="45">45分钟</button>
            <button class="quick-time-btn" data-min="60">60分钟</button>
        </div>
        <div class="action-row" id="st-action-row">
            <button class="btn btn-forward" id="st-btn-forward">▶ 正计时</button>
            <button class="btn btn-start" id="st-btn-start" style="display:none;">▶ 开始</button>
            <button class="btn btn-pause" id="st-btn-pause" style="display:none;">⏸ 暂停</button>
            <button class="btn btn-resume" id="st-btn-resume" style="display:none;">▶ 继续</button>
            <button class="btn btn-stop" id="st-btn-stop" style="display:none;">⏹ 停止</button>
            <button class="btn btn-break" id="st-btn-break" style="display:none;">☕ 休息</button>
        </div>
        <div class="bottom-toolbar">
            <button class="tool-btn" id="st-tool-stats">📊 统计</button>
            <button class="tool-btn" id="st-tool-time">🕐 当前</button>
            <button class="tool-btn" id="st-tool-settings">⚙ 设置</button>
            <button class="tool-btn" id="st-tool-ai">🤖 AI消息</button>
        </div>
    `;
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function bindPanelEvents(panel) {
    console.log('[StudyTimer] 🔗 绑定面板事件...');

    // 关闭按钮
    const closeBtn = panel.querySelector('#st-panel-close');
    if (closeBtn) {
        console.log('[StudyTimer] ✅ 找到关闭按钮，绑定 click 事件');
        closeBtn.addEventListener('click', (e) => {
            console.log('[StudyTimer] ❎ X按钮 click 事件触发');
            e.stopPropagation();
            e.preventDefault();
            closeAllPanels();
        });
        // 移动端额外绑定 touchend
        closeBtn.addEventListener('touchend', (e) => {
            console.log('[StudyTimer] ❎ X按钮 touchend 事件触发');
            e.stopPropagation();
            e.preventDefault();
            closeAllPanels();
        });
    } else {
        console.error('[StudyTimer] ❌ 关闭按钮 #st-panel-close 未找到！');
    }

    // 科目选择
    const subjectRow = panel.querySelector('#st-subject-row');
    if (subjectRow) {
        subjectRow.addEventListener('click', (e) => {
            const chip = e.target.closest('.subject-chip');
            if (!chip) return;
            console.log('[StudyTimer] 📚 选择科目:', chip.dataset.subject);
            panel.querySelectorAll('.subject-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            StudyTimer.currentSubject = chip.dataset.subject;
        });
        console.log('[StudyTimer] ✅ 科目选择事件已绑定');
    } else {
        console.error('[StudyTimer] ❌ 科目行 #st-subject-row 未找到！');
    }

    // 快捷时间按钮
    const quickRow = panel.querySelector('.quick-time-row');
    if (quickRow) {
        quickRow.addEventListener('click', (e) => {
            const btn = e.target.closest('.quick-time-btn');
            if (!btn) return;
            const minutes = parseInt(btn.dataset.min);
            console.log('[StudyTimer] ⏱ 快捷计时:', minutes, '分钟');
            if (StudyTimer.running) {
                showToast('⚠ 请先停止当前计时');
                return;
            }
            startCountdown(StudyTimer.currentSubject, minutes);
        });
        console.log('[StudyTimer] ✅ 快捷时间事件已绑定');
    } else {
        console.error('[StudyTimer] ❌ 快捷时间行未找到！');
    }

    // 正计时
    const btnForward = panel.querySelector('#st-btn-forward');
    if (btnForward) {
        btnForward.addEventListener('click', () => {
            console.log('[StudyTimer] ▶ 正计时按钮点击');
            if (StudyTimer.running) {
                showToast('⚠ 请先停止当前计时');
                return;
            }
            startStopwatch(StudyTimer.currentSubject);
        });
    }

    // 暂停
    const btnPause = panel.querySelector('#st-btn-pause');
    if (btnPause) {
        btnPause.addEventListener('click', () => { console.log('[StudyTimer] ⏸ 暂停'); pauseTimer(); });
    }

    // 继续
    const btnResume = panel.querySelector('#st-btn-resume');
    if (btnResume) {
        btnResume.addEventListener('click', () => { console.log('[StudyTimer] ▶ 继续'); resumeTimer(); });
    }

    // 停止
    const btnStop = panel.querySelector('#st-btn-stop');
    if (btnStop) {
        btnStop.addEventListener('click', () => { console.log('[StudyTimer] ⏹ 停止'); stopTimer(); });
    }

    // 休息
    const btnBreak = panel.querySelector('#st-btn-break');
    if (btnBreak) {
        btnBreak.addEventListener('click', () => {
            console.log('[StudyTimer] ☕ 休息');
            startBreak(StudyTimer.settings.shortBreakMinutes * 60, false);
        });
    }

    // 工具栏
    const toolStats = panel.querySelector('#st-tool-stats');
    if (toolStats) {
        toolStats.addEventListener('click', () => { console.log('[StudyTimer] 📊 统计按钮'); showStatsPanel(); });
    } else {
        console.error('[StudyTimer] ❌ 统计按钮 #st-tool-stats 未找到！');
    }

    const toolTime = panel.querySelector('#st-tool-time');
    if (toolTime) {
        toolTime.addEventListener('click', () => {
            const now = new Date();
            showToast(`🕐 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
        });
    }

    const toolSettings = panel.querySelector('#st-tool-settings');
    if (toolSettings) {
        toolSettings.addEventListener('click', () => { console.log('[StudyTimer] ⚙ 设置按钮'); showSettingsPanel(); });
    }

    const toolAI = panel.querySelector('#st-tool-ai');
    if (toolAI) {
        toolAI.addEventListener('click', () => { console.log('[StudyTimer] 🤖 AI消息按钮'); toggleAIMode(); });
    }

    console.log('[StudyTimer] ✅ 所有面板事件绑定完成');

    // 手柄拖拽关闭
    const handle = panel.querySelector('#st-panel-handle');
    if (handle) {
        let startY = 0;
        handle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
        });
        handle.addEventListener('touchmove', (e) => {
            const dy = e.touches[0].clientY - startY;
            if (dy > 60) {
                console.log('[StudyTimer] 👆 手柄拖拽关闭');
                closeAllPanels();
            }
        });
    }
}

function updateTimerDisplay() {
    const display = document.getElementById('st-time-display');
    const label = document.getElementById('st-time-label');
    if (!display || !label) return;

    if (StudyTimer.timerType === 'countdown') {
        display.textContent = formatTime(StudyTimer.remainingSeconds);
        display.className = 'time countdown-active';
        label.textContent = `${StudyTimer.currentSubject} · 倒计时`;
    } else if (StudyTimer.timerType === 'stopwatch') {
        display.textContent = formatTime(StudyTimer.elapsedSeconds);
        display.className = 'time stopwatch-active';
        label.textContent = `${StudyTimer.currentSubject} · 正计时`;
    } else if (StudyTimer.timerType === 'break') {
        display.textContent = formatTime(StudyTimer.remainingSeconds);
        display.className = 'time break-active';
        label.textContent = '☕ 休息中';
    } else {
        display.textContent = '00:00';
        display.className = 'time';
        label.textContent = '选择科目开始学习';
    }

    // 更新浮动按钮上的时间
    updateFloatingBtn();
}

function updateFloatingBtn() {
    const btn = document.getElementById('study-timer-floating-btn');
    if (!btn) return;
    const miniTime = btn.querySelector('.mini-time');

    if (StudyTimer.running) {
        const timeStr = StudyTimer.timerType === 'stopwatch'
            ? formatTime(StudyTimer.elapsedSeconds)
            : formatTime(StudyTimer.remainingSeconds);
        if (miniTime) miniTime.textContent = timeStr;
        btn.classList.add('running');
        btn.classList.toggle('paused', StudyTimer.paused);
    } else {
        btn.classList.remove('running', 'paused');
        if (miniTime) miniTime.textContent = '';
    }
}

function updatePanelUI() {
    const panel = document.getElementById('study-timer-panel');
    if (!panel) return;

    const btnForward = panel.querySelector('#st-btn-forward');
    const btnStart = panel.querySelector('#st-btn-start');
    const btnPause = panel.querySelector('#st-btn-pause');
    const btnResume = panel.querySelector('#st-btn-resume');
    const btnStop = panel.querySelector('#st-btn-stop');
    const btnBreak = panel.querySelector('#st-btn-break');

    // 隐藏所有操作按钮
    [btnForward, btnStart, btnPause, btnResume, btnStop, btnBreak].forEach(b => {
        if (b) b.style.display = 'none';
    });

    if (StudyTimer.running && !StudyTimer.paused) {
        // 运行中：显示暂停和停止
        if (btnPause) btnPause.style.display = '';
        if (btnStop) btnStop.style.display = '';
    } else if (StudyTimer.running && StudyTimer.paused) {
        // 已暂停：显示继续和停止
        if (btnResume) btnResume.style.display = '';
        if (btnStop) btnStop.style.display = '';
    } else {
        // 未运行：显示正计时和休息
        if (btnForward) btnForward.style.display = '';
        if (btnBreak && StudyTimer.timerType === null) btnBreak.style.display = '';
    }

    updateTimerDisplay();
}

function togglePanel() {
    console.log('[StudyTimer] 🔘 togglePanel 被调用', {
        pageX: window.event?.pageX,
        pageY: window.event?.pageY,
        clientX: window.event?.clientX,
        clientY: window.event?.clientY
    });

    const panel = document.getElementById('study-timer-panel');
    const overlay = document.getElementById('study-timer-overlay');
    const statsPanel = document.getElementById('study-timer-stats-panel');
    const settingsPanel = document.getElementById('study-timer-settings-panel');

    if (!panel) {
        console.error('[StudyTimer] ❌ togglePanel: 面板元素不存在！');
        return;
    }

    // 关闭其他面板
    if (statsPanel) statsPanel.classList.remove('visible');
    if (settingsPanel) settingsPanel.classList.remove('visible');

    const isVisible = panel.classList.contains('visible');
    console.log('[StudyTimer] 📋 面板当前状态:', isVisible ? '可见→关闭' : '隐藏→打开');
    console.log('[StudyTimer] 📋 panel.classList:', panel.className);

    if (isVisible) {
        panel.classList.remove('visible');
        if (overlay) overlay.classList.remove('visible');
        console.log('[StudyTimer] 🔒 面板已关闭');
    } else {
        panel.classList.add('visible');
        if (overlay) overlay.classList.add('visible');
        refreshSubjectChips();
        updateTimerDisplay();
        updatePanelUI();
        console.log('[StudyTimer] 🔓 面板已打开');
    }

    // 诊断：检查面板的实际可见性
    setTimeout(() => {
        const style = getComputedStyle(panel);
        const rect = panel.getBoundingClientRect();
        console.log('[StudyTimer] 🔍 面板诊断:', {
            className: panel.className,
            transform: style.transform,
            opacity: style.opacity,
            display: style.display,
            pointerEvents: style.pointerEvents,
            rect: { top: rect.top, bottom: rect.bottom, height: rect.height }
        });
    }, 50);
}

function closeAllPanels() {
    console.log('[StudyTimer] ❎ closeAllPanels 被调用');
    const panel = document.getElementById('study-timer-panel');
    const stats = document.getElementById('study-timer-stats-panel');
    const settings = document.getElementById('study-timer-settings-panel');
    const overlay = document.getElementById('study-timer-overlay');

    console.log('[StudyTimer] 关闭前状态:', {
        panel: panel?.classList.contains('visible'),
        stats: stats?.classList.contains('visible'),
        settings: settings?.classList.contains('visible'),
        overlay: overlay?.classList.contains('visible')
    });

    panel?.classList.remove('visible');
    stats?.classList.remove('visible');
    settings?.classList.remove('visible');
    overlay?.classList.remove('visible');

    console.log('[StudyTimer] ✅ 所有面板已关闭');
}

function refreshSubjectChips() {
    const row = document.getElementById('st-subject-row');
    if (!row) return;
    const subjects = StudyTimer.settings.subjects;
    row.innerHTML = subjects.map(s => 
        `<span class="subject-chip${s === StudyTimer.currentSubject ? ' selected' : ''}" data-subject="${escapeHTML(s)}">${escapeHTML(s)}</span>`
    ).join('');
}

function showStatsPanel() {
    const panel = document.getElementById('study-timer-panel');
    const statsPanel = document.getElementById('study-timer-stats-panel');
    if (!statsPanel) return;

    // 隐藏主面板
    if (panel) panel.classList.remove('visible');

    const todayKey = getTodayKey();
    const todayData = StudyTimer.dailyRecords[todayKey] || {};
    const subjects = StudyTimer.settings.subjects;
    const totalSeconds = getTodayTotalSeconds();

    let html = `<button class="panel-close-btn" onclick="document.getElementById('study-timer-stats-panel').classList.remove('visible');document.getElementById('study-timer-overlay').classList.remove('visible');">✕</button><div class="stats-title">📊 今日学习统计</div>`;

    for (const subject of subjects) {
        const secs = todayData[subject] || 0;
        const goalMins = StudyTimer.settings.dailyGoals[subject] || 0;
        const pct = goalMins > 0 ? Math.min(100, (secs / (goalMins * 60)) * 100) : 0;
        html += `
            <div class="stat-row">
                <span class="stat-subject">${escapeHTML(subject)}</span>
                <span class="stat-time">${formatTime(secs)}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width:${pct}%"></div>
            </div>
            ${goalMins > 0 ? `<div class="goal-indicator">目标 ${goalMins}分钟 · ${pct.toFixed(0)}%</div>` : ''}
        `;
    }

    html += `
        <div class="stat-row total-row">
            <span>总计</span>
            <span>${formatTime(totalSeconds)} (${formatHours(totalSeconds)}小时)</span>
        </div>
        <div class="stat-row" style="font-size:12px;color:#a89888;">
            <span>番茄数</span>
            <span>${StudyTimer.pomodoroCount} 🍅</span>
        </div>
    `;

    // 本周统计
    const { weekKeys, stats: weekStats } = getWeeklyStats();
    let weekTotal = 0;
    for (const key of weekKeys) {
        weekTotal += Object.values(weekStats[key] || {}).reduce((s, v) => s + v, 0);
    }
    html += `
        <div class="stat-row total-row" style="border-top:2px solid #a0aec0;">
            <span>📅 本周总计</span>
            <span>${formatTime(weekTotal)} (${formatHours(weekTotal)}小时)</span>
        </div>
    `;

    html += `<button class="close-btn" onclick="document.getElementById('study-timer-stats-panel').classList.remove('visible');document.getElementById('study-timer-overlay').classList.remove('visible');">关闭</button>`;

    statsPanel.innerHTML = html;
    statsPanel.classList.add('visible');
    document.getElementById('study-timer-overlay')?.classList.add('visible');
}

function showSettingsPanel() {
    const panel = document.getElementById('study-timer-panel');
    const settingsPanel = document.getElementById('study-timer-settings-panel');
    if (!settingsPanel) return;

    if (panel) panel.classList.remove('visible');

    const s = StudyTimer.settings;
    let html = `
        <button class="panel-close-btn" onclick="document.getElementById('study-timer-settings-panel').classList.remove('visible');document.getElementById('study-timer-overlay').classList.remove('visible');">✕</button>
        <div class="settings-title">⚙ 计时器设置</div>
        <div class="setting-item">
            <span>番茄钟时长 (分钟)</span>
            <input type="number" id="st-set-default-min" value="${s.defaultMinutes}" min="1" max="120">
        </div>
        <div class="setting-item">
            <span>短休息时长 (分钟)</span>
            <input type="number" id="st-set-short-break" value="${s.shortBreakMinutes}" min="1" max="30">
        </div>
        <div class="setting-item">
            <span>长休息时长 (分钟)</span>
            <input type="number" id="st-set-long-break" value="${s.longBreakMinutes}" min="5" max="60">
        </div>
        <div class="setting-item">
            <span>长休息间隔 (番茄数)</span>
            <input type="number" id="st-set-long-interval" value="${s.longBreakInterval}" min="2" max="10">
        </div>
        <div class="setting-item">
            <span>科目列表 (逗号分隔)</span>
            <input type="text" id="st-set-subjects" value="${escapeHTML(s.subjects.join(','))}" style="width:150px;">
        </div>
        <div class="setting-item">
            <span>科目每日目标 (如: 数学=60,英语=30)</span>
            <input type="text" id="st-set-goals" value="${escapeHTML(Object.entries(s.dailyGoals || {}).map(([k,v]) => `${k}=${v}`).join(','))}" style="width:180px;">
        </div>
        <div class="setting-item">
            <span>AI 角色互动</span>
            <div class="toggle-switch ${s.aiInteractionEnabled ? 'on' : ''}" id="st-set-ai-enabled"></div>
        </div>
        <div class="setting-item">
            <span>AI 消息模式</span>
            <select id="st-set-ai-mode">
                <option value="auto" ${s.aiMessageMode === 'auto' ? 'selected' : ''}>自动 (AI生成)</option>
                <option value="template" ${s.aiMessageMode === 'template' ? 'selected' : ''}>固定模板</option>
                <option value="off" ${s.aiMessageMode === 'off' ? 'selected' : ''}>关闭</option>
            </select>
        </div>
        <div class="setting-item">
            <span>自动开始休息</span>
            <div class="toggle-switch ${s.autoStartBreak ? 'on' : ''}" id="st-set-auto-break"></div>
        </div>
        <div class="setting-item">
            <span>提示音量</span>
            <input type="number" id="st-set-volume" value="${s.alertVolume}" min="0" max="1" step="0.1">
        </div>
        <div class="btn-row">
            <button class="cancel-btn" id="st-settings-cancel">取消</button>
            <button class="save-btn" id="st-settings-save">💾 保存</button>
        </div>
    `;

    settingsPanel.innerHTML = html;
    settingsPanel.classList.add('visible');
    document.getElementById('study-timer-overlay')?.classList.add('visible');

    // 切换开关
    settingsPanel.querySelector('#st-set-ai-enabled').addEventListener('click', function () {
        this.classList.toggle('on');
    });
    settingsPanel.querySelector('#st-set-auto-break').addEventListener('click', function () {
        this.classList.toggle('on');
    });

    // 保存
    settingsPanel.querySelector('#st-settings-save').addEventListener('click', () => {
        StudyTimer.settings.defaultMinutes = parseInt(document.getElementById('st-set-default-min').value) || 25;
        StudyTimer.settings.shortBreakMinutes = parseInt(document.getElementById('st-set-short-break').value) || 5;
        StudyTimer.settings.longBreakMinutes = parseInt(document.getElementById('st-set-long-break').value) || 15;
        StudyTimer.settings.longBreakInterval = parseInt(document.getElementById('st-set-long-interval').value) || 4;
        StudyTimer.settings.alertVolume = parseFloat(document.getElementById('st-set-volume').value) || 0.7;
        StudyTimer.settings.aiInteractionEnabled = document.getElementById('st-set-ai-enabled').classList.contains('on');
        StudyTimer.settings.aiMessageMode = document.getElementById('st-set-ai-mode').value;
        StudyTimer.settings.autoStartBreak = document.getElementById('st-set-auto-break').classList.contains('on');

        // 科目列表
        const subsStr = document.getElementById('st-set-subjects').value;
        StudyTimer.settings.subjects = subsStr.split(',').map(s => s.trim()).filter(Boolean);
        if (StudyTimer.settings.subjects.length === 0) {
            StudyTimer.settings.subjects = [...STUDY_TIMER_DEFAULTS.subjects];
        }

        // 每日目标
        const goalsStr = document.getElementById('st-set-goals').value;
        StudyTimer.settings.dailyGoals = {};
        goalsStr.split(',').forEach(part => {
            const [subj, mins] = part.split('=').map(s => s.trim());
            if (subj && mins && !isNaN(parseInt(mins))) {
                StudyTimer.settings.dailyGoals[subj] = parseInt(mins);
            }
        });

        saveSettings();
        refreshSubjectChips();
        settingsPanel.classList.remove('visible');
        document.getElementById('study-timer-overlay')?.classList.remove('visible');
        showToast('✅ 设置已保存');
    });

    // 取消
    settingsPanel.querySelector('#st-settings-cancel').addEventListener('click', () => {
        settingsPanel.classList.remove('visible');
        document.getElementById('study-timer-overlay')?.classList.remove('visible');
    });
}

function toggleAIMode() {
    const modes = ['auto', 'template', 'off'];
    const labels = { auto: 'AI自动', template: '固定模板', off: '已关闭' };
    const idx = modes.indexOf(StudyTimer.settings.aiMessageMode);
    const next = modes[(idx + 1) % modes.length];
    StudyTimer.settings.aiMessageMode = next;
    StudyTimer.settings.aiInteractionEnabled = next !== 'off';
    saveSettings();
    showToast(`🤖 AI消息: ${labels[next]}`);
}

// ============ 斜杠命令注册 ============

function registerSlashCommands() {
    const ctx = getContext();
    if (!ctx || !ctx.registerSlashCommand) return;

    // 修补：新版 ST 的 registerSlashCommand 需要 aliases 参数（数组），
    // 否则 SlashCommandParser 展开 undefined 会报 "not iterable" 错误
    const origRegister = ctx.registerSlashCommand.bind(ctx);
    ctx.registerSlashCommand = (name, cb, aliases, help) =>
        origRegister(name, cb, aliases ?? [], help ?? '');

    // /study 科目 分钟数
    ctx.registerSlashCommand('study', (args) => {
        const argStr = typeof args === 'string' ? args : '';
        const parts = argStr.trim().split(/\s+/);
        
        if (parts.length === 0 || !parts[0]) {
            sendSystemMessage('用法: /study 科目 分钟数  例如: /study 数学 25');
            return;
        }

        const subject = parts[0];
        let minutes = StudyTimer.settings.defaultMinutes;

        if (parts.length >= 2 && !isNaN(parseInt(parts[1]))) {
            minutes = Math.max(1, Math.min(180, parseInt(parts[1])));
        }

        if (StudyTimer.running) {
            sendSystemMessage('⚠ 当前有计时器正在运行，请先停止。');
            return;
        }

        // 检查科目是否在列表中，不在则临时添加
        if (!StudyTimer.settings.subjects.includes(subject)) {
            StudyTimer.settings.subjects.push(subject);
            saveSettings();
        }

        StudyTimer.currentSubject = subject;
        startCountdown(subject, minutes);
        sendSystemMessage(`🍅 开始 ${subject} 学习，倒计时 ${minutes} 分钟！`);
    });

    // /study-forward 科目
    ctx.registerSlashCommand('study-forward', (args) => {
        const subject = (typeof args === 'string' ? args : '').trim() || '其他';
        if (StudyTimer.running) {
            sendSystemMessage('⚠ 当前有计时器正在运行，请先停止。');
            return;
        }
        if (!StudyTimer.settings.subjects.includes(subject)) {
            StudyTimer.settings.subjects.push(subject);
            saveSettings();
        }
        StudyTimer.currentSubject = subject;
        startStopwatch(subject);
        sendSystemMessage(`▶ ${subject} 正计时开始！`);
    });

    // /timer-stop
    ctx.registerSlashCommand('timer-stop', () => {
        if (!StudyTimer.running) {
            sendSystemMessage('⏹ 当前没有运行中的计时器。');
            return;
        }
        const duration = StudyTimer.timerType === 'stopwatch'
            ? formatTime(StudyTimer.elapsedSeconds)
            : formatTime(StudyTimer.remainingSeconds);
        const subject = StudyTimer.currentSubject;
        stopTimer();
        sendSystemMessage(`⏹ 已停止 ${subject} 计时 (${duration})`);
    });

    // /timer-pause
    ctx.registerSlashCommand('timer-pause', () => {
        if (!StudyTimer.running || StudyTimer.paused) {
            sendSystemMessage('⏸ 计时器未在运行中或已暂停。');
            return;
        }
        pauseTimer();
        sendSystemMessage('⏸ 计时器已暂停');
    });

    // /timer-resume
    ctx.registerSlashCommand('timer-resume', () => {
        if (!StudyTimer.running || !StudyTimer.paused) {
            sendSystemMessage('▶ 计时器未暂停。');
            return;
        }
        resumeTimer();
        sendSystemMessage('▶ 计时器已恢复');
    });

    // /timer-status
    ctx.registerSlashCommand('timer-status', () => {
        if (!StudyTimer.running) {
            sendSystemMessage('🍅 番茄计时器空闲中。');
            return;
        }
        const status = StudyTimer.paused ? '⏸ 已暂停' : '▶ 运行中';
        const type = StudyTimer.timerType === 'countdown' ? '倒计时' :
                     StudyTimer.timerType === 'stopwatch' ? '正计时' : '休息';
        const time = StudyTimer.timerType === 'stopwatch'
            ? formatTime(StudyTimer.elapsedSeconds)
            : formatTime(StudyTimer.remainingSeconds);
        sendSystemMessage(
            `${status} | ${type} | 科目: ${StudyTimer.currentSubject} | 时间: ${time} | 番茄: ${StudyTimer.pomodoroCount}🍅`
        );
    });

    // /study-stats
    ctx.registerSlashCommand('study-stats', () => {
        const todayKey = getTodayKey();
        const todayData = StudyTimer.dailyRecords[todayKey] || {};
        const totalSeconds = getTodayTotalSeconds();
        
        let msg = `📊 今日学习统计 (${todayKey})\n`;
        for (const [subject, secs] of Object.entries(todayData)) {
            msg += `  ${subject}: ${formatTime(secs)}\n`;
        }
        msg += `总计: ${formatTime(totalSeconds)} (${formatHours(totalSeconds)}小时)\n`;
        msg += `🍅 番茄数: ${StudyTimer.pomodoroCount}`;
        sendSystemMessage(msg);
    });

    // /study-now
    ctx.registerSlashCommand('study-now', () => {
        const now = new Date();
        const todayKey = getTodayKey();
        const totalSeconds = getTodayTotalSeconds();
        sendSystemMessage(
            `🕐 当前时间: ${now.toLocaleTimeString('zh-CN')}\n` +
            `📅 ${todayKey} | 今日学习: ${formatTime(totalSeconds)} (${formatHours(totalSeconds)}小时) | 🍅 ${StudyTimer.pomodoroCount}`
        );
    });

    // /study-subjects
    ctx.registerSlashCommand('study-subjects', () => {
        const subs = StudyTimer.settings.subjects.join(', ');
        sendSystemMessage(`📚 当前科目: ${subs}`);
    });

    // /study-add-subject 科目名
    ctx.registerSlashCommand('study-add-subject', (args) => {
        const subject = (typeof args === 'string' ? args : '').trim();
        if (!subject) {
            sendSystemMessage('用法: /study-add-subject 科目名');
            return;
        }
        if (StudyTimer.settings.subjects.includes(subject)) {
            sendSystemMessage(`📚 "${subject}" 已存在。`);
            return;
        }
        StudyTimer.settings.subjects.push(subject);
        saveSettings();
        refreshSubjectChips();
        sendSystemMessage(`✅ 已添加科目: ${subject}`);
    });

    // /study-remove-subject 科目名
    ctx.registerSlashCommand('study-remove-subject', (args) => {
        const subject = (typeof args === 'string' ? args : '').trim();
        if (!subject) {
            sendSystemMessage('用法: /study-remove-subject 科目名');
            return;
        }
        const idx = StudyTimer.settings.subjects.indexOf(subject);
        if (idx === -1) {
            sendSystemMessage(`❌ 未找到科目: ${subject}`);
            return;
        }
        StudyTimer.settings.subjects.splice(idx, 1);
        saveSettings();
        refreshSubjectChips();
        sendSystemMessage(`🗑 已删除科目: ${subject}`);
    });
}

// ============ 初始化 ============

/** 检查 ST 是否已就绪 */
function isSTReady() {
    if (!document.body) return false;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const ctx = SillyTavern.getContext();
        if (ctx && ctx.characters !== undefined) return true;
    }
    return document.body.children.length > 0;
}

function init() {
    if (StudyTimer.initialized) {
        console.log('[StudyTimer] ⚠ 已初始化，跳过');
        return;
    }

    console.log('[StudyTimer] 🚀 开始初始化...', {
        hasBody: !!document.body,
        hasST: typeof SillyTavern !== 'undefined',
        readyState: document.readyState,
        ua: navigator.userAgent.substring(0, 50)
    });

    if (!isSTReady()) {
        console.warn('[StudyTimer] ⏳ ST 尚未就绪，延迟重试...');
        setTimeout(init, 500);
        return;
    }

    try {
        loadSettings();
        loadDailyRecords();
        console.log('[StudyTimer] 📦 数据加载完成', StudyTimer.settings.subjects);

        createStyles();
        createUI();

        // 恢复计时器状态
        loadTimerState();

        // 设置初始科目选择
        setTimeout(() => {
            refreshSubjectChips();
            updateTimerDisplay();
            updatePanelUI();
            // 🔥 测试：面板初始直接展开，绕过悬浮球
            document.getElementById('study-timer-panel')?.classList.add('visible');
            document.getElementById('study-timer-overlay')?.classList.add('visible');
            console.log('[StudyTimer] 🎨 UI 刷新完成，面板已展开');
        }, 200);

        // 注册命令
        try {
            registerSlashCommands();
            console.log('[StudyTimer] 💬 斜杠命令注册完成');
        } catch (e) {
            console.warn('[StudyTimer] 斜杠命令注册失败，2秒后重试', e);
            setTimeout(() => {
                try { registerSlashCommands(); console.log('[StudyTimer] 💬 斜杠命令重试成功'); } catch (e2) {
                    console.error('[StudyTimer] ❌ 斜杠命令注册最终失败', e2);
                }
            }, 2000);
        }

        // 页面关闭前保存
        window.addEventListener('beforeunload', () => {
            saveTimerState();
            saveDailyRecords();
            saveSettings();
        });

        // 定期自动保存（每30秒）
        setInterval(() => {
            if (StudyTimer.running) saveTimerState();
        }, 30000);

        StudyTimer.initialized = true;
        console.log('🍅 番茄学习计时器已就绪 (Mobile-First v1.0.1)');

    } catch (err) {
        console.error('[StudyTimer] ❌ 初始化失败:', err);
        setTimeout(init, 5000);
    }
}

// ============ 导出 API（供其他扩展或工具调用）============
if (typeof window !== 'undefined') {
    window.StudyTimerAPI = {
        startCountdown,
        startStopwatch,
        pauseTimer,
        resumeTimer,
        stopTimer,
        getStatus: () => ({
            running: StudyTimer.running,
            paused: StudyTimer.paused,
            timerType: StudyTimer.timerType,
            remainingSeconds: StudyTimer.remainingSeconds,
            elapsedSeconds: StudyTimer.elapsedSeconds,
            totalDuration: StudyTimer.totalDuration,
            currentSubject: StudyTimer.currentSubject,
            pomodoroCount: StudyTimer.pomodoroCount
        }),
        getTodayStats: () => {
            const key = getTodayKey();
            return {
                date: key,
                records: StudyTimer.dailyRecords[key] || {},
                totalSeconds: getTodayTotalSeconds(),
                pomodoroCount: StudyTimer.pomodoroCount
            };
        },
        getWeeklyStats,
        getSubjects: () => [...StudyTimer.settings.subjects],
        addSubject: (s) => {
            if (!StudyTimer.settings.subjects.includes(s)) {
                StudyTimer.settings.subjects.push(s);
                saveSettings();
                refreshSubjectChips();
            }
        }
    };
}

// ============ 启动（带多重保障） ============
(function boot() {
    console.log('[StudyTimer] 📋 脚本加载... readyState=' + document.readyState);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[StudyTimer] 📋 DOMContentLoaded 触发');
            setTimeout(init, 300);
        });
    } else {
        setTimeout(init, 300);
    }

    // 兜底：3秒后无论如何再试
    setTimeout(() => {
        if (!StudyTimer.initialized) {
            console.warn('[StudyTimer] 🔄 兜底重试...');
            init();
        }
    }, 3000);
})();
