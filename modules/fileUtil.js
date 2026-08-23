/**
 * AIメモ:
 * - fileUtil.js: ファイル・ディレクトリ・JSON・アップロード処理向けの安全な入出力ユーティリティ。
 * - ゼロ依存 (Node/Bun 標準の node:fs, node:path, node:crypto のみ)。
 * - 主な機能:
 *   - readJson(path, defaultVal) / writeJson(path, data, space)
 *   - readText(path, defaultVal) / writeText(path, text)
 *   - ensureDir(dirPath) / remove(targetPath) / exists(targetPath)
 *   - list(dirPath, options) (拡張子絞り込み・再帰探索対応)
 *   - safeFileName(originalName, allowedExts, prefix) (パストラバーサル防止 & 拡張子検証)
 *   - copy(src, dest) / size(path)
 * - CommonJS 形式。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = typeof $require === 'function' ? $require('crypto') : require('node:crypto');

/**
 * ディレクトリが存在しない場合に再帰的に作成
 * @param {string} dirPath 
 * @returns {string} 作成されたディレクトリパス
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

/**
 * ファイルまたはディレクトリが存在するか確認
 * @param {string} targetPath 
 * @returns {boolean}
 */
function exists(targetPath) {
    if (!targetPath) return false;
    return fs.existsSync(targetPath);
}

/**
 * ファイルサイズを取得 (バイト数、存在しない場合は -1)
 * @param {string} targetPath 
 * @returns {number}
 */
function size(targetPath) {
    try {
        const stat = fs.statSync(targetPath);
        return stat.size;
    } catch (e) {
        return -1;
    }
}

/**
 * ファイルの拡張子を取得 (小文字、ドットなし、例: 'png', 'json')
 * @param {string} fileNameOrPath 
 * @returns {string}
 */
function getExt(fileNameOrPath) {
    if (!fileNameOrPath) return '';
    const ext = path.extname(String(fileNameOrPath)).toLowerCase();
    return ext.startsWith('.') ? ext.slice(1) : ext;
}

/**
 * JSON文字列からJavaScriptコメント (// および /* ... * /) を安全に除去し、末尾カンマも処理する
 * @param {string} jsonString 
 * @returns {string}
 */
function stripJsonComments(jsonString) {
    if (typeof jsonString !== 'string') return '';
    let result = '';
    let inString = false;
    let stringQuote = null;
    let inSingleComment = false;
    let inMultiComment = false;
    let isEscaped = false;
    let pendingComma = false;
    let pendingWhitespace = '';

    const len = jsonString.length;
    for (let i = 0; i < len; i++) {
        const c = jsonString[i];
        const next = i + 1 < len ? jsonString[i + 1] : '';

        // 単一行コメントの処理
        if (inSingleComment) {
            if (c === '\n' || c === '\r') {
                inSingleComment = false;
                if (pendingComma) {
                    pendingWhitespace += c;
                } else {
                    result += c;
                }
            }
            continue;
        }

        // 複数行コメントの処理
        if (inMultiComment) {
            if (c === '*' && next === '/') {
                inMultiComment = false;
                i++;
            } else if (c === '\n') {
                if (pendingComma) {
                    pendingWhitespace += c;
                } else {
                    result += c;
                }
            }
            continue;
        }

        // 文字列リテラル内の処理
        if (inString) {
            result += c;
            if (isEscaped) {
                isEscaped = false;
            } else if (c === '\\') {
                isEscaped = true;
            } else if (c === stringQuote) {
                inString = false;
                stringQuote = null;
            }
            continue;
        }

        // 空白文字の処理 (カンマ保留中なら蓄積)
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            if (pendingComma) {
                pendingWhitespace += c;
            } else {
                result += c;
            }
            continue;
        }

        // 単一行コメント // の開始
        if (c === '/' && next === '/') {
            inSingleComment = true;
            i++;
            continue;
        }

        // 複数行コメント /* の開始
        if (c === '/' && next === '*') {
            inMultiComment = true;
            i++;
            continue;
        }

        // 保留中のカンマがある場合、次の有効文字をチェック
        if (pendingComma) {
            if (c === '}' || c === ']') {
                result += pendingWhitespace + c;
            } else {
                result += ',' + pendingWhitespace + c;
            }
            pendingComma = false;
            pendingWhitespace = '';

            if (c === '"' || c === "'") {
                inString = true;
                stringQuote = c;
                isEscaped = false;
            }
            continue;
        }

        // カンマの検出
        if (c === ',') {
            pendingComma = true;
            pendingWhitespace = '';
            continue;
        }

        // 文字列開始の検出
        if (c === '"' || c === "'") {
            inString = true;
            stringQuote = c;
            isEscaped = false;
            result += c;
            continue;
        }

        result += c;
    }

    if (pendingComma) {
        result += ',' + pendingWhitespace;
    }

    return result;
}

/**
 * コメント付きJSON (JSONC) 文字列を安全にパースする
 * @param {string} jsonString 
 * @param {*} [defaultValue=null] 
 * @returns {*}
 */
