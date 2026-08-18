/**
 * AIメモ:
 * - format.js, encrypt.js, http.js の単体テスト。
 */

const { describe, it, expect } = require('bun:test');

const format = require('../modules/format.js');
const encrypt = require('../modules/encrypt.js');
const http = require('../modules/http.js');

describe('Additional Utilities Suite (format, encrypt, http)', () => {
    describe('1. format.js', () => {
        it('金額・カンマ区切り (money) が正しく動作すること', () => {
            expect(format.money(1234567)).toBe('1,234,567');
            expect(format.money(100)).toBe('100');
            expect(format.money(1234567.89, '¥')).toBe('¥1,234,567.89');
            expect(format.money(null)).toBe('');
        });

        it('金額文字列の逆変換 (parseMoney / unmoney) が正しく動作すること', () => {
            expect(format.parseMoney('1,234,567')).toBe(1234567);
            expect(format.parseMoney('¥1,234,567.89')).toBe(1234567.89);
            expect(format.parseMoney(' ￥ 1,000 円 ')).toBe(1000);
            expect(format.parseMoney('１,２３４,５６７')).toBe(1234567); // 全角
            expect(format.parseMoney('-1,234')).toBe(-1234);
            expect(format.parseMoney('▲1,234.5')).toBe(-1234.5);
            expect(format.parseMoney('(500)')).toBe(-500);
            expect(format.parseMoney('', 0)).toBe(0);
            expect(format.parseMoney('invalid', -1)).toBe(-1);
            expect(format.unmoney('$9,999')).toBe(9999);
        });

        it('全角・半角変換 (toHalfWidth, toFullWidth) が正しく動作すること', () => {
            expect(format.toHalfWidth('ＡＢＣ　１２３！')).toBe('ABC 123!');
            expect(format.toFullWidth('ABC 123!')).toBe('ＡＢＣ　１２３！');
        });

        it('ひらがな・カタカナ変換 (toHiragana, toKatakana) が正しく動作すること', () => {
            expect(format.toHiragana('テストカタカナ')).toBe('てすとかたかな');
            expect(format.toKatakana('てすとかたかな')).toBe('テストカタカナ');
        });

        it('バイト数表記 (bytes) が正しく動作すること', () => {
            expect(format.bytes(0)).toBe('0 B');
            expect(format.bytes(1024)).toBe('1 KB');
            expect(format.bytes(1048576)).toBe('1 MB');
            expect(format.bytes(1536000, 2)).toBe('1.46 MB');
        });

        it('伏字 (mask) と切り詰め (truncate) が正しく動作すること', () => {
            expect(format.mask('09012345678', 3, 4)).toBe('090****5678');
            expect(format.mask('short', 3, 4)).toBe('*****');

            expect(format.truncate('吾輩は猫である。名前はまだ無い。', 6)).toBe('吾輩は猫であ...');
            expect(format.truncate('短い文章', 10)).toBe('短い文章');
        });
    });

    describe('2. encrypt.js (AES-256-GCM)', () => {
        it('平文の暗号化と復号が正しく行えること', () => {
            const secretKey = 'my-super-secret-system-key-2026';
            const plainText = 'CreditCardNumber: 1234-5678-9012-3456';

            const encrypted = encrypt.encrypt(plainText, secretKey);
            expect(encrypted).not.toBe(plainText);
            expect(encrypted.split(':').length).toBe(3); // iv:tag:ciphertext

            const decrypted = encrypt.decrypt(encrypted, secretKey);
            expect(decrypted).toBe(plainText);
        });

        it('異なる秘密鍵や改ざんされた暗号文は復号失敗 (null) となること', () => {
            const secretKey = 'correct-key';
            const encrypted = encrypt.encrypt('secret-data', secretKey);

            // 誤った鍵
            expect(encrypt.decrypt(encrypted, 'wrong-key')).toBeNull();

            // 改ざんされた暗号文 (末尾の文字を反転)
            const lastChar = encrypted.slice(-1);
            const tampered = encrypted.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');
            expect(encrypt.decrypt(tampered, secretKey)).toBeNull();
        });

        it('ランダムトークンとハッシュ関数が正しく動作すること', () => {
            const token1 = encrypt.randomToken(32);
            const token2 = encrypt.randomToken(32);
            expect(token1.length).toBe(32);
            expect(token1).not.toBe(token2);

            expect(encrypt.sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
            expect(encrypt.hmac('hello', 'key')).toBeDefined();
        });
    });

    describe('3. http.js', () => {
        it('appendQuery で正しくクエリが付与されること', () => {
            const url = http.appendQuery('https://api.example.com/search', { q: 'bun', page: 1 });
            expect(url).toBe('https://api.example.com/search?q=bun&page=1');
        });

        it('ローカル Bun サーバーに対して GET / POST が正しく送受信できること', async () => {
            const testServer = Bun.serve({
                port: 0,
                async fetch(req) {
                    const url = new URL(req.url);
                    if (url.pathname === '/test-json' && req.method === 'POST') {
                        const body = await req.json();
                        return Response.json({ received: body, ok: true });
                    }
                    return Response.json({ message: 'get-ok', query: url.searchParams.get('test') });
                }
            });

            try {
                const baseUrl = `http://localhost:${testServer.port}`;

                // GET
                const getRes = await http.getJson(`${baseUrl}/test-get`, { query: { test: '123' } });
                expect(getRes.message).toBe('get-ok');
                expect(getRes.query).toBe('123');

                // POST JSON
                const postRes = await http.postJson(`${baseUrl}/test-json`, { foo: 'bar', num: 42 });
                expect(postRes.ok).toBe(true);
                expect(postRes.received.foo).toBe('bar');
                expect(postRes.received.num).toBe(42);
            } finally {
                testServer.stop();
            }
        });
    });
});
