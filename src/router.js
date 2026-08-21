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

/**
 * テンプレートファイルのパスを探索して解決する
 * @param {string} filePath 指定されたファイルパス
 * @param {string} [currentFile] 呼び出し元のテンプレートパス
 * @param {string} publicDir public ディレクトリ
 * @returns {string|null}
 */
function resolveTemplatePath(filePath, currentFile, publicDir) {
    if (!filePath) return null;

    const candidateBases = [];

    if (filePath.startsWith('/')) {
        candidateBases.push(path.join(publicDir, filePath.slice(1)));
        if (fs.existsSync(filePath)) {
            candidateBases.push(filePath);
        }
    } else {
        if (currentFile) {
            candidateBases.push(path.resolve(path.dirname(currentFile), filePath));
        }
        candidateBases.push(path.resolve(publicDir, filePath));
        if (path.isAbsolute(filePath)) {
            candidateBases.push(filePath);
        }
    }

    const extensionsToTry = ['', '.mt.html', '.jhtml', '.jhtml.js'];

    for (const base of candidateBases) {
        for (const ext of extensionsToTry) {
            const testPath = ext ? `${base}${ext}` : base;
            if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
                return testPath;
            }
        }
    }

    return null;
}

/**
 * テンプレート実行用ヘルパー (__includeHelper__, __layoutHelper__) を生成
 * @param {Object} context 
 * @param {string} publicDir 
 * @returns {{ includeHelper: Function, layoutHelper: Function }}
 */
function createTemplateHelpers(context, publicDir) {
    const includeHelper = async (filePath, includeParams = {}, currentFile = null) => {
        const resolved = resolveTemplatePath(filePath, currentFile, publicDir);
        if (!resolved) {
            throw new Error(`[JHTML $include] Template not found: "${filePath}" (called from: ${currentFile || 'unknown'})`);
        }
        const isCompiled = resolved.endsWith('.jhtml.js');
        const code = isCompiled ? fs.readFileSync(resolved, 'utf-8') : jhtml.compileFile(resolved);
        return await executeJs(code, context, {
            currentFile: resolved,
            params: includeParams,
            __includeHelper__: includeHelper,
            __layoutHelper__: layoutHelper
        });
    };

    const layoutHelper = async (layoutPath, layoutParams = {}, currentFile = null) => {
        const resolved = resolveTemplatePath(layoutPath, currentFile, publicDir);
        if (!resolved) {
            throw new Error(`[JHTML $layout] Layout template not found: "${layoutPath}" (called from: ${currentFile || 'unknown'})`);
        }
        const isCompiled = resolved.endsWith('.jhtml.js');
        const code = isCompiled ? fs.readFileSync(resolved, 'utf-8') : jhtml.compileFile(resolved);
        return await executeJs(code, context, {
            currentFile: resolved,
            params: layoutParams,
            __includeHelper__: includeHelper,
            __layoutHelper__: layoutHelper
        });
    };

    return { includeHelper, layoutHelper };
}

/**
 * JSスクリプトを安全に実行する
 * @param {string} jsSource 実行するJSコード
 * @param {Object} context 注入するコンテキストオブジェクト
 * @param {Object} [options] 追加オプション (params, currentFile, __includeHelper__, __layoutHelper__)
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
        '__includeHelper__',
        '__layoutHelper__',
        '__currentFile__'
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
        options.__includeHelper__,
        options.__layoutHelper__,
        options.currentFile
    ];

    const fn = new Function(...argNames, jsSource);
    fn(...argValues);

    const handler = moduleObj.exports.handler || exportsObj.handler;
    if (typeof handler === 'function') {
        return await handler(options.params);
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
    const { includeHelper, layoutHelper } = createTemplateHelpers(context, publicDir);

    // 3. filter.mt.js の実行
    const filterPath = path.join(publicDir, 'filter.mt.js');
    if (fs.existsSync(filterPath)) {
        try {
            const filterCode = fs.readFileSync(filterPath, 'utf-8');
            const filterResult = await executeJs(filterCode, context, {
                currentFile: filterPath,
                __includeHelper__: includeHelper,
                __layoutHelper__: layoutHelper
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
            return await runDynamicJs(mtJsPath, context, false, { includeHelper, layoutHelper });
        }

        // (2) .jhtml.js (事前コンパイル済み)
        const jhtmlJsPath = path.join(publicDir, `${targetRelPath}.jhtml.js`);
        if (fs.existsSync(jhtmlJsPath)) {
            return await runDynamicJs(jhtmlJsPath, context, true, { includeHelper, layoutHelper });
        }

        // (3) .mt.html または .jhtml (ローカル・オンデマンド変換)
        const mtHtmlPath = path.join(publicDir, `${targetRelPath}.mt.html`);
        const jhtmlPath = path.join(publicDir, `${targetRelPath}.jhtml`);
        const templatePath = fs.existsSync(mtHtmlPath) ? mtHtmlPath : (fs.existsSync(jhtmlPath) ? jhtmlPath : null);

        if (templatePath) {
            return await runJhtmlTemplate(templatePath, context, { includeHelper, layoutHelper });
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
            return await runDynamicJs(jhtmlJsPath, context, true, { includeHelper, layoutHelper });
        }
        const mtHtmlPath = path.join(publicDir, `${basePath}.mt.html`);
        const jhtmlPath = path.join(publicDir, `${basePath}.jhtml`);
        const templatePath = fs.existsSync(mtHtmlPath) ? mtHtmlPath : (fs.existsSync(jhtmlPath) ? jhtmlPath : null);
        if (templatePath) {
            return await runJhtmlTemplate(templatePath, context, { includeHelper, layoutHelper });
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
async function runDynamicJs(filePath, context, isJhtml = false, helpers = {}) {
    try {
        const code = fs.readFileSync(filePath, 'utf-8');
        const result = await executeJs(code, context, {
            currentFile: filePath,
            __includeHelper__: helpers.includeHelper,
            __layoutHelper__: helpers.layoutHelper
        });
        return buildResponse(context.$response, result, isJhtml);
    } catch (err) {
        console.error(`[Error in ${filePath}]`, err);
        return new Response(JSON.stringify({ error: 'Execution Error', message: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}

/**
 * JHTMLテンプレートをオンデマンド変換して実行
 */
async function runJhtmlTemplate(templatePath, context, helpers = {}) {
    try {
        const code = jhtml.compileFile(templatePath);
        const result = await executeJs(code, context, {
            currentFile: templatePath,
            __includeHelper__: helpers.includeHelper,
            __layoutHelper__: helpers.layoutHelper
        });
        return buildResponse(context.$response, result, true);
    } catch (err) {
        console.error(`[JHTML Error in ${templatePath}]`, err);
        return new Response(JSON.stringify({ error: 'JHTML Compile Error', message: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
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
