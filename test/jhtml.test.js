/**
 * AIメモ:
 * - jhtml.js の単体テスト。
 * - タグ構文 (<% %>, <%= %>, <%- %>, ${ }, <%# %>) の展開および HTML エスケープのテスト。
 * - $include, $layout, $body, $params の動作検証。
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
        expect(jsCode).toContain('exports.handler = async function');
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

    it('$params / $data / $props 経由で渡された引数が利用できること', async () => {
        const template = `
            <h3>\${$data.title}</h3>
            <p>ユーザー: \${$params.user.name} (\${$props.user.role})</p>
        `;
        const jsCode = compileToJs(template);

        const exportsObj = {};
        const fn = new Function('exports', jsCode);
        fn(exportsObj);

        const result = await exportsObj.handler({
            title: 'ダッシュボード',
            user: { name: '山田太郎', role: 'admin' }
        });

        expect(result).toContain('<h3>ダッシュボード</h3>');
        expect(result).toContain('<p>ユーザー: 山田太郎 (admin)</p>');
    });

    it('$include ヘルパーが正しく呼び出され、HTML が埋め込まれること', async () => {
        const template = `
            <div class="container">
                <%- await $include("header.mt.html", { title: "トップ" }) %>
                <main>本文</main>
            </div>
        `;
        const jsCode = compileToJs(template);

        const mockIncludeHelper = async (file, params) => {
            return `<header><h1>${params.title}</h1></header>`;
        };

        const exportsObj = {};
        const fn = new Function('exports', '__includeHelper__', '__layoutHelper__', '__currentFile__', jsCode);
        fn(exportsObj, mockIncludeHelper, null, '/path/to/page.mt.html');

        const result = await exportsObj.handler();
        expect(result).toContain('<header><h1>トップ</h1></header>');
        expect(result).toContain('<main>本文</main>');
    });

    it('$layout ヘルパーでレイアウト継承と $body / $content が動作すること', async () => {
        const template = `
            <% $layout("layouts/base.mt.html", { title: "商品一覧" }) %>
            <div class="products">商品リスト</div>
        `;
        const jsCode = compileToJs(template);

        const mockLayoutHelper = async (layoutFile, params) => {
            return `<!DOCTYPE html><html><head><title>${params.title}</title></head><body>${params.$body}</body></html>`;
        };

        const exportsObj = {};
        const fn = new Function('exports', '__includeHelper__', '__layoutHelper__', '__currentFile__', jsCode);
        fn(exportsObj, null, mockLayoutHelper, '/path/to/page.mt.html');

        const result = await exportsObj.handler();
        expect(result).toContain('<title>商品一覧</title>');
        expect(result).toContain('<div class="products">商品リスト</div>');
    });
});
