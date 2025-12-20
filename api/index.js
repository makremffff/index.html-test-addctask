دconst crypto = require('crypto');

// Load environment variables for Supabase connection
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Prefer service role key for server-side operations if available
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || null;
// ⚠️ BOT_TOKEN must be set in Vercel environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;

// Use the service role key if present, otherwise fall back to anon key (less ideal)
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

// ------------------------------------------------------------------
// Fully secured and defined server-side constants
// ------------------------------------------------------------------
const REWARD_PER_AD = 6;
const REFERRAL_COMMISSION_RATE = 0.40;
const DAILY_MAX_ADS = 200; // Max ads limit
const DAILY_MAX_SPINS = 25; // Max spins limit
const RESET_INTERVAL_MS = 6 * 60 * 60 * 1000; // ⬅️ 6 hours in milliseconds
const MIN_TIME_BETWEEN_ACTIONS_MS = 3000; // 3 seconds minimum time between watchAd/spin requests
const ACTION_ID_EXPIRY_MS = 60 * 1000; // 60 seconds for Action ID to be valid
const SPIN_SECTORS = [5, 10, 15, 20, 5];

// ===== Task Link Constants =====
const TASK_LINK_REWARD = 5; // 5 SHIB per task-link click
const TASK_LINK_DAILY_MAX = 200; // daily max clicks tracked server-side

// ------------------------------------------------------------------
// Task Constants
// ------------------------------------------------------------------
const TASK_COMPLETIONS_TABLE = 'user_task_completions'; // default junction table name

// ------------------------------------------------------------------
// Security thresholds
// ------------------------------------------------------------------
const ABUSE_SCORE_THRESHOLD_SHADOW = 6; // example threshold for shadow ban
const ABUSE_SCORE_THRESHOLD_BAN = 12; // threshold for permanent ban
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // window for counting quick actions for escalation

// ------------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------------

function sendSuccess(res, data = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, data }));
}

function sendError(res, message, statusCode = 400) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: message }));
}

/**
 * Lightweight Supabase REST helper using fetch.
 * - tableName: REST endpoint table
 * - method: GET | POST | PATCH | DELETE
 * - body: object or null
 * - queryParams: string starting with ? for filters/select/order
 */
async function supabaseFetch(tableName, method, body = null, queryParams = '?select=*') {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase environment variables are not configured (URL or KEY).');
  }

  const url = `${SUPABASE_URL}/rest/v1/${tableName}${queryParams}`;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  };

  const response = await fetch(url, options);

  if (response.status === 204) {
      return [];
  }

  const text = await response.text().catch(() => null);
  if (!text) {
      return [];
  }
  try {
      const json = JSON.parse(text);
      return json;
  } catch (e) {
      return text;
  }
}

// Simple SHA256 hex helper
function sha256Hex(input) {
    return crypto.createHash('sha256').update(String(input)).digest('hex');
}

// Get IP from request headers (works in serverless)
function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    if (req.connection && req.connection.remoteAddress) return req.connection.remoteAddress;
    if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
    return '0.0.0.0';
}

/**
 * Checks if a user is a member (or creator/admin) of a specific Telegram channel.
 */
async function checkChannelMembership(userId, channelUsername) {
    if (!BOT_TOKEN) {
        console.error('BOT_TOKEN is not configured for membership check.');
        return false;
    }
    
    const chatId = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`; 

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Telegram API error (getChatMember):', errorData.description || response.statusText);
            return false;
        }

        const data = await response.json();
        
        if (!data.ok) {
             console.error('Telegram API error (getChatMember - not ok):', data.description);
             return false;
        }

        const status = data.result.status;
        
        const isMember = ['member', 'administrator', 'creator'].includes(status);
        
        return isMember;

    } catch (error) {
        console.error('Network or parsing error during Telegram API call:', error.message);
        return false;
    }
}

/**
 * Creates or updates a short-lived server session for the user.
 */
async function createOrRefreshSession(userId, ipHash, fpHash, uaHash) {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const hashedToken = sha256Hex(token);
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(); // 24h

        // Upsert session row
        // Attempt to find existing
        const existing = await supabaseFetch('temp_sessions', 'GET', null, `?user_id=eq.${userId}&select=id`);
        if (Array.isArray(existing) && existing.length > 0) {
            await supabaseFetch('temp_sessions', 'PATCH', { token_hash: hashedToken, ip_hash: ipHash, fp_hash: fpHash, ua_hash: uaHash, updated_at: now, expires_at }, `?user_id=eq.${userId}`);
        } else {
            await supabaseFetch('temp_sessions', 'POST', { user_id: userId, token_hash: hashedToken, ip_hash: ipHash, fp_hash: fpHash, ua_hash: uaHash, created_at: now, updated_at: now, expires_at }, '?select=id');
        }

        return token;
    } catch (e) {
        console.warn('createOrRefreshSession failed:', e.message);
        return null;
    }
}

/**
 * Ban or shadow-ban helper (irreversible ban as required).
 * - type: 'ban' or 'shadow'
 */
async function applyBan(userId, ipHash, fpHash, type='ban', reason='suspicious activity') {
    try {
        const update = {};
        if (type === 'ban') {
            update.is_banned = true;
            update.is_shadow_banned = false;
        } else {
            update.is_shadow_banned = true;
        }
        await supabaseFetch('users', 'PATCH', update, `?id=eq.${userId}`);
        // record ban history
        await supabaseFetch('ban_history', 'POST', { user_id: userId, ip_hash: ipHash, fp_hash: fpHash, type, reason, created_at: new Date().toISOString() }, '?select=id');
        console.warn(`User ${userId} ${type} applied due to ${reason}`);
    } catch (e) {
        console.error('applyBan failed:', e.message);
    }
}

/**
 * Limit-Based Reset Logic: Resets counters if the limit was reached AND the interval (6 hours) has passed since.
 */
async function resetDailyLimitsIfExpired(userId) {
    const now = Date.now();

    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${userId}&select=ads_watched_today,spins_today,ads_limit_reached_at,spins_limit_reached_at,task_link_clicks_today,task_link_limit_reached_at`);
        if (!Array.isArray(users) || users.length === 0) {
            return;
        }

        const user = users[0];
        const updatePayload = {};

        if (user.ads_limit_reached_at && user.ads_watched_today >= DAILY_MAX_ADS) {
            const adsLimitTime = new Date(user.ads_limit_reached_at).getTime();
            if (now - adsLimitTime > RESET_INTERVAL_MS) {
                updatePayload.ads_watched_today = 0;
                updatePayload.ads_limit_reached_at = null; 
            }
        }

        if (user.spins_limit_reached_at && user.spins_today >= DAILY_MAX_SPINS) {
            const spinsLimitTime = new Date(user.spins_limit_reached_at).getTime();
            if (now - spinsLimitTime > RESET_INTERVAL_MS) {
                updatePayload.spins_today = 0;
                updatePayload.spins_limit_reached_at = null; 
            }
        }

        if (user.task_link_limit_reached_at && user.task_link_clicks_today >= TASK_LINK_DAILY_MAX) {
            const tlLimitTime = new Date(user.task_link_limit_reached_at).getTime();
            if (now - tlLimitTime > RESET_INTERVAL_MS) {
                updatePayload.task_link_clicks_today = 0;
                updatePayload.task_link_limit_reached_at = null;
            }
        }

        if (Object.keys(updatePayload).length > 0) {
            await supabaseFetch('users', 'PATCH',
                updatePayload,
                `?id=eq.${userId}`);
        }
    } catch (error) {
        console.error(`Failed to check/reset daily limits for user ${userId}:`, error.message);
    }
}

