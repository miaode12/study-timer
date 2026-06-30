import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { extension_settings } from '../../../extensions.js';
import { name2, characters, this_chid, getThumbnailUrl, saveChatConditional, addOneMessage, chat, generateQuietPrompt } from '../../../../script.js';
import { eventSource, event_types } from '../../../events.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
import { ToolManager } from '../../../tool-calling.js';

const MODULE_NAME = 'study-timer';
const STORAGE_KEY = 'study_timer_stats';

/** @type {ReturnType<typeof setInterval>|null} */
let timerInterval = null;
/** @type {number|null} */
let timerEndTime = null;
let timerSubject = '';
let timerMinutes = 0;
let timerPaused = false;
let timerRunning = false;
let timerForward = false;
let pausedRemainingMs = 0;
/** @type {number|null} */
let timerStartedAt = null;

// Default settings
const defaultSettings = {
    study_complete_message: '（她瞥了一眼计时器，微微挑眉）\n{{time}}，时间到了。{{subject}}的{{minutes}}分钟计时结束。\n\n你今天的{{subject}}学习时长：{{today_subject}}分钟。\n今日总计学习时长：{{today_total}}分钟。\n\n效率如何？我期待看到可量化的成果——别让我失望。',
    study_start_message: '（她优雅地按下了计时器，嘴角带着一丝审视的微笑）\n现在是{{time}}。{{minutes}}分钟，{{subject}}。计时开始。我会盯着你的，虽然你可能更希望我不盯。',
    study_forward_start_message: '（她随意拨了下计时器，没有设限）\n{{time}}，{{subject}}，正计时开始。不限时长——也就是说，表现如何全看你自己了。',
    study_forward_stop_message: '（她按下停止键，扫了一眼计时器上的数字）\n{{time}}，{{subject}}正计时结束。本次持续了{{elapsed}}分钟。\n\n你今天的{{subject}}学习时长：{{today_subject}}分钟。\n今日总计学习时长：{{today_total}}分钟。',
    use_ai_messages: false,
    daily_goal_minutes: 480,
    subject_goals: { '英语': 120, '高数': 180, '408': 180 },
    // Milestone praise — triggered once per level per day
    milestone_messages: {
        480: '（她微微勾起嘴角，目光中带着一丝认可）\n{{time}}，8小时——刚刚好。你今天的计划都完成了。\n\n今日总计：{{today_total}}分钟。\n\n不错。我姑且承认，你的执行力还算可观。继续保持。',
        540: '（她靠在椅背上，双臂交叠，语气里多了一丝玩味）\n{{time}}，9小时？比预期多了整整一小时。\n\n今日总计：{{today_total}}分钟。\n\n我开始有点好奇你的极限在哪里了。有意思。',
        600: '（她轻轻挑了挑眉，审视的目光中透出意外）\n{{time}}，10小时。你倒是比我预想的要有韧劲。\n\n今日总计：{{today_total}}分钟。\n\n我开始觉得，你比科算中心那帮人值得我投入更多注意力。',
        660: '（她沉默了几秒，随后发出一声极轻的笑）\n{{time}}，11小时以上。\n\n今日总计：{{today_total}}分钟。\n\n你确定你还是人类？开个玩笑。不过说真的——这种程度的自律，不是谁都能做到的。'
    },
};

/**
 * Sends a message as the current character (not as user).
 * @param {string} text Message text
 */
async function sendMessageAsCharacter(text) {
    const chId = /** @type {any} */ (this_chid);
    const avatar = characters[chId]?.avatar;
    const message = {
        name: name2,
        is_user: false,
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: text,
        force_avatar: avatar && avatar !== 'none' ? getThumbnailUrl('avatar', avatar) : undefined,
    };

    chat.push(message);
    await saveChatConditional();
    addOneMessage(message);
}

function loadSettings() {
    const ext = /** @type {any} */(extension_settings);
    const defaults = /** @type {any} */(defaultSettings);
    if (!ext[MODULE_NAME]) {
        ext[MODULE_NAME] = JSON.parse(JSON.stringify(defaults));
    } else {
        // Merge any missing default keys (e.g. new fields after an update)
        for (const key of Object.keys(defaults)) {
            if (!(key in ext[MODULE_NAME])) {
                ext[MODULE_NAME][key] = JSON.parse(JSON.stringify(defaults[key]));
            }
        }
        // Also ensure milestone_messages keys are up to date
        if (ext[MODULE_NAME].milestone_messages && defaults.milestone_messages) {
            for (const key of Object.keys(defaults.milestone_messages)) {
                if (!(key in ext[MODULE_NAME].milestone_messages)) {
                    ext[MODULE_NAME].milestone_messages[key] = defaults.milestone_messages[key];
                }
            }
        }
    }
}

