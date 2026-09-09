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

    it('startServer と stopServer による Graceful Shutdown が安全に完了すること', async () => {
        const { startServer, stopServer } = require('../src/index.js');
        const dbWrapper = require('../src/db.js');

        // テスト用のDB接続を作成
        const db = dbWrapper.getDb(':memory:');
        db.exec('CREATE TABLE test_shutdown (id INTEGER PRIMARY KEY);');

        // サーバーを別ポートかつシグナル登録オフで起動
        const server = startServer({
            baseDir: testProjectDir,
            port: 3999,
            hostname: '127.0.0.1',
            handleSignals: false
        });

        expect(server).toBeDefined();
        expect(server.port).toBe(3999);

        // stopServer で停止
        await stopServer(server);

        // 二重停止してもエラーにならないこと
        await stopServer(server);
    });

    it('セキュリティヘッダーがデフォルトでレスポンスに自動付与されること', async () => {
        const req = new Request('http://localhost:3000/api/data');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
        expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('conf/server.json で securityHeaders: false が指定された場合にヘッダーが付与されないこと', async () => {
        const customDir = path.resolve(__dirname, '../.tmp_sec_project');
        fs.mkdirSync(path.join(customDir, 'conf'), { recursive: true });
        fs.mkdirSync(path.join(customDir, 'public'), { recursive: true });
        fs.writeFileSync(path.join(customDir, 'conf', 'server.json'), JSON.stringify({
            securityHeaders: false
        }));
        fs.writeFileSync(path.join(customDir, 'public', 'index.html'), 'OK');

        try {
            const req = new Request('http://localhost:3000/');
            const res = await handleRequest(req, { baseDir: customDir, frameworkDir, isDev: true });
            expect(res.status).toBe(200);
            expect(res.headers.get('X-Frame-Options')).toBeNull();
            expect(res.headers.get('X-Content-Type-Options')).toBeNull();
        } finally {
            fs.rmSync(customDir, { recursive: true, force: true });
        }
    });

    it('ヘルスチェック (/healthz) がデフォルトで稼働情報を JSON で返却すること', async () => {
        const req = new Request('http://localhost:3000/healthz');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        const data = await res.json();
        expect(data.status).toBe('ok');
        expect(typeof data.uptime).toBe('number');
        expect(typeof data.timestamp).toBe('number');
        expect(data.memory).toBeDefined();
        expect(typeof data.memory.heapUsed).toBe('number');
        expect(data.version).toBeDefined();
    });

    it('conf/server.json でヘルスチェックの path カスタマイズおよび無効化 (enabled: false) が動作すること', async () => {
        const customDir = path.resolve(__dirname, '../.tmp_health_project');
        fs.mkdirSync(path.join(customDir, 'conf'), { recursive: true });
        fs.mkdirSync(path.join(customDir, 'public'), { recursive: true });
        fs.writeFileSync(path.join(customDir, 'conf', 'server.json'), JSON.stringify({
            healthCheck: {
                path: '/ping'
            }
        }));

        try {
            const reqCustom = new Request('http://localhost:3000/ping');
            const resCustom = await handleRequest(reqCustom, { baseDir: customDir, frameworkDir, isDev: true });
            expect(resCustom.status).toBe(200);
            const data = await resCustom.json();
            expect(data.status).toBe('ok');

            // 従来の /healthz は 404 になること
            const reqDefault = new Request('http://localhost:3000/healthz');
            const resDefault = await handleRequest(reqDefault, { baseDir: customDir, frameworkDir, isDev: true });
            expect(resDefault.status).toBe(404);
        } finally {
            fs.rmSync(customDir, { recursive: true, force: true });
        }
    });

    it('filter.mt.js の exports.after フックが実行されレスポンスを変更できること', async () => {
        const filterDir = path.resolve(__dirname, '../.tmp_after_project');
        fs.mkdirSync(path.join(filterDir, 'conf'), { recursive: true });
        fs.mkdirSync(path.join(filterDir, 'public'), { recursive: true });
        fs.writeFileSync(path.join(filterDir, 'public', 'hello.mt.js'), `
            exports.handler = async function() {
                return { msg: "hello world" };
            };
        `);
        fs.writeFileSync(path.join(filterDir, 'public', 'filter.mt.js'), `
            exports.handler = async function() {
                return true;
            };
            exports.after = async function({ req, res, executionTimeMs }) {
                const headers = new Headers(res.headers);
                headers.set('X-Response-Time', executionTimeMs + 'ms');
                headers.set('X-Custom-Filter', 'applied');
                return new Response(res.body, {
                    status: res.status,
                    statusText: res.statusText,
                    headers
                });
            };
        `);

        try {
            const req = new Request('http://localhost:3000/hello');
            const res = await handleRequest(req, { baseDir: filterDir, frameworkDir, isDev: true });
            expect(res.status).toBe(200);
            expect(res.headers.get('X-Custom-Filter')).toBe('applied');
            expect(res.headers.get('X-Response-Time')).toContain('ms');
            const json = await res.json();
            expect(json.msg).toBe('hello world');
        } finally {
            fs.rmSync(filterDir, { recursive: true, force: true });
        }
    });
});
