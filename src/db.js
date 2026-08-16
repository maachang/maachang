/**
 * AIメモ:
 * - Bun組み込みの `bun:sqlite` (Database) を利用した最小限のSQLite3ラッパー。
 * - RDBMSが未指定の場合に標準で利用される。
 * - データベースインスタンスはパスごとにキャッシュし、多重オープンを防止する。
 * - クエリ実行メソッド (get, all, run, exec, transaction) を提供する。
 * - コモンJS (CommonJS) 形式で実装。
 */

'use strict';

const { Database } = require('bun:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// データベースインスタンスのキャッシュ
const _dbCache = new Map();

/**
 * データベース接続を取得または作成
 * @param {string} [dbPath] データベースファイルのパス (省略時は ':memory:')
 * @returns {Database} Bun SQLiteインスタンス
 */
function getDb(dbPath = ':memory:') {
    const resolvedPath = dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath);

    if (_dbCache.has(resolvedPath)) {
        return _dbCache.get(resolvedPath);
    }

    if (resolvedPath !== ':memory:') {
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    const db = new Database(resolvedPath, { create: true });
    // WALモードを有効化して並行性能を向上
    if (resolvedPath !== ':memory:') {
        try {
            db.exec('PRAGMA journal_mode = WAL;');
            db.exec('PRAGMA synchronous = NORMAL;');
        } catch (e) {
            // WAL設定失敗時は継続
        }
    }

    _dbCache.set(resolvedPath, db);
    return db;
}

/**
 * 1件取得 (SELECT ... LIMIT 1)
 * @param {string} sql 
 * @param {Array|Object} [params]
 * @param {string} [dbPath]
 * @returns {Object|null}
 */
function get(sql, params = [], dbPath) {
    const db = getDb(dbPath);
    const stmt = db.prepare(sql);
    return stmt.get(params) || null;
}

/**
 * 全件取得 (SELECT)
 * @param {string} sql 
 * @param {Array|Object} [params]
 * @param {string} [dbPath]
 * @returns {Array<Object>}
 */
function all(sql, params = [], dbPath) {
    const db = getDb(dbPath);
    const stmt = db.prepare(sql);
    return stmt.all(params);
}

/**
 * 更新・挿入・削除実行 (INSERT / UPDATE / DELETE)
 * @param {string} sql 
 * @param {Array|Object} [params]
 * @param {string} [dbPath]
 * @returns {{ changes: number, lastInsertRowid: number|bigint }}
 */
function run(sql, params = [], dbPath) {
    const db = getDb(dbPath);
    const stmt = db.prepare(sql);
    return stmt.run(params);
}

/**
 * SQLスクリプトの一括実行 (DDLなど)
 * @param {string} sql 
 * @param {string} [dbPath]
 */
function exec(sql, dbPath) {
    const db = getDb(dbPath);
    db.exec(sql);
}

/**
 * トランザクションラッパー
 * @param {Function} fn 
 * @param {string} [dbPath]
 * @returns {*}
 */
function transaction(fn, dbPath) {
    const db = getDb(dbPath);
    const tx = db.transaction(fn);
    return tx();
}

/**
 * キャッシュされたDBを閉じる
 * @param {string} [dbPath]
 */
function close(dbPath) {
    if (dbPath) {
        const resolvedPath = dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath);
        if (_dbCache.has(resolvedPath)) {
            const db = _dbCache.get(resolvedPath);
            db.close();
            _dbCache.delete(resolvedPath);
        }
    } else {
        for (const [key, db] of _dbCache.entries()) {
            db.close();
        }
        _dbCache.clear();
    }
}

module.exports = {
    getDb,
    get,
    all,
    run,
    exec,
    transaction,
    close
};
