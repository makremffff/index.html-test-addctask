const crypto = require('crypto');

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
const ACTION_ID_EXPIRY_MS = 60000; // 60 seconds for Action ID to be valid
const SPIN_SECTORS = [5, 10, 15, 20, 5];

// ===== Task Link Constants =====
const TASK_LINK_REWARD = 5; // 5 SHIB per task-link click
const TASK_LINK_DAILY_MAX = 200; // daily max clicks tracked server-side

// ------------------------------------------------------------------
// Task Constants
// ------------------------------------------------------------------
const TASK_COMPLETIONS_TABLE = 'user_task_completions'; // اسم افتراضي لجدول حفظ إكمال المهام

/**
 * Helper function to randomly select a prize from the defined sectors and return its index.
 */
function calculateRandomSpinPrize() {
    const randomIndex = Math.floor(Math.random() * SPIN_SECTORS.length);
    const prize = SPIN_SECTORS[randomIndex];
    return { prize, prizeIndex: randomIndex };
}

// --- Helper Functions ---

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

  // Ensure leading slash not duplicated
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

  // Handle no content
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
      // If not JSON, return raw text wrapped
      return text;
  }
}

/**
 * Checks if a user is a member (or creator/admin) of a specific Telegram channel.
 */
async function checkChannelMembership(userId, channelUsername) {
    if (!BOT_TOKEN) {
        console.error('BOT_TOKEN is not configured for membership check.');
        return false;
    }
    
    // The chat_id must be in the format @username or -100xxxxxxxxxx
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
        
        // Accepted statuses are 'member', 'administrator', 'creator'
        const isMember = ['member', 'administrator', 'creator'].includes(status);
        
        return isMember;

    } catch (error) {
        console.error('Network or parsing error during Telegram API call:', error.message);
        return false;
    }
}

/**
 * Limit-Based Reset Logic: Resets counters if the limit was reached AND the interval (6 hours) has passed since.
 */
async function resetDailyLimitsIfExpired(userId) {
    const now = Date.now();

    try {
        // 1. Fetch current limits and the time they were reached (including new task link fields)
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${userId}&select=ads_watched_today,spins_today,ads_limit_reached_at,spins_limit_reached_at,task_link_clicks_today,task_link_limit_reached_at`);
        if (!Array.isArray(users) || users.length === 0) {
            return;
        }

        const user = users[0];
        const updatePayload = {};

        // 2. Check Ads Limit Reset
        if (user.ads_limit_reached_at && user.ads_watched_today >= DAILY_MAX_ADS) {
            const adsLimitTime = new Date(user.ads_limit_reached_at).getTime();
            if (now - adsLimitTime > RESET_INTERVAL_MS) {
                updatePayload.ads_watched_today = 0;
                updatePayload.ads_limit_reached_at = null; 
                console.log(`Ads limit reset for user ${userId}.`);
            }
        }

        // 3. Check Spins Limit Reset
        if (user.spins_limit_reached_at && user.spins_today >= DAILY_MAX_SPINS) {
            const spinsLimitTime = new Date(user.spins_limit_reached_at).getTime();
            if (now - spinsLimitTime > RESET_INTERVAL_MS) {
                updatePayload.spins_today = 0;
                updatePayload.spins_limit_reached_at = null; 
                console.log(`Spins limit reset for user ${userId}.`);
            }
        }

        // 4. Check Task Link Limit Reset
        if (user.task_link_limit_reached_at && user.task_link_clicks_today >= TASK_LINK_DAILY_MAX) {
            const tlLimitTime = new Date(user.task_link_limit_reached_at).getTime();
            if (now - tlLimitTime > RESET_INTERVAL_MS) {
                updatePayload.task_link_clicks_today = 0;
                updatePayload.task_link_limit_reached_at = null;
                console.log(`Task-link limit reset for user ${userId}.`);
            }
        }

        // 5. Perform the database update if any limits were reset
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
 * Rate Limiting Check for Ad/Spin Actions
 */
async function checkRateLimit(userId) {
    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${userId}&select=last_activity`);
        if (!Array.isArray(users) || users.length === 0) {
            return { ok: true };
        }

        const user = users[0];
        const lastActivity = user.last_activity ? new Date(user.last_activity).getTime() : 0; 
        const now = Date.now();
        const timeElapsed = now - lastActivity;

        if (timeElapsed < MIN_TIME_BETWEEN_ACTIONS_MS) {
            const remainingTime = MIN_TIME_BETWEEN_ACTIONS_MS - timeElapsed;
            return {
                ok: false,
                message: `Rate limit exceeded. Please wait ${Math.ceil(remainingTime / 1000)} seconds before the next action.`,
                remainingTime: remainingTime
            };
        }
        return { ok: true };
    } catch (error) {
        console.error(`Rate limit check failed for user ${userId}:`, error.message);
        return { ok: true };
    }
}

