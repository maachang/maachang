/**
 * AIメモ:
 * - minto の実行コンテキスト ($request, $response, $loadConf, $loadLib, $db) を生成するモジュール。
 * - $request / $response は関数呼び出し ($request(), $response()) とオブジェクトプロパティアクセス ($request.path, $response.json()) の両方に対応。
 * - $loadConf: conf/{name}.local.json (ローカル優先) または conf/{name}.json を読み込む。
 * - $loadLib: プロジェクトの lib/ 配下、あるいはフレームワークの modules/ 配下からモジュールを探索して require する。
 * - CommonJS 形式。
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const dbWrapper = require('./db.js');

// 設定ファイルのキャッシュ
const _confCache = new Map();
let _mimeMapCache = null;

/**
 * 拡張子に対応する MIME タイプを取得
 * @param {string} ext 拡張子 (.csv, .pdf 等)
 * @param {string} baseDir 
 * @param {string} frameworkDir 
 * @returns {string}
 */
function getMimeType(ext, baseDir, frameworkDir) {
    if (!_mimeMapCache) {
        let map = {};
        const projectMime = path.join(baseDir, 'conf', 'mime.json');
        const frameworkMime = path.join(frameworkDir, 'conf', 'mime.json');
        if (fs.existsSync(projectMime)) {
            map = parseJson(fs.readFileSync(projectMime, 'utf-8')) || {};
        } else if (fs.existsSync(frameworkMime)) {
            map = parseJson(fs.readFileSync(frameworkMime, 'utf-8')) || {};
        }
        _mimeMapCache = {
            '.html': 'text/html; charset=utf-8',
            '.htm': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.txt': 'text/plain; charset=utf-8',
            '.pdf': 'application/pdf',
            '.csv': 'text/csv; charset=utf-8',
            '.zip': 'application/zip',
            ...map
        };
    }
    return _mimeMapCache[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * JSON文字列からJavaScriptコメント (// および /* ... * /) を安全に除去し、末尾カンマも処理する
 * 文字列リテラル内の // や /*、エスケープシーケンス (\") を考慮
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
                i++; // '/' をスキップ
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
                // 末尾カンマ (trailing comma) なのでカンマは破棄
                result += pendingWhitespace + c;
            } else {
                // 通常のカンマなのでカンマを出力
                result += ',' + pendingWhitespace + c;
            }
            pendingComma = false;
            pendingWhitespace = '';

            // 文字列開始のチェック
            if (c === '"' || c === "'") {
                inString = true;
                stringQuote = c;
                isEscaped = false;
            }
            continue;
        }

        // カンマの検出 (末尾カンマ対応のために保留)
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
 * conf/env.json および conf/env.local.json を読み込み process.env にセットする
 * @param {string} baseDir プロジェクトルートパス
 * @returns {Object} 読み込まれた環境変数のマップ
 */
function loadEnv(baseDir) {
    if (!baseDir) return {};
    const loaded = {};

    const projectEnv = path.join(baseDir, 'conf', 'env.json');
    const localEnv = path.join(baseDir, 'conf', 'env.local.json');

    if (fs.existsSync(projectEnv)) {
        try {
            const parsed = parseJson(fs.readFileSync(projectEnv, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    process.env[k] = String(v);
                    loaded[k] = String(v);
                }
            }
        } catch (e) {
            console.error(`[loadEnv] Error loading ${projectEnv}:`, e.message);
        }
    }

    if (fs.existsSync(localEnv)) {
        try {
            const parsed = parseJson(fs.readFileSync(localEnv, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    process.env[k] = String(v);
                    loaded[k] = String(v);
                }
            }
        } catch (e) {
            console.error(`[loadEnv] Error loading ${localEnv}:`, e.message);
        }
    }

    return loaded;
}

/**
 * Cookie文字列をパースする
 * @param {string} cookieHeader 
 * @returns {Object}
 */
function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        list[name] = decodeURIComponent(value);
    });

    return list;
}

/**
 * クライアントのIPアドレス一覧を取得 (Nginx等のリバースプロキシを考慮)
 * @param {Request} req 
 * @param {Object} headers 
 * @returns {string[]}
 */