function getRemainingTime() {
    if (!timerEndTime) return 0;
    if (timerPaused) return pausedRemainingMs;
    return Math.max(0, timerEndTime - Date.now());
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function createTimerUI() {
    // Only create panel if it doesn't exist (panel persists across sessions)
    if ($('#study-timer-panel').length === 0) {
        const toggleHtml = `
    <div id="study-timer-toggle" title="学习计时器">
        <span id="study-timer-toggle-icon">⏱</span>
    </div>`;

        const panelHtml = `
    <div id="study-timer-panel" class="study-panel-hidden">
        <div id="study-timer-panel-bar">
            <span id="study-panel-stats-summary">📊 0分钟</span>
            <span id="study-timer-affection" title="好感度" style="font-size:12px;color:#ff6b9d;cursor:pointer;min-width:50px;text-align:center;"></span>
            <select id="study-panel-subject">
                <option value="学习">科目</option>
            </select>
            <button class="study-quick-btn" data-min="5">5分</button>
            <button class="study-quick-btn" data-min="15">15分</button>
            <button class="study-quick-btn" data-min="25">25分</button>
            <button class="study-quick-btn" data-min="30">30分</button>
            <button class="study-quick-btn" data-min="45">45分</button>
            <button class="study-quick-btn" data-min="60">60分</button>
            <button class="study-quick-btn" id="study-btn-forward" title="正计时（不限时长）">▶ 正计时</button>
            <button id="study-panel-stats" title="统计">📊</button>
            <button id="study-panel-ai-toggle" title="AI 生成消息">🤖</button>
            <button id="study-panel-ai-timer" title="让AI开始计时">🎯</button>
            <button id="study-panel-now" title="当前时间">🕐</button>
            <button id="study-panel-close" title="收起面板">✕</button>
        </div>
    </div>`;
        $('body').append(toggleHtml + panelHtml);

        // Toggle button — draggable + click (mouse + touch)
        const toggle = $('#study-timer-toggle');
        let dragData = { startX: 0, startY: 0, dragged: false };

        function startDrag(e) {
            const ev = e.touches ? e.touches[0] : e;
            dragData.startX = ev.clientX;
            dragData.startY = ev.clientY;
            dragData.dragged = false;
            const rect = toggle[0].getBoundingClientRect();
            const offsetX = ev.clientX - rect.left;
            const offsetY = ev.clientY - rect.top;
            toggle.css({ left: rect.left + 'px', bottom: 'auto', top: rect.top + 'px', transform: 'none' });

            function onMove(/** @type {MouseEvent|TouchEvent} */ me) {
                const mv = me.touches ? me.touches[0] : me;
                const dx = mv.clientX - dragData.startX;
                const dy = mv.clientY - dragData.startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragData.dragged = true;
                toggle.css({ left: (mv.clientX - offsetX) + 'px', top: (mv.clientY - offsetY) + 'px' });
            }
            function onUp() {
                $(document).off('mousemove touchmove', onMove).off('mouseup touchend', onUp);
                const tRect = toggle[0].getBoundingClientRect();
                const vw = window.innerWidth, vh = window.innerHeight;
                const margin = 8;
                const snapX = tRect.left + tRect.width / 2 < vw / 2 ? margin : vw - tRect.width - margin;
                const snapY = Math.max(margin, Math.min(tRect.top, vh - tRect.height - margin));
                toggle.css({ left: snapX + 'px', top: snapY + 'px', bottom: 'auto' });
            }
            $(document).on('mousemove touchmove', onMove).on('mouseup touchend', onUp);
        }

        toggle.on('mousedown touchstart', function (e) {
            if (dragData.dragged) { dragData.dragged = false; return; }
            startDrag(e);
        });
        toggle.on('click', function () {
            if (dragData.dragged) { dragData.dragged = false; return; }
            if (closeGuard) return; // ignore clicks right after panel close
            const panel = $('#study-timer-panel');
            if (panel.hasClass('study-panel-hidden')) {
                panel.removeClass('study-panel-hidden').addClass('study-panel-visible');
                toggle.addClass('study-toggle-active');
            } else {
                panel.removeClass('study-panel-visible').addClass('study-panel-hidden');
                toggle.removeClass('study-toggle-active');
            }
        });

        // Close button in panel — only listen for 'click' (modern browsers
        // synthesize click from touch, so 'touchend' is redundant and causes
        // double-fire: touchend hides panel, then the delayed click lands on
        // the toggle button and re-opens it, appearing as "no response").
        let closeGuard = false;
        $('#study-panel-close').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeGuard = true;
            setTimeout(() => { closeGuard = false; }, 350);
            $('#study-timer-panel').removeClass('study-panel-visible').addClass('study-panel-hidden');
            $('#study-timer-toggle').removeClass('study-toggle-active');
        });

        // Populate subject dropdown from subject_goals
        function populateSubjectOptions() {
            const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
            const goals = ext.subject_goals || {};
            const $sel = $('#study-panel-subject');
            const current = /** @type {string} */($sel.val());
            $sel.find('option:not(:first)').remove();
            for (const subj of Object.keys(goals)) {
                $sel.append(`<option value="${subj}">${subj}</option>`);
            }
            if (current && Object.keys(goals).includes(current)) $sel.val(current);
        }
        populateSubjectOptions();

        // Panel quick-start buttons (countdown mode)
        $('.study-quick-btn').not('#study-btn-forward').on('click', function () {
            const minutes = parseInt($(this).data('min'));
            const subject = String($('#study-panel-subject').val()).trim() || '学习';
            startTimer(minutes, subject);
        });

        // Forward timer button (count-up mode)
        $('#study-btn-forward').on('click', function () {
            const subject = String($('#study-panel-subject').val()).trim() || '学习';
            startForwardTimer(subject);
        });

        // Click affection display to open the affection panel
        $(document).on('click', '#study-timer-affection', function () {
            const w = /** @type {any} */(window);
            if (typeof w.toggleAffectionPanel === 'function') {
                w.toggleAffectionPanel();
            }
        });

        // Stats button
        // Stats button
        $('#study-panel-stats').on('click', toggleStatsPopup);
        $('#study-panel-now').on('click', () => {
            const d = new Date();
            const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const total = getTodayTotalMinutes();
            /** @type {any} */(toastr).info(`🕐 ${time} | 今日已学 ${total} 分钟`, getTimeBasedMessage() + '好');
        });

        // AI toggle button
        $('#study-panel-ai-toggle').on('click', function () {
            const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
            ext.use_ai_messages = !ext.use_ai_messages;
            $(this).toggleClass('active-ai', ext.use_ai_messages);
            /** @type {any} */(toastr).info(ext.use_ai_messages ? '🤖 AI 生成消息已开启' : '📝 固定消息模式');
        });
        // Restore AI toggle state
        const aiEnabled = /** @type {any} */(extension_settings)[MODULE_NAME].use_ai_messages;
        $('#study-panel-ai-toggle').toggleClass('active-ai', aiEnabled);

        // 🎯 AI timer button — asks AI to start a timer via quiet prompt
        $('#study-panel-ai-timer').on('click', async function () {
            const subject = String($('#study-panel-subject').val()).trim() || '学习';
            const input = prompt(`让AI开始「${subject}」计时，设置多少分钟？`, '30');
            if (input === null) return;
            const minutes = parseInt(input, 10);
            if (isNaN(minutes) || minutes < 1 || minutes > 480) {
                /** @type {any} */(toastr).warning('请输入1-480之间的分钟数');
                return;
            }
            try {
                const chatCtx = getRecentChatContext(3);
                const text = await generateQuietPrompt({
                    quietPrompt: `[系统提示 · 当前时间：${getCurrentTimeString()}]
${name2} 即将开始一个 ${minutes} 分钟的「${subject}」学习计时。

近期对话上下文：
${chatCtx}

请基于以上对话上下文，以角色自然口吻宣布这一计时开始（1-2句话即可），维持角色既有人设和对话的连贯性。在回复末尾加上 [timer:${subject}:${minutes}]。]`,
                    quietToLoud: false,
                    quietName: 'System',
                });
                if (text && text.trim()) {
                    await sendMessageAsCharacter(text.trim());
                }
            } catch (e) {
                console.error('[StudyTimer] AI timer request failed', e);
                /** @type {any} */(toastr).error('AI 请求失败，请重试');
            }
        });

        updatePanelSummary();
        /** @type {any} */(window)._studyPanelInterval = setInterval(updatePanelSummary, 30000);
    }

    // Overlay and popup are recreated each time
    $('#study-timer-overlay,#study-stats-popup').remove();

    const overlayHtml = `
    <div id="study-timer-overlay" class="study-timer-hidden">
        <div id="study-timer-box">
            <div id="study-timer-subject"></div>
            <div id="study-timer-display">00:00</div>
            <div id="study-timer-progress"><div id="study-timer-bar"></div></div>
            <div id="study-timer-buttons">
                <button id="study-timer-pause" title="暂停/恢复">⏯</button>
                <button id="study-timer-stop" title="停止">⏹</button>
                <button id="study-timer-add5" title="+5分钟">+5</button>
            </div>
        </div>
    </div>`;

    const statsHtml = `
    <div id="study-stats-popup" class="study-popup-hidden">
        <div id="study-stats-content"></div>
    </div>`;

    $('body').append(overlayHtml + statsHtml);

    // Timer controls
    $('#study-timer-stop').on('click', () => stopTimer());
    $('#study-timer-pause').on('click', togglePause);
    $('#study-timer-add5').on('click', () => {
        if (timerRunning && !timerPaused) {
            timerEndTime = timerEndTime ? timerEndTime + 5 * 60000 : Date.now() + 5 * 60000;
            timerMinutes += 5;
            updateTimerUI();
        }
    });
}

