/**
 * jhtml.browser.js の単体テスト
 */

const { describe, it, expect } = require('bun:test');
const browserJHtml = require('../public/jhtml.browser.js');

describe('jhtml.browser.js (Browser Runtime)', () => {
    describe('1. テンプレートリテラル (jhtml.html & jhtml.raw)', () => {
        it('式を自動エスケープしてHTMLを構築できること', () => {
            const { html } = browserJHtml;
            const name = '<script>alert(1)</script>';
            const count = 5;
            const res = html`<div class="user"><span>${name}</span><span>${count}</span></div>`;
            expect(res).toBe('<div class="user"><span>&lt;script&gt;alert(1)&lt;/script&gt;</span><span>5</span></div>');
        });

        it('jhtml.raw() を使って生HTMLを出力できること', () => {
            const { html, raw } = browserJHtml;
            const richText = '<b>太字</b>';
            const res = html`<div>${raw(richText)}</div>`;
            expect(res).toBe('<div><b>太字</b></div>');
        });

        it('配列を渡したときに自動で連結展開されること', () => {
            const { html } = browserJHtml;
            const items = ['りんご', 'みかん', 'バナナ'];
            const res = html`<ul>${items.map(item => html`<li>${item}</li>`)}</ul>`;
            expect(res).toBe('<ul><li>りんご</li><li>みかん</li><li>バナナ</li></ul>');
        });

        it('null や undefined は空文字として扱われること', () => {
            const { html } = browserJHtml;
            const res = html`<p>${null}|${undefined}</p>`;
            expect(res).toBe('<p>|</p>');
        });
    });

    describe('2. JHTML コンパイラ (<% %>, <%= %>, <%- %>, ${})', () => {
        it('基本タグと ${} が正しく解釈され実行できること', async () => {
            const tpl = `
                <% if (show) { %>
                    <h1>\${title}</h1>
                    <div class="desc"><%- rawContent %></div>
                <% } %>
            `;
            const render = browserJHtml.compile(tpl);
            const result = await render({
                show: true,
                title: 'JHTML on Browser <>&',
                rawContent: '<span class="badge">OK</span>'
            });

            expect(result).toContain('<h1>JHTML on Browser &lt;&gt;&amp;</h1>');
            expect(result).toContain('<span class="badge">OK</span>');
        });

        it('ループ処理 (<% for ... %>) が正しく動作すること', async () => {
            const tpl = `
                <ul>
                <% for (let i = 0; i < items.length; i++) { %>
                    <li><%= i %>: \${items[i]}</li>
                <% } %>
                </ul>
            `;
            const render = browserJHtml.compile(tpl);
            const result = await render({
                items: ['A', 'B', 'C']
            });

            expect(result).toContain('<li>0: A</li>');
            expect(result).toContain('<li>1: B</li>');
            expect(result).toContain('<li>2: C</li>');
        });

        it('文字列テンプレートに対して render() でキャッシュ実行できること', async () => {
            const tpl = '<p>こんにちは、${user.name}さん！</p>';
            const res1 = await browserJHtml.render(tpl, { user: { name: 'maachang' } });
            const res2 = await browserJHtml.render(tpl, { user: { name: 'ゲスト' } });

            expect(res1).toBe('<p>こんにちは、maachangさん！</p>');
            expect(res2).toBe('<p>こんにちは、ゲストさん！</p>');
        });
    });

    describe('3. DOM ショートカット ($, $$, refs)', () => {
        it('global.document が存在する環境で $, $$, refs が正しく機能すること', () => {
            const mockElements = {
                'loginBtn': { id: 'loginBtn', tagName: 'BUTTON' },
                'userInput': { id: 'userInput', tagName: 'INPUT' }
            };

            // 簡易 mock document
            global.document = {
                getElementById: (id) => mockElements[id] || null,
                querySelector: (sel) => sel.startsWith('#') ? mockElements[sel.slice(1)] || null : null,
                querySelectorAll: (sel) => Object.values(mockElements)
            };

            const { $, $$, refs } = browserJHtml;

            // $ (ID探索 / セレクタ探索)
            expect($('loginBtn')).toBe(mockElements['loginBtn']);
            expect($('#userInput')).toBe(mockElements['userInput']);
            expect($('nonExistent')).toBe(null);

            // $$ (複数取得)
            const all = $$('button');
            expect(all.length).toBe(2);

            // refs (一括取得)
            const { loginBtn, userInput, missing } = refs('loginBtn', 'userInput', 'missing');
            expect(loginBtn).toBe(mockElements['loginBtn']);
            expect(userInput).toBe(mockElements['userInput']);
            expect(missing).toBe(null);

            delete global.document;
        });
    });
});

