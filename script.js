    // ===== AdsGram (Rewarded) Integration =====
        // Docs: https://docs.adsgram.ai/publisher/reward-interstitial-integration
        // blockId: int-20679
        let AdsGramController = null;

        function initAdsGram(){
            try {
                if (window.Adsgram && typeof window.Adsgram.init === 'function') {
                    AdsGramController = window.Adsgram.init({ blockId: "int-20679" });
                    return true;
                }
                console.warn('[AdsGram] SDK not loaded yet.');
                return false;
            } catch (e) {
                console.warn('[AdsGram] init error:', e);
                return false;
            }
        }

        async function showAdsGramRewarded(){
            // Returns: { ok: boolean, reason?: string, result?: any, error?: any }
            if (!AdsGramController) initAdsGram();

            if (!AdsGramController || typeof AdsGramController.show !== 'function') {
                return { ok: false, reason: 'not_ready' };
            }

            try {
                const result = await AdsGramController.show();
                // For rewarded ads, promise resolves when watched till the end,
                // but we still check `done` for safety.
                if (result && result.done === false) {
                    return { ok: false, reason: 'not_done', result };
                }
                return { ok: true, result };
            } catch (error) {
                return { ok: false, reason: 'error', error };
            }
        }

        /* ===== Loading ===== */
        const loadingScreen = document.getElementById('loadingScreen');
        const mainScreen = document.getElementById('mainScreen');

        document.addEventListener('DOMContentLoaded',()=>{
            // Simulating a brief loading time for the spinner to be visible
            setTimeout(async ()=>{ 
                await initDailyProgress(); 
                loadingScreen.classList.add('hidden');
                playBGAudio(); 
            }, 7000); 
        });
        
        /* ===== Custom Alert & Audio Functions ===== */
        
        const bgPlayer = document.getElementById('bgPlayer');
        const successSFX = document.getElementById('successSFX');
        const errorSFX = document.getElementById('errorSFX');
        const customAlert = document.getElementById('customAlert');
        const alertBox = customAlert.querySelector('.custom-alert-box');
        const alertTitleEl = document.getElementById('alertTitle');
        const alertMessageEl = document.getElementById('alertMessage');
        const alertIconEl = document.getElementById('alertIcon');

        const toastContainer = document.getElementById('toastContainer');

        const bgPlaylist = ['audio.mp3', 'audio2.mp3', 'audio3.mp3', 'audio4.mp3'];
        let currentBgIndex = -1;

        function playNextBg() {
            if (!Array.isArray(bgPlaylist) || bgPlaylist.length === 0) return;
            currentBgIndex = (currentBgIndex + 1) % bgPlaylist.length;
            const nextSrc = bgPlaylist[currentBgIndex];
            try {
                bgPlayer.src = nextSrc;
                bgPlayer.load();
                bgPlayer.volume = 0.4;
                bgPlayer.play().catch(e => {
                    console.log("bgPlayer play blocked (will wait for user interaction):", e);
                });
            } catch (e) {
                console.warn("Failed to set bgPlayer source:", e);
            }
        }

        bgPlayer.addEventListener('ended', () => {
            playNextBg();
        });

        bgPlayer.addEventListener('error', (e) => {
            console.warn('bgPlayer error, advancing to next track', e);
            playNextBg();
        });

        function playBGAudio() {
            try {
                if (currentBgIndex === -1) {
                    currentBgIndex = 0;
                    bgPlayer.src = bgPlaylist[currentBgIndex];
                    bgPlayer.load();
                }
                bgPlayer.volume = 0.4;
                bgPlayer.play().catch(e => {
                    console.log("Background audio play failed, waiting for user click:", e);
                });
            } catch (e) {
                console.log("Background audio play failed, waiting for user click:", e);
            }
        }
        
        function playSFX(type) {
            let sfx;
            if (type === 'success') {
                sfx = successSFX;
            } else if (type === 'error') {
                sfx = errorSFX;
            } else {
                return;
            }
            sfx.currentTime = 0;
            sfx.volume = 0.8;
            sfx.play().catch(e => console.log("SFX play failed:", e));
        }

        /* =========================
           Toast Notification System (replaces previous overlay alerts for non-blocking UX)
           - Uses same showCustomAlert signature for compatibility with existing code.
           - Creates small top toasts, auto-dismiss after ~2.8s (configurable).
           - Glassmorphism style, soft shadow, rounded corners.
           - Error type gets a subtle shake animation.
           - Does not block page interactions (pointer-events: none).
           - Improved contrast, larger type and multi-line support.
           ========================= */

        /**
         * showToast(type, title, message, opts)
         * type: 'success'|'error'|'warning'|'info'
         * title: short title string
         * message: short descriptive text (supports multi-line)
         * opts: { durationMs: number (optional) }
         */
        function showToast(type, title, message, opts = {}) {
            if (!toastContainer) return;
            const duration = typeof opts.durationMs === 'number' ? opts.durationMs : 3600; // slightly longer default
            const toast = document.createElement('div');
            const safeTitle = String(title || '').slice(0, 160);
            const safeMessage = String(message || '').slice(0, 800);

            const typeClass = `toast--${type || 'info'}`;
            toast.className = `toast ${typeClass}`;
            // build inner HTML (icon left, title + small message)
            let icon = 'ℹ️';
            if (type === 'success') icon = '✅';
            else if (type === 'error') icon = '❌';
            else if (type === 'warning') icon = '⚡';
            else if (type === 'info') icon = 'ℹ️';

            toast.innerHTML = `
                <div class="toast-icon" aria-hidden="true">${icon}</div>
                <div class="toast-content">
                    <div class="toast-title">${escapeHtml(safeTitle || capitalizeType(type))}</div>
                    <div class="toast-message">${escapeHtml(safeMessage || '')}</div>
                </div>
            `;

            // append and animate in
            toastContainer.appendChild(toast);

            // small delay to ensure CSS animation triggers
            requestAnimationFrame(() => {
                // apply 'show' state
                toast.classList.add('show');
                // add shake class for error
                if (type === 'error') {
                    // add a class that triggers a shake; the CSS combines with entrance animation
                    toast.classList.add('shake');
                }
            });

            // optional SFX
            if (type === 'error') playSFX('error');
            else if (type === 'success') playSFX('success');

            // auto-dismiss
            const hideAfter = Math.max(1800, duration); // ensure reasonable min
            const timeoutId = setTimeout(() => {
                // start hide animation
                toast.classList.remove('show');
                toast.classList.add('hide');
                // remove after animation
                setTimeout(() => {
                    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
                }, 300);
            }, hideAfter);

            // Return control object for optional manual dismissal
            return {
                dismiss: () => {
                    clearTimeout(timeoutId);
                    if (toast && toast.parentNode) {
                        toast.classList.remove('show');
                        toast.classList.add('hide');
                        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
                    }
                }
            };
        }

        // Helper: preserve existing function name so other code calls still work.
        // We replace the previous overlay-based showCustomAlert with a toast-based implementation.
        function showCustomAlert(title, message, type = 'warning') {
            // Normalize type to known values
            const normalized = (String(type || '').toLowerCase());
            const t = ['success','error','warning','info'].includes(normalized) ? normalized : 'info';

            // Preserve newlines and show multi-line message in English if possible
            const msg = String(message || '').replace(/\r\n/g, '\n').trim();

            // Use a compact duration for toasts; success/info shorter, error slightly longer
            const durationMap = { success: 3000, info: 3000, warning: 3600, error: 4200 };
            const duration = durationMap[t] || 3200;

            showToast(t, title || capitalizeType(t), msg, { durationMs: duration });
        }

        // small helper: escape HTML to avoid injection in innerHTML usage
        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function capitalizeType(type) {
            if (!type) return '';
            return String(type).charAt(0).toUpperCase() + String(type).slice(1);
        }

        /* ===== Telegram User & Referral Setup (Modified to include audio) ===== */
        Telegram.WebApp.ready();
        
        let tgUser = null;
        if(Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user){
            tgUser = Telegram.WebApp.initDataUnsafe.user;
            const photoUrl = tgUser.photo_url;
            const userName = tgUser.first_name + (tgUser.last_name? ' '+tgUser.last_name:'');
            const userId = tgUser.id;
            const imgEl  = document.getElementById('userImage');
            const nameEl = document.getElementById('userName');
            const idEl   = document.getElementById('userId');
            const placeHolder = document.querySelector('.placeholder');
            if(photoUrl){
                imgEl.src = photoUrl;
                imgEl.style.display = 'block';
                if (placeHolder) placeHolder.style.display = 'none';
            } else {
                // Show a clean initial instead of a plain "+" when no profile photo exists
                if (placeHolder) {
                    const initial = (userName && userName.trim().length) ? userName.trim().charAt(0).toUpperCase() : '👤';
                    placeHolder.textContent = initial;
                }
            }
            nameEl.textContent = userName;
            idEl.textContent   = 'ID: ' + userId;
        }

        function getRefParam() {
            let referrerId = null;
            const REF_PREFIX = 'ref_';

            if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.start_param) {
                const startParam = Telegram.WebApp.initDataUnsafe.start_param;
                if (startParam.startsWith(REF_PREFIX)) {
                    referrerId = startParam.substring(REF_PREFIX.length);
                    console.log('Referrer ID from start_param:', referrerId);
                }
            } 
            return referrerId; 
        }

        let referrerId = getRefParam();
        const API_URL = '/api'; 
        
        // ------------------------------------------------------------------
        // **fetchApi Function**
        // ------------------------------------------------------------------
        async function fetchApi(payload) {
            if (!tgUser) {
                showCustomAlert('Critical Error!', 'User data not initialized. Please restart the app. [CODE: U_NIL]', 'error');
                return { ok: false, error: 'User not initialized' };
            }

            const initData = Telegram.WebApp.initData;
            if (!initData) {
                showCustomAlert('Critical Error!', 'Initialization data is missing. Please restart the app. [CODE: ID_MS]', 'error');
                return { ok: false, error: 'InitData missing' };
            }

            if (typeof Telegram.WebApp.showProgress === 'function') {
                Telegram.WebApp.showProgress();
            }
            
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        ...payload,
                        user_id: tgUser.id,
                        initData: initData 
                    }),
                });

                if (typeof Telegram.WebApp.hideProgress === 'function') {
                    Telegram.WebApp.hideProgress();
                }

                const data = await response.json();

                if (!response.ok || !data.ok) {
                    const errorMessage = data.error || `Server Error: ${response.status} ${response.statusText}`;
                    console.error(`API Call failed for type ${payload.type}:`, errorMessage);
                    let alertTitle = 'Operation Failed!';
                    let alertType = 'error';
                    let cleanMessage = errorMessage;

                    if (response.status === 429) {
                        alertTitle = 'Rate Limit Exceeded!';
                        alertType = 'warning';
                        cleanMessage = 'You have exceeded the allowed request limit. Please try again after 5 second.';
                    } else if (errorMessage.includes('banned')) {
                        alertTitle = 'Access Denied!';
                        alertType = 'error';
                        cleanMessage = 'This account has been banned.';
                    } else if (errorMessage.includes('limit reached')) {
                        alertTitle = 'Daily Limit Reached!';
                        alertType = 'warning';
                        cleanMessage = 'You have reached the maximum number of allowed actions for today.';
                    } else if (errorMessage.includes('Server Token') || response.status === 409 || response.status === 408) {
                        alertTitle = 'Security Error!';
                        alertType = 'error';
                        cleanMessage = 'A security-related error occurred. Please try again.';
                    } else if (payload.type === 'completeTask' && errorMessage.includes('already completed')) {
                        alertTitle = 'Task Completed!';
                        alertType = 'warning';
                        cleanMessage = 'Reward already claimed. Task is complete.';
                    } else if (payload.type === 'completeTask' && errorMessage.includes('not joined')) {
                        alertTitle = 'Task Failed!';
                        alertType = 'error';
                        cleanMessage = 'Membership not verified. Please ensure you joined the channel and try again.';
                    } else {
                        alertTitle = 'Operation Failed!';
                        alertType = 'error';
                        cleanMessage = errorMessage;
                    }
                    
                    showCustomAlert(alertTitle, cleanMessage, alertType);
                    return { ok: false, error: errorMessage };
                }

                return data;
            } catch (error) {
                if (typeof Telegram.WebApp.hideProgress === 'function') {
                    Telegram.WebApp.hideProgress();
                }
                console.error(`General Fetch Error for type ${payload.type}:`, error.message);
                showCustomAlert('Connection Error!', 'Could not connect to the server. Please check your internet connection.', 'error');
                return { ok: false, error: error.message };
            }
        }

        // ------------------------------------------------------------------
        // NEW: Function to request Action ID from the Server
        // ------------------------------------------------------------------
        async function requestActionId(actionType) {
            const result = await fetchApi({ 
                type: 'generateActionId', 
                action_type: actionType 
            });
            
            if (result.ok) {
                return result.data.action_id;
            }
            return null;
        }


        /* ===== Rewards, Limits, and Anti-Cheat (Limits here are for display only) ===== */
        const DAILY_MAX = 200;
        const DAILY_MAX_SPINS = 25;
        
        let shibBalance = 0; 
        let adsWatchedToday = 0;
        let spinsToday = 0; 
        let taskCompleted = false; 
        let taskActionState = 'JOIN_OR_CLAIM';
        let withdrawalHistory = [];
        let referralsCount = 0; 
        let isBanned = false; 
        let isProcessingTask = false; 
        let countdownInterval = null;
        
        const sectors = [5, 10, 15, 20, 5]; 

        let currentTask = null;

        // ===== Contest Variables =====
        let contestEndTime = new Date().getTime() + (10 * 24 * 60 * 60 * 1000); // 10 days from now
        let myTickets = 0;
        let allTickets = 0;
        let contestCountdownInterval = null;
        let contestAdLocked = false;

        // ===== Task Link Constants and state (local-storage based) =====
        const TASK_LINK_KEY = 'taskLinkProgress_v1';
        const TASK_LINK_DAILY_MAX = 200; // daily limit (count)
        const TASK_LINK_REWARD = 5; // 5 SHIB per click
        const TASK_LINK_URL = 'https://otieu.com/4/10259911';

        let taskLinkState = { date: null, count: 0 }; // {date:'YYYY-MM-DD', count: number}

        function todayDateString() {
            const d = new Date();
            return d.toISOString().slice(0,10);
        }

        function loadTaskLinkProgressFromStorage() {
            try {
                const raw = localStorage.getItem(TASK_LINK_KEY);
                if (!raw) {
                    taskLinkState = { date: todayDateString(), count: 0 };
                    localStorage.setItem(TASK_LINK_KEY, JSON.stringify(taskLinkState));
                    return;
                }
                const parsed = JSON.parse(raw);
                if (!parsed || parsed.date !== todayDateString()) {
                    taskLinkState = { date: todayDateString(), count: 0 };
                    localStorage.setItem(TASK_LINK_KEY, JSON.stringify(taskLinkState));
                    return;
                }
                taskLinkState = parsed;
            } catch (e) {
                console.warn('Failed to load task link progress from localStorage:', e);
                taskLinkState = { date: todayDateString(), count: 0 };
            }
        }

        function saveTaskLinkProgressToStorage() {
            try {
                taskLinkState.date = todayDateString();
                localStorage.setItem(TASK_LINK_KEY, JSON.stringify(taskLinkState));
            } catch (e) {
                console.warn('Failed to save task link progress to localStorage:', e);
            }
        }

        function updateTaskLinkUI() {
            const area = document.getElementById('taskLinkArea');
            const fill = document.getElementById('taskLinkProgressFill');
            const countDisplay = document.getElementById('taskLinkCountDisplay');
            const btn = document.getElementById('taskLinkBtn');

            if (!area || !fill || !countDisplay || !btn) return;

            area.style.display = 'block';

            const count = taskLinkState.count || 0;
            const percent = Math.min((count / TASK_LINK_DAILY_MAX) * 100, 100);
            fill.style.width = percent + '%';
            countDisplay.textContent = `${count.toLocaleString('en-US')} / ${TASK_LINK_DAILY_MAX.toLocaleString('en-US')}`;

            if (count >= TASK_LINK_DAILY_MAX) {
                btn.disabled = true;
                btn.textContent = 'Daily Limit Reached';
            } else {
                btn.disabled = false;
                btn.textContent = 'Open and get 5 SHIB';
            }
        }

        async function handleTaskLinkClick() {
            if (isBanned) {
                showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                return;
            }

            if (taskLinkState.count >= TASK_LINK_DAILY_MAX) {
                showCustomAlert('Daily Limit Reached!', `You have reached the daily limit for these instant links (${TASK_LINK_DAILY_MAX}).`, 'warning');
                updateTaskLinkUI();
                return;
            }

            let actionId = null;
            try {
                actionId = await requestActionId('taskLink');
            } catch (e) {
                console.warn('Failed to get action id for task link:', e);
                actionId = null;
            }

            const opened = openExternalLink(TASK_LINK_URL);

            let serverResult = { ok: false };
            if (actionId) {
                try {
                    serverResult = await fetchApi({
                        type: 'taskLinkClick',
                        action_id: actionId,
                        url: TASK_LINK_URL
                    });
                } catch (e) {
                    serverResult = { ok: false };
                }
            }

            if (serverResult && serverResult.ok) {
                if (serverResult.data && serverResult.data.new_balance !== undefined) {
                    shibBalance = serverResult.data.new_balance;
                    taskLinkState.count = serverResult.data.new_count;
                    saveTaskLinkProgressToStorage();
                    updateState({ balance: shibBalance });
                    updateTaskLinkUI();
                    showCustomAlert('Reward', `You received ${TASK_LINK_REWARD} SHIB`, 'success');
                } else {
                    showCustomAlert('Server Sync Warning', 'The server accepted the click but did not return updated data. Please reload the app.', 'warning');
                }
                return;
            }
            
            loadUserData();
        }

        // ------------------------------------------------------------------

        function updateState(data) {
            shibBalance = data.balance !== undefined ? data.balance : shibBalance;
            adsWatchedToday = data.ads_watched_today !== undefined ? data.ads_watched_today : adsWatchedToday;
            spinsToday = data.spins_today !== undefined ? data.spins_today : spinsToday;
            referralsCount = data.referrals_count !== undefined ? data.referrals_count : referralsCount;
            withdrawalHistory = data.withdrawal_history !== undefined ? data.withdrawal_history : withdrawalHistory;
            isBanned = data.is_banned !== undefined ? data.is_banned : isBanned;
            if (data.task_completed === true) {
                taskCompleted = true;
                taskActionState = 'COMPLETED';
            } else if (data.task_completed === false) {
                 taskCompleted = false;
            }

            updateUI();
        }
        
        async function loadUserData() {
            if (!tgUser) return;
            
            const result = await fetchApi({ type: 'getUserData' }); 

            if (result.ok) {
                if (result.data.is_banned) {
                    isBanned = true;
                    mainScreen.classList.remove('visible');
                    showCustomAlert('Account Banned!', 'This account has been permanently restricted for violating policies. Access to the Mini App is denied.', 'error');
                    return;
                }
                
                updateState({
                    balance: result.data.balance,
                    ads_watched_today: result.data.ads_watched_today,
                    spins_today: result.data.spins_today,
                    referrals_count: result.data.referrals_count,
                    is_banned: false, 
                    task_completed: result.data.task_completed || false,
                    withdrawal_history: (result.data.withdrawal_history || []).map(item => ({
                        amount: item.amount,
                        status: item.status,
                        date: new Date(item.created_at).toLocaleDateString('en-GB'),
                        binance_id: item.binance_id || null,
                        faucetpay_email: item.faucetpay_email || null
                    }))
                });

                if (result.data.task_link_clicks_today !== undefined) {
                    taskLinkState.count = result.data.task_link_clicks_today;
                    saveTaskLinkProgressToStorage();
                }

                if (taskCompleted) {
                    taskActionState = 'COMPLETED';
                } else if (taskActionState === 'COMPLETED') { 
                    taskActionState = 'JOIN_OR_CLAIM';
                }
                
                mainScreen.classList.add('visible'); 

            }
        }
        
        async function initDailyProgress(){
            if (!tgUser) return;

            // include minimal user profile to server so photo_url & name saved
            const userPayload = {
                type: 'register',
                ref_by: referrerId ? referrerId : null,
                user: {
                    id: tgUser.id,
                    first_name: tgUser.first_name || null,
                    last_name: tgUser.last_name || null,
                    photo_url: tgUser.photo_url || null
                }
            };

            const registerResult = await fetchApi(userPayload);

            if (registerResult.ok) {
                await loadUserData(); 
            }
        }
        
        
        function updateWithdrawButtonState(){
            const btn = document.getElementById('withdrawRequestBtn');
            const amountEl = document.getElementById('withdrawAmount');
            if (!btn || !amountEl) return;
            const bal = Number(shibBalance || 0);
            const amount = Number(amountEl.value || 0);
            const MIN_WITHDRAW_UI = 4000;
            btn.disabled = !(bal >= MIN_WITHDRAW_UI && amount >= MIN_WITHDRAW_UI && amount <= bal);
        }