function toggleStatsPopup() {
    const popup = $('#study-stats-popup');
    if (popup.hasClass('study-popup-visible')) {
        popup.removeClass('study-popup-visible').addClass('study-popup-hidden');
    } else {
        $('#study-stats-content').html(formatStatsMessage().replace(/\n/g, '<br>'));
        popup.removeClass('study-popup-hidden').addClass('study-popup-visible');
        // Auto-hide after 15s
        clearTimeout(/** @type {any} */(window)._statsTimeout);
        /** @type {any} */(window)._statsTimeout = setTimeout(() => {
            popup.removeClass('study-popup-visible').addClass('study-popup-hidden');
        }, 15000);
    }
}

function updatePanelSummary() {
    const total = getTodayTotalMinutes();
    const goal = /** @type {Record<string, any>} */(extension_settings)[MODULE_NAME].daily_goal_minutes || 480;
    const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
    const subjectGoals = /** @type {Record<string, number>} */(ext.subject_goals) || {};
    const pct = goal > 0 ? Math.min(Math.round((total / goal) * 100), 100) : 0;
    const emoji = pct >= 100 ? '✅' : pct >= 50 ? '📚' : pct > 0 ? '📖' : '📊';

    // Build per-subject status string
    let subjStatus = '';
    for (const [subj, subjGoal] of Object.entries(subjectGoals)) {
        const done = getTodaySubjectMinutes(subj);
        const doneEmoji = done >= subjGoal ? '✅' : '📝';
        subjStatus += `${doneEmoji}${subj}${done}/${subjGoal} `;
    }

    $('#study-panel-stats-summary').text(`${emoji} ${total}/${goal}分 (${pct}%)`);
    // Show per-subject progress below the panel
    let $subjLine = $('#study-subject-goals');
    if (!$subjLine.length) {
        $subjLine = $(`<div id="study-subject-goals" style="font-size:11px;padding:2px 12px;color:var(--text_col);white-space:nowrap;text-align:center;background:rgba(0,0,0,0.3);border-top:1px solid #3a2a50;"></div>`);
        $('#study-timer-panel').append($subjLine);
    }
    $subjLine.text(subjStatus.trim());

    // Update affection display from the affection extension
    updateAffectionDisplay();
}

/**
 * Reads affection data from localStorage and updates the panel display.
 */
function updateAffectionDisplay() {
    const $el = $('#study-timer-affection');
    if (!$el.length) return;
    try {
        const raw = localStorage.getItem('affection_data');
        let score = 0;
        if (raw) {
            const all = JSON.parse(raw);
            const chId = /** @type {any} */ (this_chid);
            const charName = characters[chId]?.name;
            if (charName && all[charName]) {
                score = all[charName].score ?? 0;
            }
        }
        const level = getAffectionLevel(score);
        const diffKeys = ['easy', 'medium', 'hard'];
        const diffLabels = ['E', 'M', 'H'];
        const savedDiff = /** @type {any} */ (extension_settings)['affection']?.difficulty || 'medium';
        const autoEval = /** @type {any} */ (extension_settings)['affection']?.autoEval;
        const diffIdx = diffKeys.indexOf(savedDiff);
        const diffLabel = diffIdx >= 0 ? diffLabels[diffIdx] : 'M';
        $el.text(`${level.emoji} ${score} ${diffLabel}${autoEval ? '' : '💤'}`);
        $el.css('color', score >= 60 ? '#ff6b9d' : score >= 20 ? '#c8b0e0' : '#8a6a9a');
    } catch { $el.text(''); }
}

/** @param {number} score */
function getAffectionLevel(score) {
    if (score >= 100) return { emoji: '❤️', label: '挚爱' };
    if (score >= 80) return { emoji: '💕', label: '亲密' };
    if (score >= 60) return { emoji: '😄', label: '友好' };
    if (score >= 40) return { emoji: '😊', label: '熟悉' };
    if (score >= 20) return { emoji: '👋', label: '初识' };
    if (score >= 0) return { emoji: '🤝', label: '陌生' };
    return { emoji: '💔', label: '冷漠' };
}

