/**
 * AIメモ:
 * - minto のルーティング・リクエスト処理アーキテクチャを踏襲したルーター。
 * - 処理フロー:
 *   1. favicon.ico の専用処理
 *   2. /filter, *.mt.js, *.jhtml.js, *.mt.html への直接アクセスを 403 で拒否
 *   3. public/filter.mt.js が存在すれば前処理として実行 (true 返却で継続、それ以外は中断)
 *   4. パス解決:
 *      - 拡張子なし: .mt.js -> .jhtml.js -> .mt.html / .jhtml の順で探索
 *      - 静的ファイル: public/ 配下の実ファイルを MIME 解決・ETag 検証して配信
 *   5. JS実行結果の型に応じた自動 Content-Type 判定 (string, object, buffer)
 * - CommonJS 形式。
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createContext } = require('./context.js');
const jhtml = require('./jhtml.js');

// MIMEキャッシュ
let _mimeMap = null;

/**
 * MIME設定を取得
 * @param {string} baseDir 
 * @param {string} frameworkDir 
 * @returns {Object}
 */
function getMimeMap(baseDir, frameworkDir) {
    if (_mimeMap) return _mimeMap;
    const projectMime = path.join(baseDir, 'conf', 'mime.json');
    const frameworkMime = path.join(frameworkDir, 'conf', 'mime.json');

    if (fs.existsSync(projectMime)) {
        try {
            _mimeMap = JSON.parse(fs.readFileSync(projectMime, 'utf-8'));
            return _mimeMap;
        } catch (e) {}
    }
    if (fs.existsSync(frameworkMime)) {
        try {
            _mimeMap = JSON.parse(fs.readFileSync(frameworkMime, 'utf-8'));
            return _mimeMap;
        } catch (e) {}
    }

    _mimeMap = {
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
        '.ico': 'image/x-icon',
        '.txt': 'text/plain; charset=utf-8'
    };
    return _mimeMap;
}

const _JHTML_SRC_EXTENSION = ".mt.html";
const _RUN_JHTML = ".jhtml.js";

/**
 * minto 互換の $include ハンドラを生成する
 * @param {Object} context 
 * @param {string} publicDir 
 * @param {boolean} isDev 
 * @returns {{ $include: Function, _includeStack: string[] }}
 */
