/**
 * AIメモ:
 * - 取り込んだ共通モジュール (password, jwt, csrf, rbac, csvReader, csvWriter, validate) の単体テスト。
 */

const { describe, it, expect } = require('bun:test');
const path = require('node:path');

const password = require('../modules/auth/password.js');
const jwt = require('../modules/auth/jwt.js');
const csrf = require('../modules/auth/csrf.js');
const rbac = require('../modules/auth/rbac.js');
const { createCsvReader, readCsv } = require('../modules/csv/csvReader.js');
const { createCsvWriter, createCsv } = require('../modules/csv/csvWriter.js');
const validate = require('../modules/validate/validate.js');
const multipart = require('../modules/http/multipart.js');
const sendSlack = require('../modules/notification/sendSlack.js');
const sendGithub = require('../modules/notification/sendGithub.js');
const corsFilter = require('../modules/auth/corsFilter.js');

describe('Imported Modules Suite', () => {
    describe('1. password.js (PBKDF2-HMAC-SHA256)', () => {
        it('パスワードをハッシュ化し、正しく検証できること', () => {
            const rawPassword = 'mySecretPassword123';
            const hashed = password.hash(rawPassword);

            expect(hashed.salt).toBeDefined();
            expect(hashed.hash).toBeDefined();
            expect(hashed.iterations).toBeGreaterThan(0);

            // 正しいパスワード
            expect(password.verify(rawPassword, hashed)).toBe(true);

            // 誤ったパスワード
            expect(password.verify('wrongPassword', hashed)).toBe(false);
        });
    });

    describe('2. jwt.js (HS256)', () => {
        it('JWT の署名と検証、ペイロード取得ができること', () => {
            const secret = 'super-secret-key-for-test';
            const payload = { userId: 'user123', role: 'editor' };

            const token = jwt.sign(payload, secret, { expiresIn: 3600 });
            expect(typeof token).toBe('string');
            expect(token.split('.').length).toBe(3);

            // 検証成功
            const verified = jwt.verify(token, secret);
            expect(verified).not.toBeNull();
            expect(verified.userId).toBe('user123');
            expect(verified.role).toBe('editor');

            // 誤ったシークレットでの検証失敗
            const invalid = jwt.verify(token, 'wrong-secret');
            expect(invalid).toBeNull();
        });
    });

    describe('3. csrf.js', () => {
        it('セッション連携 CSRF トークンが正しく生成・検証できること', () => {
            const sid = 'session_test_sid_12345';
            const token = csrf.generateToken(sid);
            expect(token).toBeDefined();

            // 正しいトークン
            expect(csrf.verify(sid, token)).toBe(true);

            // 異なるセッションIDでの検証失敗
            expect(csrf.verify('other_sid', token)).toBe(false);

            // 不正トークンでの検証失敗
            expect(csrf.verify(sid, 'invalid_token_xxx')).toBe(false);
        });

        it('リクエストオブジェクトから Cookie とヘッダーを自動取得して検証できること', () => {
            const sid = 'req_session_abc123';
            const validToken = csrf.generateToken(sid);

            const mockReq = {
                cookie: (name) => name === 'maachang_sid' ? sid : null,
                header: (name) => name.toLowerCase() === 'x-csrf-token' ? validToken : null
            };

            // 正常検証
            expect(csrf.verify(mockReq)).toBe(true);

            // トークンが不一致の場合
            const invalidReq = {
                cookie: (name) => name === 'maachang_sid' ? sid : null,
                header: (name) => name.toLowerCase() === 'x-csrf-token' ? 'invalid-token' : null
            };
            expect(csrf.verify(invalidReq)).toBe(false);

            // Cookie がない場合
            const noCookieReq = {
                cookie: () => null,
                header: (name) => validToken
            };
            expect(csrf.verify(noCookieReq)).toBe(false);
        });
    });

    describe('4. csvReader.js & csvWriter.js', () => {
        it('CSV の書き込みと読み込みが相互に正しく動作すること', () => {
            const data = [
                { id: 1, name: '山田 太郎', memo: '改行を含む\nメモ', tag: 'A,B,C' },
                { id: 2, name: '佐藤 "花子"', memo: 'ダブルクォートテスト', tag: 'X' }
            ];

            const csvString = createCsv(['id', 'name', 'memo', 'tag'], data);
            expect(csvString).toContain('id,name,memo,tag');
            expect(csvString).toContain('1,山田 太郎');
            expect(csvString).toContain('"佐藤 ""花子"""');
            expect(csvString).toContain('"A,B,C"');

            // 読み込み
            const parsed = readCsv(csvString);
            expect(parsed.headers).toEqual(['id', 'name', 'memo', 'tag']);
            expect(parsed.rows.length).toBe(2);
            expect(parsed.rows[0].id).toBe('1');
            expect(parsed.rows[0].name).toBe('山田 太郎');
            expect(parsed.rows[0].memo).toBe('改行を含む\nメモ');
            expect(parsed.rows[1].name).toBe('佐藤 "花子"');
        });
    });

    describe('5. validate.js', () => {
        it('スキーマ定義に沿って正常値・異常値が検証されること', () => {
            const schema = {
                name: { type: 'string', required: true, minLen: 2, maxLen: 20 },
                age: { type: 'int', required: true, min: 0, max: 120 },
                email: { type: 'string', pattern: /^.+@.+\..+$/ },
                role: { type: 'string', enum: ['admin', 'user', 'guest'], default: 'user' }
            };

            // 正常系
            const validResult = validate.check({
                name: '田中',
                age: '25',
                email: 'tanaka@example.com'
            }, schema);

            expect(validResult.valid).toBe(true);
            expect(validResult.errors.length).toBe(0);
            expect(validResult.data.role).toBe('user'); // default 補完

            // 異常系
            const invalidResult = validate.check({
                name: 'A', // minLen エラー
                age: 150,  // max エラー
                email: 'invalid-email', // pattern エラー
                role: 'superadmin' // enum エラー
            }, schema);

            expect(invalidResult.valid).toBe(false);
            expect(invalidResult.errors.length).toBe(4);
        });

        it('追加された各種検証ルール (range, mail, url, zip, tel, date, time, alphaNum) が正しく動作すること', () => {
            const schema = {
                score:    { type: 'int', range: [1, 100] },
                email:    { type: 'string', mail: true },
                homepage: { type: 'string', url: true },
                postal:   { type: 'string', zip: true },
                phone:    { type: 'string', tel: true },
                birth:    { type: 'string', date: true },
                alarm:    { type: 'string', time: true },
                code:     { type: 'string', alphaNum: true }
            };

            // 正常系
            const validResult = validate.check({
                score: 85,
                email: 'user@example.co.jp',
                homepage: 'https://example.com/path?foo=bar',
                postal: '100-0001',
                phone: '090-1234-5678',
                birth: '2026-08-19',
                alarm: '07:30:00',
                code: 'ABC123xyz'
            }, schema);

            expect(validResult.valid).toBe(true);
            expect(validResult.errors.length).toBe(0);

            // 異常系
            const invalidResult = validate.check({
                score: 150, // range エラー
                email: 'not-an-email', // mail エラー
                homepage: 'ftp://invalid-url', // url エラー
                postal: '12-34', // zip エラー
                phone: 'abc-def', // tel エラー
                birth: '2026-02-31', // date エラー (無効な日付)
                alarm: '25:99:99', // time エラー
                code: 'hello world!' // alphaNum エラー
            }, schema);

            expect(invalidResult.valid).toBe(false);
            expect(invalidResult.errors.length).toBe(8);

            const ruleErrors = invalidResult.errors.map(e => e.rule);
            expect(ruleErrors).toEqual([
                'range', 'mail', 'url', 'zip', 'tel', 'date', 'time', 'alphaNum'
            ]);
        });
    });

    describe('6. multipart.js', () => {
        it('multipart/form-data のテキストおよびファイルフィールドが正しく抽出されること', () => {
            const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
            const bodyStr = [
                `--${boundary}`,
                'Content-Disposition: form-data; name="comment"',
                '',
                'テストコメントです',
                `--${boundary}`,
                'Content-Disposition: form-data; name="avatar"; filename="test.png"',
                'Content-Type: image/png',
                '',
                'fake-png-binary-data',
                `--${boundary}--`,
                ''
            ].join('\r\n');

            const mockRequest = {
                header: (name) => {
                    if (name.toLowerCase() === 'content-type') {
                        return `multipart/form-data; boundary=${boundary}`;
                    }
                    return null;
                },
                body: () => Buffer.from(bodyStr)
            };

            const parsed = multipart.parse(mockRequest);
            expect(parsed.comment).toBe('テストコメントです');
            expect(parsed.avatar).toBeDefined();
            expect(parsed.avatar.filename).toBe('test.png');
            expect(parsed.avatar.contentType).toBe('image/png');
            expect(parsed.avatar.data.toString()).toBe('fake-png-binary-data');
        });

        it('日本語ファイル名や複数フィールド混在時も安全にパースできること', () => {
            const boundary = '----WebKitFormBoundaryMultiPart999';
            const bodyStr = [
                `--${boundary}`,
                'Content-Disposition: form-data; name="username"',
                '',
                '山田太郎',
                `--${boundary}`,
                'Content-Disposition: form-data; name="memo"',
                '',
                '複数行の\r\nメモテキスト',
                `--${boundary}`,
                'Content-Disposition: form-data; name="doc"; filename="報告書2026.pdf"',
                'Content-Type: application/pdf',
                '',
                '%PDF-1.4 mock binary data',
                `--${boundary}--`,
                ''
            ].join('\r\n');

            const mockRequest = {
                header: () => `multipart/form-data; boundary=${boundary}`,
                body: () => Buffer.from(bodyStr)
            };

            const parsed = multipart.parse(mockRequest);
            expect(parsed.username).toBe('山田太郎');
            expect(parsed.memo).toBe('複数行の\r\nメモテキスト');
            expect(parsed.doc).toBeDefined();
            expect(parsed.doc.filename).toBe('報告書2026.pdf');
            expect(parsed.doc.contentType).toBe('application/pdf');
            expect(parsed.doc.data.toString()).toBe('%PDF-1.4 mock binary data');
        });

        it('Content-Type が multipart/form-data 以外または空ボディの場合は空オブジェクトを返すこと', () => {
            expect(multipart.parse({ header: () => 'application/json', body: () => Buffer.from('{}') })).toEqual({});
            expect(multipart.parse({ header: () => 'multipart/form-data; boundary=xxx', body: () => null })).toEqual({});
        });
    });

    describe('7. sendSlack.js & sendGithub.js', () => {
        it('sendSlack.multi でメッセージのバッファリングとフラッシュができること', () => {
            const multi = sendSlack.multi('#dev-test');
            expect(multi.useMessage()).toBe(false);
            multi.setMessage('メッセージ1');
            multi.setMessage('メッセージ2');
            expect(multi.useMessage()).toBe(true);
            expect(multi.getMessage()).toBe('メッセージ1\nメッセージ2');
            multi.clear();
            expect(multi.useMessage()).toBe(false);
        });

        it('sendSlack.send で Webhook URL に対する POST 送信が実行されること', async () => {
            let receivedPayload = null;
            const testServer = Bun.serve({
                port: 0,
                fetch(req) {
                    return req.json().then(data => {
                        receivedPayload = data;
                        return new Response('ok', { status: 200 });
                    });
                }
            });

            try {
                const webhookUrl = `http://localhost:${testServer.port}/webhook`;
                const res = await sendSlack.send(webhookUrl, 'テスト通知メッセージ');
                expect(res.ok).toBe(true);
                expect(receivedPayload).toEqual({ text: 'テスト通知メッセージ' });
            } finally {
                testServer.stop(true);
            }
        });

        it('sendGithub.createIssue でオブジェクト形式の引数が正しく処理されること', async () => {
            const originalFetch = globalThis.fetch;
            let calledUrl = null;
            let calledHeaders = null;
            try {
                globalThis.fetch = async (url, options) => {
                    calledUrl = url;
                    calledHeaders = options.headers;
                    return new Response(JSON.stringify({
                        html_url: 'https://github.com/my-org/my-repo/issues/42',
                        title: 'エラー報告',
                        number: 42
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                };

                const issue = await sendGithub.createIssue({
                    owner: 'my-org',
                    repo: 'my-repo',
                    token: 'ghp_mock_token_12345',
                    title: 'エラー報告',
                    body: 'エラー本文...',
                    labels: ['bug']
                });

                expect(issue.number).toBe(42);
                expect(issue.title).toBe('エラー報告');
                expect(issue.url).toBe('https://github.com/my-org/my-repo/issues/42');
                expect(calledUrl).toContain('api.github.com/repos/my-org/my-repo/issues');
                expect(calledHeaders['Authorization']).toBe('token ghp_mock_token_12345');
                expect(calledHeaders['User-Agent']).toMatch(/^maachang\//);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('8. rbac.js', () => {
        const customRbac = rbac.create({
            roles: {
                admin: {
                    inherits: ['editor'],
                    permissions: ['*']
                },
                editor: {
                    inherits: ['viewer'],
                    permissions: ['posts:write', 'posts:delete']
                },
                viewer: {
                    inherits: [],
                    permissions: ['posts:read']
                }
            },
            defaultRole: 'viewer'
        });

        it('hasRole でロール判定および階層継承が正しく判定されること', () => {
            const adminUser = { role: 'admin' };
            const editorUser = { role: 'editor' };
            const viewerUser = { role: 'viewer' };

            // admin は editor と viewer を継承
            expect(customRbac.hasRole(adminUser, 'admin')).toBe(true);
            expect(customRbac.hasRole(adminUser, 'editor')).toBe(true);
            expect(customRbac.hasRole(adminUser, 'viewer')).toBe(true);

            // editor は viewer を継承、admin は持たない
            expect(customRbac.hasRole(editorUser, 'editor')).toBe(true);
            expect(customRbac.hasRole(editorUser, 'viewer')).toBe(true);
            expect(customRbac.hasRole(editorUser, 'admin')).toBe(false);

            // viewer は viewer のみ
            expect(customRbac.hasRole(viewerUser, 'viewer')).toBe(true);
            expect(customRbac.hasRole(viewerUser, 'editor')).toBe(false);
        });

        it('hasPermission / can でパーミッションおよびワイルドカードが正しく判定されること', () => {
            const adminUser = { role: 'admin' };
            const editorUser = { role: 'editor' };
            const viewerUser = { role: 'viewer' };

            // viewer は posts:read のみ
            expect(customRbac.can(viewerUser, 'posts:read')).toBe(true);
            expect(customRbac.can(viewerUser, 'posts:write')).toBe(false);

            // editor は posts:write と posts:read(継承) を持つ
            expect(customRbac.can(editorUser, 'posts:read')).toBe(true);
            expect(customRbac.can(editorUser, 'posts:write')).toBe(true);
            expect(customRbac.can(editorUser, 'users:delete')).toBe(false);

            // admin はワイルドカード '*' により全権限を持つ
            expect(customRbac.can(adminUser, 'posts:read')).toBe(true);
            expect(customRbac.can(adminUser, 'users:delete')).toBe(true);
            expect(customRbac.can(adminUser, 'settings:update')).toBe(true);
        });

        it('ユーザー未指定または権限不足時に正しく拒否されること', () => {
            expect(customRbac.can(null, 'posts:read')).toBe(false);
            expect(customRbac.hasRole(null, 'viewer')).toBe(false);
        });
    });

    describe('9. corsFilter.js', () => {
        it('許可オリジンからのリクエストに対して CORS ヘッダーを設定し true を返すこと', () => {
            const headers = {};
            const mockReq = {
                header: (name) => name.toLowerCase() === 'origin' ? 'https://example.com' : null
            };
            const mockRes = {
                header: (name, val) => { headers[name.toLowerCase()] = val; }
            };

            const result = corsFilter.apply({
                request: mockReq,
                response: mockRes,
                origins: ['https://example.com', 'https://admin.example.com'],
                credentials: true
            });

            expect(result).toBe(true);
            expect(headers['access-control-allow-origin']).toBe('https://example.com');
            expect(headers['access-control-allow-credentials']).toBe('true');
            expect(headers['access-control-allow-methods']).toContain('GET');
        });

        it('許可されていないオリジンからのリクエストには false を返すこと', () => {
            const mockReq = {
                header: (name) => name.toLowerCase() === 'origin' ? 'https://malicious.example.org' : null
            };
            const mockRes = {
                header: () => {}
            };

            const result = corsFilter.apply({
                request: mockReq,
                response: mockRes,
                origins: ['https://example.com']
            });

            expect(result).toBe(false);
        });

        it('ワイルドカード "*" を指定した場合は任意のオリジンを許可すること', () => {
            const headers = {};
            const mockReq = {
                header: (name) => name.toLowerCase() === 'origin' ? 'https://any-domain.com' : null
            };
            const mockRes = {
                header: (name, val) => { headers[name.toLowerCase()] = val; }
            };

            const result = corsFilter.apply({
                request: mockReq,
                response: mockRes,
                origins: '*'
            });

            expect(result).toBe(true);
            expect(headers['access-control-allow-origin']).toBe('*');
        });

        it('Origin ヘッダーが無い同一オリジンリクエストは素通り (true) すること', () => {
            const mockReq = {
                header: () => null
            };
            const mockRes = {
                header: () => {}
            };

            const result = corsFilter.apply({
                request: mockReq,
                response: mockRes,
                origins: ['https://example.com']
            });

            expect(result).toBe(true);
        });
    });
});


