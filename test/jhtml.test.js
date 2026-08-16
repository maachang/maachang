/**
 * AIメモ:
 * - jhtml.js の単体テスト。
 * - タグ構文 (<% %>, <%= %>, <%- %>, ${ }, <%# %>) の展開および HTML エスケープのテスト。
 */

const { describe, it, expect } = require('bun:test');
const { compileToJs, escapeHtml } = require('../src/jhtml.js');

describe('JHTML Compiler', () => {
    it('HTMLエスケープが正しく動作すること', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(escapeHtml('A & B \' "')).toBe('A &amp; B &#39; &quot;');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('JHTML テンプレートが実行可能な JS にコンパイルされること', async () => {
        const template = `
            <% const name = "World"; %>
            <h1>Hello <%= name %>!</h1>
            <p>Score: \${100 + 20}</p>
            <%# ここはコメント %>
        `;

        const jsCode = compileToJs(template);
        expect(jsCode).toContain('exports.handler = async function()');
        expect(jsCode).toContain('$escape(name)');
        expect(jsCode).toContain('$escape(100 + 20)');

        // 実行検証
        const exportsObj = {};
        const fn = new Function('exports', jsCode);
        fn(exportsObj);

        const result = await exportsObj.handler();
        expect(result).toContain('<h1>Hello World!</h1>');
        expect(result).toContain('<p>Score: 120</p>');
        expect(result).not.toContain('ここはコメント');
    });

    it('<%- ... %> で非エスケープ出力ができること', async () => {
        const template = `<%- "<b>太字</b>" %>`;
        const jsCode = compileToJs(template);

        const exportsObj = {};
        const fn = new Function('exports', jsCode);
        fn(exportsObj);

        const result = await exportsObj.handler();
        expect(result).toBe('<b>太字</b>');
    });
});