// ------------------------------------------------------------------
// **initData Security Validation Function**
// ------------------------------------------------------------------
function validateInitData(initData) {
    if (!initData || !BOT_TOKEN) {
        console.warn('Security Check Failed: initData or BOT_TOKEN is missing.');
        return false;
    }

    // initData may be the raw query string typically provided by Telegram
    // if user passed an object, convert to query string
    let raw = initData;
    if (typeof initData === 'object') {
        raw = Object.keys(initData).map(k => `${k}=${initData[k]}`).join('&');
    }

    const urlParams = new URLSearchParams(raw);
    const hash = urlParams.get('hash');
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
        console.warn(`Security Check Failed: Hash mismatch.`);
        return false;
    }

    const authDateParam = urlParams.get('auth_date');
    if (!authDateParam) {
        console.warn('Security Check Failed: auth_date is missing.');
        return false;
    }

    const authDate = parseInt(authDateParam) * 1000;
    const currentTime = Date.now();
    const expirationTime = 1200 * 1000; // 20 minutes limit

    if (currentTime - authDate > expirationTime) {
        console.warn(`Security Check Failed: Data expired.`);
        return false;
    }

    return true;
}

/**
 * Parses initData (query string) into an object. Returns {} if not parseable.
 */
function parseInitDataToObject(initData) {
    try {
        if (!initData) return {};
        if (typeof initData === 'object') {
            return initData;
        }
        const params = new URLSearchParams(initData);
        const obj = {};
        for (const [k, v] of params.entries()) {
            obj[k] = v;
        }
        // Telegram sometimes provides 'user' JSON in initDataUnsafe only on client.
        return obj;
    } catch (e) {
        return {};
    }
}

// ------------------------------------------------------------------
// 🔑 Commission Helper Function
// ------------------------------------------------------------------
/**
 * Processes the commission for the referrer and updates their balance.
 */