/**
 * Rate Limiting + Behavioral checks:
 * - updates last_activity
 * - counts quick repeated actions and escalate abuse_score
 * - returns { ok: true } or { ok:false, message, escalate: 'shadow'|'ban' }
 */
async function checkRateLimitAndBehavior(userId, req, body) {
    try {
        const ip = getRequestIp(req);
        const ipHash = sha256Hex(ip || '0');
        const now = Date.now();

        // Fetch user row with behavioral fields
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${userId}&select=last_activity,abuse_score,consecutive_quick_actions,cooldown_until,is_banned,is_shadow_banned`);
        if (!Array.isArray(users) || users.length === 0) {
            return { ok: true };
        }
        const user = users[0];

        if (user.is_banned) {
            return { ok: false, message: 'User is banned.', code: 'banned' };
        }

        // Check cooldown
        if (user.cooldown_until) {
            const cooldownUntil = new Date(user.cooldown_until).getTime();
            if (Date.now() < cooldownUntil) {
                return { ok:false, message: 'User in cooldown', code: 'cooldown' };
            }
        }

        // Determine time since last activity
        const lastActivity = user.last_activity ? new Date(user.last_activity).getTime() : 0;
        const timeElapsed = now - lastActivity;

        // If actions are too quick (< MIN_TIME_BETWEEN_ACTIONS_MS), increment counters
        let abuse_score = user.abuse_score || 0;
        let consecutive_quick = user.consecutive_quick_actions || 0;
        let escalate = null;

        if (timeElapsed < MIN_TIME_BETWEEN_ACTIONS_MS) {
            consecutive_quick += 1;
            // increase abuse score incrementally
            abuse_score += 1;
        } else {
            // decay consecutive quick counter slowly
            consecutive_quick = Math.max(0, consecutive_quick - 1);
        }

        // Additional detection: if client claims devtools flag true, escalate more
        if (body && body.devtools) {
            abuse_score += 3;
        }

        // If rapid repeat actions within short window, escalate
        if (consecutive_quick >= 4) {
            abuse_score += 2;
        }

        // Persist back behavioral fields and update last_activity
        await supabaseFetch('users', 'PATCH', { abuse_score, consecutive_quick_actions: consecutive_quick, last_activity: new Date().toISOString() }, `?id=eq.${userId}`);

        // Evaluate thresholds
        if (abuse_score >= ABUSE_SCORE_THRESHOLD_BAN) {
            // permanent ban
            await applyBan(userId, ipHash, body && body.fingerprint_hash ? body.fingerprint_hash : null, 'ban', 'automated detection: abuse_score exceeded');
            escalate = 'ban';
        } else if (abuse_score >= ABUSE_SCORE_THRESHOLD_SHADOW) {
            // shadow ban
            await applyBan(userId, ipHash, body && body.fingerprint_hash ? body.fingerprint_hash : null, 'shadow', 'automated detection: abuse_score high');
            escalate = 'shadow';
        } else if (consecutive_quick >= 3) {
            // Soft cooldown for a short period
            const until = new Date(Date.now() + (30 * 1000)).toISOString(); // 30s cooldown
            await supabaseFetch('users', 'PATCH', { cooldown_until: until }, `?id=eq.${userId}`);
            return { ok: false, message: 'Rate limit: cooldown', code: 'cooldown' };
        }

        return { ok: true, escalate };
    } catch (e) {
        console.error('checkRateLimitAndBehavior failed:', e.message);
        return { ok: true };
    }
}

/**
 * Validate initData from Telegram cryptographically.
 * If invalid and user_id provided, escalate to ban (per requirements).
 */
function validateInitData(initData) {
    if (!initData || !BOT_TOKEN) {
        return false;
    }

    let raw = initData;
    if (typeof initData === 'object') {
        raw = Object.keys(initData).map(k => `${k}=${initData[k]}`).join('&');
    }

    try {
        const urlParams = new URLSearchParams(raw);
        const hash = urlParams.get('hash') || '';
        urlParams.delete('hash');

        const dataCheckString = Array.from(urlParams.entries())
            .map(([key, value]) => `${key}=${value}`)
            .sort()
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto.createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (calculatedHash !== hash) {
            return false;
        }

        const authDateParam = urlParams.get('auth_date');
        if (!authDateParam) return false;
        const authDate = parseInt(authDateParam) * 1000;
        if (Date.now() - authDate > (20 * 60 * 1000)) { // 20 minutes
            return false;
        }

        return true;
    } catch (e) {
        console.warn('validateInitData error:', e.message);
        return false;
    }
}

/**
 * Parses initData (query string) into an object. Returns {} if not parseable.
 */
function parseInitDataToObject(initData) {
    try {
        if (!initData) return {};
        if (typeof initData === 'object') return initData;
        const params = new URLSearchParams(initData);
        const obj = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        return obj;
    } catch (e) {
        return {};
    }
}

/**
 * Processes the commission for the referrer and updates their balance.
 */
async function processCommission(referrerId, refereeId, sourceReward) {
    const commissionAmount = sourceReward * REFERRAL_COMMISSION_RATE; 
    
    if (commissionAmount < 0.000001) { 
        return { ok: false, error: 'Commission amount too small.' };
    }

    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${referrerId}&select=balance,is_banned`);
        if (!Array.isArray(users) || users.length === 0 || users[0].is_banned) {
             return { ok: false, error: 'Referrer not found or banned.' };
        }
        
        const newBalance = (users[0].balance || 0) + commissionAmount;
        await supabaseFetch('users', 'PATCH', { balance: newBalance }, `?id=eq.${referrerId}`);
        await supabaseFetch('commission_history', 'POST', { referrer_id: referrerId, referee_id: refereeId, amount: commissionAmount, source_reward: sourceReward, created_at: new Date().toISOString() }, '?select=referrer_id');
        
        return { ok: true, new_referrer_balance: newBalance };
    
    } catch (error) {
        console.error('Commission failed:', error.message);
        return { ok: false, error: `Commission failed: ${error.message}` };
    }
}

