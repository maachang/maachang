/**
 * AIメモ:
 * - minto の tools/localLog.js を踏襲したローカルロガーモジュール。
 * - 日別ローテーションファイル出力 (例: ./log/logout.yyyy-MM-dd.log) および標準出力に対応。
 * - ログレベル: TRACE(1), DEBUG(2), INFO(3), WARN(4), ERROR(5), LOG(99), NONE(100)
 * - conf/log.json (または log.local.json) で設定可能。
 * - CommonJS 形式。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

// 出力タイプ定義
const LEVEL_TRACE = 1;
const LEVEL_DEBUG = 2;
const LEVEL_INFO = 3;
const LEVEL_WARN = 4;
const LEVEL_ERROR = 5;
const LEVEL_LOG = 99;
const LEVEL_NONE = 100;

const LEVEL_NAMES = {
    [LEVEL_TRACE]: 'TRACE',
    [LEVEL_DEBUG]: 'DEBUG',
    [LEVEL_INFO]: 'INFO',
    [LEVEL_WARN]: 'WARN',
    [LEVEL_ERROR]: 'ERROR',
    [LEVEL_LOG]: 'LOG'
};

// 状態変数
let _logDir = './log';
let _logFilePrefix = 'logout';
let _logLevel = LEVEL_INFO;
let _writeToStdout = true;
let _isInitialized = false;

// ファイルストリーム管理
let _currentDateStr = null;
let _currentWriteStream = null;

/**
 * ログレベル文字列を数値に変換
 * @param {string|number} level 
 * @returns {number}
 */
function parseLogLevel(level) {
    if (typeof level === 'number') return level;
    if (typeof level !== 'string') return LEVEL_INFO;

    switch (level.trim().toLowerCase()) {
        case 'none': return LEVEL_NONE;
        case 'trace': return LEVEL_TRACE;
        case 'dbg':
        case 'debug': return LEVEL_DEBUG;
        case 'info': return LEVEL_INFO;
        case 'warn':
        case 'warning': return LEVEL_WARN;
        case 'err':
        case 'error': return LEVEL_ERROR;
        default: return LEVEL_INFO;
    }
}

/**
 * 日付フォーマット (yyyy-MM-dd HH:mm:ss.SSS)
 * @param {Date} date 
 * @returns {{ full: string, dateOnly: string }}
 */
function formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    return {
        full: `${y}-${m}-${d} ${h}:${min}:${s}.${ms}`,
        dateOnly: `${y}-${m}-${d}`
    };
}

/**
 * 書き込みストリームを取得 (日別ローテーション)
 * @param {string} dateOnly 
 * @returns {fs.WriteStream|null}
 */
function getWriteStream(dateOnly) {
    if (_currentDateStr === dateOnly && _currentWriteStream) {
        return _currentWriteStream;
    }

    if (_currentWriteStream) {
        try {
            _currentWriteStream.end();
        } catch (e) {}
    }

    if (!fs.existsSync(_logDir)) {
        fs.mkdirSync(_logDir, { recursive: true });
    }

    const logFilePath = path.join(_logDir, `${_logFilePrefix}.${dateOnly}.log`);
    _currentWriteStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf-8' });
    _currentDateStr = dateOnly;

    return _currentWriteStream;
}

/**
 * ロガーの設定を初期化
 * @param {Object} [options]
 * @param {string} [options.dir] ログ出力先ディレクトリ (デフォルト: ./log)
 * @param {string} [options.file] ログファイル名プレフィックス (デフォルト: logout)
 * @param {string|number} [options.level] 出力ログレベル (デフォルト: info)
 * @param {boolean} [options.stdout] 標準出力にも出すか (デフォルト: true)
 */
function setting(options = {}) {
    let streamNeedsReset = false;
    if (options.dir && options.dir !== _logDir) {
        _logDir = options.dir;
        streamNeedsReset = true;
    }
    if (options.file && options.file !== _logFilePrefix) {
        _logFilePrefix = options.file;
        streamNeedsReset = true;
    }
    if (options.level !== undefined) _logLevel = parseLogLevel(options.level);
    if (options.stdout !== undefined) _writeToStdout = !!options.stdout;

    if (streamNeedsReset && _currentWriteStream) {
        try {
            _currentWriteStream.end();
        } catch (e) {}
        _currentWriteStream = null;
        _currentDateStr = null;
    }
    _isInitialized = true;
}

/**
 * ログを出力
 * @param {number} level 
 * @param  {...any} args 
 */
function writeLog(level, ...args) {
    if (level < _logLevel || _logLevel === LEVEL_NONE) {
        return;
    }

    const now = new Date();
    const { full, dateOnly } = formatDate(now);
    const levelName = LEVEL_NAMES[level] || 'LOG';
    const message = util.format(...args);
    const logLine = `[${full}] [${levelName}] ${message}\n`;

    // 1. ファイル出力
    try {
        const stream = getWriteStream(dateOnly);
        if (stream) {
            stream.write(logLine);
        }
    } catch (e) {
        // ファイル書き込みエラー時は標準エラーに出力
        process.stderr.write(`[Logger Error] ${e.message}\n`);
    }

    // 2. 標準出力 / 標準エラー出力
    if (_writeToStdout) {
        if (level >= LEVEL_ERROR) {
            process.stderr.write(logLine);
        } else {
            process.stdout.write(logLine);
        }
    }
}

const logger = {
    setting,
    setLogLevel: (lvl) => { _logLevel = parseLogLevel(lvl); },
    getLogLevel: () => _logLevel,
    trace: (...args) => writeLog(LEVEL_TRACE, ...args),
    debug: (...args) => writeLog(LEVEL_DEBUG, ...args),
    info: (...args) => writeLog(LEVEL_INFO, ...args),
    warn: (...args) => writeLog(LEVEL_WARN, ...args),
    error: (...args) => writeLog(LEVEL_ERROR, ...args),
    log: (...args) => writeLog(LEVEL_LOG, ...args),
    // 定数
    LEVEL_TRACE,
    LEVEL_DEBUG,
    LEVEL_INFO,
    LEVEL_WARN,
    LEVEL_ERROR,
    LEVEL_NONE
};

module.exports = logger;