function createIncludeHandler(context, publicDir, isDev = true) {
    const _includeStack = [];

    const $include = async function (name, params) {
        if (name == null || typeof name !== "string") {
            throw new Error("$include: target path must be a non-empty string");
        }
        name = name.trim();
        if (name.length === 0) {
            throw new Error("$include: target path is empty");
        }
        if (_includeStack.length >= 32) {
            throw new Error("Circular $include detected or maximum include depth exceeded: " + name);
        }

        // 呼び出し元のディレクトリを特定.
        const callerPath = _includeStack.length > 0 ? _includeStack[_includeStack.length - 1] : null;
        const callerDir = callerPath ? path.dirname(callerPath) : publicDir;

        const isRelative = name.startsWith("./") || name.startsWith("../");
        const isAbsolute = name.startsWith("/");

        const candidateBases = [];
        if (isAbsolute) {
            candidateBases.push(path.resolve(publicDir, name.substring(1)));
        } else if (isRelative) {
            candidateBases.push(path.resolve(callerDir, name));
        } else {
            // callerDir基準とpublic基準の両方を候補とする.
            candidateBases.push(path.resolve(callerDir, name));
            const pubBase = path.resolve(publicDir, name);
            if (candidateBases[0] !== pubBase) {
                candidateBases.push(pubBase);
            }
        }

        // 拡張子に応じた候補パスを展開.
        const candidates = [];
        for (let base of candidateBases) {
            if (base.endsWith(_JHTML_SRC_EXTENSION)) {
                // .mt.html 指定時
                if (isDev) {
                    candidates.push({ path: base, conv: true });
                    candidates.push({ path: base.substring(0, base.length - _JHTML_SRC_EXTENSION.length) + _RUN_JHTML, conv: false });
                } else {
                    candidates.push({ path: base.substring(0, base.length - _JHTML_SRC_EXTENSION.length) + _RUN_JHTML, conv: false });
                    candidates.push({ path: base, conv: false });
                }
            } else if (base.endsWith(_RUN_JHTML)) {
                // .jhtml.js 指定時
                if (isDev) {
                    candidates.push({ path: base.substring(0, base.length - _RUN_JHTML.length) + _JHTML_SRC_EXTENSION, conv: true });
                    candidates.push({ path: base, conv: false });
                } else {
                    candidates.push({ path: base, conv: false });
                }
            } else if (base.endsWith(".html") || base.endsWith(".htm")) {
                // .html / .htm 指定時
                candidates.push({ path: base, conv: isDev });
            } else {
                // 拡張子省略時
                if (isDev) {
                    candidates.push({ path: base + _JHTML_SRC_EXTENSION, conv: true });
                    candidates.push({ path: base + _RUN_JHTML, conv: false });
                    candidates.push({ path: base + ".html", conv: true });
                    candidates.push({ path: base + ".htm", conv: true });
                    candidates.push({ path: base, conv: false });
                } else {
                    candidates.push({ path: base + _RUN_JHTML, conv: false });
                    candidates.push({ path: base + _JHTML_SRC_EXTENSION, conv: false });
                    candidates.push({ path: base + ".html", conv: false });
                    candidates.push({ path: base + ".htm", conv: false });
                    candidates.push({ path: base, conv: false });
                }
            }
        }

        // 存在する候補を探す.
        let target = null;
        for (let cand of candidates) {
            if (fs.existsSync(cand.path) && fs.statSync(cand.path).isFile()) {
                target = cand;
                break;
            }
        }

        if (!target) {
            throw new Error("Failed to $include file: " + name);
        }

        // static html (convなし) の場合、ファイル内容を直接返す.
        if ((target.path.endsWith(".html") || target.path.endsWith(".htm")) && target.conv === false) {
            return fs.readFileSync(target.path, "utf8");
        }

        _includeStack.push(target.path);
        try {
            const code = target.conv
                ? jhtml.compileFile(target.path)
                : fs.readFileSync(target.path, "utf-8");
            return await executeJs(code, context, {
                currentFile: target.path,
                params: params || {}
            });
        } finally {
            _includeStack.pop();
        }
    };

    return { $include, _includeStack };
}

/**
 * JSスクリプトを安全に実行する
 * @param {string} jsSource 実行するJSコード
 * @param {Object} context 注入するコンテキストオブジェクト
 * @param {Object} [options] 追加オプション (params, currentFile)
 * @returns {Promise<*>} handler() の戻り値
 */
async function executeJs(jsSource, context, options = {}) {
    const exportsObj = {};
    const moduleObj = { exports: exportsObj };

    const argNames = [
        'exports',
        'module',
        '$request',
        '$response',
        '$loadConf',
        '$loadLib',
        '$require',
        '$db',
        'require',
        '$include',
        '$params'
    ];

    const argValues = [
        exportsObj,
        moduleObj,
        context.$request,
        context.$response,
        context.$loadConf,
        context.$loadLib,
        context.$require,
        context.$db,
        context.$require,
        context.$include,
        options.params || {}
    ];

    const fn = new Function(...argNames, jsSource);
    fn(...argValues);

    const handler = moduleObj.exports.handler || exportsObj.handler;
    if (typeof handler === 'function') {
        return await handler(options.params || {});
    }
    return undefined;
}

/**
 * リクエストを処理して Response を生成
 * @param {Request} req 
 * @param {Object} serverInfo 
 * @returns {Promise<Response>}
 */
