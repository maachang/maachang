/**
 * AIメモ:
 * - http.js: タイムアウト・リトライ制御・クエリ付与・JSON送受信を備えた軽量 HTTP クライアント。
 * - ゼロ依存 (Bun/Node 標準の fetch / AbortSignal のみ)。
 * - 主な機能:
 *   - http.get(url, { query, timeout, retry, headers })
 *   - http.postJson(url, data, { timeout, headers })
 *   - http.post(url, body, options)
 *   - http.put(url, body, options)
 *   - http.delete(url, options)
 * - CommonJS 形式。
 */

'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

/**
 * IPアドレスがプライベートIP/ローカル/リンクローカル/クラウドメタデータ/予約済みか判定する
 * @param {string} ip 
 * @returns {boolean}
 */
function isPrivateIp(ip) {
    if (!net.isIP(ip)) return false;
    if (net.isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        if (parts[0] === 0) return true; // 0.0.0.0/8
        if (parts[0] === 10) return true; // 10.0.0.0/8
        if (parts[0] === 127) return true; // 127.0.0.0/8 (Loopback)
        if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 (Link Local / Cloud Metadata)
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
        if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // 100.64.0.0/10 Carrier-grade NAT
        if (parts[0] >= 224) return true; // Multicast / Reserved (224.0.0.0/4 and above)
        return false;
    }
    // IPv6
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fe80:')) return true; // Link-local
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // Unique local (ULA)
    if (norm.startsWith('::ffff:')) { // IPv4-mapped IPv6
        const v4 = norm.substring(7);
        return isPrivateIp(v4);
    }
    return false;
}

/**
 * ホスト名またはIPが安全か検証する (SSRF保護)
 * @param {string} urlString
 * @param {Object} [options]
 * @returns {Promise<{ safe: boolean, addresses: string[], reason?: string }>}
 */
async function validateUrlForSsrf(urlString, options = {}) {
    let parsedUrl;
    try {
        parsedUrl = new URL(urlString);
    } catch (e) {
        return { safe: false, addresses: [], reason: 'Invalid URL format' };
    }

    const protocol = parsedUrl.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
        return { safe: false, addresses: [], reason: `Forbidden protocol: ${protocol}` };
    }

    const hostname = parsedUrl.hostname;
    // リスト指定された許可ホストまたは拒否ホスト
    if (Array.isArray(options.allowedHosts) && options.allowedHosts.length > 0) {
        if (!options.allowedHosts.includes(hostname)) {
            return { safe: false, addresses: [], reason: `Host ${hostname} is not in allowedHosts` };
        }
    }

    // IP直指定のチェック
    if (net.isIP(hostname)) {
        if (isPrivateIp(hostname)) {
            return { safe: false, addresses: [hostname], reason: `Target IP ${hostname} is a private/internal address` };
        }
        return { safe: true, addresses: [hostname] };
    }

    // DNS名前解決による検証 (DNS Rebinding/SSRF対策)
    try {
        const records = await dns.lookup(hostname, { all: true });
        if (!records || records.length === 0) {
            return { safe: false, addresses: [], reason: `DNS lookup failed for ${hostname}` };
        }
        const addresses = records.map(r => r.address);
        for (const addr of addresses) {
            if (isPrivateIp(addr)) {
                return { safe: false, addresses, reason: `Host ${hostname} resolved to private/internal IP ${addr}` };
            }
        }
        return { safe: true, addresses };
    } catch (err) {
        return { safe: false, addresses: [], reason: `DNS resolution error: ${err.message}` };
    }
}

/**
 * URL にクエリパラメータを結合
 * @param {string} url 
 * @param {Object} [query] 
 * @returns {string}
 */
function appendQuery(url, query) {
    if (!query || typeof query !== 'object') return url;
    const urlObj = new URL(url, 'http://localhost');
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
            urlObj.searchParams.append(k, String(v));
        }
    }
    return url.startsWith('http') ? urlObj.toString() : urlObj.pathname + urlObj.search;
}

/**
 * タイムアウト・リトライ付きの fetch リクエスト実行
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function executeFetch(url, options = {}) {
    const timeoutMs = options.timeout || 10000;
    const retries = options.retry || 0;
    const retryDelay = options.retryDelay || 300;

    // SSRF対策 (safe: true または ssrf: true または blockPrivateIPs: true が指定された場合)
    if (options.ssrfProtection === true || options.safe === true || options.blockPrivateIPs === true) {
        const check = await validateUrlForSsrf(url, options);
        if (!check.safe) {
            const err = new Error(`SSRF blocked: ${check.reason}`);
            err.code = 'ERR_SSRF_BLOCKED';
            err.details = check;
            throw err;
        }
    }

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);

        try {
            const fetchOptions = {
                ...options,
                signal: controller.signal
            };

            const response = await fetch(url, fetchOptions);
            clearTimeout(timer);

            // 5xx 系サーバーエラー時はリトライ対象
            if (!response.ok && response.status >= 500 && attempt < retries) {
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
            }

            return response;
        } catch (err) {
            clearTimeout(timer);
            lastError = err;
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }
    }

    throw lastError || new Error(`Failed to fetch ${url}`);
}

/**
 * GET リクエスト
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function get(url, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'GET',
        ...options
    });
}

/**
 * GET リクエストして JSON を直接取得
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<any>}
 */
async function getJson(url, options = {}) {
    const res = await get(url, {
        ...options,
        headers: {
            'Accept': 'application/json',
            ...(options.headers || {})
        }
    });
    return res.json();
}

/**
 * POST リクエスト
 * @param {string} url 
 * @param {any} body 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function post(url, body, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'POST',
        body,
        ...options
    });
}

/**
 * POST リクエスト (JSON 送信 ＆ JSON 受信)
 * @param {string} url 
 * @param {Object} jsonData 
 * @param {Object} [options] 
 * @returns {Promise<any>}
 */
async function postJson(url, jsonData, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    const res = await executeFetch(fullUrl, {
        method: 'POST',
        body: JSON.stringify(jsonData),
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers || {})
        }
    });
    return res.json();
}

/**
 * PUT リクエスト
 * @param {string} url 
 * @param {any} body 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function put(url, body, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'PUT',
        body,
        ...options
    });
}

/**
 * DELETE リクエスト
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function del(url, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'DELETE',
        ...options
    });
}

module.exports = {
    fetch: executeFetch,
    get,
    getJson,
    post,
    postJson,
    put,
    delete: del,
    appendQuery,
    isPrivateIp,
    validateUrlForSsrf
};