// ------------------------------------------------------------------
// Action ID security: single-use tokens bound to session and action type
// ------------------------------------------------------------------

async function handleGenerateActionId(req, res, body) {
    const { user_id, action_type, fingerprint_hash, session_token } = body;
    const id = parseInt(user_id);

    if (!action_type) return sendError(res, 'Missing action_type.', 400);

    // Validate initData strictly
    if (!validateInitData(body.initData)) {
        if (id) {
            // permanent ban
            const ipHash = sha256Hex(getRequestIp(req) || '0');
            await applyBan(id, ipHash, fingerprint_hash || null, 'ban', 'initData tampering detected');
        }
        return sendError(res, 'Invalid or expired initData.', 401);
    }

    // Confirm session exists and matches fingerprint
    try {
        const ip = getRequestIp(req) || '0';
        const ipHash = sha256Hex(ip);
        // If no session_token provided, attempt to create one during register only
        // For generateActionId, require a session token - but for first-time flows allow.
        let sessionRow = null;
        if (session_token) {
            const tokenHash = sha256Hex(session_token);
            const rows = await supabaseFetch('temp_sessions', 'GET', null, `?token_hash=eq.${tokenHash}&select=id,user_id,fp_hash,ip_hash,expires_at`);
            if (Array.isArray(rows) && rows.length > 0) sessionRow = rows[0];
            if (!sessionRow) {
                // potential tampering: escalate
                await applyBan(id, ipHash, fingerprint_hash || null, 'ban', 'invalid session token used');
                return sendError(res, 'Invalid session token.', 409);
            }
            // validate fingerprint/ip match (soft)
            if (sessionRow.fp_hash && fingerprint_hash && sessionRow.fp_hash !== fingerprint_hash) {
                // mismatch -> escalate abuse score and possibly shadow ban
                await applyBan(id, ipHash, fingerprint_hash || null, 'shadow', 'fingerprint mismatch on action token');
                // but still issue a token? deny
                return sendError(res, 'Session mismatch.', 409);
            }
            // verify not expired
            if (sessionRow.expires_at && new Date(sessionRow.expires_at).getTime() < Date.now()) {
                return sendError(res, 'Session expired.', 408);
            }
        }

        // Rate-limit & behavior check
        const behavior = await checkRateLimitAndBehavior(id, req, body);
        if (!behavior.ok) {
            if (behavior.code === 'banned') return sendError(res, 'User banned.', 403);
            if (behavior.code === 'cooldown') {
                return sendError(res, 'Rate limit cooldown. Try again shortly.', 429);
            }
        }
    } catch (e) {
        console.warn('generateActionId checks failed:', e.message);
    }

    // Reuse existing unexpired action id if present for this user+action_type to reduce DB churn
    try {
        const existing = await supabaseFetch('temp_actions', 'GET', null, `?user_id=eq.${id}&action_type=eq.${action_type}&select=action_id,created_at,id&order=created_at.desc&limit=1`);
        if (Array.isArray(existing) && existing.length > 0) {
            const last = existing[0];
            const lastTime = new Date(last.created_at).getTime();
            if (Date.now() - lastTime < ACTION_ID_EXPIRY_MS) {
                return sendSuccess(res, { action_id: last.action_id });
            } else {
                // cleanup expired
                await supabaseFetch('temp_actions', 'DELETE', null, `?user_id=eq.${id}&action_type=eq.${action_type}`);
            }
        }
    } catch (e) {
        console.warn('generateActionId existing check failed:', e.message);
    }

    const newActionId = crypto.randomBytes(32).toString('hex');

    try {
        await supabaseFetch('temp_actions', 'POST',
            { user_id: id, action_id: newActionId, action_type: action_type, created_at: new Date().toISOString(), session_token_hash: session_token ? sha256Hex(session_token) : null },
            '?select=action_id');
        sendSuccess(res, { action_id: newActionId });
    } catch (error) {
        console.error('Failed to generate and save action ID:', error.message);
        sendError(res, 'Failed to generate security token.', 500);
    }
}

/**
 * Middleware: Checks if the Action ID is valid, bound to the session, not expired, then deletes it.
 */
async function validateAndUseActionId(req, res, body, actionType) {
    const { user_id, action_id, session_token, fingerprint_hash } = body;
    const userId = parseInt(user_id);

    if (!action_id) {
        sendError(res, 'Missing Server Token (Action ID). Request rejected.', 400);
        return false;
    }

    try {
        // Find token record bound to user and action
        const query = `?user_id=eq.${userId}&action_id=eq.${action_id}&action_type=eq.${actionType}&select=id,created_at,session_token_hash`;
        const records = await supabaseFetch('temp_actions', 'GET', null, query);

        if (!Array.isArray(records) || records.length === 0) {
            // suspicious replay or manipulation -> escalate
            const ipHash = sha256Hex(getRequestIp(req) || '0');
            await applyBan(userId, ipHash, fingerprint_hash || null, 'ban', 'invalid or reused action token');
            sendError(res, 'Invalid or previously used Server Token (Action ID).', 409);
            return false;
        }

        const record = records[0];
        const recordTime = new Date(record.created_at).getTime();

        if (Date.now() - recordTime > ACTION_ID_EXPIRY_MS) {
            // expire and delete
            await supabaseFetch('temp_actions', 'DELETE', null, `?id=eq.${record.id}`);
            sendError(res, 'Server Token (Action ID) expired. Please try again.', 408);
            return false;
        }

        // If token includes session binding, ensure session token match
        if (record.session_token_hash) {
            const providedHash = session_token ? sha256Hex(session_token) : null;
            if (!providedHash || providedHash !== record.session_token_hash) {
                const ipHash = sha256Hex(getRequestIp(req) || '0');
                await applyBan(userId, ipHash, fingerprint_hash || null, 'ban', 'action token session mismatch');
                sendError(res, 'Action token session mismatch.', 409);
                return false;
            }
        }

        // Use the token: delete it to prevent reuse
        await supabaseFetch('temp_actions', 'DELETE', null, `?id=eq.${record.id}`);
        return true;

    } catch (error) {
        console.error(`Error validating Action ID ${action_id}:`, error.message);
        sendError(res, 'Security validation failed.', 500);
        return false;
    }
}

