'use strict';

const path = require('node:path');
const { BrowserWindow, session, shell } = require('electron');

const BALANCE_PARTITION = 'persist:relay-monitor-balance';
const AUTH_HEADER_CACHE_MS = 20 * 1000;
const LOGIN_ACTIVITY_DEBOUNCE_MS = 1500;
const LOGIN_BLANK_CHECK_MS = 4500;
const LOGIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LOGIN_SHELL_PATH = path.join(__dirname, 'balance-login-shell.html');
const LOGIN_FALLBACK_PATHS = [
  '/',
  '/console',
  '/dashboard',
  '/login',
  '/signin',
  '/user',
  '/panel',
  '/panel/login',
];

let authHeaderCache = {
  origin: '',
  headers: {},
  updatedAt: 0,
};

function clearBalanceAuthCache() {
  authHeaderCache = {
    origin: '',
    headers: {},
    updatedAt: 0,
  };
}

function notifyLoginActivity(callback) {
  clearBalanceAuthCache();
  if (typeof callback === 'function') {
    callback();
  }
}

function safeUrl(value, fallback = '') {
  const raw = String(value || '').trim() || fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch (_) {
    // Fall through.
  }
  return '';
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch (_) {
    return '';
  }
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function buildLoginUrlCandidates(targetUrl) {
  const url = safeUrl(targetUrl);
  if (!url) return [];
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const candidates = [parsed.toString()];
    for (const path of LOGIN_FALLBACK_PATHS) {
      candidates.push(new URL(path, origin).toString());
    }
    return uniqueStrings(candidates);
  } catch (_) {
    return [url];
  }
}

function encodeLoginShellState(payload) {
  return Buffer.from(JSON.stringify(payload || {}), 'utf8').toString('base64url');
}

function loginShellPayload({ title, message, targetUrl, candidates = [], autoStart = false }) {
  return {
    title: String(title || ''),
    message: String(message || ''),
    targetUrl: safeUrl(targetUrl),
    candidates: uniqueStrings(candidates).map((url) => safeUrl(url)).filter(Boolean),
    autoStart: Boolean(autoStart),
  };
}

function loadLoginShell(window, payload) {
  if (!window || window.isDestroyed()) return Promise.resolve();
  return window.loadFile(LOGIN_SHELL_PATH, {
    query: {
      payload: encodeLoginShellState(payload),
    },
  });
}