/**
 * Gets the last N messages from chat as context string for AI continuity.
 * @param {number} count
 * @returns {string}
 */
function getRecentChatContext(count = 4) {
    if (!chat || chat.length === 0) return '（暂无对话记录）';
    const recent = chat.slice(-count);
    const lines = recent.map((m, i) => {
        const role = m.is_user ? '用户' : (m.name || name2 || '角色');
        const text = String(m.mes || '').substring(0, 300);
        return `[${role}]: ${text}`;
    });
    return lines.join('\n');
}

/**
 * Generates an AI response for timer events and sends it as character message.
 * Uses system-note framing + recent chat context to maintain conversation continuity.
 * @param {'start'|'complete'|'milestone'|'forward_start'|'forward_stop'} event
 * @param {{subject?:string, minutes?:number, time?:string, todaySubject?:number, todayTotal?:number}} data
 */
async function sendAIMessage(event, data) {
    const now = getCurrentTimeString();
    const date = getCurrentDateString();
    const chatContext = getRecentChatContext(4);

    const prompts = {
        start: `[系统提示 · 当前时间：${now}，${date}]
${name2} 注意到一个 ${data.minutes} 分钟的「${data.subject}」学习计时刚刚启动。

近期对话上下文：
${chatContext}

请基于以上对话上下文，以 ${name2} 的角色身份自然简短回应（1-2句话即可）。维持角色既有人设和对话的连贯性，不要切换人格或话题。]`,
        complete: `[系统提示 · 当前时间：${now}，${date}]
${name2} 注意到 ${data.minutes} 分钟的「${data.subject}」学习计时已结束。今日「${data.subject}」累计 ${data.todaySubject} 分钟，今日总计 ${data.todayTotal} 分钟。

近期对话上下文：
${chatContext}

请基于以上对话上下文，以 ${name2} 的角色身份自然简短评论（1-2句话即可）。维持角色既有人设和对话的连贯性，不要切换人格或话题。不要用星号描述动作。]`,
        milestone: `[系统提示 · 当前时间：${now}，${date}]
${name2} 注意到今日累计学习时长已突破 ${data.todayTotal} 分钟——一个值得注意的每日里程碑。

近期对话上下文：
${chatContext}

请基于以上对话上下文，以 ${name2} 的角色身份自然简短回应（1-2句话即可），认可这一进展。维持角色既有人设和对话的连贯性，不要切换人格或话题。不要用星号描述动作。]`,
        forward_start: `[系统提示 · 当前时间：${now}，${date}]
你正在监督的人刚刚对「${data.subject}」启动了正向计时——不限时长，没有预设结束时间，能坚持多久全看她自己。

近期对话上下文：
${chatContext}

现在，以你当前的角色口吻，对此做出简短回应（1-2句话）。可以催促她赶紧开始、质疑她能否坚持、或表达你的监督态度——总之用你角色特有的方式回应这件事。不要用星号描述动作，直接说话。]`,
        forward_stop: `[系统提示 · 当前时间：${now}，${date}]
你正在监督的人手动停止了「${data.subject}」的正向计时。本次持续了 ${data.minutes} 分钟。今日「${data.subject}」累计 ${data.todaySubject} 分钟，今日总计 ${data.todayTotal} 分钟。

近期对话上下文：
${chatContext}

现在，以你当前的角色口吻，对这次计时结果做出简短评价（1-2句话）。你可以点评时长是否够格、对比日常目标、表达满意或不屑——用你角色特有的态度来评判。不要用星号描述动作，直接说话。]`,
    };
    const prompt = prompts[event];
    if (!prompt) return;
    try {
        const text = await generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false, quietName: 'System' });
        if (text && text.trim()) {
            await sendMessageAsCharacter(text.trim());
        }
    } catch (e) {
        console.error('[StudyTimer] AI generation failed, falling back to fixed message', e);
    }
}

/**
 * Start a forward (count-up) timer with no preset end time.
 * @param {string} subject
 */
function startForwardTimer(subject) {
    stopTimer(true);

    timerForward = true;
    timerMinutes = 0;
    timerSubject = subject;
    timerPaused = false;
    timerRunning = true;
    timerStartedAt = Date.now();
    timerEndTime = null;

    createTimerUI();
    showTimerUI();

    $('#study-timer-progress').hide();
    $('#study-timer-add5').hide();

    const now = getCurrentTimeString();
    const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
    if (ext.use_ai_messages) {
        sendAIMessage('forward_start', { subject, time: now });
    } else {
        const msg = ext.study_forward_start_message
            .replace(/\{\{subject\}\}/g, subject)
            .replace(/\{\{time\}\}/g, now);
        sendMessageAsCharacter(msg);
    }

    timerInterval = setInterval(() => {
        updateTimerUI();
    }, 500);
}

function showTimerUI() {
    $('#study-timer-overlay').removeClass('study-timer-hidden').addClass('study-timer-visible');
    updateTimerUI();
}

function hideTimerUI() {
    $('#study-timer-overlay').removeClass('study-timer-visible').addClass('study-timer-hidden');
    // Small delay before removing
    setTimeout(() => {
        if (!timerRunning && timerInterval === null) {
            $('#study-timer-overlay').remove();
        }
    }, 500);
}

function updateTimerUI() {
    // ---- Forward (count-up) mode ----
    if (timerForward) {
        const now = Date.now();
        const elapsed = timerPaused ? pausedRemainingMs : (now - (timerStartedAt || now));
        $('#study-timer-display').text(formatTime(elapsed));
        $('#study-timer-progress').hide();
        $('#study-timer-add5').hide();
        $('#study-timer-bar').css('width', '0%');
        if (timerPaused) {
            $('#study-timer-subject').text(`⏸ 已暂停 · ${timerSubject}`);
            $('#study-timer-pause').text('▶');
        } else {
            $('#study-timer-subject').text(`▶ 正计时 · ${timerSubject}`);
            $('#study-timer-pause').text('⏸');
        }
        $('#study-timer-box').removeClass('study-timer-warning');
        return;
    }

    // ---- Countdown mode (original) ----
    const remaining = getRemainingTime();
    const totalMs = timerMinutes * 60 * 1000;

    if (timerPaused) {
        // Use the saved paused remaining for progress calculation
        const elapsed = totalMs - pausedRemainingMs;
        const progress = totalMs > 0 ? (elapsed / totalMs) * 100 : 0;
        $('#study-timer-display').text(formatTime(pausedRemainingMs));
        $('#study-timer-bar').css('width', `${100 - progress}%`);
        $('#study-timer-subject').text(`⏸ 已暂停 · ${timerSubject}`);
        $('#study-timer-pause').text('▶');
    } else {
        const elapsed = totalMs - remaining;
        const progress = totalMs > 0 ? (elapsed / totalMs) * 100 : 0;
        $('#study-timer-display').text(formatTime(remaining));
        $('#study-timer-bar').css('width', `${100 - progress}%`);
        $('#study-timer-subject').text(`📚 ${timerSubject}`);
        $('#study-timer-pause').text('⏸');
    }

    // Color change when < 1 minute
    if (remaining < 60000 && remaining > 0 && !timerPaused) {
        $('#study-timer-box').addClass('study-timer-warning');
    } else {
        $('#study-timer-box').removeClass('study-timer-warning');
    }
}