async function processCommission(referrerId, refereeId, sourceReward) {
    // 1. Calculate commission
    const commissionAmount = sourceReward * REFERRAL_COMMISSION_RATE; 
    
    if (commissionAmount < 0.000001) { 
        console.log(`Commission too small (${commissionAmount}). Aborted for referee ${refereeId}.`);
        return { ok: false, error: 'Commission amount is effectively zero.' };
    }

    try {
        // 2. Fetch referrer's current balance and status
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${referrerId}&select=balance,is_banned`);
        if (!Array.isArray(users) || users.length === 0 || users[0].is_banned) {
             console.log(`Referrer ${referrerId} not found or banned. Commission aborted.`);
             return { ok: false, error: 'Referrer not found or banned, commission aborted.' };
        }
        
        // 3. Update balance: newBalance will now include the decimal commission
        const newBalance = (users[0].balance || 0) + commissionAmount;
        
        // 4. Update referrer balance
        await supabaseFetch('users', 'PATCH', { balance: newBalance }, `?id=eq.${referrerId}`); 

        // 5. Add record to commission_history
        await supabaseFetch('commission_history', 'POST', { referrer_id: referrerId, referee_id: refereeId, amount: commissionAmount, source_reward: sourceReward, created_at: new Date().toISOString() }, '?select=referrer_id');
        
        return { ok: true, new_referrer_balance: newBalance };
    
    } catch (error) {
        console.error('Commission failed:', error.message);
        return { ok: false, error: `Commission failed: ${error.message}` };
    }
}


// ------------------------------------------------------------------
// 🔒 Action ID Security System
// ------------------------------------------------------------------

/**
 * Generates a strong, random ID for the client to use only once.
 */
function generateStrongId() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * HANDLER: type: "generateActionId"
 */
async function handleGenerateActionId(req, res, body) {
    const { user_id, action_type } = body;
    const id = parseInt(user_id);
    
    if (!action_type) {
        return sendError(res, 'Missing action_type.', 400);
    }
    
    // Check if the user already has an unexpired ID for this action type
    try {
        const existingIds = await supabaseFetch('temp_actions', 'GET', null, `?user_id=eq.${id}&action_type=eq.${action_type}&select=action_id,created_at,id`);
        
        if (Array.isArray(existingIds) && existingIds.length > 0) {
            const lastIdTime = new Date(existingIds[0].created_at).getTime();
            if (Date.now() - lastIdTime < ACTION_ID_EXPIRY_MS) {
                 // If the existing ID is still valid, return it to prevent spamming the table
                return sendSuccess(res, { action_id: existingIds[0].action_id });
            } else {
                 // Clean up expired ID before creating a new one
                 await supabaseFetch('temp_actions', 'DELETE', null, `?user_id=eq.${id}&action_type=eq.${action_type}`);
            }
        }
    } catch(e) {
        console.warn('Error checking existing temp_actions:', e.message);
    }
    
    // Generate and save the new ID
    const newActionId = generateStrongId();
    
    try {
        await supabaseFetch('temp_actions', 'POST',
            { user_id: id, action_id: newActionId, action_type: action_type, created_at: new Date().toISOString() },
            '?select=action_id');
            
        sendSuccess(res, { action_id: newActionId });
    } catch (error) {
        console.error('Failed to generate and save action ID:', error.message);
        sendError(res, 'Failed to generate security token.', 500);
    }
}


/**
 * Middleware: Checks if the Action ID is valid and then deletes it.
 */
async function validateAndUseActionId(res, userId, actionId, actionType) {
    if (!actionId) {
        sendError(res, 'Missing Server Token (Action ID). Request rejected.', 400);
        return false;
    }
    
    try {
        const query = `?user_id=eq.${userId}&action_id=eq.${actionId}&action_type=eq.${actionType}&select=id,created_at`;
        const records = await supabaseFetch('temp_actions', 'GET', null, query);
        
        if (!Array.isArray(records) || records.length === 0) {
            sendError(res, 'Invalid or previously used Server Token (Action ID).', 409); 
            return false;
        }
        
        const record = records[0];
        const recordTime = new Date(record.created_at).getTime();
        
        // 1. Check Expiration (60 seconds)
        if (Date.now() - recordTime > ACTION_ID_EXPIRY_MS) {
            await supabaseFetch('temp_actions', 'DELETE', null, `?id=eq.${record.id}`);
            sendError(res, 'Server Token (Action ID) expired. Please try again.', 408); 
            return false;
        }

        // 2. Use the token: Delete it to prevent reuse
        await supabaseFetch('temp_actions', 'DELETE', null, `?id=eq.${record.id}`);

        return true;

    } catch (error) {
        console.error(`Error validating Action ID ${actionId}:`, error.message);
        sendError(res, 'Security validation failed.', 500);
        return false;
    }
}

// --- API Handlers ---

/**
 * HANDLER: type: "getUserData"
 */
async function handleGetUserData(req, res, body) {
    const { user_id } = body;
    if (!user_id) {
        return sendError(res, 'Missing user_id for data fetch.');
    }
    const id = parseInt(user_id);

    try {
        // 1. Check and reset daily limits (if 6 hours passed since limit reached)
        await resetDailyLimitsIfExpired(id);

        // 2. Fetch user data (including new task link fields and profile)
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,ads_watched_today,spins_today,is_banned,ref_by,ads_limit_reached_at,spins_limit_reached_at,task_completed,task_link_clicks_today,task_link_limit_reached_at,first_name,photo_url`);

        if (!users || (Array.isArray(users) && users.length === 0)) {
            return sendSuccess(res, {
                balance: 0, ads_watched_today: 0, spins_today: 0, referrals_count: 0, withdrawal_history: [], is_banned: false, task_completed: false, task_link_clicks_today: 0
            });
        }

        const userData = Array.isArray(users) ? users[0] : users;

        // 3. Banned Check - Exit immediately if banned
        if (userData.is_banned) {
             return sendSuccess(res, { is_banned: true, message: "User is banned from accessing the app." });
        }


        // 4. Fetch referrals count
        const referrals = await supabaseFetch('users', 'GET', null, `?ref_by=eq.${id}&select=id`);
        const referralsCount = Array.isArray(referrals) ? referrals.length : 0;

        // 5. Fetch withdrawal history
        const binanceRecords = await supabaseFetch('withdrawals', 'GET', null, `?user_id=eq.${id}&select=amount,status,created_at,binance_id&order=created_at.desc`);
        const faucetPayRecords = await supabaseFetch('faucet_pay', 'GET', null, `?user_id=eq.${id}&select=amount,status,created_at,faucetpay_email&order=created_at.desc`);

        const normalizedBinance = Array.isArray(binanceRecords) ? binanceRecords.map(r => ({
            amount: r.amount,
            status: r.status,
            created_at: r.created_at,
            binance_id: r.binance_id || null,
            faucetpay_email: null,
            source: 'binance'
        })) : [];

        const normalizedFaucet = Array.isArray(faucetPayRecords) ? faucetPayRecords.map(r => ({
            amount: r.amount,
            status: r.status,
            created_at: r.created_at,
            binance_id: null,
            faucetpay_email: r.faucetpay_email || null,
            source: 'faucetpay'
        })) : [];

        // Merge and sort by created_at descending
        const withdrawalHistory = [...normalizedBinance, ...normalizedFaucet].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // 6. Update last_activity (only for Rate Limit purposes now)
        await supabaseFetch('users', 'PATCH',
            { last_activity: new Date().toISOString() },
            `?id=eq.${id}&select=id`);

        sendSuccess(res, {
            ...userData,
            referrals_count: referralsCount,
            withdrawal_history: withdrawalHistory
        });

    } catch (error) {
        console.error('GetUserData failed:', error.message);
        sendError(res, `Failed to retrieve user data: ${error.message}`, 500);
    }
}

/**
 * HANDLER: type: "getTasks"
 */
