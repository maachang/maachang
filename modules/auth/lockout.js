/**
 * AIメモ:
 * - クレデンシャルスタッフィングおよびブルートフォース攻撃からアカウントとシステムを保護するモジュール。
 * - $loadLib('lockout.js') または $loadLib('auth/lockout.js') で利用可能。
 * - 主な機能:
 *   1. ユーザー/アカウント単位の連続失敗制限 (Account Lockout)
 *      - ログイン失敗回数 (maxAttempts) に応じて一定時間 (lockoutDurationMs) ロック。
 *      - 段階的バックオフ (exponential backoff) オプションのサポート。
 *   2. IP単位の連続試行・攻撃元ブロック (IP Auto-ban / Rate Limit)
 *      - 同一IPからの異常な連続失敗を検知して一時ブロック。
 *   3. 成功時のリセット (reset / recordSuccess)
 *   4. SQLite 永続化ストレージまたはインメモリストアの両方に対応。
 * - CommonJS 形式。
 */

'use strict';

const dbWrapper = require('../../src/db.js');

// インメモリストア (デフォルト)
const _inMemoryAttempts = new Map();
let _sqliteDb = null;
let _isTableInitialized = false;

/**
 * 試行管理テーブルの初期化 (SQLite使用時)
 * @param {string} dbPath 
 */
function initSqliteTable(dbPath) {
    if (_isTableInitialized) return;
    try {
        dbWrapper.exec(`
            CREATE TABLE IF NOT EXISTS auth_lockout (
                key TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                attempts INTEGER NOT NULL,
                first_failed_at INTEGER NOT NULL,
                last_failed_at INTEGER NOT NULL,
                locked_until INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_auth_lockout_locked ON auth_lockout(locked_until);
        `, dbPath);
        _isTableInitialized = true;
    } catch (e) {
        // SQLite使用不可時はインメモリへフォールバック
        _isTableInitialized = false;
    }
}

/**
 * アカウントロックおよびブルートフォース保護マネージャー
 */
