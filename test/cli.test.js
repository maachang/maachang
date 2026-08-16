/**
 * AIメモ:
 * - maachang の CLI (mkmc, mcbuild, maachang) およびプロジェクト単位実行のテスト。
 * - 外部ディレクトリでの mkmc 実行、mcbuild 事前コンパイル、およびプロジェクト内のルーティング検証。
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const { handleRequest } = require('../src/router.js');

describe('CLI & Multi-project Execution', () => {
    const tmpProjectDir = path.resolve(__dirname, '../.tmp_cli_project');
    const frameworkDir = path.resolve(__dirname, '..');

    beforeAll(() => {
        if (fs.existsSync(tmpProjectDir)) {
            fs.rmSync(tmpProjectDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(tmpProjectDir)) {
            fs.rmSync(tmpProjectDir, { recursive: true, force: true });
        }
    });

    it('mkmc で新しいプロジェクト雛形が生成されること', async () => {
        // mkmc.js を直接実行
        const proc = Bun.spawnSync(['bun', path.join(frameworkDir, 'bin', 'mkmc.js'), path.basename(tmpProjectDir)], {
            cwd: path.dirname(tmpProjectDir),
            env: { ...process.env, MAACHANG_HOME: frameworkDir }
        });

        expect(proc.exitCode).toBe(0);
        expect(fs.existsSync(path.join(tmpProjectDir, 'conf', 'server.json'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'conf', 'session.json'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'api', 'hello.mt.js'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'sample.mt.html'))).toBe(true);
    });

    it('mcbuild でプロジェクト内の JHTML テンプレートがコンパイルされること', async () => {
        const proc = Bun.spawnSync(['bun', path.join(frameworkDir, 'bin', 'mcbuild.js')], {
            cwd: tmpProjectDir,
            env: { ...process.env, MAACHANG_HOME: frameworkDir }
        });

        expect(proc.exitCode).toBe(0);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'sample.jhtml.js'))).toBe(true);
    });

    it('生成されたプロジェクトで API および セッションが正常動作すること', async () => {
        const req = new Request('http://localhost:3000/api/hello');
        const res = await handleRequest(req, {
            baseDir: tmpProjectDir,
            frameworkDir,
            isDev: false
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.message).toBe('Hello from maachang!');
        expect(data.sessionCount).toBe(1);
        expect(res.headers.get('Set-Cookie')).not.toBeNull();
    });
});