async function handleGetTasks(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    
    try {
        // 1. جلب قائمة المهام المتاحة من جدول tasks (بما في ذلك نوع المهمة)
        const availableTasks = await supabaseFetch('tasks', 'GET', null, `?select=id,name,link,reward,max_participants,type`);

        // 2. جلب المهام التي أكملها المستخدم
        const completedTasks = await supabaseFetch(TASK_COMPLETIONS_TABLE, 'GET', null, `?user_id=eq.${id}&select=task_id`);
        const completedTaskIds = Array.isArray(completedTasks) ? new Set(completedTasks.map(t => t.task_id)) : new Set();
        
        // 3. فلترة وتجهيز قائمة المهام
        const tasksList = Array.isArray(availableTasks) ? availableTasks.map(task => {
            const isCompleted = completedTaskIds.has(task.id);
            
            return {
                task_id: task.id,
                name: task.name,
                link: task.link,
                reward: task.reward,
                max_participants: task.max_participants,
                is_completed: isCompleted,
                type: task.type || 'channel', // إرجاع النوع، الافتراضي 'channel'
            };
        }) : [];

        sendSuccess(res, { tasks: tasksList });

    } catch (error) {
        console.error('GetTasks failed:', error.message);
        sendError(res, `Failed to retrieve tasks: ${error.message}`, 500);
    }
}

/**
 * 1) type: "register"
 */
async function handleRegister(req, res, body) {
  const { user_id, ref_by } = body;
  const id = parseInt(user_id);

  try {
    // 1. Check if user exists
    const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=id,is_banned,first_name,photo_url`);

    // Extract optional user object sent from client (tgUser)
    const clientUser = body.user || null;
    const providedFirstName = clientUser && clientUser.first_name ? clientUser.first_name : null;
    const providedLastName = clientUser && clientUser.last_name ? clientUser.last_name : null;
    const providedPhoto = clientUser && clientUser.photo_url ? clientUser.photo_url : (body.photo_url || null);

    if (!Array.isArray(users) || users.length === 0) {
      // 2. User does not exist, create new user
      const newUser = {
        id,
        balance: 0,
        ads_watched_today: 0,
        spins_today: 0,
        ref_by: ref_by ? parseInt(ref_by) : null,
        last_activity: new Date().toISOString(), 
        is_banned: false,
        task_completed: false, 
        // Task-link fields initialization
        task_link_clicks_today: 0,
        task_link_limit_reached_at: null,
        // profile fields
        first_name: providedFirstName,
        last_name: providedLastName,
        photo_url: providedPhoto
      };
      await supabaseFetch('users', 'POST', newUser, '?select=id');
    } else {
        if (users[0].is_banned) {
             return sendError(res, 'User is banned.', 403);
        }
        // Update profile fields if provided and different
        const updates = {};
        if (providedFirstName && providedFirstName !== users[0].first_name) updates.first_name = providedFirstName;
        if (providedPhoto && providedPhoto !== users[0].photo_url) updates.photo_url = providedPhoto;
        if (Object.keys(updates).length > 0) {
            await supabaseFetch('users', 'PATCH', updates, `?id=eq.${id}`);
        }
    }

    sendSuccess(res, { message: 'User registered or already exists.' });
  } catch (error) {
    console.error('Registration failed:', error.message);
    sendError(res, `Registration failed: ${error.message}`, 500);
  }
}

/**
 * 2) type: "watchAd"
 */
async function handleWatchAd(req, res, body) {
    const { user_id, action_id } = body;
    const id = parseInt(user_id);
    const reward = REWARD_PER_AD;

    // 1. Check and Consume Action ID (Security Check)
    if (!await validateAndUseActionId(res, id, action_id, 'watchAd')) return;

    try {
        // 2. Check and reset daily limits (if 6 hours passed since limit reached)
        await resetDailyLimitsIfExpired(id);

        // 3. Fetch current user data 
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,ads_watched_today,is_banned,ref_by`);
        if (!Array.isArray(users) || users.length === 0) {
            return sendError(res, 'User not found.', 404);
        }
        
        const user = users[0];
        const referrerId = user.ref_by; 

        // 4. Banned Check
        if (user.is_banned) {
            return sendError(res, 'User is banned.', 403);
        }

        // 5. Rate Limit Check 
        const rateLimitResult = await checkRateLimit(id);
        if (!rateLimitResult.ok) {
            return sendError(res, rateLimitResult.message, 429); 
        }

        // 6. Check maximum ad limit
        if (user.ads_watched_today >= DAILY_MAX_ADS) {
            return sendError(res, `Daily ad limit (${DAILY_MAX_ADS}) reached.`, 403);
        }

        // 7. Calculate new values
        const newBalance = (user.balance || 0) + reward;
        const newAdsCount = (user.ads_watched_today || 0) + 1;
        const updatePayload = {
            balance: newBalance,
            ads_watched_today: newAdsCount,
            last_activity: new Date().toISOString() 
        };

        // 8. NEW LOGIC: Check if the limit is reached NOW
        if (newAdsCount >= DAILY_MAX_ADS) {
            updatePayload.ads_limit_reached_at = new Date().toISOString();
        }

        // 9. Update user record
        await supabaseFetch('users', 'PATCH', updatePayload, `?id=eq.${id}`);

        // 10. Commission Call
        if (referrerId) {
            processCommission(referrerId, id, reward).catch(e => {
                console.error(`WatchAd Commission failed silently for referrer ${referrerId}:`, e.message);
            });
        }
          
        // 11. Success
        sendSuccess(res, { new_balance: newBalance, actual_reward: reward, new_ads_count: newAdsCount });

    } catch (error) {
        console.error('WatchAd failed:', error.message);
        sendError(res, `Failed to process ad watch: ${error.message}`, 500);
    }
}