class LockoutManager {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxAttempts=5] 最大試行失敗回数
     * @param {number} [options.lockoutDurationMs=900000] ロック時間(ミリ秒) デフォルト15分
     * @param {number} [options.windowMs=900000] 失敗カウントが保持される監視ウィンドウ(ミリ秒) デフォルト15分
     * @param {boolean} [options.exponential=false] 失敗回数に応じた段階的バックオフを行うか
     * @param {string} [options.dbPath] SQLite保存先パス (省略時はインメモリ)
     */
    constructor(options = {}) {
        this.maxAttempts = options.maxAttempts || 5;
        this.lockoutDurationMs = options.lockoutDurationMs || 15 * 60 * 1000;
        this.windowMs = options.windowMs || 15 * 60 * 1000;
        this.exponential = options.exponential === true;
        this.dbPath = options.dbPath || null;

        if (this.dbPath) {
            initSqliteTable(this.dbPath);
        }
    }

    /**
     * キーを正規化 (ユーザーID/メールまたはIP)
     * @private
     */
    _normalizeKey(identifier, scope = 'user') {
        const cleanId = String(identifier || '').trim().toLowerCase();
        return `${scope}:${cleanId}`;
    }

    /**
     * 現在のロック状態および試行回数を取得
     * @param {string} identifier アカウントID、メールアドレス、またはIP
     * @param {string} [scope='user'] 'user' または 'ip'
     * @returns {Promise<{ isLocked: boolean, remainingAttempts: number, lockedUntil: number|null, waitSeconds: number }>}
     */
    async check(identifier, scope = 'user') {
        const key = this._normalizeKey(identifier, scope);
        const now = Date.now();

        let record = null;
        if (this.dbPath && _isTableInitialized) {
            record = dbWrapper.findById('auth_lockout', key, { primaryKey: 'key', dbPath: this.dbPath });
        } else {
            record = _inMemoryAttempts.get(key);
        }

        if (!record) {
            return {
                isLocked: false,
                remainingAttempts: this.maxAttempts,
                lockedUntil: null,
                waitSeconds: 0
            };
        }

        // ロック期間中か
        if (record.locked_until > now) {
            const waitSeconds = Math.ceil((record.locked_until - now) / 1000);
            return {
                isLocked: true,
                remainingAttempts: 0,
                lockedUntil: record.locked_until,
                waitSeconds
            };
        }

        // 監視ウィンドウを過ぎている場合は期限切れリセット扱い
        if (now - record.last_failed_at > this.windowMs) {
            await this.reset(identifier, scope);
            return {
                isLocked: false,
                remainingAttempts: this.maxAttempts,
                lockedUntil: null,
                waitSeconds: 0
            };
        }

        const remainingAttempts = Math.max(0, this.maxAttempts - record.attempts);
        return {
            isLocked: false,
            remainingAttempts,
            lockedUntil: null,
            waitSeconds: 0
        };
    }

    /**
     * ログインまたは認証失敗を記録
     * @param {string} identifier 
     * @param {string} [scope='user'] 
     * @returns {Promise<{ isLocked: boolean, remainingAttempts: number, attempts: number, waitSeconds: number }>}
     */
    async recordFailure(identifier, scope = 'user') {
        const key = this._normalizeKey(identifier, scope);
        const now = Date.now();

        let record = null;
        if (this.dbPath && _isTableInitialized) {
            record = dbWrapper.findById('auth_lockout', key, { primaryKey: 'key', dbPath: this.dbPath });
        } else {
            record = _inMemoryAttempts.get(key);
        }

        // 監視ウィンドウ外であればリセット
        if (record && (now - record.last_failed_at > this.windowMs) && record.locked_until <= now) {
            record = null;
        }

        let attempts = record ? record.attempts + 1 : 1;
        let firstFailedAt = record ? record.first_failed_at : now;
        let lockedUntil = 0;

        // 最大失敗回数に達した場合はロック
        if (attempts >= this.maxAttempts) {
            let duration = this.lockoutDurationMs;
            if (this.exponential) {
                // 段階的バックオフ: 連続ロック毎に倍加 (最大 24時間)
                const multiplier = Math.pow(2, Math.min(10, attempts - this.maxAttempts));
                duration = Math.min(24 * 60 * 60 * 1000, this.lockoutDurationMs * multiplier);
            }
            lockedUntil = now + duration;
        }

        const newRecord = {
            key,
            scope,
            attempts,
            first_failed_at: firstFailedAt,
            last_failed_at: now,
            locked_until: lockedUntil
        };

        if (this.dbPath && _isTableInitialized) {
            if (record) {
                dbWrapper.updateById('auth_lockout', key, newRecord, { primaryKey: 'key', dbPath: this.dbPath });
            } else {
                dbWrapper.insert('auth_lockout', newRecord, this.dbPath);
            }
        } else {
            _inMemoryAttempts.set(key, newRecord);
        }

        const isLocked = lockedUntil > now;
        const waitSeconds = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;
        const remainingAttempts = isLocked ? 0 : Math.max(0, this.maxAttempts - attempts);

        return {
            isLocked,
            remainingAttempts,
            attempts,
            waitSeconds
        };
    }

    /**
     * ログイン成功時または管理者による解除時に試行履歴をリセット
     * @param {string} identifier 
     * @param {string} [scope='user'] 
     * @returns {Promise<boolean>}
     */
    async reset(identifier, scope = 'user') {
        const key = this._normalizeKey(identifier, scope);
        if (this.dbPath && _isTableInitialized) {
            try {
                dbWrapper.deleteById('auth_lockout', key, { primaryKey: 'key', dbPath: this.dbPath });
                return true;
            } catch (_) {
                return false;
            }
        } else {
            return _inMemoryAttempts.delete(key);
        }
    }

    /**
     * 期限切れデータのクリーンアップ
     */
    async cleanExpired() {
        const now = Date.now();
        if (this.dbPath && _isTableInitialized) {
            try {
                dbWrapper.exec(`
                    DELETE FROM auth_lockout 
                    WHERE locked_until <= ${now} AND (${now} - last_failed_at) > ${this.windowMs}
                `, this.dbPath);
            } catch (_) {}
        } else {
            for (const [k, v] of _inMemoryAttempts.entries()) {
                if (v.locked_until <= now && (now - v.last_failed_at) > this.windowMs) {
                    _inMemoryAttempts.delete(k);
                }
            }
        }
    }
}

// デフォルトインスタンス
const defaultManager = new LockoutManager();

module.exports = {
    LockoutManager,
    check: (id, scope) => defaultManager.check(id, scope),
    recordFailure: (id, scope) => defaultManager.recordFailure(id, scope),
    reset: (id, scope) => defaultManager.reset(id, scope),
    cleanExpired: () => defaultManager.cleanExpired(),
    createLockoutManager: (opts) => new LockoutManager(opts)
};
