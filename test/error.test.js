/**
 * AIメモ:
 * - 開発環境・本番環境のエラーハンドリング切り替えおよびログ出力の検証テスト。
 * - 開発環境 (isDev: true): HTML/JSON のリッチエラー表示、コードスニペット、スタックトレース。
 * - 本番環境 (isDev: false): 内部情報隠蔽の 500 応答。
 * - 共通: logger.error() によるログ記録。
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const { handleRequest } = require('../src/router.js');
const logger = require('../src/logger.js');

describe('Error Handling & Logging (Dev vs Prod)', () => {
    const testProjectDir = path.resolve(__dirname, '../.tmp_test_error_project');
    const frameworkDir = path.resolve(__dirname, '..');
    const logDir = path.join(testProjectDir, 'log');

    beforeAll(() => {
        fs.mkdirSync(path.join(testProjectDir, 'public', 'api'), { recursive: true });
        fs.mkdirSync(path.join(testProjectDir, 'conf'), { recursive: true });
        fs.mkdirSync(logDir, { recursive: true });

        logger.setting({
            dir: logDir,
            file: 'logout',
            level: 'info',
            stdout: false
        });

        // 1. エラーを起こす .mt.js
        fs.writeFileSync(path.join(testProjectDir, 'public', 'api', 'broken.mt.js'), `
            exports.handler = async function() {
                // わざと未定義変数を参照してエラーを発生させる
                const x = undefinedVariable.property;
                return { status: "ok" };
            };
        `);

        // 2. エラーを起こす JHTML テンプレート (.mt.html)
        fs.writeFileSync(path.join(testProjectDir, 'public', 'broken_template.mt.html'), `
            <% const user = null; %>
            <h1>ユーザー情報</h1>
            <% const name = user.name; %>
            <p>\${name}</p>
        `);
    });

    afterAll(() => {
        if (fs.existsSync(testProjectDir)) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }
    });

    it('開発環境 (isDev: true) かつ Accept: text/html の場合、リッチなHTMLエラー画面が返ること', async () => {
        const req = new Request('http://localhost:3000/broken_template', {
            headers: { 'Accept': 'text/html' }
        });
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });

        expect(res.status).toBe(500);
        expect(res.headers.get('Content-Type')).toContain('text/html');

        const html = await res.text();
        expect(html).toContain('Development Mode');
        expect(html).toContain('maachang Web Framework');
        expect(html).toContain('broken_template.mt.html');
        expect(html).toContain('Stack Trace');
    });

    it('開発環境 (isDev: true) かつ Accept: application/json の場合、詳細なJSONエラーが返ること', async () => {
        const req = new Request('http://localhost:3000/api/broken', {
            headers: { 'Accept': 'application/json' }
        });
        const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });

        expect(res.status).toBe(500);
        expect(res.headers.get('Content-Type')).toContain('application/json');

        const json = await res.json();
        expect(json.error).toBe('Script Execution Error');
        expect(json.message).toBeDefined();
        expect(json.file).toContain('broken.mt.js');
        expect(Array.isArray(json.stack)).toBe(true);
    });

    it('本番環境 (isDev: false) の場合、内部情報が隠蔽された 500 エラーが返ること (JSON & HTML)', async () => {
        // A. JSON 要求
        const reqJson = new Request('http://localhost:3000/api/broken', {
            headers: { 'Accept': 'application/json' }
        });
        const resJson = await handleRequest(reqJson, { baseDir: testProjectDir, frameworkDir, isDev: false });
        expect(resJson.status).toBe(500);
        const json = await resJson.json();
        expect(json).toEqual({ error: 'Internal Server Error' });
        expect(json.message).toBeUndefined();
        expect(json.stack).toBeUndefined();

        // B. HTML 要求
        const reqHtml = new Request('http://localhost:3000/broken_template', {
            headers: { 'Accept': 'text/html' }
        });
        const resHtml = await handleRequest(reqHtml, { baseDir: testProjectDir, frameworkDir, isDev: false });
        expect(resHtml.status).toBe(500);
        const html = await resHtml.text();
        expect(html).toContain('500 Internal Server Error');
        expect(html).not.toContain('broken_template.mt.html');
        expect(html).not.toContain('Stack Trace');
    });

    it('エラー発生時に必ずログファイルへ記録されること', async () => {
        // ファイル書き込み待機
        await new Promise(r => setTimeout(r, 60));

        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const logFilePath = path.join(logDir, `logout.${y}-${m}-${d}.log`);

        expect(fs.existsSync(logFilePath)).toBe(true);
        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        expect(logContent).toContain('[ERROR]');
        expect(logContent).toContain('broken.mt.js');
    });
});
