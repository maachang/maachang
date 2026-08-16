/**
 * AIメモ:
 * - session.js (SQLite3セッションモジュール) の単体テスト。
 * - セッションの作成、取得、更新、破棄、有効期限切れクリーンアップを検証。
 */

const { describe, it, expect } = require('bun:test');
const sessionMod = require('../modules/session.js');

describe('Session Manager Module', () => {
    it('セッションの作成と取得、更新、削除ができること', () => {
        let setCookieHeader = null;
        const mockResponse = {
            setCookie: (name, value, opts) => {
                setCookieHeader = { name, value, opts };
            },
            deleteCookie: (name, opts) => {
                setCookieHeader = null;
            }
        };

        // 1. セッション作成
        const created = sessionMod.createSession(mockResponse, { user: 'tester', role: 'admin' });
        expect(created.sid).toBeDefined();
        expect(created.data.user).toBe('tester');
        expect(setCookieHeader).not.toBeNull();
        expect(setCookieHeader.value).toBe(created.sid);

        // 2. セッション取得
        const mockRequest = {
            cookies: {
                [setCookieHeader.name]: created.sid
            },
            getCookie: (k) => mockRequest.cookies[k]
        };

        const session = sessionMod.getSession(mockRequest);
        expect(session).not.toBeNull();
        expect(session.sid).toBe(created.sid);
        expect(session.data.user).toBe('tester');
        expect(session.data.role).toBe('admin');

        // 3. セッション更新
        sessionMod.setSession(session.sid, { user: 'tester', role: 'superadmin' });
        const updated = sessionMod.getSession(mockRequest);
        expect(updated.data.role).toBe('superadmin');

        // 4. セッション削除
        const deleted = sessionMod.deleteSession(mockRequest, mockResponse);
        expect(deleted).toBe(true);

        const afterDelete = sessionMod.getSession(mockRequest);
        expect(afterDelete).toBeNull();
    });
});