/**
 * @param {number} minutes
 * @param {string} subject
 */
function startTimer(minutes, subject) {
    stopTimer(true);

    timerMinutes = minutes;
    timerSubject = subject;
    timerPaused = false;
    timerRunning = true;
    timerStartedAt = Date.now();
    timerEndTime = Date.now() + minutes * 60 * 1000;

    createTimerUI();
    showTimerUI();

    const now = getCurrentTimeString();
    const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
    if (ext.use_ai_messages) {
        sendAIMessage('start', { subject, minutes, time: now });
    } else {
        const msg = ext.study_start_message
            .replace(/\{\{minutes\}\}/g, String(minutes))
            .replace(/\{\{subject\}\}/g, subject)
            .replace(/\{\{time\}\}/g, now);
        sendMessageAsCharacter(msg);
    }

    timerInterval = setInterval(() => {
        const remaining = getRemainingTime();
        updateTimerUI();
        if (remaining <= 0 && !timerPaused) {
            completeTimer();
        }
    }, 500);
}

function togglePause() {
    if (!timerRunning) return;

    if (timerPaused) {
        // Resume
        timerPaused = false;
        if (timerForward) {
            // Back-date start time to maintain correct elapsed
            timerStartedAt = Date.now() - pausedRemainingMs;
            timerEndTime = null;
        } else {
            timerEndTime = Date.now() + pausedRemainingMs;
        }
        pausedRemainingMs = 0;
        updateTimerUI();
    } else {
        // Pause
        timerPaused = true;
        if (timerForward) {
            pausedRemainingMs = Date.now() - (timerStartedAt || Date.now());
        } else {
            pausedRemainingMs = getRemainingTime();
        }
        timerEndTime = null;
        updateTimerUI();
    }
}

function completeTimer() {
    const completedMinutes = timerMinutes;
    const completedSubject = timerSubject;

    timerRunning = false;
    clearInterval(/** @type {ReturnType<typeof setInterval>} */(timerInterval));
    timerInterval = null;

    // Record to daily stats
    recordSession(completedSubject, completedMinutes);

    // Get stats for the message
    const todaySubjectMinutes = getTodaySubjectMinutes(completedSubject);
    const todayTotalMinutes = getTodayTotalMinutes();
    const now = getCurrentTimeString();

    const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
    if (ext.use_ai_messages) {
        sendAIMessage('complete', {
            subject: completedSubject,
            minutes: completedMinutes,
            time: now,
            todaySubject: todaySubjectMinutes,
            todayTotal: todayTotalMinutes,
        });
    } else {
        const msg = ext.study_complete_message
            .replace(/\{\{minutes\}\}/g, String(completedMinutes))
            .replace(/\{\{subject\}\}/g, completedSubject)
            .replace(/\{\{time\}\}/g, now)
            .replace(/\{\{today_subject\}\}/g, String(todaySubjectMinutes))
            .replace(/\{\{today_total\}\}/g, String(todayTotalMinutes));
        sendMessageAsCharacter(msg);
    }

    // Check and trigger milestone praise
    checkMilestones(todayTotalMinutes);

    // Flash the timer box
    $('#study-timer-box').addClass('study-timer-complete');
    setTimeout(() => {
        hideTimerUI();
    }, 5000);
}

function stopTimer(silent = false) {
    const wasForward = timerForward;
    const stoppedSubject = timerSubject;
    let recordedMinutes = 0;

    // If timer was running, record partial time
    if (timerRunning && !silent && timerStartedAt && timerSubject) {
        let elapsedMs;
        if (timerForward) {
            elapsedMs = timerPaused ? pausedRemainingMs : (Date.now() - timerStartedAt);
        } else {
            elapsedMs = Date.now() - timerStartedAt;
        }
        recordedMinutes = Math.round(elapsedMs / 60000);
        if (recordedMinutes >= 1) {
            recordSession(timerSubject, recordedMinutes);
        }
    }
    timerRunning = false;
    timerPaused = false;
    timerForward = false;
    clearInterval(/** @type {ReturnType<typeof setInterval>} */(timerInterval));
    timerInterval = null;
    timerEndTime = null;
    timerSubject = '';
    timerMinutes = 0;
    pausedRemainingMs = 0;
    timerStartedAt = null;
    hideTimerUI();

    // Send stop message for forward mode (non-silent stop)
    if (wasForward && !silent && recordedMinutes >= 1) {
        const now = getCurrentTimeString();
        const todaySubject = getTodaySubjectMinutes(stoppedSubject);
        const todayTotal = getTodayTotalMinutes();
        const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
        if (ext.use_ai_messages) {
            sendAIMessage('forward_stop', {
                subject: stoppedSubject,
                minutes: recordedMinutes,
                time: now,
                todaySubject: todaySubject,
                todayTotal: todayTotal,
            });
        } else {
            const msg = ext.study_forward_stop_message
                .replace(/\{\{subject\}\}/g, stoppedSubject)
                .replace(/\{\{elapsed\}\}/g, String(recordedMinutes))
                .replace(/\{\{time\}\}/g, now)
                .replace(/\{\{today_subject\}\}/g, String(todaySubject))
                .replace(/\{\{today_total\}\}/g, String(todayTotal));
            sendMessageAsCharacter(msg);
        }
        // Check milestones after forward stop too
        checkMilestones(todayTotal);
    }
}