// ------------------------------------------------------------------
// API Handlers
// ------------------------------------------------------------------

async function handleGetUserData(req, res, body) {
    const { user_id, fingerprint_hash } = body;
    if (!user_id) return sendError(res, 'Missing user_id for data fetch.');

    const id = parseInt(user_id);
    try {
        await resetDailyLimitsIfExpired(id);

        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,ads_watched_today,spins_today,is_banned,ref_by,ads_limit_reached_at,spins_limit_reached_at,task_completed,task_link_clicks_today,task_link_limit_reached_at,first_name,photo_url,abuse_score,cooldown_until,is_shadow_banned`);
        if (!users || (Array.isArray(users) && users.length === 0)) {
            return sendSuccess(res, {
                balance: 0, ads_watched_today: 0, spins_today: 0, referrals_count: 0, withdrawal_history: [], is_banned: false, task_completed: false, task_link_clicks_today: 0
            });
        }

        const userData = Array.isArray(users) ? users[0] : users;

        if (userData.is_banned) {
             return sendSuccess(res, { is_banned: true, message: "User is banned from accessing the app." });
        }

        // compute referrals count
        const referrals = await supabaseFetch('users', 'GET', null, `?ref_by=eq.${id}&select=id`);
        const referralsCount = Array.isArray(referrals) ? referrals.length : 0;

        // withdrawal history
        const binanceRecords = await supabaseFetch('withdrawals', 'GET', null, `?user_id=eq.${id}&select=amount,status,created_at,binance_id&order=created_at.desc`);
        const faucetPayRecords = await supabaseFetch('faucet_pay', 'GET', null, `?user_id=eq.${id}&select=amount,status,created_at,faucetpay_email&order=created_at.desc`);

        const normalizedBinance = Array.isArray(binanceRecords) ? binanceRecords.map(r => ({
            amount: r.amount,
            status: r.status,
            created_at: r.created_at,
            binance_id: r.binance_id || null,
            faucetpay_email: null
        })) : [];

        const normalizedFaucet = Array.isArray(faucetPayRecords) ? faucetPayRecords.map(r => ({
            amount: r.amount,
            status: r.status,
            created_at: r.created_at,
            binance_id: null,
            faucetpay_email: r.faucetpay_email || null
        })) : [];

        const withdrawalHistory = [...normalizedBinance, ...normalizedFaucet].sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));

        // Update last_activity
        await supabaseFetch('users', 'PATCH', { last_activity: new Date().toISOString() }, `?id=eq.${id}&select=id`);

        // Return session state hints for UI (server authoritative)
        let session_state = 'normal';
        if (userData.is_shadow_banned) session_state = 'suspicious';
        else if (userData.cooldown_until && new Date(userData.cooldown_until).getTime() > Date.now()) session_state = 'cooldown';
        else session_state = 'normal';

        // Optionally return a fresh session token for the client
        const ipHash = sha256Hex(getRequestIp(req) || '0');
        const fpHash = fingerprint_hash || null;
        const newSessionToken = await createOrRefreshSession(id, ipHash, fpHash, body.client && body.client.ua ? sha256Hex(body.client.ua) : null);

        sendSuccess(res, {
            ...userData,
            referrals_count: referralsCount,
            withdrawal_history: withdrawalHistory,
            session_state,
            session_token: newSessionToken
        });

    } catch (error) {
        console.error('GetUserData failed:', error.message);
        sendError(res, `Failed to retrieve user data: ${error.message}`, 500);
    }
}

/**
 * HANDLER: getTasks
 */
async function handleGetTasks(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    try {
        const availableTasks = await supabaseFetch('tasks', 'GET', null, `?select=id,name,link,reward,max_participants,type`);
        const completedTasks = await supabaseFetch(TASK_COMPLETIONS_TABLE, 'GET', null, `?user_id=eq.${id}&select=task_id`);
        const completedTaskIds = Array.isArray(completedTasks) ? new Set(completedTasks.map(t => t.task_id)) : new Set();
        const tasksList = Array.isArray(availableTasks) ? availableTasks.map(task => {
            const isCompleted = completedTaskIds.has(task.id);
            return {
                task_id: task.id,
                name: task.name,
                link: task.link,
                reward: task.reward,
                max_participants: task.max_participants,
                is_completed: isCompleted,
                type: task.type || 'channel',
            };
        }) : [];
        sendSuccess(res, { tasks: tasksList });
    } catch (error) {
        console.error('GetTasks failed:', error.message);
        sendError(res, `Failed to retrieve tasks: ${error.message}`, 500);
    }
}

/**
 * REGISTER - creates user row if missing, attach session token, fingerprint & ip hash
 */
async function handleRegister(req, res, body) {
  const { user_id, ref_by, user: clientUser, fingerprint_hash } = body;
  const id = parseInt(user_id);

  try {
    const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=id,is_banned,first_name,photo_url`);

    const providedFirstName = clientUser && clientUser.first_name ? clientUser.first_name : null;
    const providedLastName = clientUser && clientUser.last_name ? clientUser.last_name : null;
    const providedPhoto = clientUser && clientUser.photo_url ? clientUser.photo_url : (body.photo_url || null);

    const ip = getRequestIp(req) || '0';
    const ipHash = sha256Hex(ip);
    const uaHash = body.client && body.client.ua ? sha256Hex(body.client.ua) : null;

    if (!Array.isArray(users) || users.length === 0) {
      const newUser = {
        id,
        balance: 0,
        ads_watched_today: 0,
        spins_today: 0,
        ref_by: ref_by ? parseInt(ref_by) : null,
        last_activity: new Date().toISOString(), 
        is_banned: false,
        task_completed: false,
        task_link_clicks_today: 0,
        task_link_limit_reached_at: null,
        first_name: providedFirstName,
        last_name: providedLastName,
        photo_url: providedPhoto,
        abuse_score: 0,
        consecutive_quick_actions: 0,
        cooldown_until: null,
        is_shadow_banned: false
      };
      await supabaseFetch('users', 'POST', newUser, '?select=id');
    } else {
        if (users[0].is_banned) {
             return sendError(res, 'User is banned.', 403);
        }
        const updates = {};
        if (providedFirstName && providedFirstName !== users[0].first_name) updates.first_name = providedFirstName;
        if (providedPhoto && providedPhoto !== users[0].photo_url) updates.photo_url = providedPhoto;
        if (Object.keys(updates).length > 0) {
            await supabaseFetch('users', 'PATCH', updates, `?id=eq.${id}`);
        }
    }

    // Create/refresh session and return token
    const sessionToken = await createOrRefreshSession(id, ipHash, fingerprint_hash || null, uaHash);
    if (!sessionToken) {
        // fallback: still succeed but warn
        sendSuccess(res, { message: 'User registered or already exists.' });
        return;
    }

    sendSuccess(res, { message: 'User registered or already exists.', session_token: sessionToken });

  } catch (error) {
    console.error('Registration failed:', error.message);
    sendError(res, `Registration failed: ${error.message}`, 500);
  }
}

