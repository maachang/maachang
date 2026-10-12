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
            try {
                const db = _dbCache.get(resolvedPath);
                db.close();
            } catch (e) {}
            _dbCache.delete(resolvedPath);
        }
    } else {
        for (const [key, db] of _dbCache.entries()) {
            try {
                db.close();
            } catch (e) {}
        }
        _dbCache.clear();
    }
}

/**
 * すべてのキャッシュされたDB接続を安全に閉じる (Graceful Shutdown用)
 */
function closeAll() {
    close();
}

/**
 * 指定ユーザー/テナントスコープにバインドされた安全なDBクライアントを生成 (BOLA/IDOR対策)
 * findById / find / count / updateById / deleteById 等の操作時に
 * 自動で `WHERE owner_column = userId` を強制付与して他者データへのアクセスを遮断する。
 *
 * @param {Object|string|number} user ユーザーオブジェクト({userId, id等})またはユーザーID値
 * @param {Object} [options] { ownerColumn: 'user_id', dbPath: string }
 * @returns {Object} スコープ化されたDBクライアント
 */
function forUser(user, options = {}) {
    let currentUserId = user;
    if (user && typeof user === 'object') {
        currentUserId = user.userId !== undefined ? user.userId : (user.id !== undefined ? user.id : null);
    }
    if (currentUserId === null || currentUserId === undefined) {
        throw new Error('[db.forUser] Invalid user context or missing userId');
    }

    const ownerColumn = options.ownerColumn || 'user_id';
    const defaultDbPath = options.dbPath;

    // テーブル名やカラム名の安全な識別子検証 (英数字とアンダースコアのみ許可)
    const checkIdent = (name) => {
        if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) {
            throw new Error(`[db.forUser] Invalid identifier: "${name}"`);
        }
        return name;
    };

    return {
        userId: currentUserId,
        ownerColumn,

        /**
         * IDと所有者カラムで1件取得
         */
        findById(table, id, idColumn = 'id', dbPath = defaultDbPath) {
            checkIdent(table);
            checkIdent(idColumn);
            checkIdent(ownerColumn);
            const sql = `SELECT * FROM ${table} WHERE ${idColumn} = ? AND ${ownerColumn} = ? LIMIT 1`;
            return get(sql, [id, currentUserId], dbPath);
        },

        /**
         * 所有者カラムで絞り込んで全件/条件取得
         */
        find(table, whereClause = '', params = [], dbPath = defaultDbPath) {
            checkIdent(table);
            checkIdent(ownerColumn);
            let sql = `SELECT * FROM ${table} WHERE ${ownerColumn} = ?`;
            const queryParams = [currentUserId];
            if (whereClause && whereClause.trim()) {
                sql += ` AND (${whereClause})`;
                if (Array.isArray(params)) {
                    queryParams.push(...params);
                } else {
                    queryParams.push(params);
                }
            }
            return all(sql, queryParams, dbPath);
        },

        /**
         * 所有者カラムで絞り込んで件数取得
         */
        count(table, whereClause = '', params = [], dbPath = defaultDbPath) {
            checkIdent(table);
            checkIdent(ownerColumn);
            let sql = `SELECT COUNT(*) AS count FROM ${table} WHERE ${ownerColumn} = ?`;
            const queryParams = [currentUserId];
            if (whereClause && whereClause.trim()) {
                sql += ` AND (${whereClause})`;
                if (Array.isArray(params)) {
                    queryParams.push(...params);
                } else {
                    queryParams.push(params);
                }
            }
            const res = get(sql, queryParams, dbPath);
            return res ? Number(res.count) : 0;
        },

        /**
         * 所有者カラムを自動付与してレコード挿入
         */
        insert(table, data = {}, dbPath = defaultDbPath) {
            checkIdent(table);
            checkIdent(ownerColumn);
            const record = { ...data, [ownerColumn]: currentUserId };
            const keys = Object.keys(record).map(checkIdent);
            if (keys.length === 0) {
                throw new Error('[db.forUser] Cannot insert empty record');
            }
            const placeholders = keys.map(() => '?').join(', ');
            const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
            const values = keys.map(k => record[k]);
            return run(sql, values, dbPath);
        },

        /**
         * 所有者カラムで保護された状態でID指定更新 (他人のIDは更新不可)
         */
        updateById(table, id, data = {}, idColumn = 'id', dbPath = defaultDbPath) {
            checkIdent(table);
            checkIdent(idColumn);
            checkIdent(ownerColumn);
            const keys = Object.keys(data).filter(k => k !== ownerColumn && k !== idColumn).map(checkIdent);
            if (keys.length === 0) return { changes: 0, lastInsertRowid: 0 };
            const setPart = keys.map(k => `${k} = ?`).join(', ');
            const sql = `UPDATE ${table} SET ${setPart} WHERE ${idColumn} = ? AND ${ownerColumn} = ?`;
            const values = [...keys.map(k => data[k]), id, currentUserId];
            return run(sql, values, dbPath);
        },

        /**
         * 所有者カラムで保護された状態でID指定削除 (他人のIDは削除不可)
         */
        deleteById(table, id, idColumn = 'id', dbPath = defaultDbPath) {
            checkIdent(table);
            checkIdent(idColumn);
            checkIdent(ownerColumn);
            const sql = `DELETE FROM ${table} WHERE ${idColumn} = ? AND ${ownerColumn} = ?`;
            return run(sql, [id, currentUserId], dbPath);
        }
    };
}

module.exports = {
    getDb,
    get,
    all,
    run,
    exec,
    transaction,
    close,
    closeAll,
    forUser
};