/**
 * 3) type: "commission"
 */
async function handleCommission(req, res, body) {
    const { referrer_id, referee_id, source_reward } = body;
    const referrerId = parseInt(referrer_id);
    const refereeId = parseInt(referee_id);
    const sourceReward = parseFloat(source_reward) || REWARD_PER_AD; 

    const result = await processCommission(referrerId, refereeId, sourceReward);

    if (result.ok) {
        sendSuccess(res, { new_referrer_balance: result.new_referrer_balance, message: 'Commission successfully processed.' });
    } else {
        console.log(`handleCommission failed: ${result.error}`);
        sendError(res, 'Commission processing failed on the server. ' + result.error, 500); 
    }
}

/**
 * 4) type: "preSpin"
 */
async function handlePreSpin(req, res, body) {
    const { user_id, action_id } = body;
    const id = parseInt(user_id);
    
    if (!await validateAndUseActionId(res, id, action_id, 'preSpin')) return;

    try {
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=is_banned`);
        if (!Array.isArray(users) || users.length === 0) {
            return sendError(res, 'User not found.', 404);
        }
        
        if (users[0].is_banned) {
            return sendError(res, 'User is banned.', 403);
        }

        sendSuccess(res, { message: "Pre-spin action secured." });

    } catch (error) {
        console.error('PreSpin failed:', error.message);
        sendError(res, `Failed to secure pre-spin: ${error.message}`, 500);
    }
}

/**
 * 5) type: "spinResult"
 */
async function handleSpinResult(req, res, body) {
    const { user_id, action_id } = body; 
    const id = parseInt(user_id);
    
    // 1. Check and Consume Action ID (Security Check)
    if (!await validateAndUseActionId(res, id, action_id, 'spinResult')) return; 
    
    // 2. Check and reset daily limits (if 6 hours passed since limit reached)
    await resetDailyLimitsIfExpired(id);

    try {
        // 3. Fetch current user data
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,spins_today,is_banned`);
        if (!Array.isArray(users) || users.length === 0) {
            return sendError(res, 'User not found.', 404);
        }
        
        const user = users[0];

        // 4. Banned Check
        if (user.is_banned) {
            return sendError(res, 'User is banned.', 403);
        }
        
        // 5. Rate Limit Check 
        const rateLimitResult = await checkRateLimit(id);
        if (!rateLimitResult.ok) {
            return sendError(res, rateLimitResult.message, 429); 
        }

        // 6. Check maximum spin limit
        if (user.spins_today >= DAILY_MAX_SPINS) {
            return sendError(res, `Daily spin limit (${DAILY_MAX_SPINS}) reached.`, 403);
        }
        
        // --- All checks passed: Process Spin Result ---

        const { prize, prizeIndex } = calculateRandomSpinPrize();
        const newSpinsCount = (user.spins_today || 0) + 1;
        const newBalance = (user.balance || 0) + prize;
        
        const updatePayload = {
            balance: newBalance,
            spins_today: newSpinsCount,
            last_activity: new Date().toISOString() 
        };

        // 7. NEW LOGIC: Check if the limit is reached NOW
        if (newSpinsCount >= DAILY_MAX_SPINS) {
            updatePayload.spins_limit_reached_at = new Date().toISOString();
        }

        // 8. Update user record
        await supabaseFetch('users', 'PATCH', updatePayload, `?id=eq.${id}`);

        // 9. Save to spin_results
        await supabaseFetch('spin_results', 'POST',
          { user_id: id, prize, created_at: new Date().toISOString() },
          '?select=user_id');

        // 10. Return the actual, server-calculated prize and index
        sendSuccess(res, { 
            new_balance: newBalance, 
            actual_prize: prize, 
            prize_index: prizeIndex,
            new_spins_count: newSpinsCount
        });

    } catch (error) {
        console.error('Spin result failed:', error.message);
        sendError(res, `Failed to process spin result: ${error.message}`, 500);
    }
}

/**
 * 6) type: "taskLinkClick"
 */
