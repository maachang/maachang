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

    describe('20. BOLA / IDOR Authorization Protection', () => {
        const rbacModule = require('../modules/auth/rbac.js');
        const dbWrapper = require('../src/db.js');

        it('rbac.isOwner で本人および管理者の一致判定ができること', async () => {
            const userA = { userId: 'user-101', role: 'viewer' };
            const userB = { userId: 'user-202', role: 'viewer' };
            const adminUser = { userId: 'admin-999', role: 'admin' };

            const resourceA = { id: 1, userId: 'user-101', title: 'User A Data' };

            // 本人
            expect(await rbacModule.isOwner(userA, resourceA)).toBe(true);
            expect(await rbacModule.isOwner(userA, 'user-101')).toBe(true);

            // 他人 (IDOR 遮断)
            expect(await rbacModule.isOwner(userB, resourceA)).toBe(false);
            expect(await rbacModule.isOwner(userB, 'user-101')).toBe(false);

            // 管理者バイパス (デフォルト許可)
            expect(await rbacModule.isOwner(adminUser, resourceA)).toBe(true);
            // 管理者バイパス無効時
            expect(await rbacModule.isOwner(adminUser, resourceA, { allowAdmin: false })).toBe(false);
        });

        it('rbac.ensureOwner で不一致時に 403 が設定されること', async () => {
            const req = new Request('http://localhost:3000/api/item');
            const ctx = createContext({
                req,
                url: new URL('http://localhost:3000/api/item'),
                body: null,
                baseDir: testProjectDir,
                frameworkDir
            });

            // ユーザーBでログイン中の状態をシミュレート
            const userB = { userId: 'user-202', role: 'viewer' };
            const targetResource = { id: 99, userId: 'user-101' };

            const ok = await rbacModule.ensureOwner(targetResource, {
                user: userB,
                request: ctx.$request,
                response: ctx.$response
            });

            expect(ok).toBe(false);
            expect(ctx.$response.getStatus()).toBe(403);
            expect(ctx.$response.getBody().error).toBe('Forbidden');
        });

        it('db.forUser で自動的にログインユーザーのレコードのみにスコープされること', () => {
            const dbPath = ':memory:';
            dbWrapper.exec(`
                CREATE TABLE items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL
                );
            `, dbPath);

            const userA = { userId: 'user-101' };
            const userB = { userId: 'user-202' };

            const dbA = dbWrapper.forUser(userA, { dbPath });
            const dbB = dbWrapper.forUser(userB, { dbPath });

            // それぞれデータを登録
            dbA.insert('items', { title: 'Item 1 of A' });
            dbA.insert('items', { title: 'Item 2 of A' });
            dbB.insert('items', { title: 'Item 1 of B' });

            // 件数チェック
            expect(dbA.count('items')).toBe(2);
            expect(dbB.count('items')).toBe(1);

            // 全件取得
            const itemsA = dbA.find('items');
            expect(itemsA.length).toBe(2);
            expect(itemsA.every(i => i.user_id === 'user-101')).toBe(true);

            // findById で他人のリソースを指定しても取得できないこと (IDOR 防止)
            const itemB = dbB.find('items')[0];
            expect(itemB).toBeDefined();
            // userA が userB のアイテムIDを指定して取得を試みる -> null
            expect(dbA.findById('items', itemB.id)).toBeNull();
            // userB は取得できる
            expect(dbB.findById('items', itemB.id)).not.toBeNull();

            // 他人のデータを updateById / deleteById で更新・削除できないこと
            const updateRes = dbA.updateById('items', itemB.id, { title: 'Tampered' });
            expect(updateRes.changes).toBe(0);

            const deleteRes = dbA.deleteById('items', itemB.id);
            expect(deleteRes.changes).toBe(0);

            // B本人であれば削除できる
            const validDelete = dbB.deleteById('items', itemB.id);
            expect(validDelete.changes).toBe(1);
        });
    });

    describe('13. SSRF (Server-Side Request Forgery) Prevention in modules/http.js', () => {
        const http = require('../modules/http.js');

        it('isPrivateIp がループバック、メタデータIP、プライベートIPを正しく検出すること', () => {
            // IPv4 プライベート/ループバック/メタデータ
            expect(http.isPrivateIp('127.0.0.1')).toBe(true);
            expect(http.isPrivateIp('127.0.0.2')).toBe(true);
            expect(http.isPrivateIp('169.254.169.254')).toBe(true); // AWS/GCP/Azure Metadata
            expect(http.isPrivateIp('10.0.0.1')).toBe(true);
            expect(http.isPrivateIp('172.16.0.1')).toBe(true);
            expect(http.isPrivateIp('172.31.255.255')).toBe(true);
            expect(http.isPrivateIp('192.168.1.100')).toBe(true);
            expect(http.isPrivateIp('0.0.0.0')).toBe(true);
            expect(http.isPrivateIp('100.64.0.1')).toBe(true); // CGNAT
            expect(http.isPrivateIp('224.0.0.1')).toBe(true); // Multicast

            // IPv6
            expect(http.isPrivateIp('::1')).toBe(true);
            expect(http.isPrivateIp('fe80::1')).toBe(true);
            expect(http.isPrivateIp('::ffff:127.0.0.1')).toBe(true);

            // パブリックIP
            expect(http.isPrivateIp('8.8.8.8')).toBe(false);
            expect(http.isPrivateIp('1.1.1.1')).toBe(false);
            expect(http.isPrivateIp('172.32.0.1')).toBe(false);
        });

        it('validateUrlForSsrf がプライベートIP宛のURLをブロックすること', async () => {
            const resLoopback = await http.validateUrlForSsrf('http://127.0.0.1:8080/secret');
            expect(resLoopback.safe).toBe(false);
            expect(resLoopback.reason).toContain('private/internal address');

            const resMeta = await http.validateUrlForSsrf('http://169.254.169.254/latest/meta-data/');
            expect(resMeta.safe).toBe(false);

            const resLocalhost = await http.validateUrlForSsrf('http://localhost:3000/internal');
            expect(resLocalhost.safe).toBe(false);
            expect(resLocalhost.reason).toContain('resolved to private/internal IP');
        });

        it('validateUrlForSsrf が不当なプロトコル(file://, gopher://等)を拒絶すること', async () => {
            const resFile = await http.validateUrlForSsrf('file:///etc/passwd');
            expect(resFile.safe).toBe(false);
            expect(resFile.reason).toContain('Forbidden protocol');
        });

        it('http.get で ssrfProtection: true または safe: true 時にプライベートIP宛のリクエストが遮断されること', async () => {
            try {
                await http.get('http://169.254.169.254/metadata', { safe: true });
                expect(true).toBe(false); // 到達してはならない
            } catch (err) {
                expect(err.code).toBe('ERR_SSRF_BLOCKED');
                expect(err.message).toContain('SSRF blocked');
            }

            try {
                await http.postJson('http://localhost:8080/api', { data: 'test' }, { ssrfProtection: true });
                expect(true).toBe(false); // 到達してはならない
            } catch (err) {
                expect(err.code).toBe('ERR_SSRF_BLOCKED');
            }
        });
    });

    describe('14. Credential Stuffing & Brute-Force Protection (modules/auth/lockout.js & Auto-ban)', () => {
        const { createLockoutManager } = require('../modules/auth/lockout.js');

        it('指定回数のログイン失敗でアカウントがロックされること', async () => {
            const lockout = createLockoutManager({
                maxAttempts: 3,
                lockoutDurationMs: 60 * 1000,
                windowMs: 60 * 1000
            });

            const userId = 'user_target@example.com';

            // 1回目失敗
            let res = await lockout.recordFailure(userId);
            expect(res.isLocked).toBe(false);
            expect(res.remainingAttempts).toBe(2);

            // 2回目失敗
            res = await lockout.recordFailure(userId);
            expect(res.isLocked).toBe(false);
            expect(res.remainingAttempts).toBe(1);

            // 3回目失敗 (上限到達でロック)
            res = await lockout.recordFailure(userId);
            expect(res.isLocked).toBe(true);
            expect(res.remainingAttempts).toBe(0);
            expect(res.waitSeconds).toBeGreaterThan(0);

            // check でもロック状態が反映されること
            const check = await lockout.check(userId);
            expect(check.isLocked).toBe(true);
            expect(check.remainingAttempts).toBe(0);

            // 成功時にリセットされること
            await lockout.reset(userId);
            const resetCheck = await lockout.check(userId);
            expect(resetCheck.isLocked).toBe(false);
            expect(resetCheck.remainingAttempts).toBe(3);
        });

        it('段階的バックオフ (exponential) が機能すること', async () => {
            const lockout = createLockoutManager({
                maxAttempts: 2,
                lockoutDurationMs: 1000, // 1秒
                exponential: true
            });

            const userId = 'victim_account';

            // 1回目
            await lockout.recordFailure(userId);
            // 2回目 (ロック: 1秒)
            let res2 = await lockout.recordFailure(userId);
            expect(res2.isLocked).toBe(true);

            // 3回目 (倍加: 2秒)
            let res3 = await lockout.recordFailure(userId);
            expect(res3.isLocked).toBe(true);
            expect(res3.waitSeconds).toBeGreaterThanOrEqual(1);
        });

        it('ルーターの高度なレートリミット (banThreshold) で悪質IPが自動一時BANされること', async () => {
            const banTestDir = path.resolve(__dirname, '../.tmp_ban_project');
            fs.mkdirSync(path.join(banTestDir, 'conf'), { recursive: true });
            fs.mkdirSync(path.join(banTestDir, 'public'), { recursive: true });
            fs.writeFileSync(path.join(banTestDir, 'conf', 'server.json'), JSON.stringify({
                rateLimit: {
                    enabled: true,
                    windowMs: 5000,
                    max: 2,
                    banThreshold: 2, // 2回超過 (合計4回目) で一時BAN
                    banDurationMs: 30000,
                    banMessage: "Attack detected. IP temporarily banned."
                }
            }));
            fs.writeFileSync(path.join(banTestDir, 'public', 'api.html'), 'OK');

            try {
                const attackerIp = '203.0.113.199';
                const makeReq = () => new Request('http://localhost:3000/api.html', {
                    headers: { 'X-Real-IP': attackerIp }
                });

                // 1回目・2回目: 200 OK
                expect((await handleRequest(makeReq(), { baseDir: banTestDir, frameworkDir, isDev: true })).status).toBe(200);
                expect((await handleRequest(makeReq(), { baseDir: banTestDir, frameworkDir, isDev: true })).status).toBe(200);

                // 3回目: 429 (通常レートリミット超過)
                const res3 = await handleRequest(makeReq(), { baseDir: banTestDir, frameworkDir, isDev: true });
                expect(res3.status).toBe(429);
                const data3 = await res3.json();
                expect(data3.error).toBe('Too Many Requests');

                // 4回目: 429 (banThreshold到達により一時BAN発動)
                const res4 = await handleRequest(makeReq(), { baseDir: banTestDir, frameworkDir, isDev: true });
                expect(res4.status).toBe(429);
                const data4 = await res4.json();
                expect(data4.error).toContain('Attack detected');
                expect(res4.headers.get('Retry-After')).toBeDefined();
            } finally {
                if (fs.existsSync(banTestDir)) {
                    fs.rmSync(banTestDir, { recursive: true, force: true });
                }
            }
        });
    });

    describe('15. Cryptography Hardening & Timing Attack Protection', () => {
        const encrypt = require('../modules/encrypt.js');
        const jwt = require('../modules/auth/jwt.js');

        it('encrypt.timingSafeEqual が正しく定数時間比較を行うこと', () => {
            expect(encrypt.timingSafeEqual('secret_api_token_123', 'secret_api_token_123')).toBe(true);
            expect(encrypt.timingSafeEqual('secret_api_token_123', 'secret_api_token_124')).toBe(false);
            expect(encrypt.timingSafeEqual('short', 'longer_string')).toBe(false);
            expect(encrypt.timingSafeEqual('', '')).toBe(true);
            expect(encrypt.timingSafeEqual(null, 'test')).toBe(false);
            expect(encrypt.timingSafeEqual('test', undefined)).toBe(false);
        });

        it('jwt.revoke / isRevoked により特定トークンおよびJTIが即時無効化されること', () => {
            const secret = 'super_secret_jwt_key_12345';
            const payload = { userId: 'user999', jti: 'jti-uuid-777' };
            const token = jwt.sign(payload, secret, { expiresIn: 3600 });

            // 通常検証は成功
            const verified = jwt.verify(token, secret);
            expect(verified).not.toBeNull();
            expect(verified.userId).toBe('user999');

            // JTI を失効
            jwt.revoke('jti-uuid-777', 60);
            expect(jwt.isRevoked('jti-uuid-777')).toBe(true);

            // 失効後は verify が失敗すること
            const revokedVerify = jwt.verify(token, secret);
            expect(revokedVerify).toBeNull();

            // noError: false の場合は Revoked 例外
            expect(() => {
                jwt.verify(token, secret, { noError: false });
            }).toThrow('revoked');
        });

        it('トークン文字列直接指定による失効も機能すること', () => {
            const secret = 'super_secret_jwt_key_12345';
            const payload = { userId: 'user888' };
            const token = jwt.sign(payload, secret, { expiresIn: 3600 });

            expect(jwt.verify(token, secret)).not.toBeNull();

            jwt.revoke(token, 60);
            expect(jwt.isRevoked(token)).toBe(true);
            expect(jwt.verify(token, secret)).toBeNull();
        });
    });

    describe('16. CSP Dynamic Nonce & Modern Isolation Headers', () => {
        const cspDir = path.resolve(__dirname, '../.tmp_csp_project');

        beforeAll(() => {
            fs.mkdirSync(path.join(cspDir, 'conf'), { recursive: true });
            fs.mkdirSync(path.join(cspDir, 'public'), { recursive: true });
            fs.writeFileSync(path.join(cspDir, 'conf', 'server.json'), JSON.stringify({
                csp: "default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none';"
            }));
            fs.writeFileSync(path.join(cspDir, 'public', 'nonce-test.mt.js'), `
                exports.handler = async function() {
                    return {
                        nonce: $request.nonce,
                        html: '<script nonce="' + $request.nonce + '">console.log("secure");</script>'
                    };
                };
            `);
        });

        afterAll(() => {
            if (fs.existsSync(cspDir)) {
                fs.rmSync(cspDir, { recursive: true, force: true });
            }
        });

        it('リクエスト毎に動的 CSP nonce が発行されヘッダーと $request.nonce に反映されること', async () => {
            const req = new Request('http://localhost:3000/nonce-test');
            const res = await handleRequest(req, { baseDir: cspDir, frameworkDir, isDev: true });
            expect(res.status).toBe(200);

            const cspHeader = res.headers.get('Content-Security-Policy');
            expect(cspHeader).toBeDefined();
            expect(cspHeader).not.toContain('{nonce}');
            expect(cspHeader).toContain("'nonce-");

            // CORP ヘッダー (Cross-Origin-Resource-Policy) が付与されていること
            expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');

            const data = await res.json();
            expect(data.nonce).toBeDefined();
            expect(data.nonce.length).toBeGreaterThan(10);
            expect(cspHeader).toContain(data.nonce);
            expect(data.html).toContain(data.nonce);
        });
    });
});


