// ================================================================= 
//                     自行修改14-15行
// =================================================================

const TOKEN = ENV_BOT_TOKEN;      // 不需要修改，在KV中配置
const WEBHOOK = '/endpoint';
const SECRET = ENV_BOT_SECRET;    // 在KV中配置
const ADMIN_UID = ENV_ADMIN_UID;  // 在KV中配置

// 验证通过后的有效期 (秒)，默认 30 天
const VERIFICATION_TTL = 60 * 60 * 24 * 30;

// Cloudflare Turnstile Keys
const CF_TURNSTILE_SITE_KEY = '0x4AAAAAasdasd0H5ADQjY';
const CF_TURNSTILE_SECRET_KEY = '0x4AAAAAACG6XsdfsdfsdfsdfZbm2cph_mxgV0';

// =================================================================
//                      核心功能
// =================================================================

function apiUrl(methodName, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', msg);
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', msg);
}

function forwardMessage(msg) {
  return requestTelegram('forwardMessage', msg);
}

addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event, url));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event));
  } else if (url.pathname === '/verify') {
    event.respondWith(handleVerifyPage(event.request));
  } else if (url.pathname === '/verify-callback') {
    event.respondWith(handleVerifyCallback(event.request));
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

async function handleWebhook(event, url) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }

  const update = await event.request.json();
  event.waitUntil(onUpdate(update, url.origin));
  return new Response('Ok');
}

async function onUpdate(update, origin) {
  if ('message' in update) {
    await onMessage(update.message, origin);
  }
}

async function onMessage(message, origin) {
  const chatId = message.chat.id.toString();

  // 1. 如果是管理员发消息
  if (chatId === ADMIN_UID) {
    return handleAdminMessage(message);
  }

  // 2. 如果是访客 (普通用户)
  else {
    // 0. 检查黑名单
    const isBlocked = await nfd.get('blocked-' + chatId);
    if (isBlocked) {
      // 被拉黑了，回复提示
      return sendMessage({
        chat_id: chatId,
        text: '🚫 您已被管理员拉黑，无法发送消息。'
      });
    }

    // 1. 检查是否已通过验证
    const isVerified = await nfd.get('verified-' + chatId);

    if (isVerified) {
      // 已验证，正常转发给管理员
      return handleGuestMessage(message);
    } else {
      // 未验证，进入验证流程
      return handleVerification(message, chatId, origin);
    }
  }
}

// 辅助函数：尝试从回复或参数中获取目标 ID
async function getTargetId(message, commandName) {
  const text = (message.text || '').trim();
  const args = text.split(/\s+/);
  const reply = message.reply_to_message;

  // 优先 1：从回复的消息中提取
  if (reply && (reply.forward_from || reply.forward_sender_name)) {
    const guestChatId = await nfd.get('msg-map-' + reply.message_id);
    if (guestChatId) return guestChatId;
  }

  // 优先 2：从指令参数中提取 (例如 /unblock 123456)
  if (args.length > 1) {
    const potentialId = args[1];
    // 简单的数字校验
    if (/^\d+$/.test(potentialId)) {
      return potentialId;
    }
  }

  return null;
}

// 处理管理员消息
async function handleAdminMessage(message) {
  const text = (message.text || '').trim();
  const reply = message.reply_to_message;

  // --- 管理指令区域 ---

  // 指令：/block (需回复用户消息)
  if (text === '/block') {
    if (reply && (reply.forward_from || reply.forward_sender_name)) {
      const guestChatId = await nfd.get('msg-map-' + reply.message_id);
      if (guestChatId) {
        await nfd.put('blocked-' + guestChatId, 'true'); // 永久拉黑
        return sendMessage({ chat_id: ADMIN_UID, text: `🚫 用户 ${guestChatId} 已被拉黑。` });
      } else {
        return sendMessage({ chat_id: ADMIN_UID, text: '⚠️ 无法获取用户ID，可能是旧消息。' });
      }
    } else {
      return sendMessage({ chat_id: ADMIN_UID, text: '⚠️ 请回复一条用户转发的消息来拉黑。' });
    }
  }

  // 指令：/unblock [ID] (支持回复或手输)
  if (text.startsWith('/unblock')) {
    const targetId = await getTargetId(message, '/unblock');
    if (targetId) {
      await nfd.delete('blocked-' + targetId);
      return sendMessage({ chat_id: ADMIN_UID, text: `✅ 用户 ${targetId} 已解封。` });
    } else {
      return sendMessage({ chat_id: ADMIN_UID, text: '⚠️ 格式错误。\n请回复用户消息发送 /unblock\n或发送 /unblock 123456 (必须是数字 ID)' });
    }
  }

  // 指令：/clear_ver [ID] (支持回复或手输)
  if (text.startsWith('/clear_ver')) {
    const targetId = await getTargetId(message, '/clear_ver');
    if (targetId) {
      await nfd.delete('verified-' + targetId);
      return sendMessage({ chat_id: ADMIN_UID, text: `🔄 用户 ${targetId} 验证状态已重置。` });
    } else {
      return sendMessage({ chat_id: ADMIN_UID, text: '⚠️ 格式错误。\n请回复用户消息发送 /clear_ver\n或发送 /clear_ver 123456 (必须是数字 ID)' });
    }
  }

  // --- 普通回复逻辑 ---

  // 检查是否在回复转发消息
  if (reply && (reply.forward_from || reply.forward_sender_name)) {
    const guestChatId = await nfd.get('msg-map-' + reply.message_id);
    if (guestChatId) {
      return copyMessage({
        chat_id: guestChatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      });
    } else {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '⚠️ 未找到原用户映射，可能消息太旧或被清理了缓存。'
      });
    }
  } else {
    // 既不是指令也不是回复
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '🤖 管理面板\n\n回复消息 = 发送给用户\n回复并发送 /block = 拉黑\n回复并发送 /unblock = 解封\n回复并发送 /clear_ver = 重置验证'
    });
  }
}