function parseJson(jsonString, defaultValue = null) {
    if (jsonString === null || jsonString === undefined) return defaultValue;
    try {
        const stripped = stripJsonComments(String(jsonString).trim());
        if (!stripped) return defaultValue;
        return JSON.parse(stripped);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * JSON ファイルを安全に読み込み (コメント付きJSONC対応、存在しない場合やパースエラー時は defaultValue を返却)
 * @param {string} filePath 
 * @param {*} [defaultValue=null] 
 * @returns {*}
 */
function readJson(filePath, defaultValue = null) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        const content = fs.readFileSync(filePath, 'utf-8');
        return parseJson(content, defaultValue);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * オブジェクトを JSON ファイルとして安全に保存 (親ディレクトリも自動作成)
 * @param {string} filePath 
 * @param {*} data 
 * @param {number|string} [space=2] 
 * @returns {boolean} 成功時 true
 */
function writeJson(filePath, data, space = 2) {
    try {
        ensureDir(path.dirname(filePath));
        const jsonStr = JSON.stringify(data, null, space) + '\n';
        fs.writeFileSync(filePath, jsonStr, 'utf-8');
        return true;
    } catch (e) {
        throw new Error(`JSONファイルの書き込みに失敗しました (${filePath}): ${e.message}`);
    }
}

/**
 * テキストファイルを読み込み
 * @param {string} filePath 
 * @param {string} [defaultValue=''] 
 * @returns {string}
 */
function readText(filePath, defaultValue = '') {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        return defaultValue;
    }
}

/**
 * テキストファイルを書き込み (親ディレクトリも自動作成)
 * @param {string} filePath 
 * @param {string} text 
 * @returns {boolean}
 */
function writeText(filePath, text) {
    try {
        ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, String(text), 'utf-8');
        return true;
    } catch (e) {
        throw new Error(`テキストファイルの書き込みに失敗しました (${filePath}): ${e.message}`);
    }
}

/**
 * バイナリファイルを読み込み
 * @param {string} filePath 
 * @param {Buffer|null} [defaultValue=null] 
 * @returns {Buffer|null}
 */
function readBuffer(filePath, defaultValue = null) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        return fs.readFileSync(filePath);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * バイナリファイルを書き込み (親ディレクトリも自動作成)
 * @param {string} filePath 
 * @param {Buffer|Uint8Array} buffer 
 * @returns {boolean}
 */
function writeBuffer(filePath, buffer) {
    try {
        ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, buffer);
        return true;
    } catch (e) {
        throw new Error(`バイナリファイルの書き込みに失敗しました (${filePath}): ${e.message}`);
    }
}

/**
 * ファイルまたはディレクトリを再帰的に削除
 * @param {string} targetPath 
 * @returns {boolean}
 */
function remove(targetPath) {
    try {
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * ファイルをコピー (コピー先ディレクトリも自動作成)
 * @param {string} srcPath 
 * @param {string} destPath 
 * @returns {boolean}
 */
function copy(srcPath, destPath) {
    try {
        ensureDir(path.dirname(destPath));
        fs.copyFileSync(srcPath, destPath);
        return true;
    } catch (e) {
        throw new Error(`ファイルのコピーに失敗しました (${srcPath} -> ${destPath}): ${e.message}`);
    }
}

/**
 * ディレクトリ内のファイル一覧を取得
 * @param {string} dirPath 
 * @param {Object} [options]
 * @param {string|string[]} [options.ext] 拡張子フィルタ (例: 'json' または ['.jpg', '.png'])
 * @param {boolean} [options.recursive=false] サブディレクトリも再帰探索するか
 * @returns {string[]} 相対パスまたは絶対パスの一覧
 */
function list(dirPath, options = {}) {
    if (!fs.existsSync(dirPath)) return [];

    let targetExts = null;
    if (options.ext) {
        const raw = Array.isArray(options.ext) ? options.ext : [options.ext];
        targetExts = raw.map(e => e.toLowerCase().replace(/^\./, ''));
    }

    const recursive = !!options.recursive;
    const results = [];

    function scan(currentDir, relativeBase = '') {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const relPath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (recursive) {
                    scan(fullPath, relPath);
                }
            } else if (entry.isFile()) {
                if (targetExts) {
                    const ext = getExt(entry.name);
                    if (!targetExts.includes(ext)) continue;
                }
                results.push(relPath);
            }
        }
    }

    scan(dirPath);
    return results;
}

/**
 * アップロードファイル名などを安全なファイル名にサニタイズ・生成
 * (パストラバーサル防止、拡張子ホワイトリスト検証、ユニーク名生成)
 * @param {string} originalName 元のファイル名
 * @param {string[]} [allowedExts] 許可する拡張子の配列 (例: ['jpg', 'png', 'pdf'])
 * @param {string} [prefix=''] ファイル名の接頭辞 (例: 'upload_')
 * @returns {string} 安全なファイル名
 */
function safeFileName(originalName, allowedExts = null, prefix = '') {
    if (!originalName) {
        throw new Error('ファイル名が空です');
    }

    // パストラバーサル防止 (ディレクトリパスを除去)
    const baseName = path.basename(String(originalName)).trim();
    const ext = getExt(baseName);

    if (allowedExts && Array.isArray(allowedExts)) {
        const normalizedAllowed = allowedExts.map(e => e.toLowerCase().replace(/^\./, ''));
        if (!normalizedAllowed.includes(ext)) {
            throw new Error(`許可されていないファイル拡張子です (.${ext})。許可拡張子: ${normalizedAllowed.join(', ')}`);
        }
    }

    // ランダムな一意サフィックスを付与して安全な名前を生成
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const timestamp = Date.now();
    const cleanExt = ext ? `.${ext}` : '';

    return `${prefix}${timestamp}_${randomSuffix}${cleanExt}`;
}

module.exports = {
    ensureDir,
    exists,
    size,
    getExt,
    stripJsonComments,
    parseJson,
    readJson,
    writeJson,
    readText,
    writeText,
    readBuffer,
    writeBuffer,
    remove,
    copy,
    list,
    safeFileName
};