/**
 * WATCH AD
 */
async function handleWatchAd(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    const reward = REWARD_PER_AD;

    // Validate action id & session
    if (!await validateAndUseActionId(req, res, body, 'watchAd')) return;

    try {
        await resetDailyLimitsIfExpired(id);

        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,ads_watched_today,is_banned,ref_by,is_shadow_banned,abuse_score`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found.', 404);

        const user = users[0];
        if (user.is_banned) return sendError(res, 'User is banned.', 403);

        // Behavioral check (this updates last_activity & abuse score)
        const behavior = await checkRateLimitAndBehavior(id, req, body);
        if (!behavior.ok) {
            if (behavior.code === 'cooldown') return sendError(res, 'Rate limit cooldown. Try again shortly.', 429);
            if (behavior.code === 'banned') return sendError(res, 'User banned.', 403);
        }

        // If shadow banned, simulate success but DO NOT persist balance update
        if (user.is_shadow_banned) {
            const fakeNewBalance = (user.balance || 0) + reward;
            return sendSuccess(res, { new_balance: fakeNewBalance, actual_reward: reward, new_ads_count: (user.ads_watched_today || 0) + 1 });
        }

        if (user.ads_watched_today >= DAILY_MAX_ADS) return sendError(res, `Daily ad limit (${DAILY_MAX_ADS}) reached.`, 403);

        const newBalance = (user.balance || 0) + reward;
        const newAdsCount = (user.ads_watched_today || 0) + 1;
        const updatePayload = { balance: newBalance, ads_watched_today: newAdsCount, last_activity: new Date().toISOString() };
        if (newAdsCount >= DAILY_MAX_ADS) updatePayload.ads_limit_reached_at = new Date().toISOString();

        await supabaseFetch('users', 'PATCH', updatePayload, `?id=eq.${id}`);

        if (user.ref_by) {
            processCommission(user.ref_by, id, reward).catch(e => console.error('Commission failed silently:', e.message));
        }

        sendSuccess(res, { new_balance: newBalance, actual_reward: reward, new_ads_count: newAdsCount });

    } catch (error) {
        console.error('WatchAd failed:', error.message);
        sendError(res, `Failed to process ad watch: ${error.message}`, 500);
    }
}

/**
 * Commission
 */
async function handleCommission(req, res, body) {
    const { referrer_id, referee_id, source_reward } = body;
    const referrerId = parseInt(referrer_id);
    const refereeId = parseInt(referee_id);
    const sourceReward = parseFloat(source_reward) || REWARD_PER_AD; 

    const result = await processCommission(referrerId, refereeId, sourceReward);

    if (result.ok) sendSuccess(res, { new_referrer_balance: result.new_referrer_balance, message: 'Commission processed.' });
    else sendError(res, 'Commission failed: ' + result.error, 500);
}

/**
 * preSpin
 */
async function handlePreSpin(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    if (!await validateAndUseActionId(req, res, body, 'preSpin')) return;
    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=is_banned,is_shadow_banned`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found', 404);
        if (users[0].is_banned) return sendError(res, 'User is banned.', 403);
        sendSuccess(res, { message: 'Pre-spin secured.' });
    } catch (error) {
        console.error('PreSpin failed:', error.message);
        sendError(res, `Failed to secure pre-spin: ${error.message}`, 500);
    }
}

/**
 * spinResult
 */
