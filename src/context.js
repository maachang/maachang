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
            const parsed = JSON.parse(fs.readFileSync(projectEnv, 'utf-8'));
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
            const parsed = JSON.parse(fs.readFileSync(localEnv, 'utf-8'));
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
 * クライアントのIPアドレスを取得 (Nginx等のリバースプロキシを考慮)
 * @param {Request} req 
 * @param {Object} headers 
 * @returns {string}
 */
function getClientIp(req, headers) {
    if (headers['x-forwarded-for']) {
        const list = headers['x-forwarded-for'].split(',');
        return list[0].trim();
    }
    if (headers['x-real-ip']) {
        return headers['x-real-ip'].trim();
    }
    return '127.0.0.1';
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
    const clientIp = getClientIp(req, headers);

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

        // キャッシュキー
        const cacheKey = `${baseDir}:${normalized}`;
        if (_confCache.has(cacheKey)) {
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
            const parsed = JSON.parse(content);
            _confCache.set(cacheKey, parsed);
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
            return require(directProject);
        }

        const projectLib = path.join(baseDir, 'lib', normalized);
        if (fs.existsSync(projectLib)) {
            return require(projectLib);
        }

        const projectValidates = path.join(baseDir, 'validates', normalized);
        if (fs.existsSync(projectValidates)) {
            return require(projectValidates);
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
    loadEnv
};
