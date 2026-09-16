/**
 * AIメモ:
 * - セキュリティ対策の統合テスト
 * - 1. パストラバーサル・多重URLエンコード・null byteの遮断 (router)
 * - 2. リクエストボディサイズ制限 (DoS保護: 413 Payload Too Large)
 * - 3. $loadLib / $loadConf におけるパストラバーサル遮断 (context)
 * - 4. $response.download / $response.file におけるベースディレクトリ外境界チェック (context)
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const { handleRequest } = require('../src/router.js');
const { createContext } = require('../src/context.js');

describe('Security Protections Suite', () => {
    const testProjectDir = path.resolve(__dirname, '../.tmp_sec_project');
    const frameworkDir = path.resolve(__dirname, '..');

    beforeAll(() => {
        fs.mkdirSync(path.join(testProjectDir, 'public', 'api'), { recursive: true });
        fs.mkdirSync(path.join(testProjectDir, 'conf'), { recursive: true });

        // 機密情報ファイル (外部から読み取られてはならない)
        fs.writeFileSync(path.join(testProjectDir, 'conf', 'env.json'), JSON.stringify({ DB_PASSWORD: "super_secret" }));
        fs.writeFileSync(path.join(testProjectDir, 'conf', 'server.json'), JSON.stringify({
            maxBodyLength: 50 // テスト用に小さな制限値 (50 bytes)
        }));

        // 通常の静的ファイルと API
        fs.writeFileSync(path.join(testProjectDir, 'public', 'index.html'), '<h1>OK</h1>');
        fs.writeFileSync(path.join(testProjectDir, 'public', 'api', 'echo.mt.js'), `
            exports.handler = async function() {
                return { body: $request.body };
            };
        `);
    });

    afterAll(() => {
        if (fs.existsSync(testProjectDir)) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }
    });

    describe('1. Path Traversal & URL Encoding Attacks', () => {
        it('URLエンコードされた ..%2f を検知して 403 で遮断すること', async () => {
            const req = new Request('http://localhost:3000/..%2fconf/env.json');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(403);
        });

        it('%2e%2e%2f によるトラバーサルを検知して 403 で遮断すること', async () => {
            const req = new Request('http://localhost:3000/api/%2e%2e%2fconf/env.json');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(403);
        });

        it('バックスラッシュを含む ..\\\\ を検知して 403 で遮断すること', async () => {
            const req = new Request('http://localhost:3000/api/..%5cconf/env.json');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(403);
        });

        it('多重URLエンコード (%252e%252e) によるトラバーサルを 403 で遮断すること', async () => {
            const req = new Request('http://localhost:3000/%252e%252e/conf/env.json');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(403);
        });

        it('null byte (%00) を含むリクエストを 400 Bad Request で遮断すること', async () => {
            const req = new Request('http://localhost:3000/index.html%00.txt');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(400);
        });
    });

    describe('2. Request Body Max Size Limit (DoS Protection)', () => {
        it('Content-Length ヘッダーが maxBodyLength を超えている場合に 413 を返すこと', async () => {
            const req = new Request('http://localhost:3000/api/echo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': '200'
                },
                body: JSON.stringify({ message: "a".repeat(150) })
            });
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(413);
            const data = await res.json();
            expect(data.error).toBe('Payload Too Large');
        });

        it('Content-Length 未指定でもボディが maxBodyLength を超えている場合に 413 を返すこと', async () => {
            const req = new Request('http://localhost:3000/api/echo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: "a".repeat(150) })
            });
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(413);
        });

        it('制限値以内のリクエストボディは正常に処理されること', async () => {
            const req = new Request('http://localhost:3000/api/echo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ a: 1 })
            });
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.body).toEqual({ a: 1 });
        });
    });

    describe('3. $loadLib / $loadConf Path Traversal Protection', () => {
        const dummyReq = new Request('http://localhost:3000/');
        const context = createContext({
            req: dummyReq,
            url: new URL('http://localhost:3000/'),
            body: null,
            baseDir: testProjectDir,
            frameworkDir
        });

        it('$loadLib で .. を含む不正パスが指定された場合に例外を投げること', () => {
            expect(() => context.$loadLib('../../../etc/passwd')).toThrow('Invalid module path');
            expect(() => context.$loadLib('..\\secret')).toThrow('Invalid module path');
        });

        it('$loadConf で .. を含む不正パスが指定された場合に例外を投げること', () => {
            expect(() => context.$loadConf('../../secret')).toThrow('Invalid config path');
        });
    });

    describe('4. $response.download / $response.file Boundary Checks', () => {
        const dummyReq = new Request('http://localhost:3000/');
        const context = createContext({
            req: dummyReq,
            url: new URL('http://localhost:3000/'),
            body: null,
            baseDir: testProjectDir,
            frameworkDir
        });

        it('$response.download で baseDir 外のファイルが指定された場合にアクセス拒否すること', () => {
            expect(() => context.$response.download('../../etc/passwd')).toThrow('Access denied');
            expect(() => context.$response.download('/etc/passwd')).toThrow('Access denied');
        });

        it('$response.file で baseDir 外のファイルが指定された場合にアクセス拒否すること', () => {
            expect(() => context.$response.file('../../etc/hosts')).toThrow('Access denied');
            expect(() => context.$response.file('/etc/shadow')).toThrow('Access denied');
        });
    });
});
