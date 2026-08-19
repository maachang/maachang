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
        expect(fs.existsSync(path.join(tmpProjectDir, 'conf', 'env.json'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'api', 'hello.mt.js'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'public', 'sample.mt.html'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'schema', 'README.md'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, 'validates', 'sample.js'))).toBe(true);
        expect(fs.existsSync(path.join(tmpProjectDir, '.claude', 'CLAUDE.md'))).toBe(true);

        const claudeMdContent = fs.readFileSync(path.join(tmpProjectDir, '.claude', 'CLAUDE.md'), 'utf-8');
        expect(claudeMdContent).toContain(path.basename(tmpProjectDir));
        expect(claudeMdContent).toContain('schema/');
        expect(claudeMdContent).toContain('validates/');
        expect(claudeMdContent).toContain('env.json');
        expect(claudeMdContent).not.toContain('${PROJECT_NAME}');
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

    it('生成されたプロジェクトで validates 定義を用いた検証が動作すること', async () => {
        // テスト用のバリデーション利用 API を作成
        fs.writeFileSync(path.join(tmpProjectDir, 'public', 'api', 'validate-test.mt.js'), `
exports.handler = async function() {
    const validate = $loadLib('validate.js');
    const sampleSchema = $loadLib('validates/sample.js');

    const result = validate.check($request.body, sampleSchema);
    if (!result.valid) {
        return $response.json({ success: false, errors: result.errors }, 400);
    }
    return { success: true, data: result.data };
};
`);

        // 異常系: 必須チェックエラー
        const badReq = new Request('http://localhost:3000/api/validate-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ age: 25 })
        });
        const badRes = await handleRequest(badReq, {
            baseDir: tmpProjectDir,
            frameworkDir,
            isDev: false
        });
        expect(badRes.status).toBe(400);
        const badData = await badRes.json();
        expect(badData.success).toBe(false);
        expect(badData.errors[0].field).toBe('name');

        // 正常系
        const goodReq = new Request('http://localhost:3000/api/validate-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '太郎', email: 'taro@example.com', age: 30 })
        });
        const goodRes = await handleRequest(goodReq, {
            baseDir: tmpProjectDir,
            frameworkDir,
            isDev: false
        });
        expect(goodRes.status).toBe(200);
        const goodData = await goodRes.json();
        expect(goodData.success).toBe(true);
        expect(goodData.data.name).toBe('太郎');
    });

    it('conf/env.json および conf/env.local.json で process.env が設定・上書きされること', async () => {
        // conf/env.json に環境変数を設定
        fs.writeFileSync(path.join(tmpProjectDir, 'conf', 'env.json'), JSON.stringify({
            APP_NAME: 'testApp',
            SECRET_KEY: 'defaultSecret',
            MY_SETTING: 'original'
        }, null, 2));

        // conf/env.local.json で上書き
        fs.writeFileSync(path.join(tmpProjectDir, 'conf', 'env.local.json'), JSON.stringify({
            SECRET_KEY: 'localOverriddenSecret'
        }, null, 2));

        // process.env を参照する API を作成
        fs.writeFileSync(path.join(tmpProjectDir, 'public', 'api', 'env-test.mt.js'), `
exports.handler = async function() {
    return {
        appName: process.env.APP_NAME,
        secretKey: process.env.SECRET_KEY,
        mySetting: process.env.MY_SETTING
    };
};
`);

        const req = new Request('http://localhost:3000/api/env-test');
        const res = await handleRequest(req, {
            baseDir: tmpProjectDir,
            frameworkDir,
            isDev: false
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.appName).toBe('testApp');
        expect(data.mySetting).toBe('original');
        expect(data.secretKey).toBe('localOverriddenSecret');
    });
});