function getClientIps(req, headers) {
    if (headers['x-forwarded-for']) {
        return headers['x-forwarded-for'].split(',').map(s => s.trim()).filter(Boolean);
    }
    if (headers['x-real-ip']) {
        return [headers['x-real-ip'].trim()];
    }
    return ['127.0.0.1'];
}

/**
 * クライアントのIPアドレスを取得 (Nginx等のリバースプロキシを考慮)
 * @param {Request} req 
 * @param {Object} headers 
 * @returns {string}
 */
function getClientIp(req, headers) {
    const ips = getClientIps(req, headers);
    return ips[0] || '127.0.0.1';
}

/**
 * コンテキストオブジェクトを作成
 * @param {Object} options
 * @param {Request} options.req Bun Request
 * @param {URL} options.url URL
 * @param {*} options.body パース済みボディ
 * @param {string} options.baseDir プロジェクトルートパス
 * @param {string} [options.frameworkDir] フレームワークルートパス
 * @returns {Object} context
 */
function createContext({ req, url, body, baseDir, frameworkDir }) {
    loadEnv(baseDir);
    const fwDir = frameworkDir || process.env.MAACHANG_HOME || path.resolve(__dirname, '..');

    const headers = {};
    for (const [key, value] of req.headers.entries()) {
        headers[key.toLowerCase()] = value;
    }

    const query = {};
    for (const [key, value] of url.searchParams.entries()) {
        query[key] = value;
    }

    const cookies = parseCookies(headers['cookie']);
    const clientIps = getClientIps(req, headers);
    const clientIp = clientIps[0] || '127.0.0.1';

    // プロトコル判定 (Nginx X-Forwarded-Proto を考慮)
    const protocol = (headers['x-forwarded-proto'] || url.protocol.replace(':', '') || 'http').toLowerCase();
    const isSecure = protocol === 'https';

    // ホスト判定 (Nginx X-Forwarded-Host, Host ヘッダーを考慮)
    const host = headers['x-forwarded-host'] || headers['host'] || url.host;

    // ベースURL組み立て (例: https://example.com)
    const baseUrl = `${protocol}://${host}`;

    // $request 実体オブジェクト
    const requestTarget = {
        raw: req,
        url: url.href,
        path: url.pathname,
        method: req.method,
        headers,
        query,
        body,
        cookies,
        ip: clientIp,
        ips: clientIps,
        protocol,
        isSecure,
        host,
        baseUrl,
        // ヘルパーメソッド
        getHeader: (k) => headers[k.toLowerCase()],
        getQuery: (k, def = null) => (query[k] !== undefined ? query[k] : def),
        getCookie: (k, def = null) => (cookies[k] !== undefined ? cookies[k] : def),
        params: () => query
    };

    // 関数呼び出し $request() とプロパティアクセス $request.path の両対応 Proxy
    const $request = new Proxy(function () { return requestTarget; }, {
        get(target, prop, receiver) {
            if (prop in requestTarget) {
                return requestTarget[prop];
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value) {
            requestTarget[prop] = value;
            return true;
        }
    });

    // レスポンス状態
    let _status = 200;
    const _responseHeaders = new Headers();
    let _responseBody = undefined;
    let _isHandled = false;

    // $response 実体オブジェクト
    const responseTarget = {
        status: function (code) {
            if (code !== undefined) {
                _status = code;
                return $response;
            }
            return _status;
        },
        setStatus: function (code) {
            _status = code;
            return $response;
        },
        contentType: function (type, charset) {
            const val = charset ? `${type}; charset=${charset}` : type;
            _responseHeaders.set('Content-Type', val);
            return $response;
        },
        header: function (key, value) {
            if (value !== undefined) {
                _responseHeaders.set(key, value);
                return $response;
            }
            return _responseHeaders.get(key);
        },
        setHeader: function (key, value) {
            _responseHeaders.set(key, value);
            return $response;
        },
        setCookie: function (name, value, opts = {}) {
            let cookieStr = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
            if (opts.maxAge) cookieStr += `; Max-Age=${opts.maxAge}`;
            if (opts.expires) cookieStr += `; Expires=${opts.expires.toUTCString()}`;
            if (opts.path) cookieStr += `; Path=${opts.path}`;
            else cookieStr += '; Path=/';
            if (opts.domain) cookieStr += `; Domain=${opts.domain}`;
            if (opts.secure) cookieStr += '; Secure';
            if (opts.httpOnly !== false) cookieStr += '; HttpOnly';
            if (opts.sameSite) cookieStr += `; SameSite=${opts.sameSite}`;
            else cookieStr += '; SameSite=Lax';

            _responseHeaders.append('Set-Cookie', cookieStr);
            return $response;
        },
        deleteCookie: function (name, opts = {}) {
            return responseTarget.setCookie(name, '', { ...opts, maxAge: 0, expires: new Date(0) });
        },
        body: function (b) {
            if (b !== undefined) {
                _responseBody = b;
                _isHandled = true;
                return $response;
            }
            return _responseBody;
        },
        setBody: function (b) {
            _responseBody = b;
            return $response;
        },
        json: function (data, statusCode = _status) {
            _status = statusCode;
            _responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
            _responseBody = JSON.stringify(data);
            _isHandled = true;
            return _responseBody;
        },
        html: function (htmlContent, statusCode = _status) {
            _status = statusCode;
            _responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
            _responseBody = htmlContent;
            _isHandled = true;
            return _responseBody;
        },
        text: function (textContent, statusCode = _status) {
            _status = statusCode;
            _responseHeaders.set('Content-Type', 'text/plain; charset=utf-8');
            _responseBody = textContent;
            _isHandled = true;
            return _responseBody;
        },
        redirect: function (location, statusCode = 302) {
            _status = statusCode;
            _responseHeaders.set('Location', location);
            _responseBody = '';
            _isHandled = true;
            return _responseBody;
        },
        download: function (pathOrBuffer, downloadFileName, opts = {}) {
            let data;
            let filename = downloadFileName;

            if (typeof pathOrBuffer === 'string') {
                const resolvedPath = path.isAbsolute(pathOrBuffer) ? pathOrBuffer : path.resolve(baseDir, pathOrBuffer);
                if (!fs.existsSync(resolvedPath)) {
                    throw new Error(`[download] File not found: ${resolvedPath}`);
                }
                data = fs.readFileSync(resolvedPath);
                if (!filename) {
                    filename = path.basename(resolvedPath);
                }
            } else if (Buffer.isBuffer(pathOrBuffer) || pathOrBuffer instanceof Uint8Array) {
                data = pathOrBuffer;
                if (!filename) {
                    filename = 'download.bin';
                }
            } else if (typeof pathOrBuffer === 'object' && pathOrBuffer !== null) {
                data = JSON.stringify(pathOrBuffer, null, 2);
                if (!filename) filename = 'download.json';
            } else {
                data = String(pathOrBuffer);
                if (!filename) filename = 'download.txt';
            }

            const ext = path.extname(filename).toLowerCase();
            const contentType = opts.contentType || getMimeType(ext, baseDir, fwDir);
            _responseHeaders.set('Content-Type', contentType);

            // RFC 5987 に準拠した日本語ファイル名ヘッダー構築
            const encodedName = encodeURIComponent(filename);
            const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');
            _responseHeaders.set('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);

            _responseBody = data;
            _isHandled = true;
            return $response;
        },
        file: function (filePath, opts = {}) {
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`[file] File not found: ${resolvedPath}`);
            }
            const data = fs.readFileSync(resolvedPath);
            const filename = opts.filename || path.basename(resolvedPath);
            const ext = path.extname(filename).toLowerCase();
            const contentType = opts.contentType || getMimeType(ext, baseDir, fwDir);

            _responseHeaders.set('Content-Type', contentType);
            const dispositionType = opts.attachment ? 'attachment' : 'inline';
            const encodedName = encodeURIComponent(filename);
            const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');
            _responseHeaders.set('Content-Disposition', `${dispositionType}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);

            _responseBody = data;
            _isHandled = true;
            return $response;
        },
        getStatus: () => _status,
        getHeaders: () => _responseHeaders,
        getBody: () => _responseBody,
        isHandled: () => _isHandled
    };

    // 関数呼び出し $response() とプロパティアクセス $response.status() の両対応 Proxy
    const $response = new Proxy(function () { return responseTarget; }, {
        get(target, prop, receiver) {
            if (prop in responseTarget) {
                return responseTarget[prop];
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value) {
            responseTarget[prop] = value;
            return true;
        }
    });

    /**
     * 設定ファイルを読み込む
     * @param {string} confName 設定ファイル名 (例: 'server.json')
     * @returns {Object|null}
     */
    function $loadConf(confName) {
        if (!confName) return null;
        const normalized = confName.endsWith('.json') ? confName : `${confName}.json`;
        const baseName = normalized.replace(/\.json$/, '');

        const isDev = process.env.APP_ENV === 'development' || process.env.NODE_ENV !== 'production';

        // キャッシュキー
        const cacheKey = `${baseDir}:${normalized}`;
        if (!isDev && _confCache.has(cacheKey)) {
            return _confCache.get(cacheKey);
        }

        // 探索順序:
        // 1. {baseDir}/conf/{name}.local.json
        // 2. {baseDir}/conf/{name}.json
        // 3. {fwDir}/conf/{name}.json
        const localPath = path.join(baseDir, 'conf', `${baseName}.local.json`);
        const projectConfPath = path.join(baseDir, 'conf', normalized);
        const frameworkConfPath = path.join(fwDir, 'conf', normalized);

        let targetPath = null;
        if (fs.existsSync(localPath)) {
            targetPath = localPath;
        } else if (fs.existsSync(projectConfPath)) {
            targetPath = projectConfPath;
        } else if (fs.existsSync(frameworkConfPath)) {
            targetPath = frameworkConfPath;
        }

        if (!targetPath) {
            return null;
        }

        try {
            const content = fs.readFileSync(targetPath, 'utf-8');
            const parsed = parseJson(content);
            if (parsed !== null && !isDev) {
                _confCache.set(cacheKey, parsed);
            }
            return parsed;
        } catch (e) {
            console.error(`[$loadConf] Error loading ${targetPath}:`, e.message);
            return null;
        }
    }

    /**
     * ライブラリを読み込む
     * @param {string} libName ライブラリ名 (例: 'session.js')
     * @returns {*}
     */
    function $loadLib(libName) {
        if (!libName) return null;
        const normalized = libName.endsWith('.js') ? libName : `${libName}.js`;

        // 探索順序:
        // 1. {baseDir}/{normalized} (validates/... や lib/... などの指定時)
        // 2. {baseDir}/lib/{normalized}
        // 3. {baseDir}/validates/{normalized}
        // 4. {fwDir}/modules/{normalized}
        // 5. {fwDir}/modules/*/{normalized}
        const directProject = path.join(baseDir, normalized);
        if (fs.existsSync(directProject) && fs.statSync(directProject).isFile()) {
            const resolved = path.resolve(directProject);
            if (process.env.APP_ENV === 'development' || process.env.NODE_ENV !== 'production') {
                delete require.cache[resolved];
            }
            return require(resolved);
        }

        const projectLib = path.join(baseDir, 'lib', normalized);
        if (fs.existsSync(projectLib)) {
            const resolved = path.resolve(projectLib);
            if (process.env.APP_ENV === 'development' || process.env.NODE_ENV !== 'production') {
                delete require.cache[resolved];
            }
            return require(resolved);
        }

        const projectValidates = path.join(baseDir, 'validates', normalized);
        if (fs.existsSync(projectValidates)) {
            const resolved = path.resolve(projectValidates);
            if (process.env.APP_ENV === 'development' || process.env.NODE_ENV !== 'production') {
                delete require.cache[resolved];
            }
            return require(resolved);
        }

        const frameworkDirect = path.join(fwDir, 'modules', normalized);
        if (fs.existsSync(frameworkDirect)) {
            return require(frameworkDirect);
        }

        const modulesDir = path.join(fwDir, 'modules');
        if (fs.existsSync(modulesDir)) {
            const subdirs = fs.readdirSync(modulesDir, { withFileTypes: true });
            for (const dirent of subdirs) {
                if (dirent.isDirectory()) {
                    const subPath = path.join(modulesDir, dirent.name, normalized);
                    if (fs.existsSync(subPath)) {
                        return require(subPath);
                    }
                }
            }
        }

        throw new Error(`[$loadLib] Module not found: ${libName}`);
    }

    return {
        $request,
        $response,
        $loadConf,
        $loadLib,
        $require: require,
        $db: dbWrapper
    };
}

module.exports = {
    createContext,
    parseCookies,
    getClientIp,
    getClientIps,
    loadEnv,
    stripJsonComments,
    parseJson
};