function timerStatus() {
    if (!timerRunning) {
        return '当前没有运行中的计时器。使用 /study 科目 分钟 开始倒计时，/study-forward 科目 开始正计时。';
    }
    if (timerForward) {
        const elapsed = timerPaused ? pausedRemainingMs : (Date.now() - (timerStartedAt || Date.now()));
        if (timerPaused) {
            return `⏸ 正计时已暂停。科目：${timerSubject}，已过：${formatTime(elapsed)}`;
        }
        return `▶ 正计时中：${timerSubject}，已过：${formatTime(elapsed)}`;
    }
    const remaining = getRemainingTime();
    if (timerPaused) {
        return `⏸ 计时器已暂停。科目：${timerSubject}，剩余：${formatTime(remaining)}`;
    }
    return `📚 正在计时：${timerSubject}，剩余：${formatTime(remaining)}`;
}

// ==================== Stats System ====================

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCurrentTimeString() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getCurrentDateString() {
    const d = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

function getTimeBasedMessage() {
    const hour = new Date().getHours();
    if (hour < 6) return '深夜';
    if (hour < 9) return '早晨';
    if (hour < 12) return '上午';
    if (hour < 14) return '中午';
    if (hour < 18) return '下午';
    if (hour < 21) return '傍晚';
    return '晚上';
}

function loadStats() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { records: {} };
    } catch { return { records: {} }; }
}

/**
 * @param {{records: Record<string, Record<string, number>>}} stats
 */
function saveStats(stats) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
}

const MILESTONE_KEY = 'study_timer_milestones';

/**
 * @returns {Record<string, number[]>}
 */
