/**
 * jhtml.browser.js
 * maachang - JHTML フロントエンド（ブラウザ用）ランタイム
 * 
 * 機能:
 * 1. 【テンプレートリテラル】 jhtml.html`...` による自動エスケープ付きインラインHTML生成
 * 2. 【生HTML出力】 jhtml.raw(string)
 * 3. 【JHTMLコンパイル】 jhtml.compile(templateString) (<% %>, <%= %>, <%- %>, ${ })
 * 4. 【DOMレンダリング】 jhtml.render(elementOrId, params) / jhtml.renderTo(target, templateOrId, params)
 * 5. 【HTMLエスケープ】 jhtml.escapeHtml(string)
 */

(function (global) {
    'use strict';

    /**
     * HTML特殊文字エスケープ (XSS対策)
     * @param {*} s 対象文字列または値
     * @returns {string} エスケープ済み文字列
     */
    function escapeHtml(s) {
        if (s === undefined || s === null) return '';
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    /**
     * エスケープをスキップして生のHTMLを出力するためのオブジェクトをラップ
     * @param {*} value 生のHTML文字列
     * @returns {{ __raw: boolean, value: string }}
     */
    function raw(value) {
        return {
            __raw: true,
            value: value === undefined || value === null ? '' : String(value)
        };
    }

    /**
     * タグ付きテンプレートリテラル関数: jhtml.html`...`
     * 埋め込み式（${...}）を自動的に escapeHtml で安全にエスケープする。
     * jhtml.raw(string) または配列が渡された場合は適切に展開する。
     */
    function html(strings, ...values) {
        let result = '';
        for (let i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < values.length) {
                const val = values[i];
                if (val === undefined || val === null) {
                    continue;
                } else if (Array.isArray(val)) {
                    result += val.join('');
                } else if (typeof val === 'object' && val.__raw) {
                    result += val.value;
                } else {
                    result += escapeHtml(val);
                }
            }
        }
        return result;
    }

    /**
     * クォーテーションのエスケープ処理
     */
    function indentQuote(string, dc) {
        const len = string.length;
        if (len <= 0) return string;
        const target = dc ? '"' : "'";
        let c, j, yenLen = 0, buf = '';
        for (let i = 0; i < len; i++) {
            c = string[i];
            if (c === target) {
                if (yenLen > 0) {
                    yenLen <<= 1;
                    for (j = 0; j < yenLen; j++) buf += '\\';
                    yenLen = 0;
                }
                buf += '\\' + target;
            } else if (c === '\\') {
                yenLen++;
            } else {
                if (yenLen !== 0) {
                    for (j = 0; j < yenLen; j++) buf += '\\';
                    yenLen = 0;
                }
                buf += c;
            }
        }
        if (yenLen !== 0) {
            for (j = 0; j < yenLen; j++) buf += '\\';
        }
        return buf;
    }

    /**
     * 改行のエスケープ処理
     */
    function indentEnter(s) {
        const len = s.length;
        if (len <= 0) return s;
        let c, ret = '';
        for (let i = 0; i < len; i++) {
            c = s[i];
            if (c === '\n') {
                ret += '\\n';
            } else if (c === '\r') {
                // carriage return はスキップ
            } else {
                ret += c;
            }
        }
        return ret;
    }

    /**
     * ${ ... } -> <%= ... %> への変換 (maachang jhtml.js 互換)
     */
    function analysis$braces(jhtml) {
        let ret = '';
        let c, qt, by = false, $pos = -1, braces = 0;
        const len = jhtml.length;

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if ($pos !== -1) {
                if (qt !== undefined) {
                    if (!by && qt === c) {
                        qt = undefined;
                    }
                } else if (c === '"' || c === "'") {
                    qt = c;
                } else if (c === '{') {
                    braces++;
                } else if (c === '}') {
                    braces--;
                    if (braces === 0) {
                        ret += '<%=' + jhtml.substring($pos + 2, i) + '%>';
                        $pos = -1;
                    }
                }
            } else if (c === '$' && i + 1 < len && jhtml[i + 1] === '{') {
                if (by) {
                    ret = ret.substring(0, ret.length - 1) + '${';
                    i++;
                } else {
                    $pos = i;
                }
            } else {
                ret += c;
            }
            by = (c === '\\');
        }
        if ($pos !== -1) {
            ret += jhtml.substring($pos);
        }
        return ret;
    }

    /**
     * <% ... %> の構文解析
     */
    function analysisJHtml(jhtml, out) {
        let c, n, start = -1, bef = 0, ret = '';
        const len = jhtml.length;
        let tagQt = undefined;
        let tagBy = false;

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if (start !== -1) {
                if (tagQt !== undefined) {
                    if (!tagBy && c === tagQt) tagQt = undefined;
                    tagBy = (c === '\\');
                    continue;
                }
                if (c === '"' || c === "'" || c === '`') {
                    tagQt = c;
                    tagBy = false;
                    continue;
                }
                if (c === '%' && i + 1 < len && jhtml[i + 1] === '>') {
                    n = jhtml.substring(bef, start);
                    if (n.length > 0) {
                        if (ret.length !== 0) ret += '\n';
                        n = indentEnter(n);
                        n = indentQuote(n, true);
                        ret += out + '("' + n + '");\n';
                    }
                    bef = i + 2;

                    n = jhtml[start + 2];
                    if (n === '=') {
                        // エスケープ出力 <%= ... %>
                        let code = jhtml.substring(start + 3, i).trim();
                        if (code.endsWith(';')) code = code.slice(0, -1).trim();
                        if (ret.length !== 0) ret += '\n';
                        ret += out + '($escape(' + code + '));\n';
                    } else if (n === '-') {
                        // 生HTML出力 <%- ... %>
                        let code = jhtml.substring(start + 3, i).trim();
                        if (code.endsWith(';')) code = code.slice(0, -1).trim();
                        if (ret.length !== 0) ret += '\n';
                        ret += out + '(' + code + ');\n';
                    } else if (n === '#') {
                        // コメント
                    } else {
                        // JSロジック <% ... %>
                        if (ret.length !== 0) ret += '\n';
                        ret += jhtml.substring(start + 2, i).trim() + '\n';
                    }

                    start = -1;
                    tagQt = undefined;
                    tagBy = false;
                    i++; // '>' をスキップ
                }
            } else if (c === '<' && i + 1 < len && jhtml[i + 1] === '%') {
                start = i;
                i++;
            }
        }

        n = jhtml.substring(bef);
        if (n.length > 0) {
            n = indentEnter(n);
            n = indentQuote(n, true);
            if (ret.length !== 0) ret += '\n';
            ret += out + '("' + n + '");\n';
        }

        return ret;
    }

    /**
     * JHTML文字列をコンパイルし、async function($params) を生成する
     * @param {string} jhtmlSource 
     * @returns {Function} async function(params): Promise<string>
     */
    function compile(jhtmlSource) {
        if (typeof jhtmlSource !== 'string') {
            throw new TypeError('[jhtml] compile: expected template source string');
        }
        const outFunc = '$out';
        const jsCode = analysisJHtml(analysis$braces(jhtmlSource), outFunc);

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        // with ($params) を利用して、テンプレート内で変数名で直接アクセス可能にする
        const fn = new AsyncFunction(
            '$params',
            '$escape',
            'if ($params === undefined || $params === null) { $params = {}; }\n' +
            'let _$outString = "";\n' +
            'const ' + outFunc + ' = function(n) { _$outString += (n !== undefined && n !== null ? n : ""); return ' + outFunc + '; };\n' +
            'with ($params) {\n' +
            jsCode + '\n' +
            '}\n' +
            'return _$outString;\n'
        );

        return function (params) {
            return fn(params || {}, escapeHtml);
        };
    }

    // コンパイル結果キャッシュ (WeakMap / Map)
    const _elementCache = new WeakMap();
    const _stringCache = new Map();

    /**
     * テンプレート（DOM要素、Element ID、またはテンプレート文字列）を指定してレンダリングする
     * @param {HTMLElement|string} target テンプレート要素またはID、またはテンプレート文字列
     * @param {Object} [params={}] 渡すデータオブジェクト
     * @returns {Promise<string>}
     */
    async function render(target, params) {
        let compiled = null;

        if (typeof target === 'string') {
            const el = typeof document !== 'undefined' ? document.getElementById(target) : null;
            if (el) {
                compiled = _elementCache.get(el);
                if (!compiled) {
                    compiled = compile(el.textContent || '');
                    _elementCache.set(el, compiled);
                }
            } else {
                // 文字列テンプレートとしてキャッシュ利用
                compiled = _stringCache.get(target);
                if (!compiled) {
                    compiled = compile(target);
                    if (_stringCache.size < 500) {
                        _stringCache.set(target, compiled);
                    }
                }
            }
        } else if (target && target.nodeType) {
            compiled = _elementCache.get(target);
            if (!compiled) {
                compiled = compile(target.textContent || '');
                _elementCache.set(target, compiled);
            }
        } else {
            throw new Error('[jhtml] render: invalid target');
        }

        return await compiled(params || {});
    }

    /**
     * 指定したDOM要素の innerHTML にレンダリング結果を直接反映するユーティリティ
     * @param {HTMLElement|string} container 表示先の親要素またはID
     * @param {HTMLElement|string} template テンプレート要素、ID、またはテンプレート文字列
     * @param {Object} [params={}] 
     */
    async function renderTo(container, template, params) {
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!el) throw new Error('[jhtml] renderTo: container element not found: ' + container);
        const htmlStr = await render(template, params);
        el.innerHTML = htmlStr;
        return htmlStr;
    }

    // 公開API
    const jhtml = {
        escapeHtml,
        escape: escapeHtml,
        raw,
        html,
        compile,
        render,
        renderTo,
        analysis$braces,
        analysisJHtml
    };

    // ブラウザ環境 (window) & モジュール環境 (Node / CommonJS / ES) 両対応
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = jhtml;
    }
    if (typeof global !== 'undefined') {
        global.jhtml = jhtml;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
