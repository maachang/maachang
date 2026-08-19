# maachang 標準モジュールリファレンス (`modules/`)

maachang が標準提供しているモジュール群のリファレンスです。  
すべてのモジュールは **外部 npm 依存ゼロ（Zero Dependency）** で動作し、`.mt.js`、`filter.mt.js`、`JHTML` 内から `$loadLib("モジュール名.js")` で即座に呼び出すことができます。

---

## 📚 モジュール一覧

| カテゴリ | モジュール名 | 説明・主な機能 |
|---|---|---|
| **コア・セッション** | [`session.js`](#1-sessionjs-sqlite3-セッション管理) | SQLite3 (`bun:sqlite`) による高速セッション管理 |
| **ロガー** | [`logger.js`](#2-loggerjs--locallogjs-日別ローテーションロガー) / `localLog.js` | 日別ローテーションファイル出力付き構造化ロガー |
| **日時操作** | [`dateEx.js`](#3-dateexjs-日時操作フォーマット期間計算) | UTC時差罠を解消した日付加減算・フォーマット・期間判定 |
| **データ整形** | [`format.js`](#4-formatjs-日本語データ整形) | 金額カンマ区切り、全角半角・カナ変換、バイト表記、マスキング |
| **暗号・セキュリティ** | [`encrypt.js`](#5-encryptjs-aes-256-gcm-可逆暗号化) | AES-256-GCM による可逆暗号化・復号、ランダムトークン生成 |
| | [`auth/password.js`](#6-authpasswordjs-パスワードハッシュ) | PBKDF2-HMAC-SHA256 による安全なパスワードハッシュ化・照合 |
| | [`auth/jwt.js`](#7-authjwtjs-jwt-トークン管理) | HS256 による JWT 署名（sign）・検証（verify） |
| | [`auth/csrf.js`](#8-authcsrfjs-csrf-トークン管理) | セッション連携 CSRF トークン生成・検証 |
| | [`auth/rbac.js`](#9-authrbacjs-ロールベースアクセス制御) | ロール階層・権限チェック・ルートガード |
| | [`auth/corsFilter.js`](#10-authcorsfilterjs-cors-制御) | CORS プリフライト（OPTIONS）およびヘッダー設定 |
| **CSV 操作** | [`csv/csvWriter.js`](#11-csvcsvwriterjs-csv-書き込み) | 配列/オブジェクト ➔ CSV 文字列変換（エスケープ自動処理） |
| | [`csv/csvReader.js`](#12-csvcsvreaderjs-csv-読み込み) | 改行・ダブルクォート対応の安全な CSV パース ＆ JSON 行変換 |
| **バリデーション** | [`validate/validate.js`](#13-validatevalidatejs-スキーマバリデーション) | スキーマ定義による入力値検証（型・必須・文字数・範囲・正規表現） |
| **通信・通知** | [`http.js`](#14-httpjs-http-クライアント) | タイムアウト・自動リトライ・JSON 送受信対応の fetch ラッパー |
| | [`notification/sendSlack.js`](#15-notificationsendslackjs-slack-通知) | Incoming Webhook / Bot Token による Slack 通知送信 |
| | [`notification/sendGithub.js`](#16-notificationsendgithubjs-github-issue-作成) | GitHub Issue の自動起票 |
| | [`http/multipart.js`](#17-httpmultipartjs-ファイルアップロード解析) | `multipart/form-data` によるファイルアップロードの解析 |
| **ファイル・JSON** | [`fileUtil.js`](#18-fileutiljs-ファイルjson-入出力支援) | 安全な JSON 読み書き、ファイル一覧、安全なファイル名生成 |

---

## 🔍 ロード方法 (`$loadLib`)

maachang の実行コンテキストでは、プロジェクト側 `lib/` および `validates/` を最優先し、見つからない場合は `modules/` 直下およびサブディレクトリ（`auth/`, `csv/`, `validate/` 等）を自動探索します。

```javascript
// サブディレクトリ名を省略してフラットに指定可能
const session = $loadLib('session.js');
const password = $loadLib('password.js');       // modules/auth/password.js を解決
const { createCsv } = $loadLib('csvWriter.js'); // modules/csv/csvWriter.js を解決
const validate = $loadLib('validate.js');       // modules/validate/validate.js を解決
const userSchema = $loadLib('validates/user.js'); // プロジェクトの validates/user.js を解決
```

---

## 📖 各モジュールの詳細仕様

### 1. `session.js` (SQLite3 セッション管理)
`bun:sqlite` を利用した軽量・高速なセッション管理モジュールです。

```javascript
const sessionMod = $loadLib('session.js');

// 1. セッション新規作成 (Set-Cookie ヘッダーも自動発行)
const session = sessionMod.createSession($response, { userId: 100, role: 'admin' });

// 2. セッション取得 (Cookie から sid を特定し、期限切れなら自動削除 & null 返却)
const current = sessionMod.getSession($request);
if (current) {
    console.log(current.sid, current.data.userId);
}

// 3. セッションデータ更新
sessionMod.setSession(current.sid, { userId: 100, role: 'admin', lastLogin: new Date() });

// 4. セッション削除 (Cookie も削除)
sessionMod.deleteSession($request, $response);

// 5. 期限切れセッションの一括クリーンアップ
sessionMod.cleanExpiredSessions();
```

---

### 2. `logger.js` / `localLog.js` (日別ローテーションロガー)
標準出力および日別ログファイル（`./log/logout.YYYY-MM-DD.log`）へ自動書き込みするロガーです。

```javascript
const logger = $loadLib('logger.js');

logger.trace('詳細トレース: %o', debugObj);
logger.debug('デバッグメッセージ');
logger.info('ユーザーがログインしました: id=%s', userId);
logger.warn('警告メッセージ: code=%d', 404);
logger.error('システムエラー発生:', err);

// 設定変更 (conf/log.json による自動読み込みにも対応)
logger.setting({
    dir: './log',
    file: 'app',      // ./log/app.YYYY-MM-DD.log
    level: 'info',    // trace | debug | info | warn | error
    stdout: true      // コンソールにも出力するか
});
```

---

### 3. `dateEx.js` (日時操作・フォーマット・期間計算)
JavaScript 標準の `Date` が抱える **「ハイフン区切り (`2025-01-01`) だと UTC 扱いになって 9 時間ズレる罠」を完全に解消** した拡張日時ユーティリティです。

```javascript
const DateEx = $loadLib('dateEx.js');

// 1. 生成 (ハイフン/スラッシュ/8桁/日本語日付のすべてを「ローカル0時」として統一パース)
const d1 = DateEx('2025-01-01'); // 2025-01-01 00:00:00 (9時にならない！)
const d2 = DateEx('2025/01/01');
const d3 = DateEx('20250101');
const now = DateEx();

// 2. 日時加減算 (チェーン可能)
const nextMonth = DateEx().change('month', 1).change('date', -3).change('hours', 2);

// 3. リセット (月初・0時0分0秒へのクリア)
const startOfDay = DateEx().clear('hours'); // 今日の 00:00:00.000
const startOfMonth = DateEx().clear('date'); // 今月1日の 00:00:00.000

// 4. フォーマット出力
now.toString('date'); // "2026-08-16"
now.toFormatString('{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}'); // "2026/08/16(日) 15:20:00"
now.toFormatString('{yyyy}-{MM}-{dd} [{dw}]'); // "2026-08-16 [Sun]"

// 5. 期間計算 & 範囲内外判定
const monthRange = DateEx.between(now, 'month');
monthRange.isBetween('2026-08-15'); // true
monthRange.isBetween('2026-09-01'); // false
```

---

### 4. `format.js` (日本語・データ整形)
業務画面や帳票で頻出する各種フォーマット処理を集約したユーティリティです。

```javascript
const format = $loadLib('format.js');

// 金額・数値カンマ区切り (数値 -> 文字列)
format.money(1250000);        // "1,250,000"
format.money(1250000.5, '¥'); // "¥1,250,000.5"

// 金額・カンマ区切りの逆変換 (文字列 -> 数値)
format.parseMoney('1,234,567');     // 1234567
format.parseMoney('¥1,234,567.89'); // 1234567.89
format.parseMoney(' ￥ 1,000 円 '); // 1000
format.parseMoney('１,２３４,５６７'); // 1234567 (全角数字・全角カンマもOK)
format.parseMoney('▲1,234.5');      // -1234.5 (▲, △, (1234) などのマイナス表記に対応)
format.unmoney('$9,999');           // 9999 (unmoney / parseComma エイリアスあり)

// 全角半角変換 (フォーム入力のゆらぎ吸収)
format.toHalfWidth('ＡＢＣ　１２３！'); // "ABC 123!"
format.toFullWidth('ABC 123!');       // "ＡＢＣ　１２３！"

// カナ変換
format.toHiragana('テスト'); // "てすと"
format.toKatakana('てすと'); // "テスト"

// バイトサイズ表記
format.bytes(1048576);    // "1.0 MB"
format.bytes(1536000, 2); // "1.46 MB"

// 伏字（マスキング）＆ 文字数切り詰め
format.mask('09012345678', 3, 4); // "090****5678"
format.truncate('長いタイトル文字列です', 6); // "長いタイト..."

// HTML エスケープ
format.escapeHtml('<script>alert(1)</script>'); // "&lt;script&gt;..."
```

---

### 5. `encrypt.js` (AES-256-GCM 可逆暗号化)
DB に保存する機密データ（APIキーや個人情報など）を安全に暗号化し、後から復号できます。

```javascript
const encrypt = $loadLib('encrypt.js');
const secretKey = 'my-system-secret-key';

// 暗号化 (改ざん検知 AuthTag を含む 'iv:tag:cipher' 形式)
const cipherText = encrypt.encrypt('SecretUserData', secretKey);

// 復号 (改ざんや鍵不一致時は null を返却)
const plainText = encrypt.decrypt(cipherText, secretKey); // "SecretUserData"

// ランダムトークン & ハッシュ生成
const token = encrypt.randomToken(32); // URLセーフなランダムトークン
const hash = encrypt.sha256('targetText');
const signature = encrypt.hmac('targetText', secretKey);
```

---

### 6. `auth/password.js` (パスワードハッシュ)
PBKDF2-HMAC-SHA256 による安全なパスワードハッシュ化と、タイミング攻撃対策の定数時間比較による照合を行います。

```javascript
const password = $loadLib('password.js');

// ハッシュ化 (新規登録・パスワード変更時)
const hashed = password.hash('UserRawPassword');
// { salt: '...', hash: '...', iterations: 10000 }

// 検証 (ログイン時)
const isMatch = password.verify('UserRawPassword', hashed); // true / false
```

---

### 7. `auth/jwt.js` (JWT トークン管理)
HMAC-SHA256 (HS256) による JWT の署名・検証ユーティリティです。

```javascript
const jwt = $loadLib('jwt.js');
const secret = 'jwt-secret-key';

// 署名 (有効期限: 秒単位)
const token = jwt.sign({ userId: 'user123', role: 'editor' }, secret, { expiresIn: 3600 });

// 検証 & ペイロード復元 (期限切れや改ざん時は null)
const payload = jwt.verify(token, secret);
if (payload) {
    console.log(payload.userId, payload.role);
}
```

---

### 8. `auth/csrf.js` (CSRF トークン管理)
セッション ID に紐づく CSRF トークンを算出し、リクエストの正当性を検証します。

```javascript
const csrf = $loadLib('csrf.js');

// トークン生成 (セッションIDに紐づくトークン)
const token = csrf.generateToken(session.sid);

// トークン検証 (リクエストヘッダー X-CSRF-Token または直接指定)
const isValid = csrf.verify(session.sid, clientToken);
```

---

### 9. `auth/rbac.js` (ロールベースアクセス制御)
ロールの階層構造や権限の割り当て、ルートガードを管理します。

```javascript
const rbac = $loadLib('rbac.js');

// 権限チェック
if (!rbac.hasPermission(user.role, 'user.write')) {
    return $response.json({ error: '権限がありません' }, 403);
}

// ロール階層チェック
if (rbac.hasRole(user.role, 'admin')) {
    // 管理者向け処理
}
```

---

### 10. `auth/corsFilter.js` (CORS 制御)
クロスオリジンリクエストに対するプリフライト（OPTIONS）およびレスポンスヘッダーの設定を行います。

```javascript
const corsFilter = $loadLib('corsFilter.js');

// filter.mt.js 内で呼び出し
exports.handler = async function() {
    if (corsFilter.handlePreflight($request, $response)) {
        return false; // OPTIONS リクエスト時は即座に応答
    }
    corsFilter.applyHeaders($request, $response);
    return true;
};
```

---

### 11. `csv/csvWriter.js` (CSV 書き込み)
RFC 4180 準拠の安全な CSV 文字列を生成します。

```javascript
const { createCsv, createCsvWriter } = $loadLib('csvWriter.js');

// パターン1: 配列から一括生成
const rows = [
    { id: 1, name: '山田 太郎', memo: '改行を含む\nメモ' },
    { id: 2, name: '佐藤 "花子"', memo: 'ダブルクォート' }
];
const csvString = createCsv(['id', 'name', 'memo'], rows);

// パターン2: 行ごとに逐次書き込み
const writer = createCsvWriter(['id', 'name']);
writer.put('id', 1).put('name', '田中').write();
writer.putRow({ id: 2, name: '鈴木' }).write();
const result = writer.get();
```

---

### 12. `csv/csvReader.js` (CSV 読み込み)
改行を含むセルやダブルクォートエスケープに対応した CSV パサーです。

```javascript
const { readCsv, createCsvReader } = $loadLib('csvReader.js');

// パターン1: 一括パース (オブジェクト配列化)
const { headers, rows } = readCsv(csvString);
rows.forEach(row => console.log(row.id, row.name));

// パターン2: 行ごとのストリーム風パース
const reader = createCsvReader(csvString);
while (reader.hasNext()) {
    const row = reader.next();
    console.log(row.getString('name'), row.getNumber('id'));
}
```

---

### 13. `validate/validate.js` (スキーマバリデーション)
宣言的なスキーマ定義に基づき、リクエストボディや任意の JS オブジェクトを検証します。`validates/` ディレクトリ配下にスキーマモジュールを定義して `$loadLib` で共有利用できます。

```javascript
const validate = $loadLib('validate.js');

// スキーマ定義例 (validates/user.js 等に定義可能)
const schema = {
    name:     { type: 'string', required: true, minLen: 1, maxLen: 50, messages: { required: '名前は必須です' } },
    email:    { type: 'string', required: true, mail: true },
    siteUrl:  { type: 'string', url: true },
    zipCode:  { type: 'string', zip: true },
    phone:    { type: 'string', tel: true },
    birthday: { type: 'string', date: true },
    wakeTime: { type: 'string', time: true },
    userId:   { type: 'string', alphaNum: true },
    age:      { type: 'int', range: [0, 150], default: 0 },
    role:     { type: 'string', enum: ['admin', 'user', 'guest'], default: 'user' }
};

const result = validate.check($request.body, schema);
if (!result.valid) {
    // errors: [{ field: 'email', rule: 'mail', message: 'emailは有効なメールアドレス形式で入力してください' }, ...]
    return $response.json({ errors: result.errors }, 400);
}

// result.data は default 値が補完された安全なオブジェクト
const validatedData = result.data;
```

#### サポートする検証ルール一覧
| ルール | 型 | 説明・指定例 |
|---|---|---|
| `type` | string | `string` / `int` / `float` / `boolean` / `date` |
| `required` | boolean | `true` の場合、値が未指定（`undefined`/`null`）ならエラー |
| `minLen` / `maxLen` | number | 文字列の最小・最大長 |
| `min` / `max` | number/Date | 数値・日付の最小・最大値 |
| `range` | Array/Object | 範囲の検証 (`[min, max]` または `{ min, max }`) |
| `mail` | boolean | メールアドレス形式チェック (`true`) |
| `url` | boolean | `http` / `https` URL 形式チェック (`true`) |
| `zip` | boolean | 郵便番号（`123-4567` / `1234567`）チェック (`true`) |
| `tel` | boolean | 電話番号（固定・携帯・フリーダイヤル等）チェック (`true`) |
| `date` | boolean | 日付形式（`YYYY-MM-DD` / `YYYY/MM/DD`、実在日判定付き）チェック (`true`) |
| `time` | boolean | 時刻形式（`HH:mm:ss` / `HH:mm`）チェック (`true`) |
| `alphaNum` | boolean | 半角英数字のみチェック (`true`) |
| `pattern` | RegExp | 任意正規表現チェック (`/^[A-Z]{3}$/`) |
| `enum` | Array | 許可する値の配列 (`['active', 'inactive']`) |
| `custom` | Function | カスタム検証関数 `(val, allData) => boolean | string` (false またはエラーメッセージで失敗) |
| `default` | Any/Function | 値が未指定時の補完値または生成関数 |
| `messages` | Object | ルール別カスタムエラーメッセージ (`{ required: '...', mail: '...' }`) |

---

### 14. `http.js` (HTTP クライアント)
タイムアウト制御、自動リトライ、クエリパラメータ自動付加、JSON 送受信に対応した軽量 HTTP クライアントです。

```javascript
const http = $loadLib('http.js');

// GET + クエリパラメータ自動付加 + JSON 自動パース (タイムアウト3秒、最大2回リトライ)
const data = await http.getJson('https://api.example.com/search', {
    query: { q: 'bun', page: 1 },
    timeout: 3000,
    retry: 2
});

// POST JSON 送信
const res = await http.postJson('https://api.example.com/items', { name: 'ItemA', price: 100 });
```

---

### 15. `notification/sendSlack.js` (Slack 通知)
Slack の Incoming Webhook または Bot Token (`chat.postMessage`) を利用して通知を送信します。

```javascript
const sendSlack = $loadLib('sendSlack.js');

// 単純なテキスト通知
await sendSlack.send(process.env.SLACK_WEBHOOK_URL, '新しい注文が入りました！');

// リッチブロック通知
await sendSlack.send(process.env.SLACK_WEBHOOK_URL, {
    text: 'システム警告',
    blocks: [ ... ]
});
```

---

### 16. `notification/sendGithub.js` (GitHub Issue 作成)
GitHub Personal Access Token を用いて指定リポジトリに Issue を自動起票します。

```javascript
const sendGithub = $loadLib('sendGithub.js');

await sendGithub.createIssue({
    owner: 'my-org',
    repo: 'my-repo',
    token: process.env.GITHUB_TOKEN,
    title: '[自動検知] サーバーエラー発生',
    body: 'エラー詳細ログ...'
});
```

---

### 17. `http/multipart.js` (ファイルアップロード解析)
`multipart/form-data` 形式のリクエストを解析し、アップロードされたファイルやテキストフィールドを抽出します。

```javascript
const multipart = $loadLib('multipart.js');

// .mt.js 内でファイル受信
exports.handler = async function() {
    const parsed = await multipart.parse($request);
    // parsed.fields: テキストフィールド { username: '...' }
    // parsed.files: アップロードファイル一覧 [{ filename, data, contentType }]
    
    return { success: true, fileCount: parsed.files.length };
};
```

---

### 18. `fileUtil.js` (ファイル・JSON 入出力支援)
JSON の安全な読み書き（親ディレクトリ自動生成）、拡張子フィルタ付き一覧、アップロードファイル名の安全な生成を行います。

```javascript
const fileUtil = $loadLib('fileUtil.js');

// 1. JSON の安全な読み書き (親ディレクトリ自動作成、エラー時は default 返却)
const config = fileUtil.readJson('./conf/app.json', { defaultVal: 1 });
fileUtil.writeJson('./data/backup.json', { savedAt: new Date(), count: 10 });

// 2. テキスト・バイナリの読み書き
fileUtil.writeText('./data/hello.txt', 'Hello maachang');
const text = fileUtil.readText('./data/hello.txt');

// 3. ディレクトリ一覧取得 (再帰探索・拡張子フィルタ)
const files = fileUtil.list('./public', { ext: ['html', 'jhtml'], recursive: true });

// 4. アップロードファイル名の安全な生成 (パストラバーサル除去・拡張子検証・ユニーク名化)
const safeName = fileUtil.safeFileName('../avatar.PNG', ['png', 'jpg', 'webp'], 'user_');
// 例: "user_1786866832000_a1b2c3d4e5f6.png"
```
