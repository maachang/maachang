/**
 * AIメモ:
 * - encrypt.js: AES-256-GCM による可逆暗号化・復号、ランダムトークン生成ユーティリティ。
 * - ゼロ依存 (Node/Bun 標準の node:crypto のみ)。
 * - 主な機能:
 *   - encrypt(plainText, key): AES-256-GCM 暗号化 (改ざん検知 AuthTag 付き)
 *   - decrypt(cipherText, key): 復号 (改ざん時は null を返却)
 *   - randomToken(len): URL セーフなランダムトークン生成
 *   - sha256(text): SHA-256 ハッシュ文字列生成
 *   - hmac(text, key): HMAC-SHA256 署名生成
 * - CommonJS 形式。
 */

'use strict';

const crypto = typeof $require === 'function' ? $require('crypto') : require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推奨 IV 長 (12 bytes)

/**
 * 任意の長さの暗号化キーを 32 バイト (256 bits) の Buffer に正規化
 * @param {string|Buffer} secretKey 
 * @returns {Buffer}
 */
function normalizeKey(secretKey) {
    if (Buffer.isBuffer(secretKey) && secretKey.length === 32) {
        return secretKey;
    }
    return crypto.createHash('sha256').update(String(secretKey)).digest();
}

/**
 * 平文を AES-256-GCM で暗号化
 * @param {string|Object} plainText 
 * @param {string|Buffer} secretKey 
 * @returns {string} 'iv:authTag:cipherText' 形式の hex 文字列
 */
function encrypt(plainText, secretKey) {
    if (plainText === null || plainText === undefined) return '';
    const text = typeof plainText === 'object' ? JSON.stringify(plainText) : String(plainText);
    const key = normalizeKey(secretKey);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    const ivHex = iv.toString('hex');

    return `${ivHex}:${authTag}:${encrypted}`;
}

/**
 * 暗号化文字列を復号
 * @param {string} encryptedString 'iv:authTag:cipherText' 形式
 * @param {string|Buffer} secretKey 
 * @returns {string|null} 復号された平文文字列 (鍵の不一致や改ざん時は null)
 */
function decrypt(encryptedString, secretKey) {
    if (!encryptedString || typeof encryptedString !== 'string') return null;
    const parts = encryptedString.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;

    try {
        const key = normalizeKey(secretKey);
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

/**
 * セキュアなランダムトークンを生成
 * @param {number} [length=32] 
 * @returns {string}
 */
function randomToken(length = 32) {
    const bytes = Math.ceil(length * 0.75);
    return crypto.randomBytes(bytes).toString('base64url').slice(0, length);
}

/**
 * SHA-256 ハッシュ値を計算 (hex)
 * @param {string|Buffer} text 
 * @returns {string}
 */
function sha256(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * HMAC-SHA256 署名を計算 (hex)
 * @param {string|Buffer} text 
 * @param {string|Buffer} key 
 * @returns {string}
 */
function hmac(text, key) {
    return crypto.createHmac('sha256', String(key)).update(String(text)).digest('hex');
}

module.exports = {
    encrypt,
    decrypt,
    randomToken,
    sha256,
    hmac
};