function loadMilestones() {
    try {
        const raw = localStorage.getItem(MILESTONE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

/**
 * @param {Record<string, number[]>} milestones
 */
function saveMilestones(milestones) {
    try { localStorage.setItem(MILESTONE_KEY, JSON.stringify(milestones)); } catch { /* ignore */ }
}

/**
 * Check and trigger milestone praise if a new level is reached.
 * @param {number} todayTotal
 */
async function checkMilestones(todayTotal) {
    const milestones = loadMilestones();
    const today = getTodayKey();
    const triggered = milestones[today] ?? [];
    const levels = Object.keys(/** @type {Record<string, any>} */(extension_settings)[MODULE_NAME].milestone_messages || {})
        .map(Number)
        .sort((a, b) => a - b);

    // Find the highest reachable milestone that hasn't been triggered yet
    const toTrigger = levels.filter(l => l <= todayTotal && !triggered.includes(l));

    for (const level of toTrigger) {
        triggered.push(level);
        const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
        if (ext.use_ai_messages) {
            await sendAIMessage('milestone', { todayTotal, time: getCurrentTimeString() });
        } else {
            const msg = ext.milestone_messages[String(level)]
                .replace(/\{\{time\}\}/g, getCurrentTimeString())
                .replace(/\{\{today_total\}\}/g, String(todayTotal));
            await sendMessageAsCharacter(msg);
        }
    }

    if (toTrigger.length > 0) {
        milestones[today] = triggered;
        saveMilestones(milestones);
    }
}

/**
 * @param {string} subject
 * @param {number} minutes
 */
function recordSession(subject, minutes) {
    const stats = loadStats();
    const today = getTodayKey();
    if (!stats.records[today]) stats.records[today] = {};
    stats.records[today][subject] = (stats.records[today][subject] || 0) + minutes;
    saveStats(stats);
}

/**
 * @param {string} subject
 * @returns {number}
 */
function getTodaySubjectMinutes(subject) {
    const stats = loadStats();
    const today = getTodayKey();
    return (stats.records[today] && stats.records[today][subject]) || 0;
}

function getTodayTotalMinutes() {
    const stats = loadStats();
    const today = getTodayKey();
    if (!stats.records[today]) return 0;
    return Object.values(stats.records[today]).reduce((a, b) => a + b, 0);
}

function getWeeklyStats() {
    const stats = loadStats();
    /** @type {Record<string, {label: string, total: number, subjects: Record<string, number>, isToday: boolean}>} */
    const result = {};
    const todayKey = getTodayKey();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayRecords = stats.records[key] || {};
        const total = Object.values(dayRecords).reduce((a, b) => a + b, 0);
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const label = `${d.getMonth() + 1}/${d.getDate()} 周${weekdays[d.getDay()]}`;
        result[key] = { label, total, subjects: dayRecords, isToday: key === todayKey };
    }
    return result;
}

function formatStatsMessage() {
    const weekly = getWeeklyStats();
    const todayTotal = getTodayTotalMinutes();
    const goal = /** @type {Record<string, any>} */(extension_settings)[MODULE_NAME].daily_goal_minutes || 480;
    const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
    const subjectGoals = /** @type {Record<string, number>} */(ext.subject_goals) || {};
    const now = getCurrentTimeString();
    const today = getCurrentDateString();
    const goalPercent = goal > 0 ? Math.min(Math.round((todayTotal / goal) * 100), 100) : 0;
    const barLen = 20;
    const filled = Math.round(goalPercent / 5);
    const progressBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

    let msg = `📊 学习统计 | ${today} ${now}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `今日目标：${goal}分钟 ${progressBar} ${goalPercent}%\n`;
    msg += `今日已完成：${todayTotal}分钟\n\n`;

    const stats = loadStats();
    const todayKey = getTodayKey();
    const todayRecords = stats.records[todayKey] || {};
    if (Object.keys(todayRecords).length > 0) {
        msg += `📋 今日科目明细：\n`;
        for (const [subj, mins] of Object.entries(todayRecords)) {
            const bar = '▌'.repeat(Math.min(Math.round(mins / 5), 20));
            const subjGoal = subjectGoals[subj];
            const goalStr = subjGoal ? ` / ${subjGoal}目` : '';
            const check = subjGoal && mins >= subjGoal ? ' ✅' : '';
            msg += `  ${subj}: ${mins}分钟${goalStr}${check} ${bar}\n`;
        }
        // Also show subjects with goals but no records
        for (const [subj, subjGoal] of Object.entries(subjectGoals)) {
            if (!(subj in todayRecords)) {
                msg += `  ${subj}: 0 / ${subjGoal}分钟 ❌\n`;
            }
        }
        msg += `\n`;
    }

    msg += `📅 本周概览：\n`;
    for (const [key, day] of Object.entries(weekly)) {
        const marker = day.isToday ? '◀' : ' ';
        const bar = day.total > 0 ? '█'.repeat(Math.min(Math.round(day.total / 10), 10)) : '';
        msg += `  ${marker}${day.label}: ${day.total}分钟 ${bar}\n`;
    }

    if (todayTotal >= goal) {
        msg += `\n✅ 今日目标已达成！`;
    }

    return msg;
}

// ==================== Slash Commands ====================

function registerSlashCommands() {
    // /study 数学 30  (countdown)
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'study',
        aliases: ['timer'],
        callback: (args, value) => {
            const subject = String(args.subject || args.科目 || '学习');
            const minutes = Number(args.minutes || args.分钟 || args.time || args.时间 || 25);

            if (isNaN(minutes) || minutes <= 0 || minutes > 480) {
                return '请输入有效的分钟数（1-480）。用法：/study 科目=数学 分钟=30';
            }

            startTimer(minutes, subject);
            return '';
        },
        helpString: '开始倒计时学习。用法：/study 科目=数学 分钟=30 或 /study 数学 30',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'subject', aliasList: ['科目'], description: '科目名称', typeList: [ARGUMENT_TYPE.STRING], defaultValue: '学习' }),
            SlashCommandNamedArgument.fromProps({ name: 'minutes', aliasList: ['分钟', 'time', '时间'], description: '计时分钟数', typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '25' }),
        ],
    }));

    // /study-forward 数学  (count-up / stopwatch)
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'study-forward',
        aliases: ['timer-forward', '正计时'],
        callback: (args, value) => {
            const subject = String(args.subject || args.科目 || '学习');
            startForwardTimer(subject);
            return '';
        },
        helpString: '开始正计时（不限时长）。用法：/study-forward 科目=数学 或 /正计时 数学',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'subject', aliasList: ['科目'], description: '科目名称', typeList: [ARGUMENT_TYPE.STRING], defaultValue: '学习' }),
        ],
    }));

    // /timer stop
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'timer-stop',
        aliases: ['stop-timer'],
        callback: () => {
            if (!timerRunning) return '没有正在运行的计时器。';
            const subject = timerSubject;
            stopTimer();
            return `计时器已停止（${subject}）。`;
        },
        helpString: '停止当前计时器',
    }));

    // /timer status
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'timer-status',
        aliases: ['study-status'],
        callback: () => timerStatus(),
        helpString: '查看计时器状态',
    }));

    // /timer pause
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'timer-pause',
        aliases: ['pause-timer'],
        callback: () => {
            if (!timerRunning) return '没有正在运行的计时器。';
            if (timerPaused) return '计时器已经是暂停状态。';
            togglePause();
            return `计时器已暂停（${timerSubject}）。`;
        },
        helpString: '暂停计时器',
    }));

    // /timer resume
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'timer-resume',
        aliases: ['resume-timer'],
        callback: () => {
            if (!timerRunning) return '没有正在运行的计时器。';
            if (!timerPaused) return '计时器未暂停。';
            togglePause();
            return `计时器已恢复（${timerSubject}）。`;
        },
        helpString: '恢复计时器',
    }));

    // /study-stats - daily and weekly statistics
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'study-stats',
        aliases: ['timer-stats', 'study-report', '今日统计', 'stats'],
        callback: () => formatStatsMessage(),
        helpString: '查看今日和本周学习统计',
    }));

    // /study-now - show current real time
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'study-now',
        aliases: ['now', '现在时间', 'time'],
        callback: () => {
            const date = getCurrentDateString();
            const time = getCurrentTimeString();
            const period = getTimeBasedMessage();
            const todayTotal = getTodayTotalMinutes();
            return `🕐 ${date} ${time}（${period}）。今日已累计学习 ${todayTotal} 分钟。`;
        },
        helpString: '查看当前现实世界的日期和时间',
    }));
}

// Listen for AI messages containing timer commands
function initTimerCommands() {
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (/** @type {number} */ messageId) => {
        const mes = chat[messageId];
        if (!mes || mes.is_user || mes.is_system) return;
        const text = /** @type {string} */ (mes.mes);

        // [timer:stop]
        if (/\[timer:stop\]/i.test(text)) {
            if (timerRunning) {
                stopTimer(true);
                mes.mes = text.replace(/\[timer:stop\]/gi, '').trim();
                addOneMessage(mes, { scroll: false });
            }
            return;
        }

        // [timer:科目:分钟数]  e.g. [timer:数学:30]
        const match = text.match(/\[timer\s*[:：]\s*([^:\]]+)\s*[:：]\s*(\d+)\s*\]/i);
        if (match) {
            const subject = match[1].trim();
            const minutes = parseInt(match[2], 10);
            if (minutes >= 1 && minutes <= 480) {
                // Start silently — AI already said something, no extra message
                timerMinutes = minutes;
                timerSubject = subject;
                timerPaused = false;
                timerRunning = true;
                timerStartedAt = Date.now();
                timerEndTime = Date.now() + minutes * 60 * 1000;

                createTimerUI();
                showTimerUI();

                timerInterval = setInterval(() => {
                    const remaining = getRemainingTime();
                    updateTimerUI();
                    if (remaining <= 0 && !timerPaused) {
                        completeTimer();
                    }
                }, 500);

                // Clean command from AI message
                mes.mes = text.replace(match[0], '').trim();
                addOneMessage(mes, { scroll: false });
            }
        }
    });
}

// ==================== Tool Calling (Function Call) ====================

/**
 * Registers a query_study_stats tool so AI can fetch real learning data on demand.
 * DeepSeek, OpenAI, Claude, etc. all support this via OpenAI-compatible protocol.
 */
function registerStudyStatsTool() {
    ToolManager.registerFunctionTool({
        name: 'query_study_stats',
        displayName: '查询学习统计',
        description: [
            '查询学习计时统计数据，包括今日各科目学习时长、目标完成率、本周趋势、历史对比等。',
            '当你需要了解用户的学习进度、效率评估、或用户询问"学得怎么样"/"进度如何"时，请调用此工具获取真实数据，不要凭空编造数字。',
        ].join(' '),
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                subject: {
                    type: 'string',
                    description: '可选。指定要查询的科目名称（如"高数""英语""408"）。不传则返回全量数据。',
                },
                scope: {
                    type: 'string',
                    enum: ['today', 'week', 'full'],
                    description: '可选。查询范围：today=仅今日, week=本周, full=今日+本周。默认 full。',
                },
            },
        },
        /**
         * @param {{subject?: string, scope?: string}} args
         */
        action: async (args) => {
            const stats = loadStats();
            const todayKey = getTodayKey();
            const todayRecords = stats.records[todayKey] || {};
            const ext = /** @type {any} */(extension_settings)[MODULE_NAME];
            const subjectGoals = /** @type {Record<string, number>} */(ext.subject_goals) || {};
            const dailyGoal = /** @type {number} */(ext.daily_goal_minutes || 480);
            const scope = args?.scope || 'full';

            const now = getCurrentTimeString();
            const dateStr = getCurrentDateString();
            const period = getTimeBasedMessage();

            // ---- Single subject query ----
            if (args?.subject) {
                const subj = args.subject;
                const mins = /** @type {number} */(todayRecords[subj] || 0);
                const goal = subjectGoals[subj];
                const pct = goal ? Math.round(mins / goal * 100) : null;
                let status;
                if (!goal) {
                    status = '无目标';
                } else if (pct === null || pct <= 0) {
                    status = '❌未开始';
                } else if (pct >= 100) {
                    status = '✅已完成';
                } else if (pct >= 50) {
                    status = '📚进行中';
                } else {
                    status = '📝刚开始';
                }

                return JSON.stringify({
                    查询科目: subj,
                    已学分钟: mins,
                    目标分钟: goal || '未设定',
                    完成率: pct !== null ? `${pct}%` : '无目标',
                    状态: status,
                    当前时间: `${dateStr} ${now} (${period})`,
                }, null, 2);
            }

            // ---- Full data ----
            const todayTotal = getTodayTotalMinutes();
            const goalPct = dailyGoal > 0 ? Math.round(todayTotal / dailyGoal * 100) : 0;

            // Per-subject breakdown
            /** @type {Record<string, {分钟: number, 目标: number|string, 完成率: string, 状态: string}>} */
            const subjectBreakdown = {};
            for (const [subj, mins] of Object.entries(todayRecords)) {
                const sg = subjectGoals[subj];
                const sp = sg ? Math.round(/** @type {number} */(mins) / sg * 100) : null;
                let subjStatus;
                if (!sg) {
                    subjStatus = '无目标';
                } else if (sp === null || sp <= 0) {
                    subjStatus = '❌';
                } else if (sp >= 100) {
                    subjStatus = '✅';
                } else if (sp >= 50) {
                    subjStatus = '📚';
                } else {
                    subjStatus = '📝';
                }
                subjectBreakdown[subj] = {
                    分钟: /** @type {number} */(mins),
                    目标: sg || '未设定',
                    完成率: sp !== null ? `${sp}%` : '无目标',
                    状态: subjStatus,
                };
            }
            // Subjects with goals but no records
            for (const [subj, goal] of Object.entries(subjectGoals)) {
                if (!(subj in subjectBreakdown)) {
                    subjectBreakdown[subj] = { 分钟: 0, 目标: goal, 完成率: '0%', 状态: '❌' };
                }
            }

            /** @type {{[key: string]: any}} */
            const result = {
                日期: dateStr,
                当前时间: `${now} (${period})`,
                今日汇总: {
                    已学总分钟: todayTotal,
                    每日目标: dailyGoal,
                    完成率: `${goalPct}%`,
                    还需分钟: Math.max(0, dailyGoal - todayTotal),
                    达标: todayTotal >= dailyGoal ? '是 ✅' : '否',
                },
                科目明细: subjectBreakdown,
            };

            // ---- Weekly data ----
            if (scope === 'week' || scope === 'full') {
                const weekly = getWeeklyStats();
                const weekSummary = [];
                let weekTotal = 0;
                let yesterdayTotal = 0;
                for (const [key, day] of Object.entries(weekly)) {
                    weekTotal += day.total;
                    weekSummary.push({
                        日期: day.label,
                        分钟: day.total,
                        今日: day.isToday,
                    });
                    if (!day.isToday) yesterdayTotal = day.total; // last non-today
                }

                // Consecutive days streak
                let streak = 0;
                const sortedKeys = Object.keys(weekly).sort().reverse();
                for (const key of sortedKeys) {
                    if (weekly[key].total > 0) streak++;
                    else break;
                }

                // All-time total
                let allTimeTotal = 0;
                for (const dayRecords of Object.values(stats.records)) {
                    allTimeTotal += Object.values(dayRecords).reduce((a, b) => a + b, 0);
                }

                result.本周汇总 = {
                    总计分钟: weekTotal,
                    日均分钟: Math.round(weekTotal / 7),
                    连续学习天数: streak,
                    较昨日: yesterdayTotal > 0
                        ? (todayTotal > yesterdayTotal ? `+${todayTotal - yesterdayTotal}分钟 ↑`
                            : todayTotal < yesterdayTotal ? `${todayTotal - yesterdayTotal}分钟 ↓` : '持平')
                        : '昨日无数据',
                };
                result.每日明细 = weekSummary.reverse();
                result.历史总计 = `${allTimeTotal}分钟 (约${Math.round(allTimeTotal/60)}小时)`;
            }

            return JSON.stringify(result, null, 2);
        },
        stealth: true,
    });

    console.log('[StudyTimer] Function tool "query_study_stats" registered');
}

// ==================== Init ====================

export function initTimer() {
    loadSettings();
    registerSlashCommands();
    createTimerUI(); // Show panel immediately
    initTimerCommands();
    registerStudyStatsTool();
    const time = getCurrentTimeString();
    const period = getTimeBasedMessage();
    console.log(`[StudyTimer] ${period}好！现在是${time}。学习计时器已加载。使用 /study 科目=数学 分钟=30 开始。`);
}
