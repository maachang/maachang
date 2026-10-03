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

    describe('5. Session Fixation Protection (regenerateSession)', () => {
        const sessionModule = require('../modules/session.js');

        it('regenerateSession でデータが引き継がれ、新しい sid が発行されること', () => {
            let setCookieHeader = null;
            const mockRes = {
                setCookie: (name, val, opts) => {
                    setCookieHeader = { name, val, opts };
                }
            };

            // 初回セッション作成
            const created = sessionModule.createSession(mockRes, { userId: 'u123', role: 'admin' });
            const initialSid = created.sid;
            expect(initialSid).toBeDefined();

            // セッションIDを持つモックリクエスト
            const mockReq = {
                getCookie: (name) => (name === 'maachang_sid' ? initialSid : null),
                cookies: { maachang_sid: initialSid }
            };

            // セッション再生成
            const regenerated = sessionModule.regenerateSession(mockReq, mockRes);
            expect(regenerated.sid).toBeDefined();
            expect(regenerated.sid).not.toBe(initialSid);
            expect(regenerated.data).toEqual({ userId: 'u123', role: 'admin' });

            // Cookie が新しい sid で更新されていること
            expect(setCookieHeader.val).toBe(regenerated.sid);

            // 古い sid では取得できず、新しい sid で取得できること
            const oldReq = { getCookie: () => initialSid };
            expect(sessionModule.getSession(oldReq)).toBeNull();

            const newReq = { getCookie: () => regenerated.sid };
            const fetched = sessionModule.getSession(newReq);
            expect(fetched.data).toEqual({ userId: 'u123', role: 'admin' });
        });
    });

    describe('6. Automatic Secure Cookie on HTTPS', () => {
        it('HTTPS 通信時に opts.secure 未指定でも自動的に Secure 属性が付与されること', () => {
            const reqHttps = new Request('https://example.com/');
            const ctxHttps = createContext({
                req: reqHttps,
                url: new URL('https://example.com/'),
                body: null,
                baseDir: testProjectDir,
                frameworkDir
            });

            ctxHttps.$response.setCookie('token', 'secret123');
            const cookieVal = ctxHttps.$response.getHeaders().get('Set-Cookie');
            expect(cookieVal).toContain('Secure');
        });

        it('HTTP 通信時にはデフォルトで Secure 属性が付与されないこと', () => {
            const reqHttp = new Request('http://example.com/');
            const ctxHttp = createContext({
                req: reqHttp,
                url: new URL('http://example.com/'),
                body: null,
                baseDir: testProjectDir,
                frameworkDir
            });

            ctxHttp.$response.setCookie('token', 'secret123');
            const cookieVal = ctxHttp.$response.getHeaders().get('Set-Cookie');
            expect(cookieVal).not.toContain('Secure');
        });
    });

    describe('7. Rate Limiting (429 Too Many Requests)', () => {
        const rateLimitDir = path.resolve(__dirname, '../.tmp_ratelimit_project');

        beforeAll(() => {
            fs.mkdirSync(path.join(rateLimitDir, 'conf'), { recursive: true });
            fs.mkdirSync(path.join(rateLimitDir, 'public'), { recursive: true });
            fs.writeFileSync(path.join(rateLimitDir, 'conf', 'server.json'), JSON.stringify({
                rateLimit: {
                    enabled: true,
                    windowMs: 60000,
                    max: 2,
                    message: "Rate limit exceeded"
                }
            }));
            fs.writeFileSync(path.join(rateLimitDir, 'public', 'test.html'), 'OK');
        });

        afterAll(() => {
            if (fs.existsSync(rateLimitDir)) {
                fs.rmSync(rateLimitDir, { recursive: true, force: true });
            }
        });

        it('リクエスト上限を超えた場合に 429 Too Many Requests を返すこと', async () => {
            const req1 = new Request('http://localhost:3000/test.html', { headers: { 'X-Real-IP': '198.51.100.1' } });
            const res1 = await handleRequest(req1, { baseDir: rateLimitDir, frameworkDir, isDev: true });
            expect(res1.status).toBe(200);

            const req2 = new Request('http://localhost:3000/test.html', { headers: { 'X-Real-IP': '198.51.100.1' } });
            const res2 = await handleRequest(req2, { baseDir: rateLimitDir, frameworkDir, isDev: true });
            expect(res2.status).toBe(200);

            const req3 = new Request('http://localhost:3000/test.html', { headers: { 'X-Real-IP': '198.51.100.1' } });
            const res3 = await handleRequest(req3, { baseDir: rateLimitDir, frameworkDir, isDev: true });
            expect(res3.status).toBe(429);
            expect(res3.headers.get('Retry-After')).toBeDefined();
            expect(res3.headers.get('X-RateLimit-Remaining')).toBe('0');
            const data = await res3.json();
            expect(data.error).toBe('Rate limit exceeded');
        });
    });

    describe('8. CORS Support (OPTIONS Preflight & Headers)', () => {
        const corsDir = path.resolve(__dirname, '../.tmp_cors_project');

        beforeAll(() => {
            fs.mkdirSync(path.join(corsDir, 'conf'), { recursive: true });
            fs.mkdirSync(path.join(corsDir, 'public'), { recursive: true });
            fs.writeFileSync(path.join(corsDir, 'conf', 'server.json'), JSON.stringify({
                cors: {
                    origin: ['https://app.example.com'],
                    methods: ['GET', 'POST', 'OPTIONS'],
                    credentials: true
                }
            }));
            fs.writeFileSync(path.join(corsDir, 'public', 'api.html'), 'API');
        });

        afterAll(() => {
            if (fs.existsSync(corsDir)) {
                fs.rmSync(corsDir, { recursive: true, force: true });
            }
        });

        it('OPTIONS プリフライトリクエストに 204 で応答し CORS ヘッダーを返すこと', async () => {
            const req = new Request('http://localhost:3000/api.html', {
                method: 'OPTIONS',
                headers: { 'Origin': 'https://app.example.com' }
            });
            const res = await handleRequest(req, { baseDir: corsDir, frameworkDir, isDev: true });
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
            expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
        });

        it('通常リクエストにも CORS ヘッダーが付与されること', async () => {
            const req = new Request('http://localhost:3000/api.html', {
                headers: { 'Origin': 'https://app.example.com' }
            });
            const res = await handleRequest(req, { baseDir: corsDir, frameworkDir, isDev: true });
            expect(res.status).toBe(200);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
        });
    });

    describe('9. HSTS & CSP Headers', () => {
        it('HTTPS (X-Forwarded-Proto: https) リクエストに HSTS ヘッダーが付与されること', async () => {
            const req = new Request('http://localhost:3000/index.html', {
                headers: { 'X-Forwarded-Proto': 'https' }
            });
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
        });

        it('HTTP リクエストには HSTS ヘッダーが付与されないこと', async () => {
            const req = new Request('http://localhost:3000/index.html');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.headers.get('Strict-Transport-Security')).toBeNull();
        });
    });

    describe('10. Prototype Pollution Prevention', () => {
        const { sanitizeObject } = require('../src/context.js');

        it('sanitizeObject で __proto__, constructor, prototype キーが除去されること', () => {
            const malicious = JSON.parse('{"valid": 1, "__proto__": {"admin": true}, "constructor": {"name": "bad"}}');
            const cleaned = sanitizeObject(malicious);
            expect(cleaned.valid).toBe(1);
            expect(Object.prototype.admin).toBeUndefined();
            expect(cleaned.__proto__).toBe(Object.prototype);
        });
    });

    describe('11. Sensitive Log Masking', () => {
        const logger = require('../src/logger.js');

        it('maskSensitiveData でパスワードやトークンが *** にマスクされること', () => {
            const input = {
                user: 'admin',
                password: 'super-secret-password',
                token: 'jwt.token.abc',
                nested: {
                    apiKey: 'api-12345'
                }
            };
            const masked = logger.maskSensitiveData(input);
            expect(masked.user).toBe('admin');
            expect(masked.password).toBe('***');
            expect(masked.token).toBe('***');
            expect(masked.nested.apiKey).toBe('***');
        });

        it('Authorization Bearer ヘッダー文字列がマスクされること', () => {
            const str = 'Request with Authorization: Bearer eyJhbGciOi...123 and done';
            const masked = logger.maskSensitiveData(str);
            expect(masked).toContain('Bearer ***');
            expect(masked).not.toContain('eyJhbGciOi');
        });

        it('access_token, refresh_token, client_secret, private_key, session_id がマスクされること', () => {
            const input = {
                access_token: 'at-12345',
                refresh_token: 'rt-67890',
                client_secret: 'cs-secret',
                private_key: 'pk-secret',
                session_id: 'sid-secret',
                normalKey: 'normalValue'
            };
            const masked = logger.maskSensitiveData(input);
            expect(masked.access_token).toBe('***');
            expect(masked.refresh_token).toBe('***');
            expect(masked.client_secret).toBe('***');
            expect(masked.private_key).toBe('***');
            expect(masked.session_id).toBe('***');
            expect(masked.normalKey).toBe('normalValue');
        });
    });

    describe('12. Symlink Escape Protection in isSafePath', () => {
        const { isSafePath } = require('../src/context.js');
        const symlinkTestDir = path.resolve(__dirname, '../.tmp_symlink_suite');

        beforeAll(() => {
            fs.mkdirSync(path.join(symlinkTestDir, 'public'), { recursive: true });
            try {
                fs.symlinkSync('/etc/hosts', path.join(symlinkTestDir, 'public', 'external_link'));
            } catch (_) {}
        });

        afterAll(() => {
            if (fs.existsSync(symlinkTestDir)) {
                fs.rmSync(symlinkTestDir, { recursive: true, force: true });
            }
        });

        it('baseDir 外を指すシンボリックリンクへのアクセスを拒否すること', () => {
            const linkPath = path.join(symlinkTestDir, 'public', 'external_link');
            if (fs.existsSync(linkPath)) {
                expect(isSafePath(path.join(symlinkTestDir, 'public'), linkPath)).toBe(false);
            }
        });
    });

    describe('13. Automatic Secure Session Cookie on HTTPS via createSession', () => {
        const sessionModule = require('../modules/session.js');

        it('HTTPS リクエスト時に createSession で自動的に Secure 属性が付与されること', () => {
            const reqHttps = new Request('https://example.com/');
            const ctxHttps = createContext({
                req: reqHttps,
                url: new URL('https://example.com/'),
                body: null,
                baseDir: testProjectDir,
                frameworkDir
            });

            sessionModule.createSession(ctxHttps.$response, { user: 'testUser' });
            const setCookie = ctxHttps.$response.getHeaders().get('Set-Cookie');
            expect(setCookie).toContain('Secure');
            expect(setCookie).toContain('HttpOnly');
        });
    });

    describe('14. RBAC Module Session Integration', () => {
        const sessionModule = require('../modules/session.js');
        const rbacModule = require('../modules/auth/rbac.js');

        it('有効なセッションを持つリクエストから getUser() でユーザー情報が取得できること', async () => {
            const created = sessionModule.createSession(null, { userId: 'admin1', role: 'admin' });
            const req = new Request('http://localhost:3000/', {
                headers: { 'cookie': `maachang_sid=${created.sid}` }
            });
            const ctx = createContext({
                req,
                url: new URL('http://localhost:3000/'),
                body: null,
                baseDir: testProjectDir,
                frameworkDir
            });

            const user = await rbacModule.getUser(ctx.$request);
            expect(user).not.toBeNull();
            expect(user.userId).toBe('admin1');
            expect(rbacModule.hasRole(user, 'admin')).toBe(true);
            expect(rbacModule.hasRole(user, 'superadmin')).toBe(false);
        });
    });

    describe('15. CSRF Secret Protection', () => {
        const csrf = require('../modules/auth/csrf.js');

        it('本番環境で CSRF_SECRET 未設定時にランダムシークレットが生成されること', () => {
            const originalEnv = process.env.NODE_ENV;
            const originalSecret = process.env.CSRF_SECRET;
            try {
                process.env.NODE_ENV = 'production';
                delete process.env.CSRF_SECRET;
                const token = csrf.generateToken('session_test_123');
                expect(token).toBeDefined();
                expect(token.length).toBe(64); // sha256 hex
                // 一貫して同じプロセス内では同一トークンが計算されること
                expect(csrf.verify('session_test_123', token)).toBe(true);
            } finally {
                process.env.NODE_ENV = originalEnv;
                if (originalSecret) process.env.CSRF_SECRET = originalSecret;
            }
        });
    });

    describe('16. CSV Formula Injection Protection', () => {
        const { writeCsv } = require('../modules/csv/csvWriter.js');

        it('sanitizeFormulas: true 時に数式プレフィックス (=, +, -, @) の先頭にクォートが付与されること', () => {
            const headers = ['id', 'formula'];
            const rows = [
                { id: 1, formula: '=1+1' },
                { id: 2, formula: '+cmd|test' },
                { id: 3, formula: '@SUM(A1:A2)' }
            ];
            const csv = writeCsv(headers, rows, { sanitizeFormulas: true });
            expect(csv).toContain("'=1+1");
            expect(csv).toContain("'+cmd|test");
            expect(csv).toContain("'@SUM(A1:A2)");
        });
    });

    describe('17. JWT Algorithm Security', () => {
        const jwt = require('../modules/auth/jwt.js');

        it('アルゴリズムが HS256 以外の不正なトークンは verify で拒否されること', () => {
            const secret = 'test-jwt-secret';
            // alg: none トークンの模倣
            const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
            const payload = Buffer.from(JSON.stringify({ userId: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
            const fakeToken = `${headerNone}.${payload}.`;

            expect(jwt.verify(fakeToken, secret)).toBeNull();
            expect(() => jwt.verify(fakeToken, secret, { noError: false })).toThrow('Unsupported JWT algorithm');
        });
    });

    describe('18. Malformed Session ID Rejection', () => {
        const sessionModule = require('../modules/session.js');

        it('不正な形式 (記号混入・短すぎる・長すぎる等) の sid は getSession で即座に null となること', () => {
            const badReq1 = { getCookie: () => "' OR '1'='1" };
            const badReq2 = { getCookie: () => "short" };
            const badReq3 = { getCookie: () => "../../../etc/passwd" };
            const badReq4 = { getCookie: () => "a".repeat(200) };

            expect(sessionModule.getSession(badReq1)).toBeNull();
            expect(sessionModule.getSession(badReq2)).toBeNull();
            expect(sessionModule.getSession(badReq3)).toBeNull();
            expect(sessionModule.getSession(badReq4)).toBeNull();
        });
    });

    describe('19. Low-Risk Hardening (Headers, Password Validation, Healthz Masking)', () => {
        const passwordModule = require('../modules/auth/password.js');

        it('デフォルトセキュリティヘッダーに X-Permitted-Cross-Domain-Policies と COOP が含まれること', async () => {
            const req = new Request('http://localhost:3000/');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: true });
            expect(res.headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
            expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
        });

        it('本番モード (isDev: false) で healthCheck.detailed が未指定の場合、内部バージョンやメモリが隠蔽されること', async () => {
            const req = new Request('http://localhost:3000/healthz');
            const res = await handleRequest(req, { baseDir: testProjectDir, frameworkDir, isDev: false });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.status).toBe('ok');
            expect(data.uptime).toBeDefined();
            expect(data.timestamp).toBeDefined();
            expect(data.memory).toBeUndefined();
            expect(data.version).toBeUndefined();
        });

        it('password モジュールで不正な型の入力や巨大な iterations が安全に処理されること', () => {
            expect(() => passwordModule.hash(12345)).toThrow();
            expect(passwordModule.verify(null, {})).toBe(false);
            expect(passwordModule.verify('test', null)).toBe(false);
            expect(passwordModule.verify('test', { salt: 123, hash: 'abc' })).toBe(false);
            expect(passwordModule.verify('test', { salt: 'abc', hash: 123 })).toBe(false);

            // 巨大な iterations が指定されても DoS にならずキャップされること (上限20万回)
            const hashed = passwordModule.hash('password123', 300000);
            expect(passwordModule.verify('password123', hashed)).toBe(true);
        });
    });
});

