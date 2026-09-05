/**
 * jhtml.browser.js の単体テスト
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
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

    describe('4. イベントリスナー・イベント委任 (jhtml.on)', () => {
        beforeAll(() => {
            global.document = {
                getElementById: () => null,
                querySelector: () => null,
                querySelectorAll: () => []
            };
        });

        afterAll(() => {
            delete global.document;
        });

        it('直接要素またはセレクタへのイベントリスナー登録が動作すること', () => {
            let clicked = false;
            const mockBtn = {
                addEventListener: (event, handler) => {
                    if (event === 'click') handler({ type: 'click' });
                }
            };

            browserJHtml.on(mockBtn, 'click', () => {
                clicked = true;
            });

            expect(clicked).toBe(true);
        });

        it('イベント委任 (delegation) が正しく動作すること', () => {
            let delegatedTarget = null;
            let containerListener = null;

            const mockChild = {
                tagName: 'BUTTON',
                className: 'btn-item',
                closest: (sel) => sel === '.btn-item' ? mockChild : null
            };

            const mockContainer = {
                id: 'container',
                contains: (node) => node === mockChild,
                addEventListener: (event, handler) => {
                    if (event === 'click') containerListener = handler;
                }
            };

            browserJHtml.on(mockContainer, 'click', '.btn-item', (e, target) => {
                delegatedTarget = target;
            });

            // 親要素でイベント発火（子がクリックされたことを模倣）
            expect(typeof containerListener).toBe('function');
            containerListener({
                type: 'click',
                target: mockChild
            });

            expect(delegatedTarget).toBe(mockChild);
        });
    });

    describe('5. API クライアント (jhtml.api)', () => {
        it('jhtml.api.get で JSON レスポンスが取得できること', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url, opts) => {
                expect(url).toBe('/api/models');
                expect(opts.method).toBe('GET');
                return {
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: async () => ({ success: true, models: [{ id: 'v1' }] })
                };
            };

            const data = await browserJHtml.api.get('/api/models');
            expect(data.success).toBe(true);
            expect(data.models[0].id).toBe('v1');

            global.fetch = originalFetch;
        });

        it('jhtml.api.post で body が自動 JSON 化され送信されること', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url, opts) => {
                expect(url).toBe('/api/switch');
                expect(opts.method).toBe('POST');
                expect(opts.headers['Content-Type']).toContain('application/json');
                expect(opts.body).toBe('{"modelId":"sd-1"}');
                return {
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: async () => ({ success: true })
                };
            };

            const data = await browserJHtml.api.post('/api/switch', { modelId: 'sd-1' });
            expect(data.success).toBe(true);

            global.fetch = originalFetch;
        });

        it('ローディング要素の連動 (loading option) が動作すること', async () => {
            const originalFetch = global.fetch;
            const mockOverlay = { style: { display: 'none' } };

            global.document = {
                getElementById: (id) => id === 'overlay' ? mockOverlay : null,
                querySelector: () => null,
                querySelectorAll: () => []
            };

            global.fetch = async () => {
                // fetch 中は表示されていること
                expect(mockOverlay.style.display).toBe('flex');
                return {
                    ok: true,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: async () => ({ ok: true })
                };
            };

            await browserJHtml.api.get('/api/test', { loading: 'overlay' });
            // 完了後は none に戻ること
            expect(mockOverlay.style.display).toBe('none');

            global.fetch = originalFetch;
            delete global.document;
        });

        it('HTTP エラー時に例外がスローされステータスが含まれること', async () => {
            const originalFetch = global.fetch;
            global.fetch = async () => {
                return {
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: async () => ({ error: 'Model not found' })
                };
            };

            let errCaught = null;
            try {
                await browserJHtml.api.get('/api/invalid');
            } catch (err) {
                errCaught = err;
            }

            expect(errCaught).not.toBe(null);
            expect(errCaught.message).toBe('Model not found');
            expect(errCaught.status).toBe(404);

            global.fetch = originalFetch;
        });
    });
});

