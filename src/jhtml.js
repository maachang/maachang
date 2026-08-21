/**
 * AIメモ:
 * - jhtml = JavaScript HTML template.
 * - minto の jhtml 仕様を踏襲したテンプレートエンジン。
 * - 構文:
 *   - <% ... %>   : 任意のJavaScriptコード (制御構文など)
 *   - <%= ... %>  : 評価結果をHTMLエスケープして出力
 *   - <%- ... %>  : 評価結果をエスケープせずに出力
 *   - ${ ... }    : <%= ... %> のエイリアス (変数出力推奨)
 *   - <%# ... %>  : テンプレート内コメント (出力されない)
 * - 組み込み関数:
 *   - $out(string): 出力バッファへ追記。チェーン呼び出し対応 ($out('a')('b'))
 * - デプロイ時は compileToJs で生成されたコードを .jhtml.js として保存可能。
 * - CommonJS 形式。
 */

'use strict';

const fs = require('node:fs');

/**
 * HTML特殊文字をエスケープ
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * テンプレート文字列をJavaScriptコードにコンパイルする
 * @param {string} template テンプレートソース文字列
 * @param {Object} [options] オプション
 * @returns {string} 生成されたJavaScriptコード
 */
function compileToJs(template, options = {}) {
    let source = template;
    let jsCode = '';
    
    // コードの先頭定義
    jsCode += 'exports.handler = async function($params = {}) {\n';
    jsCode += '    let __output__ = "";\n';
    jsCode += '    let __layoutFile__ = null;\n';
    jsCode += '    let __layoutParams__ = {};\n';
    jsCode += '    const $escape = ' + escapeHtml.toString() + ';\n';
    jsCode += '    const $out = function(s) {\n';
    jsCode += '        if (s !== undefined && s !== null) {\n';
    jsCode += '            __output__ += String(s);\n';
    jsCode += '        }\n';
    jsCode += '        return $out;\n';
    jsCode += '    };\n';
    jsCode += '    const $body = ($params && $params.$body !== undefined) ? $params.$body : (($params && $params.$content !== undefined) ? $params.$content : "");\n';
    jsCode += '    const $content = $body;\n';
    jsCode += '    const $data = $params || {};\n';
    jsCode += '    const $props = $params || {};\n';
    jsCode += '    const $layout = function(layoutPath, layoutParams = {}) {\n';
    jsCode += '        __layoutFile__ = layoutPath;\n';
    jsCode += '        __layoutParams__ = layoutParams;\n';
    jsCode += '    };\n';
    jsCode += '    const $include = async function(filePath, includeParams = {}) {\n';
    jsCode += '        if (typeof __includeHelper__ === "function") {\n';
    jsCode += '            return await __includeHelper__(filePath, includeParams, typeof __currentFile__ !== "undefined" ? __currentFile__ : null);\n';
    jsCode += '        }\n';
    jsCode += '        return "";\n';
    jsCode += '    };\n';

    // トークン分解正規表現
    // 1: <%# (コメント)
    // 2: <%= (エスケープ出力)
    // 3: <%- (非エスケープ出力)
    // 4: <% (コード)
    // 5: ${ (エスケープ出力)
    const regex = /(<%#[\s\S]*?%>)|(<%=\s*([\s\S]*?)\s*%>)|(<%-\s*([\s\S]*?)\s*%>)|(<%([\s\S]*?)%>)|(\${([\s\S]*?)})/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(source)) !== null) {
        const textBefore = source.slice(lastIndex, match.index);
        if (textBefore.length > 0) {
            jsCode += `    $out(${JSON.stringify(textBefore)});\n`;
        }

        if (match[1]) {
            // <%# コメント %> -> 何もしない
        } else if (match[2]) {
            // <%= 式 %> -> エスケープ出力
            const expr = match[3];
            jsCode += `    $out($escape(${expr}));\n`;
        } else if (match[4]) {
            // <%- 式 %> -> そのまま出力
            const expr = match[5];
            jsCode += `    $out(${expr});\n`;
        } else if (match[6]) {
            // <% コード %> -> そのままJSコード実行
            const code = match[7];
            jsCode += `    ${code}\n`;
        } else if (match[8]) {
            // ${ 式 } -> エスケープ出力
            const expr = match[9];
            jsCode += `    $out($escape(${expr}));\n`;
        }

        lastIndex = regex.lastIndex;
    }

    const remainingText = source.slice(lastIndex);
    if (remainingText.length > 0) {
        jsCode += `    $out(${JSON.stringify(remainingText)});\n`;
    }

    jsCode += '    if (__layoutFile__ && typeof __layoutHelper__ === "function") {\n';
    jsCode += '        return await __layoutHelper__(__layoutFile__, Object.assign({}, __layoutParams__, { $body: __output__, $content: __output__ }), typeof __currentFile__ !== "undefined" ? __currentFile__ : null);\n';
    jsCode += '    }\n';
    jsCode += '    return __output__;\n';
    jsCode += '};\n';

    return jsCode;
}

/**
 * JHTMLファイルをコンパイルしてJSコードを生成
 * @param {string} filePath テンプレートファイルのパス
 * @returns {string} 生成されたJSコード
 */
function compileFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return compileToJs(content);
}

module.exports = {
    escapeHtml,
    compileToJs,
    compileFile
};