async function handleTaskLinkClick(req, res, body) {
    const { user_id, action_id, url } = body;
    const id = parseInt(user_id);

    // 1. Validate action id (using a general 'taskLink' action type)
    if (!await validateAndUseActionId(res, id, action_id, 'taskLink')) return;

    try {
        // 2. Reset limits if expired
        await resetDailyLimitsIfExpired(id);

        // 3. Fetch user
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,task_link_clicks_today,is_banned,ref_by`);
        if (!Array.isArray(users) || users.length === 0) {
            return sendError(res, 'User not found.', 404);
        }
        const user = users[0];

        // 4. Banned check
        if (user.is_banned) {
            return sendError(res, 'User is banned.', 403);
        }

        // 5. Rate limit check (using the main last_activity)
        const rateLimitResult = await checkRateLimit(id);
        if (!rateLimitResult.ok) {
            return sendError(res, rateLimitResult.message, 429);
        }

        // 6. Check daily task-link limit
        const currentCount = user.task_link_clicks_today || 0;
        if (currentCount >= TASK_LINK_DAILY_MAX) {
            return sendError(res, `Daily task-link limit (${TASK_LINK_DAILY_MAX}) reached.`, 403);
        }

        // 7. Compute new balance and count
        const reward = TASK_LINK_REWARD;
        const newBalance = (user.balance || 0) + reward;
        const newCount = currentCount + 1;

        const updatePayload = {
            balance: newBalance,
            task_link_clicks_today: newCount,
            last_activity: new Date().toISOString()
        };

        // 8. If reached limit, set timestamp
        if (newCount >= TASK_LINK_DAILY_MAX) {
            updatePayload.task_link_limit_reached_at = new Date().toISOString();
        }

        // 9. Update user record
        await supabaseFetch('users', 'PATCH', updatePayload, `?id=eq.${id}`);

        // 10. Record the click to a table for audit (optional but recommended)
        try {
            await supabaseFetch('task_link_clicks', 'POST', { user_id: id, url: url || null, reward, created_at: new Date().toISOString() }, '?select=user_id');
        } catch (e) {
            console.warn('Failed to record task_link click audit:', e.message);
        }

        // 11. Commission for referrer if exists
        if (user.ref_by) {
            processCommission(user.ref_by, id, reward).catch(e => {
                console.error(`TaskLink Commission failed silently for referrer ${user.ref_by}:`, e.message);
            });
        }

        // 12. Success
        sendSuccess(res, { new_balance: newBalance, actual_reward: reward, new_count: newCount });

    } catch (error) {
        console.error('TaskLinkClick failed:', error.message);
        sendError(res, `Failed to process task link click: ${error.message}`, 500);
    }
}


/**
 * 7) type: "completeTask" (For dynamic task types: channel, bot, etc.)
 */
async function handleCompleteTask(req, res, body) {
    // 1. Get task_id from request body
    const { user_id, action_id, task_id } = body; 
    const id = parseInt(user_id);
    const taskId = parseInt(task_id);
    
    // Ensure task_id is valid
    if (isNaN(taskId)) {
        return sendError(res, 'Missing or invalid task_id.', 400);
    }
    
    // 2. Check and Consume Action ID (Security Check) - use task_id in action_type
    if (!await validateAndUseActionId(res, id, action_id, `completeTask_${taskId}`)) return;

    try {
        // 3. Fetch Task Details (Reward, Link, Max Participants, AND TYPE)
        const tasks = await supabaseFetch('tasks', 'GET', null, `?id=eq.${taskId}&select=link,reward,max_participants,type`);
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return sendError(res, 'Task not found.', 404);
        }
        const task = tasks[0];
        const reward = task.reward;
        const taskLink = task.link;
        // افتراض: إذا لم يكن هناك نوع، نعتبره 'channel' للتحقق من الانضمام
        const taskType = (task.type || 'channel').toLowerCase(); 

        // 4. Check if task is already completed for the user (باستخدام الجدول الوسيط)
        const completions = await supabaseFetch(TASK_COMPLETIONS_TABLE, 'GET', null, `?user_id=eq.${id}&task_id=eq.${taskId}&select=id`);
        if (Array.isArray(completions) && completions.length > 0) {
            return sendError(res, 'Task already completed by this user.', 403);
        }

        // 5. Rate Limit Check 
        const rateLimitResult = await checkRateLimit(id);
        if (!rateLimitResult.ok) {
            return sendError(res, rateLimitResult.message, 429); 
        }
        
        // 6. التحقق من الانضمام بناءً على نوع المهمة
        if (taskType === 'channel') {
            const channelUsernameMatch = taskLink && taskLink.match(/t\.me\/([a-zA-Z0-9_]+)/);
            
            if (channelUsernameMatch) {
                const channelUsername = `@${channelUsernameMatch[1]}`;
                // 7. 🚨 CRITICAL: Check Channel Membership using Telegram API
                const isMember = await checkChannelMembership(id, channelUsername);

                if (!isMember) {
                     return sendError(res, `User has not joined the required channel: ${channelUsername}`, 400);
                }
            } else {
                 // قناة ولكن الرابط غير صحيح
                 return sendError(res, 'Task verification failed: Invalid Telegram channel link format for a channel task.', 400);
            }
        } 
        // ⚠️ إذا كان taskType === 'bot' أو غير ذلك، يتم تخطي التحقق من الانضمام

        // 8. Fetch balance and referrer ID 
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,ref_by,is_banned`);
        const user = users[0];
        
        if (user.is_banned) {
            return sendError(res, 'User is banned.', 403);
        }
        
        const referrerId = user.ref_by;
        const newBalance = (user.balance || 0) + (reward || 0);
        
        // 9. Update balance and last_activity
        await supabaseFetch('users', 'PATCH', 
            { 
                balance: newBalance, 
                last_activity: new Date().toISOString() 
            }, 
            `?id=eq.${id}`);
            
        // 10. Mark task as completed (INSERT into the junction table)
        await supabaseFetch(TASK_COMPLETIONS_TABLE, 'POST', 
            { user_id: id, task_id: taskId, reward_amount: reward, created_at: new Date().toISOString() }, 
            '?select=user_id');

        // 11. Commission Call
        if (referrerId) {
            processCommission(referrerId, id, reward).catch(e => {
                console.error(`Task Completion Commission failed silently for referrer ${referrerId}:`, e.message);
            });
        }
          
        // 12. Success
        sendSuccess(res, { new_balance: newBalance, actual_reward: reward, message: 'Task completed successfully.' });

    } catch (error) {
        console.error('CompleteTask failed:', error.message);
        sendError(res, `Failed to complete task: ${error.message}`, 500);
    }
}