function loginFallbackHtml({ title, message, targetUrl, candidates = [] }) {
  const safeTitle = String(title || '登录页面加载失败').replace(/[<>&"]/g, '');
  const safeMessage = String(message || '中转站后台没有正常显示。').replace(/[<>&"]/g, '');
  const safeTarget = safeUrl(targetUrl);
  const links = candidates.map((url) => {
    const safe = safeUrl(url);
    if (!safe) return '';
    return `<button onclick="location.href='${safe.replace(/'/g, '%27')}'">${safe.replace(/[<>&"]/g, '')}</button>`;
  }).join('');
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${safeTitle}</title>
        <style>
          :root { color-scheme: light; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: linear-gradient(145deg, rgba(255,255,255,.96), rgba(255,246,250,.9));
            color: #352d37;
          }
          main {
            width: min(640px, calc(100vw - 56px));
            padding: 30px;
            border-radius: 28px;
            background: rgba(255,255,255,.82);
            border: 1px solid rgba(255,157,184,.26);
            box-shadow: 0 24px 80px rgba(219,107,137,.22);
          }
          h1 { margin: 0 0 12px; font-size: 22px; }
          p { margin: 8px 0; color: #766875; line-height: 1.7; }
          .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
          button, a {
            border: 0;
            border-radius: 999px;
            padding: 10px 15px;
            background: #f08aaa;
            color: #fff;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
          }
          button.secondary { background: rgba(62,54,65,.12); color: #4b404c; }
          small { display: block; margin-top: 18px; color: #9a8d98; word-break: break-all; }
        </style>
      </head>
      <body>
        <main>
          <h1>${safeTitle}</h1>
          <p>${safeMessage}</p>
          <p>可以先点“重新加载”，或者尝试下面的同站点入口。登录完成后关闭这个窗口，主程序会刷新余额。</p>
          <div class="actions">
            ${safeTarget ? `<button onclick="location.href='${safeTarget.replace(/'/g, '%27')}'">重新加载</button>` : ''}
            ${links}
            <button class="secondary" onclick="location.reload()">刷新当前页</button>
          </div>
          ${safeTarget ? `<small>当前目标：${safeTarget.replace(/[<>&"]/g, '')}</small>` : ''}
        </main>
      </body>
    </html>`)}`
}

async function openExternalBalancePage(targetUrl) {
  const url = safeUrl(targetUrl);
  if (!url) {
    return {
      opened: false,
      url: '',
      message: '\u4f59\u989d\u9875\u9762\u5730\u5740\u672a\u914d\u7f6e',
    };
  }
  await shell.openExternal(url);
  return {
    opened: true,
    url,
    message: '\u5df2\u5728\u7cfb\u7edf\u6d4f\u89c8\u5668\u6253\u5f00\u4f59\u989d\u9875\u9762',
  };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function flattenStorageValues(value, parentKey = '') {
  if (value == null) return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (isObject(parsed) || Array.isArray(parsed)) {
        return flattenStorageValues(parsed, parentKey);
      }
    } catch (_) {
      // Keep the raw string.
    }
    return [{ key: parentKey, value: text }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenStorageValues(item, `${parentKey}.${index}`));
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => (
      flattenStorageValues(item, parentKey ? `${parentKey}.${key}` : key)
    ));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ key: parentKey, value: String(value) }];
  }
  return [];
}

function tokenScore(entry) {
  const key = String(entry.key || '');
  const value = String(entry.value || '').trim();
  if (!value || /^sk[-_]/i.test(value)) return 0;
  if (/^bearer\s+\S+/i.test(value)) return 100;
  if (/^(?:eyJ|jwt[\w.-]*$)/.test(value) && value.length > 24) return 90;
  if (/(^|[._-])(access[_-]?token|auth[_-]?token|id[_-]?token|jwt|token)([._-]|$)/i.test(key) && value.length > 16) return 80;
  if (/token|access|auth|jwt/i.test(key) && value.length > 16) return 60;
  return 0;
}

function userIdScore(entry) {
  const key = String(entry.key || '');
  const value = String(entry.value || '').trim();
  if (!/^\d{1,12}$/.test(value)) return 0;
  if (/(^|[._-])(user[_-]?id|userId|uid)([._-]|$)/i.test(key)) return 90;
  if (/(^|[._-])user([._-]|$)/i.test(key) && /(^|[._-])id([._-]|$)/i.test(key)) return 80;
  if (/(^|[._-])id([._-]|$)/i.test(key) && /user|profile|account|auth/i.test(key)) return 60;
  return 0;
}

function extractStorageAuthContext(entries) {
  const tokenCandidates = [];
  const userIdCandidates = [];
  for (const entry of entries || []) {
    const key = String(entry?.key || '');
    const value = entry?.value;
    for (const flattened of flattenStorageValues(value, key)) {
      const tokenCandidateScore = tokenScore(flattened);
      if (tokenCandidateScore > 0) tokenCandidates.push({ ...flattened, score: tokenCandidateScore });
      const userIdCandidateScore = userIdScore(flattened);
      if (userIdCandidateScore > 0) userIdCandidates.push({ ...flattened, score: userIdCandidateScore });
    }
  }
  tokenCandidates.sort((a, b) => b.score - a.score);
  userIdCandidates.sort((a, b) => b.score - a.score);
  return {
    token: tokenCandidates[0]?.value || '',
    userId: userIdCandidates[0]?.value || '',
  };
}

function extractStorageAuthToken(entries) {
  return extractStorageAuthContext(entries).token;
}

function authHeadersFromContext(context) {
  const token = String(context?.token || '').trim();
  const userId = String(context?.userId || '').trim();
  const headers = {};
  if (token) headers.Authorization = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  if (userId) headers['New-Api-User'] = userId;
  return headers;
}

function authHeadersFromToken(token) {
  return authHeadersFromContext({ token });
}

function balanceSession() {
  return session.fromPartition(BALANCE_PARTITION, { cache: true });
}

function createBalanceLoginStatus({
  cookies = [],
  storageEntries = [],
  targetUrl = '',
  message = '',
  status = '',
} = {}) {
  const hasCookies = Array.isArray(cookies) && cookies.length > 0;
  const authContext = extractStorageAuthContext(storageEntries);
  const hasAuthToken = Boolean(authContext.token);
  const hasAuthUserId = Boolean(authContext.userId);
  const hasLoginState = hasCookies || hasAuthToken;
  return {
    status: status || (hasLoginState ? 'ready' : 'missing'),
    hasCookies,
    hasAuthToken,
    hasAuthUserId,
    hasLoginState,
    origin: originFromUrl(targetUrl),
    updatedAt: new Date().toISOString(),
    message: message || (hasLoginState ? '\u5df2\u4fdd\u5b58\u7f51\u9875\u767b\u5f55\u72b6\u6001' : '\u672a\u68c0\u6d4b\u5230\u7f51\u9875\u767b\u5f55\u72b6\u6001'),
  };
}

async function readStorageEntries(targetUrl) {
  const origin = originFromUrl(targetUrl);
  if (!origin) return [];
  const ses = balanceSession();
  const window = new BrowserWindow({
    width: 420,
    height: 320,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: ses,
    },
  });
  const timeout = setTimeout(() => {
    try {
      window.webContents.stop();
    } catch (_) {
      // Best-effort cleanup.
    }
  }, 4500);
  timeout.unref?.();
  try {
    await window.loadURL(origin);
  } catch (_) {
    // A rate-limited/error page often still commits the target origin.
  } finally {
    clearTimeout(timeout);
  }
  try {
    return await window.webContents.executeJavaScript(`
      (async () => {
        const entries = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          entries.push({ area: 'localStorage', key, value: localStorage.getItem(key) });
        }
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const key = sessionStorage.key(i);
          entries.push({ area: 'sessionStorage', key, value: sessionStorage.getItem(key) });
        }
        async function scanIndexedDb() {
          if (!indexedDB || typeof indexedDB.databases !== 'function') return;
          const databases = await indexedDB.databases();
          for (const dbInfo of databases.slice(0, 8)) {
            if (!dbInfo || !dbInfo.name) continue;
            await new Promise((resolve) => {
              const request = indexedDB.open(dbInfo.name);
              request.onerror = () => resolve();
              request.onsuccess = () => {
                const db = request.result;
                const storeNames = Array.from(db.objectStoreNames || []).slice(0, 12);
                if (!storeNames.length) {
                  db.close();
                  resolve();
                  return;
                }
                const transaction = db.transaction(storeNames, 'readonly');
                let pending = storeNames.length;
                const done = () => {
                  pending -= 1;
                  if (pending <= 0) {
                    db.close();
                    resolve();
                  }
                };
                transaction.onerror = () => {
                  try { db.close(); } catch (_) {}
                  resolve();
                };
                for (const storeName of storeNames) {
                  try {
                    const store = transaction.objectStore(storeName);
                    const getAll = store.getAll(null, 80);
                    getAll.onerror = done;
                    getAll.onsuccess = () => {
                      const rows = Array.isArray(getAll.result) ? getAll.result : [];
                      rows.forEach((value, index) => {
                        entries.push({
                          area: 'indexedDB',
                          key: dbInfo.name + '.' + storeName + '.' + index,
                          value
                        });
                      });
                      done();
                    };
                  } catch (_) {
                    done();
                  }
                }
              };
            });
          }
        }
        try {
          await scanIndexedDb();
        } catch (_) {}
        return entries;
      })()
    `);
  } catch (_) {
    return [];
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function getBalanceSessionAuthHeaders(targetUrl) {
  const origin = originFromUrl(targetUrl);
  if (!origin) return {};
  if (authHeaderCache.origin === origin && Date.now() - authHeaderCache.updatedAt < AUTH_HEADER_CACHE_MS) {
    return authHeaderCache.headers;
  }
  const authContext = extractStorageAuthContext(await readStorageEntries(targetUrl));
  const headers = authHeadersFromContext(authContext);
  authHeaderCache = {
    origin,
    headers,
    updatedAt: Date.now(),
  };
  return headers;
}

async function getBalanceLoginStatus(targetUrl) {
  const url = safeUrl(targetUrl);
  if (!url) {
    return createBalanceLoginStatus({
      status: 'unconfigured',
      message: '\u4f59\u989d\u9875\u9762\u5730\u5740\u672a\u914d\u7f6e',
    });
  }
  const cookies = await balanceSession().cookies.get({ url });
  const storageEntries = await readStorageEntries(url);
  return createBalanceLoginStatus({ cookies, storageEntries, targetUrl: url });
}

function createLoginWindow({ parent, targetUrl, onClosed, onActivity }) {
  const ses = balanceSession();
  let activityTimer = null;
  let blankCheckTimer = null;
  let candidateIndex = 0;
  let showingShell = true;
  const candidates = buildLoginUrlCandidates(targetUrl);
  const scheduleActivity = () => {
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      activityTimer = null;
      notifyLoginActivity(onActivity);
    }, LOGIN_ACTIVITY_DEBOUNCE_MS);
    activityTimer.unref?.();
  };
  const loginWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    parent: parent && !parent.isDestroyed?.() ? parent : undefined,
    modal: false,
    show: false,
    title: '\u7f51\u9875\u767b\u5f55\u4f59\u989d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: ses,
    },
  });
  loginWindow.setAutoHideMenuBar(true);
  loginWindow.setMenuBarVisibility(false);
  loginWindow.webContents.setUserAgent(LOGIN_USER_AGENT);
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = safeUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: 'deny' };
  });

  const showFallbackPage = (message) => {
    if (loginWindow.isDestroyed()) return;
    showingShell = true;
    loadLoginShell(loginWindow, loginShellPayload({
      title: '\u4f59\u989d\u767b\u5f55\u9875\u52a0\u8f7d\u5931\u8d25',
      message,
      targetUrl,
      candidates,
      autoStart: false,
    })).catch(() => {
      loginWindow.loadURL(loginFallbackHtml({
        title: '\u4f59\u989d\u767b\u5f55\u9875\u52a0\u8f7d\u5931\u8d25',
        message,
        targetUrl,
        candidates,
      })).catch(() => {});
    });
  };

  const loadCandidate = () => {
    if (loginWindow.isDestroyed()) return;
    showingShell = false;
    const nextUrl = candidates[candidateIndex];
    candidateIndex += 1;
    if (!nextUrl) {
      showFallbackPage('\u5df2\u5c1d\u8bd5\u5e38\u89c1\u540e\u53f0\u5165\u53e3\uff0c\u4ecd\u7136\u6ca1\u6709\u663e\u793a\u9875\u9762\u3002');
      return;
    }
    loginWindow.loadURL(nextUrl).catch((error) => {
      if (!loginWindow.isDestroyed()) {
        showFallbackPage(`\u65e0\u6cd5\u52a0\u8f7d ${nextUrl}\uff1a${error.message || error}`);
      }
    });
  };

  const scheduleBlankCheck = () => {
    clearTimeout(blankCheckTimer);
    if (showingShell || loginWindow.isDestroyed()) return;
    blankCheckTimer = setTimeout(async () => {
      blankCheckTimer = null;
      if (showingShell || loginWindow.isDestroyed()) return;
      try {
        const pageState = await loginWindow.webContents.executeJavaScript(`(() => {
          const body = document.body;
          const text = body ? String(body.innerText || body.textContent || '').replace(/\\s+/g, ' ').trim() : '';
          const visibleNodes = Array.from(document.querySelectorAll('input, button, a, form, main, [role="button"], [class], [id]')).length;
          return { textLength: text.length, visibleNodes, readyState: document.readyState };
        })()`);
        if ((pageState?.textLength || 0) < 4 && (pageState?.visibleNodes || 0) < 3) {
          loadCandidate();
        }
      } catch (_) {
        // Cross-origin renderer states can fail while navigating. The user still has the visible window.
      }
    }, LOGIN_BLANK_CHECK_MS);
    blankCheckTimer.unref?.();
  };

  loginWindow.once('ready-to-show', () => {
    if (!loginWindow.isDestroyed()) loginWindow.show();
  });
  setTimeout(() => {
    if (!loginWindow.isDestroyed() && !loginWindow.isVisible()) loginWindow.show();
  }, 450).unref?.();
  loginWindow.webContents.on('did-start-navigation', (_event, navigatedUrl, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    if (safeUrl(navigatedUrl)) {
      showingShell = false;
    }
  });
  loginWindow.webContents.on('did-finish-load', scheduleActivity);
  loginWindow.webContents.on('did-finish-load', scheduleBlankCheck);
  loginWindow.webContents.on('did-navigate', scheduleActivity);
  loginWindow.webContents.on('did-navigate', scheduleBlankCheck);
  loginWindow.webContents.on('did-navigate-in-page', scheduleActivity);
  loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    showFallbackPage(`\u52a0\u8f7d ${validatedUrl || targetUrl} \u5931\u8d25\uff1a${errorDescription || errorCode}`);
  });
  loginWindow.once('closed', () => {
    clearTimeout(activityTimer);
    clearTimeout(blankCheckTimer);
    notifyLoginActivity(onClosed);
  });
  loadLoginShell(loginWindow, loginShellPayload({
    title: '\u7f51\u9875\u767b\u5f55\u4f59\u989d',
    message: '\u6b63\u5728\u6253\u5f00\u4f59\u989d\u9875\u9762\uff0c\u8bf7\u7a0d\u7b49\u3002',
    targetUrl,
    candidates,
    autoStart: true,
  })).then(() => {
    setTimeout(() => {
      if (!loginWindow.isDestroyed() && showingShell) {
        loadCandidate();
      }
    }, 350).unref?.();
  }).catch(() => {
    loadCandidate();
  });
  return loginWindow;
}