// 处理验证流程
async function handleVerification(message, chatId, origin) {
  // 生成验证链接
  const verifyUrl = `${origin}/verify?uid=${chatId}`;

  return sendMessage({
    chat_id: chatId,
    text: '🛡 为了防止垃圾消息，请点击下方按钮完成人机验证：',
    reply_markup: {
      inline_keyboard: [[
        { text: '🤖 点击进行人机验证', web_app: { url: verifyUrl } }
      ]]
    }
  });
}

// 渲染验证页面
function handleVerifyPage(request) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>人机验证</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background-color: #f0f2f5;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        h1 { margin-bottom: 1.5rem; color: #1a1a1a; }
        .success-msg { color: #10b981; display: none; }
        .error-msg { color: #ef4444; display: none; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>请完成验证</h1>
        <div id="turnstile-widget" class="cf-turnstile" data-sitekey="${CF_TURNSTILE_SITE_KEY}" data-callback="onVerify"></div>
        <h2 class="success-msg" id="success-msg">✅ 验证成功！<br>请返回 Telegram 继续聊天。</h2>
        <p class="error-msg" id="error-msg">验证失败，请刷新重试。</p>
    </div>

    <script>
        // 初始化 Telegram Web App
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand(); // 尝试展开到最大高度

        function onVerify(token) {
            const urlParams = new URLSearchParams(window.location.search);
            const uid = urlParams.get('uid');
            
            if (!uid) {
                document.getElementById('error-msg').innerText = "错误：缺少用户 ID";
                document.getElementById('error-msg').style.display = 'block';
                return;
            }

            fetch('/verify-callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, uid })
            })
            .then(response => {
                if (response.ok) {
                    document.getElementById('turnstile-widget').style.display = 'none';
                    document.getElementById('success-msg').style.display = 'block';
                    
                    // 验证成功 1.5 秒后自动关闭窗口
                    setTimeout(() => {
                        tg.close();
                    }, 1500);
                } else {
                    throw new Error('Verification failed');
                }
            })
            .catch(err => {
                document.getElementById('error-msg').style.display = 'block';
            });
        }
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'content-type': 'text/html;charset=UTF-8' }
  });
}

// 处理验证回调
async function handleVerifyCallback(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { token, uid } = await request.json();

    if (!token || !uid) {
      return new Response('Missing token or uid', { status: 400 });
    }

    // 向 Cloudflare 验证 Token
    const formData = new FormData();
    formData.append('secret', CF_TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    // formData.append('remoteip', request.headers.get('CF-Connecting-IP')); // 可选

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    }).then(r => r.json());

    if (result.success) {
      // 验证通过！写入 KV
      await nfd.put('verified-' + uid, 'true', { expirationTtl: VERIFICATION_TTL });

      // 主动通知用户验证成功
      await sendMessage({
        chat_id: uid,
        text: '✅ 验证通过！您可以直接发送消息给管理员了。'
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ success: false, error: result['error-codes'] }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
}

// 处理访客消息 (已验证)
async function handleGuestMessage(message) {
  const forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  });

  if (forwardReq.ok && forwardReq.result && forwardReq.result.message_id) {
    // 存储消息映射关系，用于管理员回复
    // 这里也可以设置一个过期时间，比如 48 小时，避免 KV 爆炸
    await nfd.put('msg-map-' + forwardReq.result.message_id, message.chat.id.toString(), { expirationTtl: 172800 });
  } else {
    await sendMessage({
      chat_id: ADMIN_UID,
      text: `❌ 转发消息失败：${JSON.stringify(forwardReq)}`
    });
  }
}

// =================================================================
//                      Webhook 设置工具
// =================================================================

async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json();
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}