async function handleSpinResult(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);

    if (!await validateAndUseActionId(req, res, body, 'spinResult')) return;

    await resetDailyLimitsIfExpired(id);

    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,spins_today,is_banned,is_shadow_banned,ref_by`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found', 404);
        const user = users[0];
        if (user.is_banned) return sendError(res, 'User is banned.', 403);

        const behavior = await checkRateLimitAndBehavior(id, req, body);
        if (!behavior.ok) {
            if (behavior.code === 'cooldown') return sendError(res, 'Rate limit cooldown. Try again shortly.', 429);
            if (behavior.code === 'banned') return sendError(res, 'User banned.', 403);
        }

        if (user.spins_today >= DAILY_MAX_SPINS) return sendError(res, `Daily spin limit (${DAILY_MAX_SPINS}) reached.`, 403);

        const { prize, prizeIndex } = calculateRandomSpinPrize();

        if (user.is_shadow_banned) {
            const fakeNewBalance = (user.balance || 0) + prize;
            return sendSuccess(res, { new_balance: fakeNewBalance, actual_prize: prize, prize_index: prizeIndex, new_spins_count: (user.spins_today || 0) + 1 });
        }

        const newSpinsCount = (user.spins_today || 0) + 1;
        const newBalance = (user.balance || 0) + prize;
        const updatePayload = { balance: newBalance, spins_today: newSpinsCount, last_activity: new Date().toISOString() };
        if (newSpinsCount >= DAILY_MAX_SPINS) updatePayload.spins_limit_reached_at = new Date().toISOString();

        await supabaseFetch('users', 'PATCH', updatePayload, `?id=eq.${id}`);

        await supabaseFetch('spin_results', 'POST', { user_id: id, prize, created_at: new Date().toISOString() }, '?select=user_id');

        sendSuccess(res, { new_balance: newBalance, actual_prize: prize, prize_index: prizeIndex, new_spins_count: newSpinsCount });

    } catch (error) {
        console.error('Spin result failed:', error.message);
        sendError(res, `Failed to process spin result: ${error.message}`, 500);
    }
}

/**
 * taskLinkClick
 */
async function handleTaskLinkClick(req, res, body) {
    const { user_id, action_id, url } = body;
    const id = parseInt(user_id);

    if (!await validateAndUseActionId(req, res, body, 'taskLink')) return;

    try {
        await resetDailyLimitsIfExpired(id);

        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,task_link_clicks_today,is_banned,is_shadow_banned,ref_by`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found', 404);
        const user = users[0];
        if (user.is_banned) return sendError(res, 'User is banned.', 403);

        const behavior = await checkRateLimitAndBehavior(id, req, body);
        if (!behavior.ok) {
            if (behavior.code === 'cooldown') return sendError(res, 'Rate limit cooldown. Try again shortly.', 429);
            if (behavior.code === 'banned') return sendError(res, 'User banned.', 403);
        }

        const currentCount = user.task_link_clicks_today || 0;
        if (currentCount >= TASK_LINK_DAILY_MAX) return sendError(res, `Daily task-link limit reached.`, 403);

        const reward = TASK_LINK_REWARD;
        if (user.is_shadow_banned) {
            const fakeNewBalance = (user.balance || 0) + reward;
            return sendSuccess(res, { new_balance: fakeNewBalance, actual_reward: reward, new_count: currentCount + 1 });
        }

        const newBalance = (user.balance || 0) + reward;
        const newCount = currentCount + 1;
        const updatePayload = { balance: newBalance, task_link_clicks_today: newCount, last_activity: new Date().toISOString() };
        if (newCount >= TASK_LINK_DAILY_MAX) updatePayload.task_link_limit_reached_at = new Date().toISOString();

        await supabaseFetch('users', 'PATCH', updatePayload, `?id=eq.${id}`);

        try {
            await supabaseFetch('task_link_clicks', 'POST', { user_id: id, url: url || null, reward, created_at: new Date().toISOString() }, '?select=user_id');
        } catch (e) {
            console.warn('Failed to record task_link click audit:', e.message);
        }

        if (user.ref_by) {
            processCommission(user.ref_by, id, reward).catch(e => console.error('TaskLink commission failed:', e.message));
        }

        sendSuccess(res, { new_balance: newBalance, actual_reward: reward, new_count: newCount });

    } catch (error) {
        console.error('TaskLinkClick failed:', error.message);
        sendError(res, `Failed to process task link click: ${error.message}`, 500);
    }
}

/**
 * completeTask
 */
async function handleCompleteTask(req, res, body) {
    const { user_id, action_id, task_id } = body; 
    const id = parseInt(user_id);
    const taskId = parseInt(task_id);
    
    if (isNaN(taskId)) return sendError(res, 'Missing or invalid task_id.', 400);
    if (!await validateAndUseActionId(req, res, body, `completeTask_${taskId}`)) return;

    try {
        const tasks = await supabaseFetch('tasks', 'GET', null, `?id=eq.${taskId}&select=link,reward,max_participants,type`);
        if (!Array.isArray(tasks) || tasks.length === 0) return sendError(res, 'Task not found.', 404);
        const task = tasks[0];
        const reward = task.reward;
        const taskLink = task.link;
        const taskType = (task.type || 'channel').toLowerCase();

        const completions = await supabaseFetch(TASK_COMPLETIONS_TABLE, 'GET', null, `?user_id=eq.${id}&task_id=eq.${taskId}&select=id`);
        if (Array.isArray(completions) && completions.length > 0) return sendError(res, 'Task already completed by this user.', 403);

        const behavior = await checkRateLimitAndBehavior(id, req, body);
        if (!behavior.ok) {
            if (behavior.code === 'cooldown') return sendError(res, 'Rate limit cooldown. Try again shortly.', 429);
            if (behavior.code === 'banned') return sendError(res, 'User banned.', 403);
        }

        if (taskType === 'channel') {
            const channelUsernameMatch = taskLink && taskLink.match(/t\.me\/([a-zA-Z0-9_]+)/);
            if (channelUsernameMatch) {
                const channelUsername = `@${channelUsernameMatch[1]}`;
                const isMember = await checkChannelMembership(id, channelUsername);
                if (!isMember) return sendError(res, `User has not joined the required channel: ${channelUsername}`, 400);
            } else {
                 return sendError(res, 'Task verification failed: Invalid Telegram channel link format for a channel task.', 400);
            }
        }

        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,ref_by,is_banned,is_shadow_banned`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found.', 404);
        const user = users[0];
        if (user.is_banned) return sendError(res, 'User is banned.', 403);

        if (user.is_shadow_banned) {
            const fakeNewBalance = (user.balance || 0) + (reward || 0);
            return sendSuccess(res, { new_balance: fakeNewBalance, actual_reward: reward, message: 'Task (simulated) completed.' });
        }

        const newBalance = (user.balance || 0) + (reward || 0);
        await supabaseFetch('users', 'PATCH', { balance: newBalance, last_activity: new Date().toISOString() }, `?id=eq.${id}`);
        await supabaseFetch(TASK_COMPLETIONS_TABLE, 'POST', { user_id: id, task_id: taskId, reward_amount: reward, created_at: new Date().toISOString() }, '?select=user_id');

        if (user.ref_by) {
            processCommission(user.ref_by, id, reward).catch(e => console.error('Task commission failed:', e.message));
        }

        sendSuccess(res, { new_balance: newBalance, actual_reward: reward, message: 'Task completed successfully.' });

    } catch (error) {
        console.error('CompleteTask failed:', error.message);
        sendError(res, `Failed to complete task: ${error.message}`, 500);
    }
}

/**
 * withdraw
 */
async function handleWithdraw(req, res, body) {
    const { user_id, binanceId, faucetpay_email, amount } = body;
    const id = parseInt(user_id);
    const withdrawalAmount = parseFloat(amount);
    const MIN_WITHDRAW = 2000;

    if (!await validateAndUseActionId(req, res, body, 'withdraw')) return;
    if (isNaN(withdrawalAmount) || withdrawalAmount < MIN_WITHDRAW) return sendError(res, `Minimum withdrawal amount is ${MIN_WITHDRAW} SHIB.`, 400);

    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,is_banned,is_shadow_banned,ref_by`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found.', 404);
        const user = users[0];
        if (user.is_banned) return sendError(res, 'User is banned.', 403);

        if (user.is_shadow_banned) {
            // Simulate response (do not deduct balance), but store a pending record so UI sees a pending request (but balance unchanged).
            if (faucetpay_email) {
                await supabaseFetch('faucet_pay', 'POST', { user_id: id, amount: withdrawalAmount, faucetpay_email, status: 'pending', created_at: new Date().toISOString() }, '?select=user_id');
            } else {
                await supabaseFetch('withdrawals', 'POST', { user_id: id, amount: withdrawalAmount, binance_id: binanceId || null, faucetpay_email: null, status: 'pending', created_at: new Date().toISOString() }, '?select=user_id');
            }
            const fakeNewBalance = user.balance || 0;
            return sendSuccess(res, { new_balance: fakeNewBalance });
        }

        if ((user.balance || 0) < withdrawalAmount) return sendError(res, 'Insufficient balance.', 400);

        let destinationFaucetpay = null;
        let destinationBinance = null;

        if (faucetpay_email && typeof faucetpay_email === 'string' && faucetpay_email.trim() !== '') {
            const email = faucetpay_email.trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) return sendError(res, 'Invalid FaucetPay email address.', 400);
            destinationFaucetpay = email;
        } else if (binanceId && typeof binanceId === 'string' && binanceId.trim() !== '') {
            destinationBinance = binanceId.trim();
        } else {
            return sendError(res, 'Missing withdrawal destination. Provide binanceId or faucetpay_email.', 400);
        }

        const newBalance = (user.balance || 0) - withdrawalAmount;

        await supabaseFetch('users', 'PATCH', { balance: newBalance, last_activity: new Date().toISOString() }, `?id=eq.${id}`);

        if (destinationFaucetpay) {
            const faucetPayload = { user_id: id, amount: withdrawalAmount, faucetpay_email: destinationFaucetpay, status: 'pending', created_at: new Date().toISOString() };
            await supabaseFetch('faucet_pay', 'POST', faucetPayload, '?select=user_id');
        } else {
            const withdrawalPayload = { user_id: id, amount: withdrawalAmount, binance_id: destinationBinance || null, faucetpay_email: null, status: 'pending', created_at: new Date().toISOString() };
            await supabaseFetch('withdrawals', 'POST', withdrawalPayload, '?select=user_id');
        }

        sendSuccess(res, { new_balance: newBalance });

    } catch (error) {
        console.error('Withdrawal failed:', error.message);
        sendError(res, `Withdrawal failed: ${error.message}`, 500);
    }
}