/**
 * 8) type: "withdraw"
 */
async function handleWithdraw(req, res, body) {
    const { user_id, binanceId, faucetpay_email, amount, action_id } = body;
    const id = parseInt(user_id);
    const withdrawalAmount = parseFloat(amount);
    const MIN_WITHDRAW = 2000; // Match client-side minimum

    // 1. Check and Consume Action ID (Security Check)
    if (!await validateAndUseActionId(res, id, action_id, 'withdraw')) return;

    if (isNaN(withdrawalAmount) || withdrawalAmount < MIN_WITHDRAW) {
        return sendError(res, `Minimum withdrawal amount is ${MIN_WITHDRAW} SHIB.`, 400);
    }

    try {
        // 2. Fetch current user balance and banned status
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=balance,is_banned`);
        if (!Array.isArray(users) || users.length === 0) {
            return sendError(res, 'User not found.', 404);
        }

        const user = users[0];

        // 3. Banned Check
        if (user.is_banned) {
            return sendError(res, 'User is banned.', 403);
        }
        
        // 4. Check sufficient balance
        if ((user.balance || 0) < withdrawalAmount) {
            return sendError(res, 'Insufficient balance.', 400);
        }

        // 5. Validate destination: prefer faucetpay_email if provided, otherwise binanceId
        let destinationBinance = null;
        let destinationFaucetpay = null;

        if (faucetpay_email && typeof faucetpay_email === 'string' && faucetpay_email.trim() !== '') {
            const email = faucetpay_email.trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return sendError(res, 'Invalid FaucetPay email address.', 400);
            }
            destinationFaucetpay = email;
        } else if (binanceId && typeof binanceId === 'string' && binanceId.trim() !== '') {
            destinationBinance = binanceId.trim();
        } else {
            return sendError(res, 'Missing withdrawal destination. Provide binanceId or faucetpay_email.', 400);
        }

        // 6. Calculate new balance
        const newBalance = (user.balance || 0) - withdrawalAmount;

        // 7. Update user balance
        await supabaseFetch('users', 'PATCH',
          { 
              balance: newBalance,
              last_activity: new Date().toISOString() 
          },
          `?id=eq.${id}`);

        // 8. Record the withdrawal request
        if (destinationFaucetpay) {
            // FaucetPay-specific table insertion
            const faucetPayload = {
                user_id: id,
                amount: withdrawalAmount,
                faucetpay_email: destinationFaucetpay,
                status: 'pending',
                created_at: new Date().toISOString()
            };

            await supabaseFetch('faucet_pay', 'POST', faucetPayload, '?select=user_id');
        } else {
            // Binance withdrawals stored in the general withdrawals table
            const withdrawalPayload = {
                user_id: id,
                amount: withdrawalAmount,
                binance_id: destinationBinance || null,
                faucetpay_email: null,
                status: 'pending',
                created_at: new Date().toISOString()
            };

            await supabaseFetch('withdrawals', 'POST', withdrawalPayload, '?select=user_id');
        }

        // 9. Success
        sendSuccess(res, { new_balance: newBalance });

    } catch (error) {
        console.error('Withdrawal failed:', error.message);
        sendError(res, `Withdrawal failed: ${error.message}`, 500);
    }
}

/**
 * NEW: 9) type: "getContestData"
 * Returns user's tickets and total tickets across users and contest timing info.
 */
async function handleGetContestData(req, res, body) {
    const { user_id } = body;
    const id = parseInt(user_id);
    try {
        // Sum tickets for the user
        const userTicketsRows = await supabaseFetch('ticket_comp', 'GET', null, `?user_id=eq.${id}&select=tickets`);
        const myTickets = Array.isArray(userTicketsRows) ? userTicketsRows.reduce((s, r) => s + (r.tickets || 0), 0) : 0;

        // Sum tickets for all users
        const allTicketsRows = await supabaseFetch('ticket_comp', 'GET', null, `?select=tickets`);
        const allTickets = Array.isArray(allTicketsRows) ? allTicketsRows.reduce((s, r) => s + (r.tickets || 0), 0) : 0;

        // Read contest time from contest_time table (if exists). Expect a row with a 'time' JSON or columns start_time/end_time
        let contestTime = null;
        try {
            const ct = await supabaseFetch('contest_time', 'GET', null, `?select=time,start_time,end_time&order=id.desc&limit=1`);
            if (Array.isArray(ct) && ct.length > 0) {
                // prefer object 'time' if present
                const row = ct[0];
                if (row.time) {
                    contestTime = row.time;
                } else {
                    contestTime = {
                        start_time: row.start_time || null,
                        end_time: row.end_time || null
                    };
                }
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
 * NEW: 10) type: "contestWatchAd"
 * Grants contest tickets for watching a contest ad.
 */
async function handleContestWatchAd(req, res, body) {
    const { user_id, action_id } = body;
    const id = parseInt(user_id);

    // Validate action id
    if (!await validateAndUseActionId(res, id, action_id, 'contestWatchAd')) return;

    try {
        // Rate limit & banned checks
        await resetDailyLimitsIfExpired(id);
        const users = await supabaseFetch('users', 'GET', null, `?id=eq.${id}&select=is_banned`);
        if (!Array.isArray(users) || users.length === 0) {
            return sendError(res, 'User not found.', 404);
        }
        if (users[0].is_banned) {
            return sendError(res, 'User is banned.', 403);
        }

        const rateLimitResult = await checkRateLimit(id);
        if (!rateLimitResult.ok) {
            return sendError(res, rateLimitResult.message, 429);
        }

        // Grant tickets (5 tickets per watch)
        const ticketsToGrant = 5;
        const insertPayload = {
            user_id: id,
            tickets: ticketsToGrant,
            source: 'contest_ad',
            created_at: new Date().toISOString()
        };

        await supabaseFetch('ticket_comp', 'POST', insertPayload, '?select=user_id');

        // Recompute totals
        const userTicketsRows = await supabaseFetch('ticket_comp', 'GET', null, `?user_id=eq.${id}&select=tickets`);
        const myTickets = Array.isArray(userTicketsRows) ? userTicketsRows.reduce((s, r) => s + (r.tickets || 0), 0) : ticketsToGrant;

        const allTicketsRows = await supabaseFetch('ticket_comp', 'GET', null, `?select=tickets`);
        const allTickets = Array.isArray(allTicketsRows) ? allTicketsRows.reduce((s, r) => s + (r.tickets || 0), 0) : myTickets;

        sendSuccess(res, { my_tickets: myTickets, all_tickets: allTickets });
    } catch (error) {
        console.error('ContestWatchAd failed:', error.message);
        sendError(res, `Failed to grant contest tickets: ${error.message}`, 500);
    }
}

/**
 * NEW: 11) type: "getContestRank"
 * Returns top players ordered by ticket totals (server authoritative).
 */
async function handleGetContestRank(req, res, body) {
    try {
        // Fetch all ticket entries
        const rows = await supabaseFetch('ticket_comp', 'GET', null, `?select=user_id,tickets,created_at`);
        if (!Array.isArray(rows)) {
            return sendSuccess(res, { players: [] });
        }

        // Aggregate tickets per user
        const agg = {};
        for (const r of rows) {
            const uid = r.user_id;
            const t = parseInt(r.tickets || 0);
            if (!agg[uid]) agg[uid] = 0;
            agg[uid] += t;
        }

        // Build array and sort
        const entries = Object.keys(agg).map(uid => ({ user_id: uid, tickets: agg[uid] }));
        entries.sort((a, b) => b.tickets - a.tickets);

        // Take top 100 (or fewer)
        const top = entries.slice(0, 100);

        // For each top user, fetch optional user details (first_name/photo_url)
        const players = [];
        for (const e of top) {
            const uid = e.user_id;
            // Try to fetch user profile fields if available
            const userRows = await supabaseFetch('users', 'GET', null, `?id=eq.${uid}&select=first_name,photo_url`);
            let first_name = `User ${uid}`;
            let photo_url = null;
            if (Array.isArray(userRows) && userRows.length > 0) {
                const u = userRows[0];
                first_name = (u.first_name || first_name).trim();
                photo_url = u.photo_url || null;
            }

            // Return a single consolidated object (no duplicate userId/user_id)
            players.push({
                first_name: first_name,
                photo_url: photo_url,
                user_id: uid,
                tickets: e.tickets
            });
        }

        sendSuccess(res, { players });
    } catch (error) {
        console.error('GetContestRank failed:', error.message);
        sendError(res, `Failed to retrieve contest ranking: ${error.message}`, 500);
    }
}

/**
 * 7) type "completeTask" already implemented earlier...
 * (no change)
 */

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

  // initData Security Check (exclude commission and server-to-server types if needed)
  if (body.type !== 'commission' && (!body.initData || !validateInitData(body.initData))) {
      return sendError(res, 'Invalid or expired initData. Security check failed.', 401);
  }

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
    // New contest-related handlers
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