async function handleRequest(req, { baseDir, frameworkDir, isDev = true }) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // 1. favicon.ico の即時対応
    if (pathname === '/favicon.ico') {
        const favPath = path.join(baseDir, 'public', 'favicon.ico');
        if (fs.existsSync(favPath)) {
            const file = Bun.file(favPath);
            return new Response(file, {
                headers: { 'Content-Type': 'image/x-icon' }
            });
        }
        return new Response(null, { status: 204 });
    }

    // 2. 内部ファイル・直接アクセス禁止チェック
    const pathSegments = pathname.split('/').filter(Boolean);
    const isPrivateSegment = pathSegments.some(seg => seg.startsWith('_'));

    if (
        isPrivateSegment ||
        pathname.startsWith('/filter') ||
        pathname.endsWith('.mt.js') ||
        pathname.endsWith('.jhtml.js') ||
        pathname.endsWith('.mt.html')
    ) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    // ボディのパース
    let parsedBody = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        const contentType = req.headers.get('content-type') || '';
        try {
            if (contentType.includes('application/json')) {
                parsedBody = await req.json();
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
                const formData = await req.formData();
                parsedBody = {};
                for (const [key, value] of formData.entries()) {
                    parsedBody[key] = value;
                }
            } else {
                parsedBody = await req.text();
            }
        } catch (e) {
            parsedBody = null;
        }
    }

    // コンテキスト生成
    const context = createContext({
        req,
        url,
        body: parsedBody,
        baseDir,
        frameworkDir
    });

    const publicDir = path.join(baseDir, 'public');
    const { $include, _includeStack } = createIncludeHandler(context, publicDir, isDev);
    context.$include = $include;

    // 3. filter.mt.js の実行
    const filterPath = path.join(publicDir, 'filter.mt.js');
    if (fs.existsSync(filterPath)) {
        try {
            const filterCode = fs.readFileSync(filterPath, 'utf-8');
            const filterResult = await executeJs(filterCode, context, {
                currentFile: filterPath
            });

            if (context.$response.isHandled()) {
                return buildResponse(context.$response, null, false);
            }

            if (filterResult !== true) {
                // 明示的に true が返されない場合は 403
                return new Response(JSON.stringify({ error: 'Access denied by filter' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });
            }
        } catch (err) {
            console.error('[Filter Error]', err);
            return new Response(JSON.stringify({ error: 'Filter Error', message: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }
    }

    // 4. パス解決 & 実行
    let targetRelPath = pathname;
    if (targetRelPath.startsWith('/')) {
        targetRelPath = targetRelPath.slice(1);
    }

    // 末尾スラッシュまたは空文字の場合は index を探索
    if (targetRelPath === '' || targetRelPath.endsWith('/')) {
        const indexHtml = path.join(publicDir, targetRelPath, 'index.html');
        const indexHtm = path.join(publicDir, targetRelPath, 'index.htm');
        if (fs.existsSync(indexHtml)) {
            return serveStatic(indexHtml, req, baseDir, frameworkDir);
        }
        if (fs.existsSync(indexHtm)) {
            return serveStatic(indexHtm, req, baseDir, frameworkDir);
        }
        targetRelPath = path.join(targetRelPath, 'index');
    }

    const ext = path.extname(targetRelPath);

    // A. 拡張子なし -> 動的JS (.mt.js, .jhtml.js, .mt.html, .jhtml) を探索
    if (!ext) {
        // (1) .mt.js
        const mtJsPath = path.join(publicDir, `${targetRelPath}.mt.js`);
        if (fs.existsSync(mtJsPath)) {
            return await runDynamicJs(mtJsPath, context, false, _includeStack);
        }

        // (2) .jhtml.js (事前コンパイル済み)
        const jhtmlJsPath = path.join(publicDir, `${targetRelPath}.jhtml.js`);
        if (fs.existsSync(jhtmlJsPath)) {
            return await runDynamicJs(jhtmlJsPath, context, true, _includeStack);
        }

        // (3) .mt.html または .jhtml (ローカル・オンデマンド変換)
        const mtHtmlPath = path.join(publicDir, `${targetRelPath}.mt.html`);
        const jhtmlPath = path.join(publicDir, `${targetRelPath}.jhtml`);
        const templatePath = fs.existsSync(mtHtmlPath) ? mtHtmlPath : (fs.existsSync(jhtmlPath) ? jhtmlPath : null);

        if (templatePath) {
            return await runJhtmlTemplate(templatePath, context, _includeStack);
        }

        // (4) 静的 index.html / index.htm (ディレクトリ指定の場合)
        const dirIndexHtml = path.join(publicDir, targetRelPath, 'index.html');
        if (fs.existsSync(dirIndexHtml)) {
            return serveStatic(dirIndexHtml, req, baseDir, frameworkDir);
        }
    } else if (ext === '.jhtml') {
        // B. .jhtml で直接リクエストされた場合
        const basePath = targetRelPath.slice(0, -ext.length);
        const jhtmlJsPath = path.join(publicDir, `${basePath}.jhtml.js`);
        if (fs.existsSync(jhtmlJsPath)) {
            return await runDynamicJs(jhtmlJsPath, context, true, _includeStack);
        }
        const mtHtmlPath = path.join(publicDir, `${basePath}.mt.html`);
        const jhtmlPath = path.join(publicDir, `${basePath}.jhtml`);
        const templatePath = fs.existsSync(mtHtmlPath) ? mtHtmlPath : (fs.existsSync(jhtmlPath) ? jhtmlPath : null);
        if (templatePath) {
            return await runJhtmlTemplate(templatePath, context, _includeStack);
        }
    } else {
        // C. 静的ファイル配信
        const staticFilePath = path.join(publicDir, targetRelPath);
        if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
            return serveStatic(staticFilePath, req, baseDir, frameworkDir);
        }
    }

    // 404 Not Found
    return new Response(JSON.stringify({ error: 'Not Found', path: pathname }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

/**
 * 動的JSを実行してレスポンスを生成
 */
async function runDynamicJs(filePath, context, isJhtml = false, includeStack = null) {
    if (includeStack) {
        includeStack.push(filePath);
    }
    try {
        const code = fs.readFileSync(filePath, 'utf-8');
        const result = await executeJs(code, context, {
            currentFile: filePath
        });
        return buildResponse(context.$response, result, isJhtml);
    } catch (err) {
        console.error(`[Error in ${filePath}]`, err);
        return new Response(JSON.stringify({ error: 'Execution Error', message: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    } finally {
        if (includeStack) {
            includeStack.pop();
        }
    }
}

/**
 * JHTMLテンプレートをオンデマンド変換して実行
 */
async function runJhtmlTemplate(templatePath, context, includeStack = null) {
    if (includeStack) {
        includeStack.push(templatePath);
    }
    try {
        const code = jhtml.compileFile(templatePath);
        const result = await executeJs(code, context, {
            currentFile: templatePath
        });
        return buildResponse(context.$response, result, true);
    } catch (err) {
        console.error(`[JHTML Error in ${templatePath}]`, err);
        return new Response(JSON.stringify({ error: 'JHTML Compile Error', message: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    } finally {
        if (includeStack) {
            includeStack.pop();
        }
    }
}

/**
 * $response と handler() の戻り値から Bun Response を構築
 */
function buildResponse($response, handlerResult, isJhtml = false) {
    let body = $response.getBody();
    if (body === undefined) {
        body = handlerResult;
    }

    const headers = $response.getHeaders();
    let status = $response.getStatus();

    if (body === undefined || body === null) {
        body = '';
    }

    // Content-Type の自動判定
    if (!headers.has('Content-Type')) {
        if (typeof body === 'string') {
            headers.set('Content-Type', isJhtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
        } else if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
            headers.set('Content-Type', 'application/octet-stream');
        } else if (typeof body === 'object') {
            headers.set('Content-Type', 'application/json; charset=utf-8');
            body = JSON.stringify(body);
        } else {
            headers.set('Content-Type', 'text/plain; charset=utf-8');
            body = String(body);
        }
    } else {
        if (typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
            body = JSON.stringify(body);
        }
    }

    return new Response(body, {
        status,
        headers
    });
}

/**
 * 静的ファイルを配信 (ETag / 304 サポート)
 */
function serveStatic(filePath, req, baseDir, frameworkDir) {
    const file = Bun.file(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = getMimeMap(baseDir, frameworkDir);
    const contentType = mimeMap[ext] || 'application/octet-stream';

    // ETag (ファイル更新時刻 + サイズ)
    const stat = fs.statSync(filePath);
    const etag = `"${stat.size}-${stat.mtimeMs.toString(36)}"`;

    const reqEtag = req.headers.get('if-none-match');
    if (reqEtag === etag) {
        return new Response(null, {
            status: 304,
            headers: {
                'ETag': etag,
                'Cache-Control': 'public, max-age=0, must-revalidate'
            }
        });
    }

    return new Response(file, {
        headers: {
            'Content-Type': contentType,
            'ETag': etag,
            'Cache-Control': 'public, max-age=0, must-revalidate'
        }
    });
}

module.exports = {
    handleRequest,
    executeJs
};
