/**
 * AIメモ:
 * - .mt.js による Web API 実行機能のテスト。
 * - $request(), $response() の関数呼び出しおよびプロパティアクセスの両対応を検証。
 * - 自動 JSON 変換、明示的 $response.json() / $response().body() の動作を検証。
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const { handleRequest } = require('../src/router.js');

describe('Web API (.mt.js) & $request / $response Compatibility', () => {
    const testProjectDir = path.resolve(__dirname, '../.tmp_api_test_project');
    const frameworkDir = path.resolve(__dirname, '..');

    beforeAll(() => {
        fs.mkdirSync(path.join(testProjectDir, 'public', 'api'), { recursive: true });
        fs.mkdirSync(path.join(testProjectDir, 'conf'), { recursive: true });

        // 1. オブジェクトを直接 return する API
        fs.writeFileSync(path.join(testProjectDir, 'public', 'api', 'auto_json.mt.js'), `
            exports.handler = async function() {
                return { success: true, count: 42 };
            };
        `);

        // 2. $response().contentType() や $response().body() を使う minto 記法 API
        fs.writeFileSync(path.join(testProjectDir, 'public', 'api', 'fn_style.mt.js'), `
            exports.handler = async function() {
                const p = $request().path;
                $response().contentType("application/json", "utf-8");
                $response().status(201);
                $response().body(JSON.stringify({ path: p, created: true }));
            };
        `);

        // 3. $response.json() プロパティアクセス記法 API
        fs.writeFileSync(path.join(testProjectDir, 'public', 'api', 'prop_style.mt.js'), `
            exports.handler = async function() {
                const user = $request.getQuery("user", "none");
                return $response.status(200).json({ user: user });
            };
        `);
    });

    afterAll(() => {
        if (fs.existsSync(testProjectDir)) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }
    });

    it('return { ... } で自動的に application/json としてレスポンスされること', async () => {
        const req = new Request('http://localhost:3000/api/auto_json');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.count).toBe(42);
    });

    it('$request() と $response() の関数呼び出し記法で正しく動作すること', async () => {
        const req = new Request('http://localhost:3000/api/fn_style');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(201);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        const data = await res.json();
        expect(data.path).toBe('/api/fn_style');
        expect(data.created).toBe(true);
    });

    it('$response.json() や $request.getQuery() のプロパティ記法で正しく動作すること', async () => {
        const req = new Request('http://localhost:3000/api/prop_style?user=Antigravity');
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.user).toBe('Antigravity');
    });
});
