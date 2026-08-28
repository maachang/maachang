/**
 * AIメモ:
 * - jhtml.js の単体テスト (minto 互換).
 * - タグ構文 (<% %>, <%= %>, ${ }, <%# %>) の展開テスト.
 * - $include 呼び出し時の await 自動補完テスト.
 * - $params へのアクセスと $out のチェーン呼び出しテスト.
 */

const { describe, it, expect } = require('bun:test');
const jhtml = require('../src/jhtml.js');

describe('JHTML Compiler (minto compatible)', () => {
    it('基本的な変換が正しく動作すること', async () => {
        const src = `
<% const name = "world"; %>
<h1>Hello <%= name %></h1>
<p>\${name}</p>
<%# コメントは出力されない %>
`;
        const js = jhtml.convert(src);
        expect(js).toContain('exports.handler = async function($params)');
        expect(js).toContain('let _$outString = "";');

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result).toContain('<h1>Hello world</h1>');
        expect(result).toContain('<p>world</p>');
        expect(result).not.toContain('コメントは出力されない');
    });

    it('$params を受け取ってアクセスできること', async () => {
        const src = `<h1>\${$params.title}</h1><p>\${$params.count + 1}</p>`;
        const js = jhtml.convert(src);

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler({ title: 'Minto Title', count: 10 });
        expect(result.trim()).toBe('<h1>Minto Title</h1><p>11</p>');
    });

    it('$params 省略時もエラーにならず空オブジェクトとして扱われること', async () => {
        const src = `<p>\${$params.title || "default"}</p>`;
        const js = jhtml.convert(src);

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result.trim()).toBe('<p>default</p>');
    });

    it('$out のチェーン呼び出しができること', async () => {
        const src = `<% $out("A")("B")("C"); %>`;
        const js = jhtml.convert(src);

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result.trim()).toBe('ABC');
    });

    it('${$include(...)} および <%= $include(...) %> に自動で await が補完されること', () => {
        const src1 = `<div>\${$include("./header.mt.html")}</div>`;
        const js1 = jhtml.convert(src1);
        expect(js1).toContain('$out(await $include("./header.mt.html"));');

        const src2 = `<div><%= $include("./header.mt.html", { title: "abc" }) %></div>`;
        const js2 = jhtml.convert(src2);
        expect(js2).toContain('$out(await $include("./header.mt.html", { title: "abc" }));');

        const src3 = `<div>\${await $include("./header.mt.html")}</div>`;
        const js3 = jhtml.convert(src3);
        expect(js3).toContain('$out(await $include("./header.mt.html"));');
        expect(js3).not.toContain('await await');
    });

    it('XSS対策: <%= %> および ${ } でHTML特殊文字が自動エスケープされること', async () => {
        const src = `
<% const payload = '<script>alert("XSS")</script>'; %>
<h1><%= payload %></h1>
<p>\${payload}</p>
<div>\${'<img src="x" onerror="alert(\\'xss\\')">'}</div>
<span>\${'Tom & Jerry'}</span>
`;
        const js = jhtml.convert(src);
        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;');
        expect(result).toContain('Tom &amp; Jerry');
    });

    it('Raw出力: <%- %> でHTMLエスケープされずに生のHTMLが出力されること', async () => {
        const src = `<%- "<strong>Raw HTML & Bold</strong>" %>`;
        const js = jhtml.convert(src);

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result.trim()).toBe('<strong>Raw HTML & Bold</strong>');
    });

    it('数値やnull、undefinedが安全に出力されること', async () => {
        const src = `<p>\${123}</p><p>\${0}</p><p>\${null}</p><p>\${undefined}</p><p>\${false}</p>`;
        const js = jhtml.convert(src);

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result.trim()).toBe('<p>123</p><p>0</p><p></p><p></p><p>false</p>');
    });

    it('<%- $include(...) %> にも自動で await が補完され、エスケープされずに出力されること', async () => {
        const src = `<div><%- $include("./parts/header") %></div>`;
        const js = jhtml.convert(src);
        expect(js).toContain('$out(await $include("./parts/header"));');

        const mockInclude = async (path) => {
            return `<h1>Header Content</h1>`;
        };

        const exp = {};
        const fn = new Function('exports', 'module', '$include', js);
        fn(exp, { exports: exp }, mockInclude);

        const result = await exp.handler();
        expect(result).toBe('<div><h1>Header Content</h1></div>');
    });

    it('モックの $include 関数を実行してインクルード結果がエスケープされず反映されること', async () => {
        const src = `<div class="container">\${$include("./header.mt.html", { title: "TopPage" })}<main>Body</main></div>`;
        const js = jhtml.convert(src);

        const mockInclude = async (path, params) => {
            return `<header><h1>${params.title}</h1></header>`;
        };

        const exp = {};
        const fn = new Function('exports', 'module', '$include', js);
        fn(exp, { exports: exp }, mockInclude);

        const result = await exp.handler();
        expect(result).toBe('<div class="container"><header><h1>TopPage</h1></header><main>Body</main></div>');
    });

    it('組み込み $escape 関数を手動で呼び出せること', async () => {
        const src = `<% const escaped = $escape("<b>hello</b>"); %><span><%- escaped %></span>`;
        const js = jhtml.convert(src);

        const exp = {};
        const fn = new Function('exports', 'module', js);
        fn(exp, { exports: exp });

        const result = await exp.handler();
        expect(result).toBe('<span>&lt;b&gt;hello&lt;/b&gt;</span>');
    });
});

