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
});