function updateUI(){
            document.getElementById('shibBalanceText').textContent = Number(shibBalance || 0).toLocaleString('en-US') + ' SHIB';
            document.getElementById('withdrawBalanceDisplay').textContent = Number(shibBalance || 0).toLocaleString('en-US');
            updateWithdrawButtonState();

            document.getElementById('adsCount').textContent = Number(adsWatchedToday || 0).toLocaleString('en-US');
            const adsPercent = Math.min((adsWatchedToday / DAILY_MAX) * 100, 100);
            document.getElementById('dailyProgressFill').style.width = adsPercent + '%';
            document.getElementById('dailyPercent').textContent = Math.round(adsPercent) + '%';

            document.getElementById('spinsCount').textContent = Number(spinsToday || 0).toLocaleString('en-US'); 
            const spinsPercent = Math.min((spinsToday / DAILY_MAX_SPINS) * 100, 100);
            document.getElementById('spinProgressFill').style.width = spinsPercent + '%';
            document.getElementById('spinPercent').textContent = Math.round(spinsPercent) + '%';

            document.getElementById('referralsCountDisplay').textContent = Number(referralsCount || 0).toLocaleString('en-US');
            
            const perTaskBtn = currentTask ? document.querySelector(`button[data-task-id="${currentTask.id}"]`) : null;

            if (perTaskBtn) {
                if (!isProcessingTask && countdownInterval) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                }

                if (currentTask && currentTask.is_completed) {
                    perTaskBtn.disabled = true;
                    perTaskBtn.textContent = 'Claimed';
                    perTaskBtn.classList.add('completed');
                } else {
                    perTaskBtn.disabled = isProcessingTask || perTaskBtn.dataset.locked === '1';
                    perTaskBtn.classList.remove('completed');

                    if (isProcessingTask) {
                    } else if (taskActionState === 'CLAIM') {
                        perTaskBtn.textContent = 'Claim';
                    } else {
                        perTaskBtn.textContent = 'Open';
                    }
                }
            }

            const adButton = document.querySelector('button[onclick="watchAds()"]');
            if (adButton) {
                if (isBanned || adsWatchedToday >= DAILY_MAX) {
                    adButton.disabled = true;
                    adButton.querySelector('span').textContent = 'LIMIT REACHED';
                } else {
                    adButton.disabled = false;
                    adButton.querySelector('span').textContent = 'Ads';
                }
            }

            const spinBtn = document.getElementById('spinBtn');
            if (spinBtn) {
                if (spinBtn) {
                    if (isBanned || spinsToday >= DAILY_MAX_SPINS) {
                        spinBtn.disabled = true;
                        spinBtn.textContent = `LIMIT REACHED (${Number(spinsToday).toLocaleString('en-US')}/${DAILY_MAX_SPINS})`;
                    } else if (!spinning) {
                        spinBtn.disabled = false;
                        spinBtn.textContent = 'SPIN';
                    }
                }
            }

            updateTaskLinkUI();

            displayWithdrawals();

            updateContestUI();
        }
        
        // ***************************************************************
        // UPDATED watchAds FUNCTION: better messages (English), improved error handling & UI reset
        // ***************************************************************
        async function watchAds(){
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            
            if (adsWatchedToday >= DAILY_MAX) {
                showCustomAlert('Daily Limit Reached!', `You have completed all ads for today (${DAILY_MAX}). Please come back later.`, 'warning');
                return;
            }

            const actionId = await requestActionId('watchAd');
            if (!actionId) return;

            // Show two ads sequentially using libtl SDK. We'll handle failures and ensure UI resets.
            try {
                await show_10245709();
                await show_10245709();

                const adsgram = await showAdsGramRewarded();
                if (!adsgram.ok) {
                    if (adsgram.reason === 'not_ready') {
                        showCustomAlert('AdsGram Not Ready', 'AdsGram ad is not available right now. Please try again.', 'error');
                    } else if (adsgram.reason === 'not_done') {
                        showCustomAlert('Ad Cancelled', 'Watch the AdsGram ad till the end to receive the reward.', 'warning');
                    } else {
                        showCustomAlert('AdsGram Error', 'Unable to show AdsGram ad. Please try again later.', 'error');
                    }
                    return;
                }

                const adResult = await fetchApi({
                    type: 'watchAd',
                    action_id: actionId
                });

                if (adResult.ok) {
                    const actualReward = adResult.data.actual_reward;
                    
                    updateState({
                        balance: adResult.data.new_balance,
                        ads_watched_today: adResult.data.new_ads_count
                    });
                    
                    if (referrerId) {
                        fetchApi({
                            type: 'commission',
                            referrer_id: referrerId,
                            referee_id: tgUser.id
                        }).then(r => {
                            if (r.ok) { console.log('Commission sent successfully.'); }
                            else { console.warn('Commission failed to send:', r.error); }
                        });
                    }
                    
                    let alertTitle = 'Reward Granted!';
                    let alertType = 'success';
                    let alertMessage = `You received ${Number(actualReward || 0).toLocaleString('en-US')} SHIB for watching the ad.`;

                    if(adResult.data.new_ads_count >= DAILY_MAX){
                        alertTitle = 'Daily Task Completed!';
                        alertMessage = `Congratulations! You have completed all today's ads (${DAILY_MAX}). Come back later.`;
                    }

                    // Provide both an English toast and also a smaller server-synced message
                    showCustomAlert(alertTitle, alertMessage, alertType);
                } else {
                    showCustomAlert('Reward Error', 'Server did not return reward details. Please try again.', 'error');
                    await loadUserData();
                }
            } catch (e) {
                console.error("libtl.com Ad sequence failed:", e);
                if (typeof e === 'string' && e.includes('canceled')) {
                    showCustomAlert('Ad Cancelled', 'The ad sequence was interrupted. Watch the full ad to receive the reward.', 'warning');
                } else {
                    showCustomAlert('Ad Load Failed', 'One of the ads failed to load. Please try again.', 'error');
                }
            } finally {
                // ensure UI is consistent
                await loadUserData();
            }
        }
        // ***************************************************************
        // END OF UPDATED watchAds FUNCTION
        // ***************************************************************
        
        function circleClick(){ console.log('Circle clicked'); }

        /* ===== Task Screen Functions (UPDATED LOGIC with dynamic tasks) ===== */

        async function fetchTasks() {
            const res = await fetchApi({ type: 'getTasks' });
            if (res.ok && Array.isArray(res.data.tasks)) {
                return res.data.tasks;
            }
            return [];
        }

        async function fetchTask(taskId) {
            const tasks = await fetchTasks();
            return tasks.find(t => parseInt(t.task_id) === parseInt(taskId)) || null;
        }

        function normalizeTaskLink(link) {
            if (!link) return '';
            link = link.trim();
            if (/^t\.me\//i.test(link)) {
                return 'https://' + link;
            }
            if (/^@/.test(link)) {
                return 'https://t.me/' + link.substring(1);
            }
            if (!/^https?:\/\//i.test(link)) {
                return 'https://' + link;
            }
            return link;
        }

        function openExternalLink(link) {
            if (!link) return false;
            const normalized = normalizeTaskLink(link);
            try {
                if (typeof Telegram !== 'undefined' && Telegram.WebApp && typeof Telegram.WebApp.openTelegramLink === 'function') {
                    Telegram.WebApp.openTelegramLink(normalized);
                    return true;
                } else {
                    window.open(normalized, '_blank');
                    return true;
                }
            } catch (e) {
                console.warn('Failed to open link via WebApp, fallback to window.open:', e);
                try { window.open(normalized, '_blank'); return true; } catch (err) { return false; }
            }
        }

        function renderTasksList(tasks) {
            const container = document.getElementById('taskListContainer');
            const noChannelNotice = document.getElementById('noChannelTasksNotice');
            if (!container) return;

            const availableTasks = Array.isArray(tasks) ? tasks.filter(t => !t.is_completed) : [];

            if (!Array.isArray(availableTasks) || availableTasks.length === 0) {
                container.innerHTML = `
                    <div class="task-item-card">
                        <div class="task-left">
                            <span class="task-dot" aria-hidden="true"></span>
                            <div class="task-text-info">
                                <div class="task-name">No tasks now</div>
                                <div class="task-meta">Check again later.</div>
                            </div>
                        </div>
                    </div>
                `;
                if (noChannelNotice) noChannelNotice.style.display = 'none';
                return;
            }

            if (noChannelNotice) noChannelNotice.style.display = 'none';

            const html = availableTasks.map(t => {
                const rewardText = `Reward: ${Number(t.reward || 0).toLocaleString('en-US')} SHIB`;
                const safeLink = (t.link || '').replace(/"/g, '&quot;');
                const name = escapeHtml(t.name || 'Task');
                return `
                    <div class="task-item-card" data-task-id="${t.task_id}">
                        <div class="task-left">
                            <span class="task-dot" aria-hidden="true"></span>
                            <div class="task-text-info">
                                <div class="task-name">${name}</div>
                                <div class="task-meta"><span class="task-reward">${escapeHtml(rewardText)}</span></div>
                            </div>
                        </div>
                        <button class="task-action-btn-new" data-task-link="${safeLink}" data-task-id="${t.task_id}" onclick="onTaskButtonClick(event)">Open</button>
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        async function onTaskButtonClick(event) {
            event = event || window.event;
            const btn = event.currentTarget || event.target;
            const taskId = btn.getAttribute('data-task-id');
            const taskLink = btn.getAttribute('data-task-link') || '';

            if (!taskId) {
                showCustomAlert('Task Error', 'Task id not found on this button.', 'error');
                return;
            }

            if (btn.dataset.locked === '1') {
                return;
            }

            const btnText = (btn.textContent || '').trim().toLowerCase();
            if (btnText === 'claim') {
                btn.dataset.locked = '1';
                btn.disabled = true;

                if (isProcessingTask) {
                    btn.dataset.locked = '0';
                    btn.disabled = false;
                    return;
                }

                const task = await fetchTask(taskId);
                if (!task) {
                    btn.dataset.locked = '0';
                    btn.disabled = false;
                    showCustomAlert('Task Error', 'Selected task not found. Please refresh the tasks list.', 'error');
                    return;
                }
                currentTask = {
                    id: parseInt(task.task_id),
                    name: task.name,
                    link: task.link,
                    reward: task.reward,
                    is_completed: !!task.is_completed
                };

                if (currentTask.is_completed) {
                    const el = document.querySelector(`div[data-task-id="${taskId}"]`);
                    if (el) el.remove();
                    btn.dataset.locked = '0';
                    btn.disabled = false;
                    showCustomAlert('Task Completed!', 'Reward already claimed for this task.', 'warning');
                    return;
                }

                claimTaskReward();
                return;
            }

            const task = await fetchTask(taskId);
            if (!task) {
                showCustomAlert('Task Error', 'Selected task not found. Please refresh the tasks list.', 'error');
                return;
            }

            currentTask = {
                id: parseInt(task.task_id),
                name: task.name,
                link: task.link,
                reward: task.reward,
                is_completed: !!task.is_completed
            };

            if (currentTask.is_completed) {
                const el = document.querySelector(`div[data-task-id="${taskId}"]`);
                if (el) el.remove();
                showCustomAlert('Task Completed!', 'Reward already claimed for this task.', 'warning');
                return;
            }

            if (taskLink && taskLink.trim() !== '') {
                const opened = openExternalLink(taskLink);
                if (opened) {
                    btn.textContent = 'Claim';
                    showCustomAlert('Opened Task', `The task has been opened. After joining press "Claim" to receive ${Number(currentTask.reward || 0).toLocaleString('en-US')} SHIB.`, 'info');
                    btn.dataset.locked = '0';
                    btn.disabled = false;
                } else {
                    showCustomAlert('Open Link Failed', 'Unable to open the link. Please try manually.', 'error');
                }
            } else {
                btn.textContent = 'Claim';
                showCustomAlert('No Link', 'This task has no join link. Press Claim to attempt verification.', 'warning');
                btn.dataset.locked = '0';
                btn.disabled = false;
            }
        }

        async function selectTask(taskId) {
            const btn = document.querySelector(`#taskListContainer button[data-task-id="${taskId}"]`);
            if (btn) {
                btn.click();
                return;
            }
            const task = await fetchTask(taskId);
            if (!task) {
                showCustomAlert('Task Error', 'Selected task not found. Please refresh the tasks list.', 'error');
                return;
            }
            currentTask = {
                id: parseInt(task.task_id),
                name: task.name,
                link: task.link,
                reward: task.reward,
                is_completed: !!task.is_completed
            };
            showCustomAlert('Task Selected', `Selected: ${currentTask.name}\nReward: ${Number(currentTask.reward || 0).toLocaleString('en-US')} SHIB`, 'info');
        }

        async function showTask(){
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            mainScreen.classList.remove('visible');
            document.getElementById('taskScreen').classList.add('visible');

            const tasks = await fetchTasks();
            renderTasksList(tasks);

            loadTaskLinkProgressFromStorage();
            updateTaskLinkUI();

            currentTask = null;

            loadUserData();
        }

        function hideTask(){
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                isProcessingTask = false;
                taskActionState = currentTask && currentTask.is_completed ? 'COMPLETED' : 'JOIN_OR_CLAIM';
                updateUI();
            }
            document.getElementById('taskScreen').classList.remove('visible');
            mainScreen.classList.add('visible');
        }

        async function claimTaskReward(){
            const taskBtn = currentTask ? document.querySelector(`button[data-task-id="${currentTask.id}"]`) : null;

            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            if (isProcessingTask) return; 
            if (!currentTask) {
                showCustomAlert('No Task Selected', 'Please select a task from the list first.', 'warning');
                return;
            }

            if (taskBtn) {
                taskBtn.dataset.locked = '1';
                taskBtn.disabled = true;
            }

            isProcessingTask = true;
            updateUI(); 

            const countdownTime = 5; 
            let countdown = countdownTime; 
            
            if (taskBtn) taskBtn.textContent = countdown;
            
            countdownInterval = setInterval(() => {
                countdown--;
                if (countdown >= 0) {
                    if (taskBtn) taskBtn.textContent = countdown;
                    if(countdownTime - countdown > 1){
                         showCustomAlert('Verifying Membership...', `Please wait ${countdown} seconds for channel membership verification.`, 'info');
                    }
                } else {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                    if (taskBtn) taskBtn.textContent = 'Verifying...';
                    showCustomAlert('Verifying...', 'Contacting server to confirm membership and claim reward.', 'info');

                    verifyAndClaim();
                }
            }, 1000);
            
        }

        async function verifyAndClaim() {
            const taskBtn = currentTask ? document.querySelector(`button[data-task-id="${currentTask.id}"]`) : null;

            if (!currentTask) {
                isProcessingTask = false;
                showCustomAlert('No Task Selected', 'Select a task before claiming.', 'warning');
                if (taskBtn) {
                    taskBtn.dataset.locked = '0';
                    taskBtn.disabled = false;
                }
                return;
            }

            const taskId = currentTask.id;

            const actionId = await requestActionId(`completeTask_${taskId}`);
            if (!actionId) {
                isProcessingTask = false;
                taskActionState = 'JOIN_OR_CLAIM';
                if (taskBtn) {
                    taskBtn.dataset.locked = '0';
                    taskBtn.disabled = false;
                }
                updateUI();
                return;
            }

            const result = await fetchApi({
                type: 'completeTask',
                action_id: actionId,
                task_id: taskId
            });
            
            isProcessingTask = false;

            if (result.ok) {
                updateState({ 
                    balance: result.data.new_balance
                });

                if (currentTask) currentTask.is_completed = true;

                const el = document.querySelector(`div[data-task-id="${taskId}"]`);
                if (el) el.remove();

                const tasks = await fetchTasks();
                renderTasksList(tasks);

                showCustomAlert('Reward Claimed!', `You received ${Number(result.data.actual_reward || currentTask.reward || 0).toLocaleString('en-US')} SHIB for completing the task!`, 'success');
                
            } else {
                await loadUserData();
                const tasks = await fetchTasks();
                renderTasksList(tasks);
                taskActionState = 'JOIN_OR_CLAIM';
                if (taskBtn) taskBtn.textContent = 'Open';
            }

            if (taskBtn) {
                taskBtn.dataset.locked = '0';
                taskBtn.disabled = false;
            }

            updateUI();
        }

        function handleTaskAction() {
            const taskBtn = document.getElementById('taskActionBtn');

            if (!currentTask) {
                showCustomAlert('No Task Selected', 'Please choose a task from the list first.', 'warning');
                return;
            }
            
            if (currentTask.is_completed) {
                showCustomAlert('Task Completed!', 'Reward already claimed for this task.', 'warning');
                return;
            }
            
            if (isProcessingTask) return;
            
            const channelLink = currentTask.link || '';

            if (taskActionState === 'JOIN_OR_CLAIM') {
                if (channelLink && typeof Telegram.WebApp.openTelegramLink === 'function') {
                     Telegram.WebApp.openTelegramLink(channelLink);
                } else if (channelLink) {
                     window.open(channelLink, '_blank');
                } else {
                     showCustomAlert('No Link', 'This task has no join link. Click Claim to verify.', 'warning');
                }
                
                setTimeout(() => {
                    taskActionState = 'CLAIM'; 
                    if (taskBtn) {
                        taskBtn.disabled = false;
                        taskBtn.textContent = 'Claim';
                    }
                    showCustomAlert('Action Required', 'Please ensure you joined the channel. Click the button again to start the reward verification.', 'info');
                }, 1500);


            } else if (taskActionState === 'CLAIM') {
                claimTaskReward();
            }
        }

        /* ===== Invite Screen Functions (No changes needed) ===== */
        
        function inviteFriends() {
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            mainScreen.classList.remove('visible');
            document.getElementById('inviteScreen').classList.add('visible');
            generateReferralLink();
            loadUserData();
        }

        function hideInvite(){
            document.getElementById('inviteScreen').classList.remove('visible');
            mainScreen.classList.add('visible');
        }
        
        function generateReferralLink() {
            const referralLinkInput = document.getElementById('referralLinkInput');
            
            if (!tgUser) {
                referralLinkInput.value = 'User data not available.';
                return;
            }
            
            const userId = tgUser.id;
            const botPath = "Bot_ad_watchbot/earn"; 
            const inviteLink = `https://t.me/${botPath}?startapp=ref_${userId}`;
            
            referralLinkInput.value = inviteLink;
        }

        function copyReferralLink() {
            const inviteLink = document.getElementById('referralLinkInput').value;
            
            if (inviteLink === 'User data not available.' || inviteLink === 'Generating Link...') {
                showCustomAlert('Error!', 'The referral link is not ready yet. Please wait a moment.', 'warning');
                return;
            }

            navigator.clipboard.writeText(inviteLink).then(() => {
                try { Telegram.WebApp.HapticFeedback.notificationOccurred('success'); } catch(e){}
                showCustomAlert('Link Copied!', 'The referral link has been copied to the clipboard.', 'success');
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                showCustomAlert('Copy Failed!', 'Failed to copy the link. Please try again.', 'error');
            });
        }

        function shareReferralLink() {
            const inviteLink = document.getElementById('referralLinkInput').value;

            if (inviteLink === 'User data not available.' || inviteLink === 'Generating Link...' || inviteLink === 'Generating link...') {
                showCustomAlert('Link not ready', 'Please wait a moment until your invite link is generated.', 'warning');
                return;
            }

            const message = `Join me using my invite link:\n${inviteLink}`;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(message)}`;

            // Prefer native share where available
            if (navigator.share) {
                navigator.share({ title: 'Invite Link', text: message, url: inviteLink }).catch(()=>{});
            }

            try {
                if (window.Telegram && Telegram.WebApp) {
                    if (Telegram.WebApp.openTelegramLink) {
                        Telegram.WebApp.openTelegramLink(shareUrl);
                    } else if (Telegram.WebApp.openLink) {
                        Telegram.WebApp.openLink(shareUrl);
                    } else {
                        window.open(shareUrl, '_blank');
                    }
                    try { Telegram.WebApp.HapticFeedback.impactOccurred('light'); } catch(e){}
                } else {
                    window.open(shareUrl, '_blank');
                }
            } catch (e) {
                window.open(shareUrl, '_blank');
            }
        }

        /* ===== End of Invite Screen Functions ===== */


        /* ===== Spin Wheel (Wheel Code) ===== */
        const colors = ['#00bfff', '#ff8c00', '#28a745', '#ff4500', '#00f2fe'];
        const prizeValues = sectors; 
        const canvas = document.getElementById('wheelCanvas');
        const wheelBox = document.getElementById('wheelBox');
        const ctx = canvas.getContext('2d');
        const spinResult = document.getElementById('spinResult');
        const spinBtn    = document.getElementById('spinBtn'); 
        let spinning = false;
        let wheelAnimating = false;
        let currentAngle = 0;
        if (wheelBox) wheelBox.classList.add('idle');

        // Preload the icon that will be drawn into every sector (35x35 target)
        const wheelIcon = new Image();
        wheelIcon.crossOrigin = "anonymous";
        wheelIcon.src = 'https://files.catbox.moe/4se3k0.jpg';
        let wheelIconLoaded = false;
        wheelIcon.onload = () => { wheelIconLoaded = true; drawWheel(); };
        wheelIcon.onerror = () => { wheelIconLoaded = false; console.warn('Wheel icon failed to load; emoji fallback will be used.'); drawWheel(); };

        function drawWheel() {
            if (!ctx) return;

            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const radius = 130;
            const sectorCount = sectors.length;
            const arc = (2 * Math.PI) / sectorCount;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Smoother edges / premium rendering
            ctx.imageSmoothingEnabled = true;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            // ---- Sectors (keep SAME colors, add subtle depth) ----
            sectors.forEach((val, i) => {
                const start = i * arc - Math.PI / 2;
                const end = start + arc;

                // Base sector fill (no color changes)
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.arc(centerX, centerY, radius, start, end);
                ctx.closePath();

                ctx.fillStyle = colors[i % colors.length];
                ctx.fill();

                // Subtle 3D shading overlay (white/black alpha only)
                ctx.clip();
                const shade = ctx.createRadialGradient(
                    centerX - radius * 0.28, centerY - radius * 0.32, radius * 0.12,
                    centerX, centerY, radius
                );
                shade.addColorStop(0.00, 'rgba(255,255,255,0.22)');
                shade.addColorStop(0.45, 'rgba(255,255,255,0.04)');
                shade.addColorStop(0.80, 'rgba(0,0,0,0.10)');
                shade.addColorStop(1.00, 'rgba(0,0,0,0.20)');
                ctx.fillStyle = shade;
                ctx.fillRect(centerX - radius - 8, centerY - radius - 8, (radius + 8) * 2, (radius + 8) * 2);

                // Very light outer-edge gloss (keeps color, adds polish)
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius - 1.5, start, end);
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(255,255,255,0.10)';
                ctx.stroke();

                // Shiba icon (same as before, no labels)
                const angle = start + arc / 2;
                const imgX = centerX + radius * 0.56 * Math.cos(angle);
                const imgY = centerY + radius * 0.56 * Math.sin(angle);
                const iconSize = 34;

                // soft shadow under the badge (neutral)
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.22)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 4;
                ctx.beginPath();
                ctx.arc(imgX, imgY, iconSize / 2 + 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.03)';
                ctx.fill();
                ctx.restore();

                if (wheelIconLoaded) {
                    try {
                        // circular clip for the icon
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(imgX, imgY, iconSize / 2, 0, Math.PI * 2);
                        ctx.closePath();
                        ctx.clip();
                        ctx.drawImage(wheelIcon, imgX - iconSize / 2, imgY - iconSize / 2, iconSize, iconSize);
                        ctx.restore();

                        // refined badge ring (soft, not harsh)
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(imgX, imgY, iconSize / 2 + 1, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(255,255,255,0.70)';
                        ctx.lineWidth = 1.5;
                        ctx.shadowColor = 'rgba(255,255,255,0.10)';
                        ctx.shadowBlur = 6;
                        ctx.stroke();

                        // tiny highlight arc
                        ctx.beginPath();
                        ctx.arc(imgX, imgY, iconSize / 2 + 0.4, -Math.PI * 0.85, -Math.PI * 0.10);
                        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.restore();
                    } catch (e) {
                        // fallback emoji (Shiba)
                        ctx.save();
                        ctx.translate(imgX, imgY);
                        ctx.rotate(angle + Math.PI / 2);
                        ctx.fillStyle = '#000';
                        ctx.fillText('🐶', 0, 0);
                        ctx.restore();
                    }
                } else {
                    ctx.save();
                    ctx.translate(imgX, imgY);
                    ctx.rotate(angle + Math.PI / 2);
                    ctx.fillStyle = '#000';
                    ctx.fillText('🐶', 0, 0);
                    ctx.restore();
                }

                ctx.restore();
            });

            // ---- Soft section separation (no harsh/raised lines) ----
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // soft highlight line (very subtle)
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.lineWidth = 1.35;
            ctx.shadowColor = 'rgba(255,255,255,0.10)';
            ctx.shadowBlur = 6;
            for (let i = 0; i < sectorCount; i++) {
                const a = i * arc - Math.PI / 2;
                const r0 = 18;           // leave center clean
                const r1 = radius - 3;   // avoid harsh outer edge
                ctx.beginPath();
                ctx.moveTo(centerX + r0 * Math.cos(a), centerY + r0 * Math.sin(a));
                ctx.lineTo(centerX + r1 * Math.cos(a), centerY + r1 * Math.sin(a));
                ctx.stroke();
            }

            // soft shade line for gentle depth
            ctx.shadowColor = 'rgba(0,0,0,0.12)';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = 'rgba(0,0,0,0.10)';
            ctx.lineWidth = 1.05;
            for (let i = 0; i < sectorCount; i++) {
                const a = i * arc - Math.PI / 2;
                const r0 = 18;
                const r1 = radius - 4;
                const off = 0.012;
                ctx.beginPath();
                ctx.moveTo(centerX + r0 * Math.cos(a + off), centerY + r0 * Math.sin(a + off));
                ctx.lineTo(centerX + r1 * Math.cos(a + off), centerY + r1 * Math.sin(a + off));
                ctx.stroke();
            }

            ctx.restore();

            // ---- Global inner shadow (subtle depth) ----
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.clip();

            const innerShadow = ctx.createRadialGradient(centerX, centerY, radius * 0.55, centerX, centerY, radius);
            innerShadow.addColorStop(0.00, 'rgba(0,0,0,0.00)');
            innerShadow.addColorStop(0.72, 'rgba(0,0,0,0.00)');
            innerShadow.addColorStop(1.00, 'rgba(0,0,0,0.22)');
            ctx.fillStyle = innerShadow;
            ctx.fillRect(centerX - radius - 10, centerY - radius - 10, (radius + 10) * 2, (radius + 10) * 2);
            ctx.restore();

            // ---- Light glossy highlight (screen blend, very subtle) ----
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.clip();

            ctx.globalCompositeOperation = 'screen';
            const gloss = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
            gloss.addColorStop(0.00, 'rgba(255,255,255,0.00)');
            gloss.addColorStop(0.24, 'rgba(255,255,255,0.05)');
            gloss.addColorStop(0.35, 'rgba(255,255,255,0.10)');
            gloss.addColorStop(0.55, 'rgba(255,255,255,0.03)');
            gloss.addColorStop(1.00, 'rgba(255,255,255,0.00)');
            ctx.fillStyle = gloss;
            ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

            ctx.globalCompositeOperation = 'source-over';
            ctx.restore();

            // ---- Refined outer ring (beveled rim) ----
            // Outer rim shadow
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius + 7, 0, 2 * Math.PI);
            ctx.lineWidth = 14;
            ctx.shadowColor = 'rgba(0,0,0,0.26)';
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 6;
            ctx.strokeStyle = 'rgba(0,0,0,0.10)';
            ctx.stroke();
            ctx.restore();

            // Outer rim highlight / bevel
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius + 6, 0, 2 * Math.PI);
            ctx.lineWidth = 12;
            const rim = ctx.createRadialGradient(centerX, centerY, radius + 1, centerX, centerY, radius + 12);
            rim.addColorStop(0.00, 'rgba(255,255,255,0.70)');
            rim.addColorStop(0.55, 'rgba(255,255,255,0.18)');
            rim.addColorStop(1.00, 'rgba(0,0,0,0.22)');
            ctx.strokeStyle = rim;
            ctx.stroke();
            ctx.restore();

            // Inner rim line (crisp edge)
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius - 0.5, 0, 2 * Math.PI);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.30)';
            ctx.stroke();
            ctx.restore();

            // ---- Center decoration (kept as-is, no text/icons) ----
            ctx.beginPath();
            ctx.fillStyle = '#fff';
            ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#ff3366';
            ctx.lineWidth = 4;
            ctx.stroke();

            ctx.beginPath();
            ctx.fillStyle = '#ff3366';
            ctx.arc(centerX, centerY, 8, 0, 2 * Math.PI);
            ctx.fill();

            ctx.shadowColor = 'transparent';
        }
        drawWheel();

        async function startSpin(){
            if(spinning) return;
            
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            
            if (spinsToday >= DAILY_MAX_SPINS) {
                showCustomAlert('Daily Limit Reached', `You have used all spins for today (${DAILY_MAX_SPINS}).`, 'warning');
                return;
            }
            
            const preSpinActionId = await requestActionId('preSpin');
            if (!preSpinActionId) return;

            const preSpinReqResult = await fetchApi({ 
                type: 'preSpin',
                action_id: preSpinActionId
            });

            if (!preSpinReqResult.ok) {
                await loadUserData(); 
                return; 
            }
            
            const spinResultActionId = await requestActionId('spinResult');
            if (!spinResultActionId) {
                showCustomAlert('Security Error!', 'Failed to get confirmation token. Please try again.', 'error');
                await loadUserData(); 
                return;
            }
            
            try {
                await show_10245709();
                await show_10245709();

                const adsgram = await showAdsGramRewarded();
                if (!adsgram.ok) {
                    if (adsgram.reason === 'not_ready') {
                        showCustomAlert('AdsGram Not Ready', 'AdsGram ad is not available right now. Please try again.', 'error');
                    } else if (adsgram.reason === 'not_done') {
                        showCustomAlert('Ad Cancelled', 'Watch the AdsGram ad till the end to spin and receive the reward.', 'warning');
                    } else {
                        showCustomAlert('AdsGram Error', 'Unable to show AdsGram ad. Please try again later.', 'error');
                    }
                    await loadUserData();
                    return;
                }

                spinning = true;
                spinBtn.disabled = true;
                spinResult.textContent = '';
canvas.classList.add('spinning');

                const spinResultRes = await fetchApi({ 
                    type: 'spinResult',
                    action_id: spinResultActionId
                });
                
                if (spinResultRes.ok) {
                    const finalPrize = spinResultRes.data.actual_prize;
                    const prizeIndex = spinResultRes.data.prize_index !== undefined ? spinResultRes.data.prize_index : 0; 
                    
                    const sectorCount = sectors.length; 
                    const arc = 2 * Math.PI / sectorCount; 
                    
                    const winningAngle = prizeIndex * arc + arc / 2; 
                    
                    let rotationToApply = Math.PI / 2 - winningAngle;
                    
                    rotationToApply = rotationToApply + (5 * 2 * Math.PI); 
                    
                    currentAngle += rotationToApply;

                                        // Premium spin motion: ease-out with a very subtle bounce
                    wheelAnimating = true;
                    const startAngle = currentAngle - rotationToApply;
                    const targetAngle = currentAngle;
                    const bounce = Math.PI / 120; // ~1.5deg, very subtle

                    const finalizeSpin = async () => {
                        canvas.style.transition = '';
                        canvas.style.transform = `rotate(${targetAngle}rad)`;
                        canvas.classList.remove('spinning');
                        if (wheelBox) {
                            wheelBox.classList.remove('spinning');
                            wheelBox.classList.add('idle');
                        }
                      
                        updateState({ 
                            balance: spinResultRes.data.new_balance,
                            spins_today: spinResultRes.data.new_spins_count
                        });
                        
                        spinResult.textContent = '';
showCustomAlert('Congratulations!', `You won ${Number(finalPrize || 0).toLocaleString('en-US')} SHIB!`, 'success');
                        
                        await loadUserData();
                        // unlock UI after wheel settles
                        wheelAnimating = false;
                        spinning = false;
                        if (spinBtn) spinBtn.disabled = false;
                        updateUI();
                    };

                    // start visual states
                    if (wheelBox) {
                        wheelBox.classList.add('spinning');
                        wheelBox.classList.remove('idle');
                        wheelBox.classList.add('spin-flash');
                        setTimeout(() => wheelBox.classList.remove('spin-flash'), 650);
                    }

                    if (canvas.animate) {
                        // cancel any previous animations
                        canvas.getAnimations().forEach(a => a.cancel());
                        const anim = canvas.animate(
                            [
                                { transform: `rotate(${startAngle}rad)`, offset: 0 },
                                { transform: `rotate(${targetAngle + bounce}rad)`, offset: 0.95, easing: 'cubic-bezier(0.22,0,0.2,1)' },
                                { transform: `rotate(${targetAngle}rad)`, offset: 1, easing: 'cubic-bezier(0.2,1,0.2,1)' }
                            ],
                            { duration: 3200, fill: 'forwards' }
                        );
                        anim.onfinish = finalizeSpin;
                    } else {
                        // Fallback: CSS transition + tiny overshoot
                        canvas.style.transition = 'transform 3s cubic-bezier(0.22,0,0.2,1)';
                        requestAnimationFrame(() => {
                            canvas.style.transform = `rotate(${targetAngle + bounce}rad)`;
                        });
                        setTimeout(() => {
                            canvas.style.transition = 'transform 240ms cubic-bezier(0.2,1,0.2,1)';
                            canvas.style.transform = `rotate(${targetAngle}rad)`;
                        }, 2950);
                        setTimeout(finalizeSpin, 3200);
                    }
 

                } else {
                    canvas.classList.remove('spinning');
                    canvas.style.transition = '';
                    spinResult.textContent = '';
showCustomAlert('Error!', 'Error receiving prize from the server. Please try again.', 'error');
                    await loadUserData(); 
                }
            } catch (e) {
                console.error("libtl.com Ad failed to show or was dismissed:", e);
                if (typeof e === 'string' && e.includes('canceled')) {
                    showCustomAlert('Ad Cancelled', 'The ad was not watched completely. The attempt was not counted.', 'warning');
                } else {
                    showCustomAlert('Ad Load Failed', 'Ad failed to load. The attempt was not counted. Please try again.', 'error');
                }
                await loadUserData();
            } finally {
                // Avoid resetting while the wheel animation is running
                if (!wheelAnimating) {
                    // Ensure wheel and button are reset in error paths to prevent "freeze/تعليق"
                    try {
                        canvas.classList.remove('spinning');
                        canvas.style.transition = '';
                    } catch (err) {}
                    spinning = false;
                    if (spinBtn) spinBtn.disabled = false;
                    updateUI();
                }
            }
        }

        /* ===== Navigation and Withdraw (No changes needed) ===== */
        function showSpin(){
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            mainScreen.classList.remove('visible');
            document.getElementById('spinScreen').classList.add('visible');
            loadUserData();
            updateUI(); 
        }
        function hideSpin(){
            document.getElementById('spinScreen').classList.remove('visible');
            mainScreen.classList.add('visible');
        }
        
        function showWithdraw(){
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            mainScreen.classList.remove('visible');
            document.getElementById('withdrawScreen').classList.add('visible');
            loadUserData();
            displayWithdrawals(); 
        }
        
        function hideWithdraw(){
            document.getElementById('withdrawScreen').classList.remove('visible');
            mainScreen.classList.add('visible');
        }
        
        function displayWithdrawals() {
            const container = document.getElementById('withdrawalHistoryContainer');
            if (!container) {
                return;
            }
            if (!withdrawalHistory || withdrawalHistory.length === 0) {
                container.innerHTML = '<div class="no-records">No withdrawal requests currently.</div>';
                return;
            }

            let tableHTML = '<table class="history-table">';
            tableHTML += '<thead><tr><th>Date</th><th>Amount (SHIB)</th><th>Status</th></tr></thead>';
            tableHTML += '<tbody>';

            withdrawalHistory.slice(0,5).forEach(record => {
                const statusText = record.status === 'pending' ? 'Pending' : 'Completed';
                const statusClass = record.status === 'pending' ? 'status-pending' : 'status-completed';
                const dest = record.binance_id ? record.binance_id : (record.faucetpay_email ? record.faucetpay_email : '-');
                tableHTML += `
                    <tr>
                        <td>${record.date}</td>
                        <td>${Number(record.amount).toLocaleString('en-US')}</td>
                        <td><span class="${statusClass}">${statusText}</span></td>
                    </tr>
                `;
            });

            tableHTML += '</tbody></table>';
            container.innerHTML = tableHTML;
        }

        function displayWithdrawalsFull() {
            mainScreen.classList.remove('visible');
            document.getElementById('withdrawScreen').classList.remove('visible');
            const screen = document.getElementById('withdrawHistoryScreen');
            const list = document.getElementById('withdrawHistoryList');
            screen.classList.add('visible');

            if (!withdrawalHistory || withdrawalHistory.length === 0) {
                list.innerHTML = `<div class="history-empty">No withdrawal records.</div>`;
                return;
            }

            const html = withdrawalHistory.map(rec => {
                const isBinance = !!rec.binance_id;
                const method = isBinance ? 'Binance' : (rec.faucetpay_email ? 'FaucetPay' : '—');
                const dest = isBinance ? rec.binance_id : (rec.faucetpay_email ? rec.faucetpay_email : '-');
                const statusText = rec.status === 'pending' ? 'Pending' : 'Completed';
                const statusClass = rec.status === 'pending' ? 'status-pending' : 'status-completed';
                return `
                    <div class="history-item">
                        <div class="left">
                            <div class="history-row"><strong>Date:</strong> <span>${escapeHtml(rec.date || '-') }</span></div>
                            <div class="history-row"><strong>Method:</strong> <span>${escapeHtml(method)}</span></div>
                            <div class="history-row history-dest"><strong>Dest:</strong> <span>${escapeHtml(dest)}</span></div>
                        </div>
                        <div class="right">
                            <div class="amount">${Number(rec.amount).toLocaleString('en-US')} SHIB</div>
                            <div class="${statusClass}">${statusText}</div>
                        </div>
                    </div>
                `;
            }).join('');
            list.innerHTML = html;
        }

        function closeWithdrawHistory(){
            document.getElementById('withdrawHistoryScreen').classList.remove('visible');
            document.getElementById('withdrawScreen').classList.add('visible');
            displayWithdrawals(); 
        }

        async function confirmWithdraw(){
            const btn = document.getElementById('withdrawRequestBtn');
            if (window.__withdrawSubmitting) return;
            window.__withdrawSubmitting = true;
            if (btn){
                btn.disabled = true;
                btn.classList.add('is-loading');
                btn.setAttribute('aria-busy','true');
            }
            try{
            if (isBanned) {
                 showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                 return;
            }
            
            const selectedMethod = document.querySelector('input[name="withdrawMethod"]:checked') ? document.querySelector('input[name="withdrawMethod"]:checked').value : 'binance';
            const binanceId = document.getElementById('binanceId').value.trim();
            const faucetpayEmail = document.getElementById('faucetpayEmail').value.trim();
            const amount = parseFloat(document.getElementById('withdrawAmount').value);
            
            if(selectedMethod === 'binance') {
                if(!binanceId || binanceId.length < 4){ 
                    showCustomAlert('Invalid Input!', 'Please enter a valid Binance User ID.', 'warning'); 
                    return; 
                }
            } else {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if(!faucetpayEmail || !emailRegex.test(faucetpayEmail)){
                    showCustomAlert('Invalid Input!', 'Please enter a valid FaucetPay email address.', 'warning'); 
                    return;
                }
            }

            if(isNaN(amount) || amount < 4000){ 
                showCustomAlert('Invalid Amount!', 'The minimum withdrawal amount is 4000 SHIB.', 'warning'); 
                return; 
            }
            if(amount > shibBalance){ 
                showCustomAlert('Balance Error!', `Your balance is insufficient. Your current balance is ${Number(shibBalance).toLocaleString('en-US')} SHIB.`, 'error'); 
                return; 
            }
            
            const actionId = await requestActionId('withdraw');
            if (!actionId) return;

            const payload = {
                type: 'withdraw',
                amount: amount,
                action_id: actionId
            };
            if (selectedMethod === 'faucetpay') {
                payload.faucetpay_email = faucetpayEmail;
            } else {
                payload.binanceId = binanceId;
            }

            const result = await fetchApi(payload);

            if (result.ok) {
                updateState({ balance: result.data.new_balance });
                
                await loadUserData(); 
                displayWithdrawals(); 
                
                const destText = selectedMethod === 'faucetpay' ? `FaucetPay: ${faucetpayEmail}` : `Binance ID: ${binanceId}`;
                showCustomAlert('Request Sent!', `Details:\n${destText}\nAmount: ${Number(amount).toLocaleString('en-US')} SHIB\n\nThe transfer will be processed within 24 hours.`, 'success');
            }
        
            } finally {
                window.__withdrawSubmitting = false;
                if (btn){
                    btn.classList.remove('is-loading');
                    btn.removeAttribute('aria-busy');
                }
                if (typeof updateWithdrawButtonState === 'function'){
                    updateWithdrawButtonState();
                }
            }
        }
        
        document.addEventListener('click', (e) => {
            const mBin = document.getElementById('methodBinance');
            const mFaucet = document.getElementById('methodFaucetpay');
            if (e.target.closest('#methodBinance')) {
                mBin.classList.add('active');
                mFaucet.classList.remove('active');
                document.getElementById('binanceGroup').style.display = 'block';
                document.getElementById('faucetpayGroup').style.display = 'none';
            } else if (e.target.closest('#methodFaucetpay')) {
                mFaucet.classList.add('active');
                mBin.classList.remove('active');
                document.getElementById('binanceGroup').style.display = 'none';
                document.getElementById('faucetpayGroup').style.display = 'block';
            }
        });
        // Update withdraw button state live while typing the amount
        document.addEventListener('input', (e) => {
            if (e && e.target && e.target.id === 'withdrawAmount') {
                updateWithdrawButtonState();
            }
        });



        

        // Quick amount chips (Min / presets / Max)
        document.addEventListener('click', (e) => {
            const chip = e.target && e.target.closest ? e.target.closest('[data-withdraw-chip]') : null;
            if (!chip) return;
            const amountEl = document.getElementById('withdrawAmount');
            if (!amountEl) return;
            const bal = Number(shibBalance || 0);
            let v = chip.getAttribute('data-withdraw-chip');
            let next = 0;
            if (v === 'max') next = bal;
            else next = Number(v);
            if (!Number.isFinite(next) || next <= 0) return;
            amountEl.value = Math.floor(next);
            amountEl.dispatchEvent(new Event('input', { bubbles: true }));
            amountEl.focus();
        });

// ===== Contest Functions (UPDATED to use server data for tickets and ranking) =====
        function showContest() {
            if (isBanned) {
                showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                return;
            }
            mainScreen.classList.remove('visible');
            document.getElementById('contestScreen').classList.add('visible');
            startContestCountdown();
            loadContestData();
        }

        function hideContest() {
            clearInterval(contestCountdownInterval);
            document.getElementById('contestScreen').classList.remove('visible');
            mainScreen.classList.add('visible');
        }

        function startContestCountdown() {
            contestCountdownInterval = setInterval(() => {
                const now = new Date().getTime();
                const distance = contestEndTime - now;

                if (distance < 0) {
                    clearInterval(contestCountdownInterval);
                    document.getElementById('contestCountdown').textContent = "Contest Ended";
                    return;
                }

                const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                document.getElementById('contestCountdown').textContent = 
                    `${days}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
            }, 1000);
        }

        // Load contest data (trusted from server). Server should return { my_tickets, all_tickets }.
        async function loadContestData() {
            const res = await fetchApi({ type: 'getContestData' });
            if (res.ok && res.data) {
                myTickets = res.data.my_tickets || 0;
                allTickets = res.data.all_tickets || 0;
                // if server returns contest time, update local countdown
                if (res.data && res.data.time && res.data.time.end_time) {
                    const end = new Date(res.data.time.end_time).getTime();
                    if (!isNaN(end)) {
                        contestEndTime = end;
                    }
                }
            } else {
                myTickets = 0;
                allTickets = 0;
            }
            updateContestUI();
        }

        function updateContestUI() {
            document.getElementById('myTickets').textContent = Number(myTickets || 0).toLocaleString('en-US');
            document.getElementById('allTickets').textContent = Number(allTickets || 0).toLocaleString('en-US');
        }

        async function watchContestAd() {
            if (isBanned) {
                showCustomAlert('Access Denied!', 'This account has been banned.', 'error');
                return;
            }

            // Prevent automated/frequent clicks by locking the button for a short duration
            if (contestAdLocked) {
                showCustomAlert('Please wait', 'The contest watch button is temporarily locked to prevent abuse. Try again shortly.', 'warning');
                return;
            }

            const btn = document.querySelector('.contest-watch-btn');
            if (btn) {
                contestAdLocked = true;
                btn.disabled = true;
                btn.classList.add('locked');
            }

            const actionId = await requestActionId('contestWatchAd');
            if (!actionId) {
                if (btn) {
                    setTimeout(() => { contestAdLocked = false; btn.disabled = false; btn.classList.remove('locked'); }, 3000);
                }
                return;
            }

            try {
                await show_10245709();

                const adsgram = await showAdsGramRewarded();
                if (!adsgram.ok) {
                    if (adsgram.reason === 'not_ready') {
                        showCustomAlert('AdsGram Not Ready', 'AdsGram ad is not available right now. Please try again.', 'error');
                    } else if (adsgram.reason === 'not_done') {
                        showCustomAlert('Ad Cancelled', 'Watch the AdsGram ad till the end to receive the reward.', 'warning');
                    } else {
                        showCustomAlert('AdsGram Error', 'Unable to show AdsGram ad. Please try again later.', 'error');
                    }
                    if (btn) {
                        setTimeout(() => { contestAdLocked = false; btn.disabled = false; btn.classList.remove('locked'); }, 3000);
                    }
                    return;
                }

                const result = await fetchApi({
                    type: 'contestWatchAd',
                    action_id: actionId
                });

                if (result.ok) {
                    // Update tickets from server's authoritative response
                    if (result.data) {
                        myTickets = result.data.my_tickets !== undefined ? result.data.my_tickets : myTickets;
                        allTickets = result.data.all_tickets !== undefined ? result.data.all_tickets : allTickets;
                    } else {
                        myTickets += 5; // fallback minimal update if server doesn't return structured data
                    }
                    updateContestUI();
                    showCustomAlert('Contest Reward!', `You earned 5 tickets! You now have ${Number(myTickets).toLocaleString('en-US')} tickets.`, 'success');
                } else {
                    showCustomAlert('Contest Error', 'Server did not confirm ticket reward. Please try again.', 'error');
                }
            } catch (e) {
                showCustomAlert('Ad Failed!', 'Ad failed to load. Please try again.', 'error');
            } finally {
                // Ensure unlock after a short delay to mitigate auto-clicking
                const btnEl = document.querySelector('.contest-watch-btn');
                setTimeout(() => {
                    contestAdLocked = false;
                    if (btnEl) {
                        btnEl.disabled = false;
                        btnEl.classList.remove('locked');
                    }
                }, 8000); // 8 seconds lock
            }
        }

        function showContestRank() {
            mainScreen.classList.remove('visible');
            document.getElementById('contestScreen').classList.remove('visible');
            document.getElementById('contestRankScreen').classList.add('visible');

            // Add class to body to hide duplicate top user info as requested
            document.body.classList.add('hide-top-user');

            loadContestRank();
        }

        function hideContestRank() {
            document.getElementById('contestRankScreen').classList.remove('visible');
            document.getElementById('contestScreen').classList.add('visible');

            // Remove the hiding class
            document.body.classList.remove('hide-top-user');
        }

        // Load ranking from server. Server must return { players: [ { first_name, photo_url, user_id, tickets, username } ] } ordered by rank.
        async function loadContestRank() {
            const res = await fetchApi({ type: 'getContestRank' });
            let players = [];
            if (res.ok && Array.isArray(res.data.players)) {
                players = res.data.players;
            } else {
                players = [];
            }

            const list = document.getElementById('contestRankList');
            const updatedAtEl = document.getElementById('rankUpdatedAt');
            const stampUpdated = () => {
                if (!updatedAtEl) return;
                updatedAtEl.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            };

            if (!list) return;

            if (!players || players.length === 0) {
                list.innerHTML = `<div style="text-align:center;color:#cfeeff;padding:20px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);">No entries yet.</div>`;
                renderPersonalUserBox(players);
                stampUpdated();
                return;
            }

            stampUpdated();

            // We'll use a single default avatar when photo is missing
            const DEFAULT_AVATAR = 'https://giftgogame.com/static/thumbnails/5170233102089322756.webp';

            // Current user id from Telegram init data (if available)
            const currentUserId = tgUser && tgUser.id ? String(tgUser.id) : null;

            // Build each row using required order and fields:
            // [ avatar(circle) | first_name (+ You if current) and username | user_id | tickets | rank ]
            list.innerHTML = players.map((player, index) => {
                const pos = index + 1;

                // Prefer explicit first_name sent by server; fallback to name or empty
                const firstNameRaw = player.first_name || player.name || '';
                const firstNameSafe = String(firstNameRaw).replace(/</g,'&lt;').replace(/>/g,'&gt;') || 'User';

                // Determine user id field (server should provide user_id only)
                const userIdRaw = player.user_id !== undefined ? player.user_id : (player.userId !== undefined ? player.userId : '');
                const userIdSafe = String(userIdRaw).replace(/</g,'&lt;').replace(/>/g,'&gt;');

                // Username (telegram handle) if provided by server
                const rawUsername = player.username || player.user_name || player.tg_username || '';
                const usernameSafe = String(rawUsername).replace(/</g,'&lt;').replace(/>/g,'&gt;');

                // Use photo_url field if present; fallback to avatar or default
                const photoUrl = player.photo_url || player.photo || player.avatar || '';

                // Use the provided photo_url for the current user if available (tgUser.photo_url)
                let avatarSrc = photoUrl || DEFAULT_AVATAR;
                if (currentUserId !== null && String(userIdRaw) === currentUserId) {
                    // override avatar for current user with Telegram WebApp photo_url if available
                    if (tgUser && tgUser.photo_url) {
                        avatarSrc = tgUser.photo_url;
                    }
                }

                // Tickets (server returns number)
                const tickets = Number(player.tickets || player.tickets_count || player.points || 0).toLocaleString('en-US');

                // Detect current user
                const isCurrent = currentUserId !== null && String(userIdRaw) === currentUserId;
                const rowClass = isCurrent ? 'contest-rank-item current-player' : 'contest-rank-item';

                // first_name display: show full first_name and append " (You)" visually next to the name (only text)
                const displayName = isCurrent ? `${firstNameSafe} (You)` : `${firstNameSafe}`;

                // username display (show @username if available)
                const usernameDisplay = usernameSafe ? `@${usernameSafe}` : '';

                // Construct safe HTML for the row with strict truncation rules applied via CSS
                // Note: tickets shown as number only per requirement (e.g., "400")
                return `
                    <div class="${rowClass}" data-rank="${pos}" role="article" aria-label="Player ${pos}">
                        <img src="${avatarSrc || DEFAULT_AVATAR}" class="contest-rank-avatar" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
                        <div class="contest-rank-name" title="${firstNameSafe}">
                            <div class="name-main">${escapeHtml(displayName)}</div>
                            <div class="contest-rank-username">${escapeHtml(usernameDisplay)}</div>
                        </div>
                        <div class="contest-rank-userid" title="${userIdSafe}">${escapeHtml(userIdSafe)}</div>
                        <div class="contest-rank-tickets">${tickets}</div>
                        <div class="contest-rank-position">${pos}</div>
                    </div>
                `;
            }).join('');

            // After rendering, also render the personal user info box with data found in players (authoritative)
            renderPersonalUserBox(players);

            // After rendering, scroll to the current player's position (if present) for visibility
            if (currentUserId) {
                // small timeout to ensure DOM paints
                setTimeout(() => {
                    const el = list.querySelector('.contest-rank-item.current-player');
                    if (el) {
                        // smooth scroll into view within the rank container
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 120);
            }
        }

        // Render the personal user golden box using tgUser and authoritative players array when available

        /* ===== Leaderboard UI helpers removed (search/podium) ===== */



        function renderPersonalUserBox(players) {
            const box = document.getElementById('personalUserBox');
            const avatarEl = document.getElementById('personalAvatar');
            const idEl = document.getElementById('personalIdValue');
            const nameEl = document.getElementById('personalNameValue');
            const ticketsEl = document.getElementById('personalTicketsValue');
            const rankEl = document.getElementById('personalRankValue');

            // default hide
            if (!box || !tgUser) {
                if (box) box.style.display = 'none';
                return;
            }

            const currentUserId = String(tgUser.id);
            // find authoritative player entry if available
            let playerEntry = null;
            if (Array.isArray(players) && players.length > 0) {
                playerEntry = players.find(p => {
                    const pid = p.user_id !== undefined ? String(p.user_id) : (p.userId !== undefined ? String(p.userId) : '');
                    return pid === currentUserId;
                });
            }

            // Avatar priority: playerEntry.photo_url > tgUser.photo_url > default
            const DEFAULT_AVATAR = 'https://giftgogame.com/static/thumbnails/5170233102089322756.webp';
            let avatarSrc = DEFAULT_AVATAR;
            if (playerEntry && (playerEntry.photo_url || playerEntry.avatar || playerEntry.photo)) {
                avatarSrc = playerEntry.photo_url || playerEntry.avatar || playerEntry.photo;
            } else if (tgUser.photo_url) {
                avatarSrc = tgUser.photo_url;
            }

            // Username priority: playerEntry.first_name > tgUser.first_name > fallback
            let displayName = tgUser.first_name || 'User';
            if (playerEntry && (playerEntry.first_name || playerEntry.name)) {
                displayName = playerEntry.first_name || playerEntry.name;
            }

            // Tickets priority: playerEntry.tickets or myTickets
            let ticketCount = myTickets || 0;
            if (playerEntry && (playerEntry.tickets !== undefined || playerEntry.tickets_count !== undefined || playerEntry.points !== undefined)) {
                ticketCount = Number(playerEntry.tickets || playerEntry.tickets_count || playerEntry.points || 0);
            }

            // Compute rank if players array provided
            let rankText = '-';
            if (Array.isArray(players) && players.length > 0) {
                const idx = players.findIndex(p => {
                    const pid = p.user_id !== undefined ? String(p.user_id) : (p.userId !== undefined ? String(p.userId) : '');
                    return pid === currentUserId;
                });
                if (idx !== -1) rankText = (idx + 1).toString();
                else rankText = '-';
            }

            // ID display
            const userIdDisplay = currentUserId;

            // set DOM
            avatarEl.src = avatarSrc || DEFAULT_AVATAR;
            avatarEl.onerror = function(){ this.onerror=null; this.src = DEFAULT_AVATAR; };

            idEl.textContent = userIdDisplay;
            nameEl.textContent = displayName;
            ticketsEl.textContent = Number(ticketCount || 0).toLocaleString('en-US');
            rankEl.textContent = rankText;

            box.style.display = 'flex';
        }

        // Final event listener to ensure background audio starts on the first user interaction
        document.addEventListener('click', function handler() {
            playBGAudio();
            document.removeEventListener('click', handler);
        });
    </script>

<script>
/* Prevent double-tap to zoom (iOS Safari) */
(function(){
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
})();