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

    describe('6. フォーム入出力 (jhtml.form & jhtml.form.fill)', () => {
        it('form() で入力要素からオブジェクトを抽出できること', () => {
            const mockInputs = [
                { name: 'endpoint', value: 'http://localhost:8080', type: 'text', disabled: false },
                { id: 'apiKey', value: 'secret-123', type: 'password', disabled: false },
                { name: 'enabled', checked: true, type: 'checkbox', disabled: false },
                { name: 'count', value: '42', type: 'number', disabled: false },
                { name: 'ignored', value: 'skip', type: 'text', disabled: true }
            ];

            const mockForm = {
                querySelectorAll: (sel) => mockInputs
            };

            const data = browserJHtml.form(mockForm);
            expect(data.endpoint).toBe('http://localhost:8080');
            expect(data.apiKey).toBe('secret-123');
            expect(data.enabled).toBe(true);
            expect(data.count).toBe(42);
            expect(data.ignored).toBe(undefined);
        });

        it('form.fill() でオブジェクトデータを各入力要素に設定できること', () => {
            const inputs = {
                endpoint: { name: 'endpoint', value: '', dispatchEvent: () => {} },
                enabled: { name: 'enabled', type: 'checkbox', checked: false, dispatchEvent: () => {} }
            };

            const mockForm = {
                querySelector: (sel) => {
                    if (sel.includes('endpoint')) return inputs.endpoint;
                    if (sel.includes('enabled')) return inputs.enabled;
                    return null;
                }
            };

            browserJHtml.form.fill(mockForm, {
                endpoint: 'http://new-url',
                enabled: true
            });

            expect(inputs.endpoint.value).toBe('http://new-url');
            expect(inputs.enabled.checked).toBe(true);
        });
    });

    describe('7. 表示・クラス操作 (show, hide, toggle, addClass, removeClass)', () => {
        it('show / hide / toggle で style.display が適切に切り替わること', () => {
            const mockEl = { style: { display: 'none' } };
            browserJHtml.show(mockEl, 'flex');
            expect(mockEl.style.display).toBe('flex');

            browserJHtml.hide(mockEl);
            expect(mockEl.style.display).toBe('none');

            browserJHtml.toggle(mockEl, true);
            expect(mockEl.style.display).toBe('block');

            browserJHtml.toggle(mockEl, false);
            expect(mockEl.style.display).toBe('none');
        });

        it('addClass / removeClass / toggleClass で classList が操作されること', () => {
            const classes = new Set();
            const mockEl = {
                classList: {
                    add: (...c) => c.forEach(x => classes.add(x)),
                    remove: (...c) => c.forEach(x => classes.delete(x)),
                    toggle: (c, cond) => cond ? classes.add(c) : classes.delete(c)
                }
            };

            browserJHtml.addClass(mockEl, 'active', 'highlight');
            expect(classes.has('active')).toBe(true);
            expect(classes.has('highlight')).toBe(true);

            browserJHtml.removeClass(mockEl, 'highlight');
            expect(classes.has('highlight')).toBe(false);

            browserJHtml.toggleClass(mockEl, 'open', true);
            expect(classes.has('open')).toBe(true);
        });
    });

    describe('8. 簡易リアクティブ状態 (jhtml.state)', () => {
        it('プロパティ変更時にリスナーが発火すること', () => {
            let changeHistory = [];
            const app = browserJHtml.state({ count: 0, title: 'initial' }, (prop, val, oldVal) => {
                changeHistory.push({ prop, val, oldVal });
            });

            app.count = 1;
            app.title = 'updated';
            app.count = 1; // 同値は発火しない

            expect(changeHistory.length).toBe(2);
            expect(changeHistory[0]).toEqual({ prop: 'count', val: 1, oldVal: 0 });
            expect(changeHistory[1]).toEqual({ prop: 'title', val: 'updated', oldVal: 'initial' });
        });

        it('$watch で個別にリスナーを追加・解除できること', () => {
            const app = browserJHtml.state({ score: 100 });
            let watchCalls = 0;
            const unwatch = app.$watch((prop, val) => {
                if (prop === 'score') watchCalls++;
            });

            app.score = 90;
            expect(watchCalls).toBe(1);

            unwatch();
            app.score = 80;
            expect(watchCalls).toBe(1); // 解除後は発火しない
        });
    });

    describe('9. 追加ユーティリティ (format, poll, alert, storage)', () => {
        it('format.bytes / money / truncate / date が正常動作すること', () => {
            const { format } = browserJHtml;
            expect(format.bytes(1048576)).toBe('1 MB');
            expect(format.bytes(1073741824 * 2.5)).toBe('2.5 GB');
            expect(format.money(1250000)).toBe('1,250,000');
            expect(format.truncate('とても長いテキストです', 5)).toBe('とても長い...');
            const d = new Date(2026, 8, 6, 12, 30, 45); // 2026-09-06
            expect(format.date(d, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-09-06 12:30:45');
        });

        it('poll() で定期実行され、true 返却で停止すること', async () => {
            let count = 0;
            const stop = browserJHtml.poll(() => {
                count++;
                return count >= 3;
            }, { interval: 10 });

            await new Promise(r => setTimeout(r, 60));
            expect(count).toBe(3);
        });

        it('alert() でメッセージがセットされクラスが制御されること', () => {
            const mockEl = {
                textContent: '',
                style: { display: 'none' },
                classList: {
                    add: (c) => mockEl._classes.add(c),
                    remove: (c) => mockEl._classes.delete(c)
                },
                _classes: new Set()
            };

            global.document = {
                getElementById: () => mockEl,
                querySelector: () => mockEl
            };

            browserJHtml.alert(mockEl, 'エラーです', { isError: true, timeout: 0 });
            expect(mockEl.textContent).toBe('エラーです');
            expect(mockEl._classes.has('alert-error')).toBe(true);
            expect(mockEl.style.display).toBe('block');

            delete global.document;
        });

        it('storage で JSON シリアライズ・デシリアライズができること', () => {
            const store = {};
            global.window = {
                localStorage: {
                    getItem: (k) => store[k] !== undefined ? store[k] : null,
                    setItem: (k, v) => { store[k] = v; },
                    removeItem: (k) => { delete store[k]; },
                    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
                }
            };

            const { storage } = browserJHtml;
            storage.set('settings', { theme: 'dark', zoom: 1.2 });
            const loaded = storage.get('settings');
            expect(loaded).toEqual({ theme: 'dark', zoom: 1.2 });
            expect(storage.get('missing', 'default')).toBe('default');

            delete global.window;
        });
    });
});