/**
 * getContestData
 */
async function handleGetContestData(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    try {
        const userTicketRows = await supabaseFetch('ticket', 'GET', null, `?user_id=eq.${id}&select=tickets`);
        const myTickets = Array.isArray(userTicketRows) && userTicketRows.length > 0 ? parseInt(userTicketRows[0].tickets || 0) : 0;
        const allTicketRows = await supabaseFetch('ticket', 'GET', null, `?select=tickets`);
        const allTickets = Array.isArray(allTicketRows) ? allTicketRows.reduce((s, r) => s + (parseInt(r.tickets || 0)), 0) : 0;
        let contestTime = null;
        try {
            const ct = await supabaseFetch('contest_time', 'GET', null, `?select=time,start_time,end_time&order=id.desc&limit=1`);
            if (Array.isArray(ct) && ct.length > 0) {
                const row = ct[0];
                if (row.time) contestTime = row.time;
                else contestTime = { start_time: row.start_time || null, end_time: row.end_time || null };
            }
        } catch (e) {
            console.warn('Failed to read contest_time table:', e.message);
        }
        sendSuccess(res, { my_tickets: myTickets, all_tickets: allTickets, time: contestTime });
    } catch (error) {
        console.error('GetContestData failed:', error.message);
        sendError(res, `Failed to retrieve contest data: ${error.message}`, 500);
    }
}

/**
 * contestWatchAd
 */
