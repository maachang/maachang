/**
 * AIメモ:
 * - maachang サーバー用エラーハンドラー・フォーマッター。
 * - 本番環境 (isDev: false):
 *   - 機密情報 (内部パス、スタックトレース等) を隠蔽し、安全な 500 応答を返却。
 * - 開発環境 (isDev: true):
 *   - Accept: text/html (ブラウザ要求) の場合:
 *     - エラー名、メッセージ、発生元ファイルパス、エラー発生行および前後コードスニペットのハイライト、スタックトレースを含むリッチな HTML 画面を返却。
 *   - それ以外 (API/JSON 要求):
 *     - JSON 形式で error, message, file, line, stack 等を返却。
 * - いずれの環境でも、エラー発生時は必ず logger.error() (日別ログおよび標準出力) にリクエスト詳細とスタックトレースを出力。
 * - CommonJS 形式。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger.js');

/**
 * HTML特殊文字をエスケープ
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * スタックトレースから対象ファイルパスと行・列番号を抽出
 * @param {Error} error 
 * @param {string} [fallbackFile] 
 * @returns {{ file: string|null, line: number|null, column: number|null }}
 */
function extractErrorLocation(error, fallbackFile = null) {
    let file = fallbackFile || null;
    let line = null;
    let column = null;

    if (error && error.stack) {
        const lines = error.stack.split('\n');
        for (const l of lines) {
            // 例: at <anonymous> (/path/to/file.js:14:25) または at /path/to/file.js:14:25
            const match = l.match(/(?:at\s+(?:.*?\s+)?\(?)(?:file:\/\/)?([^\s\(\)]+):(\d+):(\d+)\)?/);
            if (match) {
                const matchedPath = match[1];
                // node: 内部や Bun 内部以外のファイルを探す
                if (!matchedPath.startsWith('node:') && !matchedPath.includes('/bun:')) {
                    file = matchedPath;
                    line = parseInt(match[2], 10);
                    column = parseInt(match[3], 10);
                    break;
                }
            }
        }
    }

    return { file, line, column };
}

/**
 * 指定ファイルの指定行の前後のコードスニペットを取得
 * @param {string} filePath 
 * @param {number} targetLine 1-based
 * @param {number} contextLines 前後の行数 (デフォルト 5)
 * @returns {Array<{ lineNum: number, code: string, isTarget: boolean }>|null}
 */
