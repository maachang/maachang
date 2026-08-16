///////////////////////////////////////////////
// CSRF対策共通ヘルパー.
//
// public/*.mt.js から呼び出して利用する.
// session.js が発行するセッションID(Cookie)にHMAC-SHA256で
// トークンを紐づける、ステートレス方式(トークン自体をS3等に
// 別途保存しない)。ヘッダー方式(X-CSRF-Token)での検証を想定する.
//
// AIメモ:
// - トークンは「セッションID」を秘密鍵(環境変数CSRF_SECRET)で
//   HMAC-SHA256署名した値。session.js側にトークン保存用の変更を
//   加える必要が無く、generateToken()/verify()どちらも都度
//   セッションIDから再計算するだけで完結する.
// - セッションが存在しない(未ログイン)状態でのCSRF検証は意味が
//   無いため、generateToken()はセッション無しの場合null、
//   verify()はセッション無しの場合は必ずfalseを返す.
// - llrtのcrypto.createHmacのみを使用(password.jsと同様の理由。
//   pbkdf2/scrypt等は未サポートのため。詳細はpassword.js参照)。
//   タイミング攻撃対策の定数時間比較もpassword.jsに倣い、
//   crypto.timingSafeEqualではなく自前のXOR比較を用いる.
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = typeof $require === 'function' ? $require('crypto') : require('node:crypto');

    // [環境変数]CSRFトークン署名用シークレット.
    const _SECRET_ENV = "CSRF_SECRET";
    const _getSecret = function () {
        const ret = process.env[_SECRET_ENV];
        if (ret == undefined || ret == null || ret === "") {
            // デフォルトシークレット(本番運用では必ず環境変数を設定すること).
            return "minto-default-csrf-secret";
        }
        return ret;
    };

    // [環境変数]CSRF検証用リクエストヘッダー名.
    const _HEADER_NAME_ENV = "CSRF_HEADER_NAME";
    const _getHeaderName = function () {
        const ret = process.env[_HEADER_NAME_ENV];
        if (ret == undefined || ret == null || ret === "") {
            return "x-csrf-token";
        }
        return ret;
    };

    // [環境変数]セッションCookie名(session.json / session.js と連携).
    const _COOKIE_SESSION_NAME_ENV = "MINTO_COOKIE_SESSION_NAME";
    const _getSid = function (customReq) {
        let req = customReq;
        if (!req && typeof $request === 'function') {
            req = $request();
        } else if (!req && typeof $request === 'object') {
            req = $request;
        }
        if (!req) return null;
        const name = process.env[_COOKIE_SESSION_NAME_ENV] || "maachang_sid";
        return (typeof req.cookie === 'function' ? req.cookie(name) : (typeof req.getCookie === 'function' ? req.getCookie(name) : (req.cookies ? req.cookies[name] : null)));
    };

    // セッションIDからHMAC-SHA256でトークン(hex文字列)を算出.
    const _computeToken = function (sid) {
        return crypto.createHmac("sha256", _getSecret())
            .update(sid).digest("hex");
    };

    // タイミング攻撃を避けるための定数時間文字列比較.
    const _timingSafeEqual = function (a, b) {
        if (typeof a != "string" || typeof b != "string" ||
            a.length != b.length) {
            return false;
        }
        let diff = 0;
        const len = a.length;
        for (let i = 0; i < len; i++) {
            diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return diff === 0;
    };

    // 現在のセッションに紐づくCSRFトークンを算出します.
    // sid: 明示的なセッションID (省略時はリクエストCookieから自動取得)
    exports.generateToken = function (sid) {
        const targetSid = sid || _getSid();
        if (targetSid == null || targetSid === "") {
            return null;
        }
        return _computeToken(targetSid);
    };

    // リクエストヘッダーまたは引数のトークンを検証します.
    // verify(sid, token) または verify(req) または verify()
    exports.verify = function (arg1, arg2) {
        let sid, token;
        if (typeof arg1 === 'string' && typeof arg2 === 'string') {
            sid = arg1;
            token = arg2;
        } else {
            const req = (arg1 && typeof arg1 === 'object') ? arg1 : (typeof $request === 'function' ? $request() : (typeof $request === 'object' ? $request : null));
            if (!req) return false;
            sid = _getSid(req);
            const headerName = _getHeaderName();
            token = typeof req.header === 'function' ? req.header(headerName) : (typeof req.getHeader === 'function' ? req.getHeader(headerName) : (req.headers ? req.headers[headerName] : null));
        }

        if (sid == null || sid === "" || token == null || token === "") {
            return false;
        }
        const expected = _computeToken(sid);
        return _timingSafeEqual(token, expected);
    };
    exports.computeToken = _computeToken;
})();