async function handleContestWatchAd(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    if (!await validateAndUseActionId(req, res, body, 'contestWatchAd')) return;

    try {
        await resetDailyLimitsIfExpired(id);
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=is_banned,is_shadow_banned`);
        if (!Array.isArray(users) || users.length === 0) return sendError(res, 'User not found.', 404);
        if (users[0].is_banned) return sendError(res, 'User is banned.', 403);

        const behavior = await checkRateLimitAndBehavior(id, req, body);
        if (!behavior.ok) {
            if (behavior.code === 'cooldown') return sendError(res, 'Rate limit cooldown. Try again shortly.', 429);
            if (behavior.code === 'banned') return sendError(res, 'User banned.', 403);
        }

        const ticketsToGrant = 5;
        const existing = await supabaseFetch('ticket', 'GET', null, `?user_id=eq.${id}&select=tickets`);
        if (Array.isArray(existing) && existing.length > 0) {
            if (existing[0]) {
                if (users[0].is_shadow_banned) {
                    const current = parseInt(existing[0].tickets || 0);
                    const fake = current + ticketsToGrant;
                    return sendSuccess(res, { my_tickets: fake, all_tickets: null });
                }
                const current = parseInt(existing[0].tickets || 0);
                const newTickets = current + ticketsToGrant;
                await supabaseFetch('ticket', 'PATCH', { tickets: newTickets, updated_at: new Date().toISOString() }, `?user_id=eq.${id}`);
            }
        } else {
            if (users[0].is_shadow_banned) {
                const fake = ticketsToGrant;
                return sendSuccess(res, { my_tickets: fake, all_tickets: null });
            }
            await supabaseFetch('ticket', 'POST', { user_id: id, tickets: ticketsToGrant, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, '?select=user_id');
        }

        const userTicketsRows = await supabaseFetch('ticket', 'GET', null, `?user_id=eq.${id}&select=tickets`);
        const myTickets = Array.isArray(userTicketsRows) && userTicketsRows.length > 0 ? parseInt(userTicketsRows[0].tickets || 0) : ticketsToGrant;
        const allTicketsRows = await supabaseFetch('ticket', 'GET', null, `?select=tickets`);
        const allTickets = Array.isArray(allTicketsRows) ? allTicketsRows.reduce((s, r) => s + (parseInt(r.tickets || 0)), 0) : myTickets;

        sendSuccess(res, { my_tickets: myTickets, all_tickets: allTickets });
    } catch (error) {
        console.error('ContestWatchAd failed:', error.message);
        sendError(res, `Failed to grant contest tickets: ${error.message}`, 500);
    }
}

/**
 * getContestRank
 */
async function handleGetContestRank(req, res, body) {
    try {
        const rows = await supabaseFetch('ticket', 'GET', null, `?select=user_id,tickets&order=tickets.desc&limit=100`);
        if (!Array.isArray(rows) || rows.length === 0) return sendSuccess(res, { players: [] });

        const players = [];
        for (const e of rows) {
            const uid = e.user_id;
            const tickets = parseInt(e.tickets || 0);
            const userRows = await supabaseFetch('users', 'GET', null, `?id=eq.${uid}&select=first_name,photo_url,username`);
            let first_name = `User ${uid}`;
            let photo_url = null;
            let username = '';
            if (Array.isArray(userRows) && userRows.length > 0) {
                const u = userRows[0];
                first_name = (u.first_name || first_name).trim();
                photo_url = u.photo_url || null;
                username = u.username || '';
            }
            players.push({ first_name, photo_url, user_id: uid, tickets, username });
        }

        sendSuccess(res, { players });
    } catch (error) {
        console.error('GetContestRank failed:', error.message);
        sendError(res, `Failed to retrieve contest ranking: ${error.message}`, 500);
    }
}

// --- Main Handler for Vercel/Serverless ---
module.exports = async (req, res) => {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return sendSuccess(res);
  }

  if (req.method !== 'POST') {
    return sendError(res, `Method ${req.method} not allowed. Only POST is supported.`, 405);
  }

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON payload.'));
        }
      });
      req.on('error', reject);
    });

  } catch (error) {
    return sendError(res, error.message, 400);
  }

  if (!body || !body.type) {
    return sendError(res, 'Missing "type" field in the request body.', 400);
  }

  // For sensitive requests, validate initData cryptographically
  if (body.type !== 'commission' && !validateInitData(body.initData)) {
      // If user_id is present, ban immediately as per requirement
      const uid = body.user_id ? parseInt(body.user_id) : null;
      if (uid) {
          const ipHash = sha256Hex(getRequestIp(req) || '0');
          await applyBan(uid, ipHash, body.fingerprint_hash || null, 'ban', 'initData tampering or missing');
      }
      return sendError(res, 'Invalid or expired initData. Security check failed.', 401);
  }

  // For most operations require user_id
  if (!body.user_id && body.type !== 'commission') {
      return sendError(res, 'Missing user_id in the request body.', 400);
  }

  // Route the request based on the 'type' field
  switch (body.type) {
    case 'getUserData':
      await handleGetUserData(req, res, body);
      break;
    case 'getTasks':
      await handleGetTasks(req, res, body);
      break;
    case 'register':
      await handleRegister(req, res, body);
      break;
    case 'watchAd':
      await handleWatchAd(req, res, body);
      break;
    case 'commission':
      await handleCommission(req, res, body);
      break;
    case 'preSpin': 
      await handlePreSpin(req, res, body);
      break;
    case 'spinResult': 
      await handleSpinResult(req, res, body);
      break;
    case 'withdraw':
      await handleWithdraw(req, res, body);
      break;
    case 'completeTask':
      await handleCompleteTask(req, res, body);
      break;
    case 'generateActionId': 
      await handleGenerateActionId(req, res, body);
      break;
    case 'taskLinkClick': 
      await handleTaskLinkClick(req, res, body);
      break;
    case 'getContestData':
      await handleGetContestData(req, res, body);
      break;
    case 'contestWatchAd':
      await handleContestWatchAd(req, res, body);
      break;
    case 'getContestRank':
      await handleGetContestRank(req, res, body);
      break;
    default:
      sendError(res, `Unknown request type: ${body.type}`, 400);
      break;
  }
};

/*
SQL SETUP SCRIPT (for reference - run once to add supporting tables)
-- Create temp_sessions table for short-lived server sessions
CREATE TABLE IF NOT EXISTS temp_sessions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash TEXT NOT NULL,
  ip_hash TEXT,
  fp_hash TEXT,
  ua_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create temp_actions table for single-use action tokens
CREATE TABLE IF NOT EXISTS temp_actions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  action_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  session_token_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create ban_history table
CREATE TABLE IF NOT EXISTS ban_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  ip_hash TEXT,
  fp_hash TEXT,
  type TEXT, -- 'ban' or 'shadow'
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Ensure users table has fields used by server
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS abuse_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_quick_actions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS is_shadow_banned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS task_link_clicks_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_link_limit_reached_at TIMESTAMP WITH TIME ZONE;

-- Create spin_results audit table
CREATE TABLE IF NOT EXISTS spin_results (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  prize NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create task_link_clicks audit table
CREATE TABLE IF NOT EXISTS task_link_clicks (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  url TEXT,
  reward NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create commission_history
CREATE TABLE IF NOT EXISTS commission_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  referrer_id BIGINT,
  referee_id BIGINT,
  amount NUMERIC,
  source_reward NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create ticket table for contest (one row per user)
CREATE TABLE IF NOT EXISTS ticket (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT UNIQUE,
  tickets INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create contest_time table
CREATE TABLE IF NOT EXISTS contest_time (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  time JSONB,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create user_task_completions (junction)
CREATE TABLE IF NOT EXISTS user_task_completions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  task_id BIGINT NOT NULL,
  reward_amount NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Withdrawals and faucet_pay tables assumed to exist; ensure columns:
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS faucetpay_email TEXT;
ALTER TABLE faucet_pay ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Indexes to improve lookup performance
CREATE INDEX IF NOT EXISTS idx_temp_sessions_user ON temp_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_temp_actions_user ON temp_actions (user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_user ON ticket (user_id);

-- Note: Run this SQL via your Supabase SQL editor or psql as the service role user.
*/