function getCodeSnippet(filePath, targetLine, contextLines = 5) {
    if (!filePath || !targetLine || !fs.existsSync(filePath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(1, targetLine - contextLines);
        const end = Math.min(lines.length, targetLine + contextLines);

        const snippet = [];
        for (let i = start; i <= end; i++) {
            snippet.push({
                lineNum: i,
                code: lines[i - 1],
                isTarget: i === targetLine
            });
        }
        return snippet;
    } catch (e) {
        return null;
    }
}

/**
 * 開発用リッチ HTML エラー画面を生成
 * @param {Object} params
 * @returns {string} HTML 文字列
 */
function renderDevErrorHtml({ error, req, location, snippet, requestInfo }) {
    const errorType = error.name || 'Error';
    const errorMessage = error.message || 'Unknown Error';
    const stack = error.stack || '';

    let snippetHtml = '';
    if (snippet && snippet.length > 0) {
        snippetHtml = `
        <div class="card snippet-card">
            <div class="card-header">
                <span class="file-path">${escapeHtml(location.file)}</span>
                ${location.line ? `<span class="line-badge">Line ${location.line}</span>` : ''}
            </div>
            <pre class="code-block"><code>` + snippet.map(item => {
                const lineClass = item.isTarget ? 'code-line highlight' : 'code-line';
                const lineNumStr = String(item.lineNum).padStart(4, ' ');
                return `<div class="${lineClass}"><span class="line-num">${lineNumStr}</span><span class="line-code">${escapeHtml(item.code)}</span></div>`;
            }).join('') + `</code></pre>
        </div>`;
    } else if (location.file) {
        snippetHtml = `
        <div class="card snippet-card">
            <div class="card-header">
                <span class="file-path">${escapeHtml(location.file)}</span>
                ${location.line ? `<span class="line-badge">Line ${location.line}</span>` : ''}
            </div>
        </div>`;
    }

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(errorType)}: ${escapeHtml(errorMessage)} - maachang</title>
    <style>
        :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --danger: #ef4444;
            --danger-bg: rgba(239, 68, 68, 0.15);
            --highlight-bg: rgba(239, 68, 68, 0.25);
            --border-color: #334155;
            --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.5;
            padding: 24px;
        }
        .container {
            max-width: 1100px;
            margin: 0 auto;
        }
        header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
        }
        .badge-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }
        .env-badge {
            background: #eab308;
            color: #000;
            font-size: 11px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .framework-title {
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 600;
        }
        h1.error-type {
            color: var(--danger);
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
            word-break: break-all;
        }
        p.error-message {
            font-size: 16px;
            color: #f1f5f9;
            background: var(--danger-bg);
            padding: 12px 16px;
            border-left: 4px solid var(--danger);
            border-radius: 4px;
            font-family: var(--font-mono);
            word-break: break-all;
            white-space: pre-wrap;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin-bottom: 24px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
        }
        .card-header {
            background: #0f172a;
            padding: 10px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            font-family: var(--font-mono);
            font-size: 13px;
        }
        .file-path {
            color: #38bdf8;
            word-break: break-all;
        }
        .line-badge {
            background: #ef4444;
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
        }
        .code-block {
            font-family: var(--font-mono);
            font-size: 13px;
            line-height: 1.6;
            overflow-x: auto;
            padding: 8px 0;
        }
        .code-line {
            display: flex;
            padding: 2px 16px;
        }
        .code-line.highlight {
            background-color: var(--highlight-bg);
            border-left: 4px solid var(--danger);
            padding-left: 12px;
            font-weight: bold;
            color: #fff;
        }
        .line-num {
            width: 44px;
            color: var(--text-muted);
            user-select: none;
            flex-shrink: 0;
            text-align: right;
            padding-right: 16px;
        }
        .line-code {
            white-space: pre;
            flex-grow: 1;
        }
        .section-title {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .stack-trace {
            background: #090d16;
            padding: 16px;
            border-radius: 6px;
            font-family: var(--font-mono);
            font-size: 12px;
            color: #cbd5e1;
            overflow-x: auto;
            white-space: pre-wrap;
            line-height: 1.6;
            border: 1px solid var(--border-color);
        }
        .request-info {
            background: #090d16;
            padding: 14px 16px;
            border-radius: 6px;
            font-family: var(--font-mono);
            font-size: 12px;
            color: #94a3b8;
            border: 1px solid var(--border-color);
            margin-top: 16px;
            display: grid;
            grid-template-columns: 120px 1fr;
            row-gap: 6px;
        }
        .request-info span.label {
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="badge-bar">
                <span class="env-badge">Development Mode</span>
                <span class="framework-title">maachang Web Framework</span>
            </div>
            <h1 class="error-type">${escapeHtml(errorType)}</h1>
            <p class="error-message">${escapeHtml(errorMessage)}</p>
        </header>

        ${snippetHtml}

        <div style="margin-bottom: 24px;">
            <div class="section-title">Stack Trace</div>
            <pre class="stack-trace">${escapeHtml(stack)}</pre>
        </div>

        <div>
            <div class="section-title">Request Context</div>
            <div class="request-info">
                <span class="label">Method:</span><span>${escapeHtml(requestInfo.method)}</span>
                <span class="label">URL:</span><span>${escapeHtml(requestInfo.url)}</span>
                <span class="label">User-Agent:</span><span>${escapeHtml(requestInfo.userAgent || 'None')}</span>
            </div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * サーバーエラーをログに出力し、適切なレスポンスを返却
 * @param {Error} error 発生したエラー
 * @param {Request} req リクエストオブジェクト
 * @param {Object} options
 * @param {boolean} options.isDev 開発モードか
 * @param {string} [options.file] 対象ファイルパス (既知の場合)
 * @param {string} [options.title] エラーカテゴリ (例: 'JHTML Compile Error', 'API Execution Error')
 * @returns {Response}
 */
function handleServerError(error, req, { isDev = true, file = null, title = 'Internal Server Error' } = {}) {
    const method = req ? req.method : 'UNKNOWN';
    const url = req ? req.url : '';
    const userAgent = req && req.headers ? (req.headers.get('user-agent') || '') : '';
    const accept = req && req.headers ? (req.headers.get('accept') || '') : '';

    const location = extractErrorLocation(error, file);

    // 1. 必ず logger.error() (日別ログ & 標準出力) に記録
    const logDetails = [
        `[${title}] ${method} ${url}`,
        `Message: ${error ? error.message : 'Unknown Error'}`,
        location.file ? `Location: ${location.file}${location.line ? `:${location.line}:${location.column || 0}` : ''}` : null,
        error && error.stack ? `Stack:\n${error.stack}` : null
    ].filter(Boolean).join('\n  ');

    logger.error(logDetails);

    // 2. 本番環境 (isDev: false) -> 安全なエラー応答
    if (!isDev) {
        if (accept.includes('text/html')) {
            return new Response('<!DOCTYPE html><html><head><title>500 Internal Server Error</title></head><body><h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p></body></html>', {
                status: 500,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    // 3. 開発環境 (isDev: true)
    const requestInfo = { method, url, userAgent };

    // A. ブラウザからの HTML 要求の場合
    if (accept.includes('text/html')) {
        const snippet = location.file && location.line ? getCodeSnippet(location.file, location.line) : null;
        const html = renderDevErrorHtml({
            error,
            req,
            location,
            snippet,
            requestInfo
        });
        return new Response(html, {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    // B. API / JSON 等の要求の場合
    const responsePayload = {
        error: title,
        message: error ? error.message : 'Unknown Error',
        file: location.file,
        line: location.line,
        column: location.column,
        stack: error && error.stack ? error.stack.split('\n').map(s => s.trim()) : []
    };

    return new Response(JSON.stringify(responsePayload, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

module.exports = {
    handleServerError,
    extractErrorLocation,
    getCodeSnippet,
    renderDevErrorHtml
};