async function openBalanceLogin({ getMainWindow, targetUrl, onClosed, onActivity }) {
  const url = safeUrl(targetUrl);
  if (!url) {
    return createBalanceLoginStatus({
      status: 'unconfigured',
      message: '\u4f59\u989d\u9875\u9762\u5730\u5740\u672a\u914d\u7f6e',
    });
  }

  const parent = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const loginWindow = createLoginWindow({
    parent,
    targetUrl: url,
    onActivity,
    onClosed,
  });
  return {
    ...(await getBalanceLoginStatus(url)),
    status: 'opened',
    message: '\u767b\u5f55\u7a97\u53e3\u5df2\u6253\u5f00\uff0c\u8bf7\u5728\u7a97\u53e3\u4e2d\u5b8c\u6210\u767b\u5f55',
    windowId: loginWindow.id,
  };
}

async function renderedTextWithBalanceSession(targetUrl, options = {}) {
  const url = safeUrl(targetUrl);
  if (!url) return '';
  const ses = balanceSession();
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: ses,
    },
  });
  const timeoutMs = Math.max(1200, Math.min(12000, Number(options.timeoutMs) || 6500));
  const settleMs = Math.max(250, Math.min(5000, Number(options.settleMs) || 1200));
  const timeout = setTimeout(() => {
    try {
      window.webContents.stop();
    } catch (_) {
      // Best-effort timeout guard.
    }
  }, timeoutMs);
  timeout.unref?.();
  try {
    await window.loadURL(url);
  } catch (_) {
    // Some relay panels still render useful DOM after navigation errors.
  } finally {
    clearTimeout(timeout);
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, settleMs);
    timer.unref?.();
  });
  try {
    return await window.webContents.executeJavaScript(`
      (() => {
        const body = document.body;
        if (!body) return '';
        const text = body.innerText || body.textContent || '';
        return String(text).replace(/\\s+/g, ' ').trim().slice(0, 200000);
      })()
    `);
  } catch (_) {
    return '';
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function fetchWithBalanceSession(targetUrl, options = {}) {
  const ses = balanceSession();
  const cookies = await ses.cookies.get({ url: targetUrl });
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const authHeaders = options.headers?.Authorization || options.headers?.authorization
    ? {}
    : await getBalanceSessionAuthHeaders(targetUrl);
  return fetch(targetUrl, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...authHeaders,
      'User-Agent': options.headers?.['User-Agent'] || 'RelayMonitor/0.1',
    },
  });
}

module.exports = {
  BALANCE_PARTITION,
  authHeadersFromContext,
  authHeadersFromToken,
  clearBalanceAuthCache,
  createBalanceLoginStatus,
  extractStorageAuthContext,
  extractStorageAuthToken,
  fetchWithBalanceSession,
  getBalanceLoginStatus,
  openExternalBalancePage,
  openBalanceLogin,
  renderedTextWithBalanceSession,
  safeUrl,
};
