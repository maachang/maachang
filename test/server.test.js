/**
 * AIメモ:
 * - maachang サーバーのルーター・リクエスト処理統合テスト。
 * - 静的配信、403禁止パス、.mt.js API、JHTML テンプレート、filter.mt.js を検証。
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const { handleRequest } = require('../src/router.js');

describe('Server & Router Integration', () => {
    const testProjectDir = path.resolve(__dirname, '../.tmp_test_project');
    const frameworkDir = path.resolve(__dirname, '..');

    beforeAll(() => {
        // テスト用プロジェクトディレクトリ作成
        fs.mkdirSync(path.join(testProjectDir, 'public', 'api'), { recursive: true });
        fs.mkdirSync(path.join(testProjectDir, 'conf'), { recursive: true });

        // 1. 静的 index.html
        fs.writeFileSync(path.join(testProjectDir, 'public', 'index.html'), '<h1>Top Page</h1>');

        // 2. .mt.js API
        fs.writeFileSync(path.join(testProjectDir, 'public', 'api', 'data.mt.js'), `
            exports.handler = async function() {
                return { status: "ok", path: $request.path };
            };
        `);

        // 3. JHTML テンプレート
        fs.writeFileSync(path.join(testProjectDir, 'public', 'page.mt.html'), `
            <% const title = "My Page"; %>
            <h2>\${title}</h2>
        `);

        // 4. filter.mt.js
        fs.writeFileSync(path.join(testProjectDir, 'public', 'filter.mt.js'), `
            exports.handler = async function() {
                if ($request.path === '/blocked') {
                    $response.status(403).json({ error: 'custom blocked' });
                    return false;
                }
                return true;
            };
        `);
        // 5. パーツ & $include
        fs.mkdirSync(path.join(testProjectDir, 'public', 'parts'), { recursive: true });

        fs.writeFileSync(path.join(testProjectDir, 'public', 'parts', 'header.mt.html'), `
            <header class="app-header"><h1>\${$params.title}</h1></header>
        `);

        fs.writeFileSync(path.join(testProjectDir, 'public', 'parts', 'footer.html'), `
            <footer>footer-content</footer>
        `);

        fs.writeFileSync(path.join(testProjectDir, 'public', 'article.mt.html'), `
            \${$include("./parts/header.mt.html", { title: "マイ記事" })}
            <article><p>記事本文です</p></article>
            \${$include("parts/footer.html")}
        `);
    });

    afterAll(() => {
        if (fs.existsSync(testProjectDir)) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }
    });

    it('静的 index.html が取得できること', async () => {
        const req = new Request('http://localhost:3000/');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe('<h1>Top Page</h1>');
    });

    it('.mt.js による API が実行され JSON が返ること', async () => {
        const req = new Request('http://localhost:3000/api/data');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        const data = await res.json();
        expect(data.status).toBe('ok');
        expect(data.path).toBe('/api/data');
    });

    it('.mt.html テンプレートが JHTML としてレンダリングされること', async () => {
        const req = new Request('http://localhost:3000/page');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/html');
        const html = await res.text();
        expect(html).toContain('<h2>My Page</h2>');
    });

    it('$include によるテンプレート部品化・パラメータ渡し・静的HTML埋め込みが動作すること', async () => {
        const req = new Request('http://localhost:3000/article');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<header class="app-header"><h1>マイ記事</h1></header>');
        expect(html).toContain('<article><p>記事本文です</p></article>');
        expect(html).toContain('<footer>footer-content</footer>');
    });

    it('_ で始まる内部ファイルやパーツへの直接アクセスが 403 で拒否されること', async () => {
        const req1 = new Request('http://localhost:3000/components/_header');
        const res1 = await handleRequest(req1, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res1.status).toBe(403);

        const req2 = new Request('http://localhost:3000/layouts/_base');
        const res2 = await handleRequest(req2, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res2.status).toBe(403);
    });

    it('.mt.js や /filter への直接アクセスが 403 で拒否されること', async () => {
        const req1 = new Request('http://localhost:3000/api/data.mt.js');
        const res1 = await handleRequest(req1, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res1.status).toBe(403);

        const req2 = new Request('http://localhost:3000/filter');
        const res2 = await handleRequest(req2, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res2.status).toBe(403);
    });

    it('filter.mt.js によるリクエスト遮断が動作すること', async () => {
        const req = new Request('http://localhost:3000/blocked');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toBe('custom blocked');
    });

    it('プロジェクト側にない静的アセット (/jhtml.browser.js) がフレームワーク本体側からフォールバック配信されること', async () => {
        const req = new Request('http://localhost:3000/jhtml.browser.js');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/javascript');
        const text = await res.text();
        expect(text).toContain('jhtml.browser.js');
        expect(text).toContain('escapeHtml');
    });
});
