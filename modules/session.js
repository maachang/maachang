/**
 * AIメモ:
 * - SQLite3 (bun:sqlite) を利用したセッション管理モジュール。
 * - minto の modules/auth/session.js 仕様を踏襲し、$loadLib("session.js") で直接利用可能。
 * - conf/session.json (または session.local.json) から設定を読み込み初期化。
 * - 主な機能:
 *   - createSession($response, initialData): セッション新規作成 & Cookie発行
 *   - getSession($request): セッションデータ取得 (有効期限切れ時は null)
 *   - setSession(sid, data): セッションデータ更新
 *   - deleteSession($request, $response): セッション削除 & Cookie破棄
 *   - cleanExpiredSessions(): 有効期限切れセッションの掃除
 * - CommonJS 形式。
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const dbWrapper = require('../src/db.js');

// 設定キャッシュ
let _conf = null;
let _isTableInitialized = false;

/**
 * セッション設定を取得
 * @returns {Object}
 */
function getConf() {
    if (_conf !== null) {
        return _conf;
    }

    let loaded = null;
    if (typeof $loadConf === 'function') {
        loaded = $loadConf('session.json');
    }

    _conf = {
        dbPath: (loaded && loaded.dbPath) ? loaded.dbPath : './data/session.db',
        cookieName: (loaded && loaded.cookieName) ? loaded.cookieName : (process.env.MAACHANG_COOKIE_SESSION_NAME || process.env.MINTO_COOKIE_SESSION_NAME || 'maachang_sid'),
        timeoutMin: (loaded && loaded.timeoutMin) ? loaded.timeoutMin : 60,
        sameSite: (loaded && loaded.sameSite) ? loaded.sameSite : 'Lax',
        httpOnly: (loaded && loaded.httpOnly !== undefined) ? loaded.httpOnly : true,
        secure: (loaded && loaded.secure !== undefined) ? loaded.secure : false
    };

    return _conf;
}

/**
 * セッションテーブルを初期化
 * @param {string} dbPath
 */
function ensureTable(dbPath) {
    if (_isTableInitialized) return;
    const sql = `
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
    `;
    dbWrapper.exec(sql, dbPath);
    _isTableInitialized = true;
}

/**
 * ランダムなセッションID (32バイト hex) を生成
 * @returns {string}
 */
function generateSid() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * リクエストからセッションIDを取得
 * @param {Object} $request
 * @returns {string|null}
 */
function getCookieSessionId($request) {
    if (!$request) return null;
    const conf = getConf();
    if (typeof $request.getCookie === 'function') {
        return $request.getCookie(conf.cookieName);
    }
    if ($request.cookies && $request.cookies[conf.cookieName]) {
        return $request.cookies[conf.cookieName];
    }
    return null;
}

/**
 * セッションを新規作成して Cookie をセットする
 * @param {Object} $response
 * @param {Object} [initialData]
 * @returns {{ sid: string, data: Object }}
 */
function createSession($response, initialData = {}) {
    const conf = getConf();
    ensureTable(conf.dbPath);

    const sid = generateSid();
    const now = Date.now();
    const expiresAt = now + conf.timeoutMin * 60 * 1000;
    const dataJson = JSON.stringify(initialData);

    dbWrapper.run(
        `INSERT INTO sessions (sid, data, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [sid, dataJson, expiresAt, now, now],
        conf.dbPath
    );

    if ($response && typeof $response.setCookie === 'function') {
        $response.setCookie(conf.cookieName, sid, {
            maxAge: conf.timeoutMin * 60,
            path: '/',
            sameSite: conf.sameSite,
            httpOnly: conf.httpOnly,
            secure: conf.secure
        });
    }

    return { sid, data: initialData };
}

/**
 * リクエストに対応するセッションデータを取得する
 * @param {Object} $request
 * @returns {Object|null} セッションデータ (存在しない/期限切れ時は null)
 */
function getSession($request) {
    const sid = getCookieSessionId($request);
    if (!sid) return null;

    const conf = getConf();
    ensureTable(conf.dbPath);

    const now = Date.now();
    const row = dbWrapper.get(
        `SELECT data, expires_at FROM sessions WHERE sid = ?`,
        [sid],
        conf.dbPath
    );

    if (!row) {
        return null;
    }

    if (row.expires_at < now) {
        // 期限切れセッションの削除
        dbWrapper.run(`DELETE FROM sessions WHERE sid = ?`, [sid], conf.dbPath);
        return null;
    }

    try {
        const data = JSON.parse(row.data);
        return { sid, data };
    } catch (e) {
        return null;
    }
}

/**
 * セッションデータを更新する
 * @param {string} sid
 * @param {Object} data
 * @param {boolean} [extendTimeout=true] 有効期限を延長するかどうか
 * @returns {boolean}
 */
function setSession(sid, data, extendTimeout = true) {
    if (!sid) return false;

    const conf = getConf();
    ensureTable(conf.dbPath);

    const now = Date.now();
    const dataJson = JSON.stringify(data);

    let result;
    if (extendTimeout) {
        const expiresAt = now + conf.timeoutMin * 60 * 1000;
        result = dbWrapper.run(
            `UPDATE sessions SET data = ?, expires_at = ?, updated_at = ? WHERE sid = ?`,
            [dataJson, expiresAt, now, sid],
            conf.dbPath
        );
    } else {
        result = dbWrapper.run(
            `UPDATE sessions SET data = ?, updated_at = ? WHERE sid = ?`,
            [dataJson, now, sid],
            conf.dbPath
        );
    }

    return result.changes > 0;
}

/**
 * セッションを削除する
 * @param {Object} $request
 * @param {Object} [$response]
 * @returns {boolean}
 */
function deleteSession($request, $response) {
    const sid = getCookieSessionId($request);
    const conf = getConf();

    if ($response && typeof $response.deleteCookie === 'function') {
        $response.deleteCookie(conf.cookieName, { path: '/' });
    }

    if (!sid) return false;

    ensureTable(conf.dbPath);
    const result = dbWrapper.run(`DELETE FROM sessions WHERE sid = ?`, [sid], conf.dbPath);
    return result.changes > 0;
}

/**
 * 期限切れセッションをすべてクリーンアップする
 * @returns {number} 削除された件数
 */
function cleanExpiredSessions() {
    const conf = getConf();
    ensureTable(conf.dbPath);

    const now = Date.now();
    const result = dbWrapper.run(`DELETE FROM sessions WHERE expires_at < ?`, [now], conf.dbPath);
    return result.changes;
}

module.exports = {
    getConf,
    getCookieSessionId,
    createSession,
    getSession,
    setSession,
    deleteSession,
    cleanExpiredSessions
};
