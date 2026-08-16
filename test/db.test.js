/**
 * AIメモ:
 * - db.js (SQLite3ラッパー) の単体テスト。
 * - メモリDB (:memory:) を用いたCRUD・トランザクション検証。
 */

const { describe, it, expect, beforeEach } = require('bun:test');
const db = require('../src/db.js');

describe('SQLite DB Wrapper', () => {
    const testDb = ':memory:';

    beforeEach(() => {
        db.exec('DROP TABLE IF EXISTS users;', testDb);
        db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER);', testDb);
    });

    it('run / get / all が正しく動作すること', () => {
        // INSERT
        const insertRes = db.run('INSERT INTO users (name, age) VALUES (?, ?)', ['Alice', 25], testDb);
        expect(insertRes.changes).toBe(1);

        db.run('INSERT INTO users (name, age) VALUES (?, ?)', ['Bob', 30], testDb);

        // GET
        const alice = db.get('SELECT * FROM users WHERE name = ?', ['Alice'], testDb);
        expect(alice).not.toBeNull();
        expect(alice.name).toBe('Alice');
        expect(alice.age).toBe(25);

        // ALL
        const allUsers = db.all('SELECT * FROM users ORDER BY id ASC', [], testDb);
        expect(allUsers.length).toBe(2);
        expect(allUsers[0].name).toBe('Alice');
        expect(allUsers[1].name).toBe('Bob');
    });

    it('transaction が正しく動作すること', () => {
        db.transaction(() => {
            db.run('INSERT INTO users (name, age) VALUES (?, ?)', ['User1', 20], testDb);
            db.run('INSERT INTO users (name, age) VALUES (?, ?)', ['User2', 22], testDb);
        }, testDb);

        const users = db.all('SELECT * FROM users', [], testDb);
        expect(users.length).toBe(2);
    });
});
