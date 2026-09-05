# ${PROJECT_NAME} プロジェクト固有の情報

このファイルは Claude Code や agy (Google Antigravity) がセッション開始時に自動的に読み込みます。ここにはプロジェクト固有の事実および maachang フレームワークの利用ルールを記載します。

# プロジェクト概要

このプロジェクトは [maachang](https://github.com/maachang/maachang)（オンプレミス向けの Bun.serve 実行による超最小・高速 Web アプリケーションフレームワーク）を使って構築された Web アプリケーション / API です。

（このプロジェクト「${PROJECT_NAME}」が何をするものか、ここに記載する）

# 設計思想: 「ファイル配置 ＝ URL」の直感的な PHP 的アプローチ

- **認知負荷ゼロ**: `public/` 配下のファイル構造がそのまま URL パスに対応するクラシカルな SSR / API 構造。SPA や複雑なルーティング設定、巨大な npm 依存による複雑さを排除しています。
- **AI Native**: 1〜2 ファイルでバックエンド処理と画面描画が完結するため、AI エージェントが迷わず、コンテキストを浪費せずに迅速な機能開発が可能です。
- **ゼロ外部依存 ＆ 爆速**: Bun 組み込み機能と SQLite3 (`bun:sqlite`) のみで動作し、ミリ秒起動と単一ファイル運用を実現しています。

# インフラ・HTTPS 運用仕様

- **Nginx リバースプロキシ構成**: オンプレミス本番環境では Nginx を前面に配置して運用します。
- **無料 SSL 証明書 (Let's Encrypt / Certbot)**:
  - HTTPS (443) 終端、および HTTP (80) での ACME チャレンジ (HTTP-01) はすべて Nginx 側で一元管理します。
  - 証明書自動更新時は `nginx -s reload` による無停止反映を行います。
  - maachang (Bun.serve) 側はローカルポート（HTTP: localhost:3000 等）でリクエストを受け付けます。
  - クライアント IP 等の取得は Nginx から渡される `X-Forwarded-For` / `X-Real-IP` を利用します。

# 作業領域（.claudeWork）

- プロジェクト直下の `.claudeWork/` は AI 専用の作業領域（Git には一切コミットしない、`.gitignore` 済み）。
- セッション再起動時の引き継ぎ用メモや、調査結果・設計方針のドラフト置き場として利用する。
- プロジェクト固有の永続的な仕様は本ファイル（`CLAUDE.md`）に記載する。

# コーディング規約 & AI 開発ルール

- **独断での仕様決定禁止**: 実装を任された際、詳細仕様（データフィルタリング手法、抽出ロジック、制限値、除外基準など）を独断で決定・補完することは禁止。必ずユーザーの承認を得ること。
- **車輪の再発明の禁止**: maachang が標準提供しているモジュール（`session.js`, `logger.js`, `validate.js` 等）や組み込みヘルパー（`$request`, `$response`, `$db` 等）を優先活用し、独自ライブラリを安易に自作しない。
- **テーブルスキーマ定義の出力・管理**: データベース（SQLite3 等）のテーブルを作成・変更した場合は、テーブルスキーマ定義（DDL、SQL、テーブル定義書等）を必ず `schema/` ディレクトリ配下に出力・更新して管理すること。実装やクエリ作成時には `schema/` 内の定義を参照すること。
- **バリデーション定義の出力・管理**: フォーム入力や API リクエストの検証スキーマは、必ず `validates/` ディレクトリ配下にモジュールとして定義・出力すること（例: `validates/login.js`, `validates/user.js`）。ページや API 実装時はこれを `$loadLib` で読み込み、`validate.js` を用いて検証を行うこと。
- **既存コメントの維持**: 処理内容が変わって意味が通じなくなる場合を除き、既存コメントを削除しない。
- **言語ルール**: コメントおよびユーザーへの返答・要約・説明文は常に**日本語**で記述する。
- **バグ修正フロー**: バグやエラーの原因調査を依頼された場合、即座に修正せず、まず原因と修正方針を報告して承認を得てから修正に着手する。
- **実装状況と設計案の峻別**: 「現状のコードで既に実装されていること」と「改修すれば実現可能な設計上のアイデア」を絶対に混同して回答しない。未実装の機能をあたかも利用可能であるかのように説明してはならない。
- **エラー発生時の責任転嫁・安易な回答の禁止**: 動作不良やエラーが発生した際、コードの実態（未実装・考慮漏れ）を確認せずに安易に「〇〇をコピーしてください」「〇〇を再設定してください」などユーザー側の運用に責任を押し付ける回答をしない。まずフレームワークやサーバーコード側の実装状態を正確に検証し、何が足りていないのか（コード改修が必要なのか、運用操作が必要なのか）を客観的・正確に説明すること。
- **CommonJS 形式**: モジュールやスクリプトは CommonJS 形式（`require` / `module.exports`）で統一する。

# maachang フレームワーク原則 & アーキテクチャ

本プロジェクトは maachang 環境（`${MAACHANG_HOME}`）上で動作します。

- **`${MAACHANG_HOME}/src/index.js`**: Bun.serve によるサーバー起動エントリ。
- **`${MAACHANG_HOME}/src/router.js`**: ルーティング・静的配信・動的 JS/JHTML 実行・フィルター処理。
- **`${MAACHANG_HOME}/modules/`**: 共通モジュール群（`session.js`, `logger.js` 等）。
  - `$loadLib("モジュール名.js")` でフラットにロード可能。
  - プロジェクト側の `lib/` に同名ファイルがある場合はプロジェクト側が優先される。
- **`${MAACHANG_HOME}/bin/`**: maachang コマンド群（`initMaachang`, `mkmc`, `maachang`, `mcbuild`）。

---

# グローバルオブジェクト & 組み込みヘルパー

maachang の `*.mt.js` / `*.mt.html` (JHTML) / `filter.mt.js` 内では以下のヘルパーが事前定義なしで利用できます（関数呼び出し `$request()` / `$response()` とオブジェクトアクセス `$request` / `$response` の両対応）。

| ヘルパー | 説明 | 主なメソッド / プロパティ |
|---|---|---|
| `$request` / `$request()` | リクエスト情報の取得 | `.path`, `.method`, `.query`, `.body`, `.cookies`, `.ip`<br>`.getHeader(key)`, `.getQuery(key, def)`, `.getCookie(key, def)` |
| `$response` / `$response()` | レスポンスの生成・返却 | `.status(code)`, `.contentType(type, charset)`, `.header(key, val)`, `.setCookie(name, val, opt)`, `.deleteCookie(name)`<br>`.json(data, status)`, `.html(str, status)`, `.text(str, status)`, `.redirect(url, status)`, `.body(val)` |
| `$include(path, params)` | 別テンプレート/HTMLのインクルード | `${$include("./parts/header.mt.html", { title: "..." })}`<br>（`${$include(...)}` は自動で await 補完） |
| `$params` | インクルードパラメータの参照 | テンプレートやパーツ内で `${$params.title}` や `${$params.user}` としてアクセス |
| `$loadLib("name.js")` | モジュールのロード | `lib/` → `validates/` → `${MAACHANG_HOME}/modules/` の順で検索してロード |
| `$loadConf("conf名")` | 設定 JSON の取得 | `conf/{conf名}.local.json`（ローカル優先）→ `conf/{conf名}.json` を取得 |
| `$db` | SQLite3 データベース操作 | `bun:sqlite` ラッパー。<br>`$db.get(sql, params)`, `$db.all(sql, params)`, `$db.run(sql, params)`, `$db.exec(sql)`, `$db.transaction(fn)` |
| `$require(mod)` | 標準ライブラリ require | `crypto`, `path`, `fs` 等の安全な呼び出し |



---

# 環境変数 & 設定ファイル定義 (`conf/*.json`, `process.env`, `$loadConf`)

- **JS コメント (JSONC) 対応**: すべての `conf/*.json`（`env.json`, `server.json`, `session.json`, `log.json`, カスタム設定）で **JavaScript コメント（`//` 単一行、`/* ... */` 複数行）** および末尾カンマが自由に使用可能です。
- **環境変数の自動展開**: `conf/env.json` にキー・バリュー形式で定義した設定は、サーバー起動時およびリクエスト実行時に自動的に `process.env` に直接展開されます。
- **プログラム内からの参照**: スクリプト内（`.mt.js`, `.jhtml`, `lib/` 等）から `process.env.APP_NAME` や `process.env.API_KEY` のように標準の環境変数としてそのまま参照できます。
- **ローカル環境の上書き (`conf/env.local.json`, `conf/*.local.json`)**:
  - `conf/{name}.local.json` が存在する場合はローカル値が最優先で上書き適用されます（`.gitignore` 済みのため機密情報や開発用キーの保存に利用）。
  - 例 (`conf/env.json`):
    ```json
    // アプリケーション全体設定
    {
      "APP_ENV": "development", // 開発環境
      /* 外部連携APIエンドポイント */
      "API_BASE_URL": "https://api.example.com",
      "DEBUG_MODE": "true",
    }
    ```


---

# 主要モジュール クイックリファレンス (`$loadLib`)

### 1. `session.js`（SQLite3 セッション管理）
- **`sessionMod.createSession($response, initialData)`**: セッション新規作成 ＆ Cookie 自動発行。
- **`sessionMod.getSession($request)`**: セッションデータ取得（有効期限切れ時は自動削除＆`null` 返却）。
- **`sessionMod.setSession(sid, data)`**: セッションデータ更新。
- **`sessionMod.deleteSession($request, $response)`**: セッション削除 ＆ Cookie 破棄。
- **`sessionMod.cleanExpiredSessions()`**: 期限切れセッションの一括クリーンアップ。

### 2. `logger.js` / `localLog.js`（日別ローテーションロガー）
- **`logger.info(...)`, `logger.warn(...)`, `logger.error(...)`, `logger.debug(...)`, `logger.trace(...)`**:
  - `[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] メッセージ` 形式で標準出力および `./log/{file}.YYYY-MM-DD.log` へ出力。
- **`logger.setting({ dir, file, level, stdout })`**: ログ設定変更（`conf/log.json` による自動設定にも対応）。

### 3. `dateEx.js`（日付操作・フォーマット・期間判定ユーティリティ）
- **`DateEx.create(...)` または `DateEx(...)`**: 日付インスタンス生成（文字列、数値、Date、DateEx から生成可能）。
- **`d.change(mode, val)`**: 日時加減算（`year`, `month`, `week`, `date`, `hours`, `minutes`, `seconds`, `milliseconds`）。
- **`d.clear(mode)`**: 日時リセット（`date`, `hours` 等）。
- **`d.toString(mode, format)` / `d.toFormatString(pattern)`**: 日時フォーマット出力（`{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}` 等）。
- **`DateEx.between(date, mode).isBetween(target)`**: 月始・月末などの期間取得および範囲内外判定。

### 4. `password.js` / `jwt.js` / `csrf.js` / `rbac.js`（セキュリティ・認証）
- **`password.hash(pwd)` / `password.verify(pwd, hashed)`**: PBKDF2-HMAC-SHA256 による安全なパスワードハッシュ化・照合。
- **`jwt.sign(payload, secret, opt)` / `jwt.verify(token, secret)`**: HS256 による JWT トークン署名・検証。
- **`csrf.generateToken(sid?)` / `csrf.verify(sid?, token?)`**: セッション連携 CSRF トークン生成・検証。
- **`rbac.hasRole(role, target)` / `rbac.hasPermission(role, perm)`**: ロール・権限の検証およびルート保護。

### 5. `csvReader.js` / `csvWriter.js`（CSV 操作）
- **`csvWriter.writeCsv(headers, rows)`**: 配列/オブジェクトデータから CSV 文字列を生成。
- **`csvReader.readCsv(csvString)`**: CSV 文字列をパースして `{ headers, rows }` オブジェクト配列を取得。

### 6. `validate.js`（バリデーション & `validates/` 定義）
- **`validate.check(data, schema)`**: スキーマ定義に従って JS オブジェクトを検証（戻り値: `{ valid, errors: [{field, rule, message}], data }`）。
- **スキーマ定義の作成方法 (`validates/{name}.js`)**:
  ```javascript
  // validates/user.js
  module.exports = {
      name:     { type: 'string', required: true, minLen: 1, maxLen: 50, messages: { required: '名前は必須です' } },
      email:    { type: 'string', required: true, mail: true },
      siteUrl:  { type: 'string', url: true },
      zipCode:  { type: 'string', zip: true },
      phone:    { type: 'string', tel: true },
      birthday: { type: 'string', date: true },
      wakeTime: { type: 'string', time: true },
      userId:   { type: 'string', alphaNum: true },
      age:      { type: 'int', range: [0, 150], default: 0 }
  };
  ```
- **ページ・API での利用手順**:
  ```javascript
  // public/api/users.mt.js または JHTML 内
  const validate = $loadLib('validate.js');
  const userSchema = $loadLib('validates/user.js'); // または $loadLib('user.js')

  const result = validate.check($request.body, userSchema);
  if (!result.valid) {
      return $response.json({ errors: result.errors }, 400);
  }
  // 検証済み・デフォルト値補完済みデータ: result.data
  ```
- **サポート属性・ルール一覧**:
  - `type`: `'string'` / `'int'` / `'float'` / `'boolean'` / `'date'`
  - `required`: `true` / `false`（必須チェック）
  - `minLen` / `maxLen`: 文字列の最小・最大長
  - `min` / `max`: 数値・日付の最小・最大値
  - `range`: 範囲検証 (`[min, max]` または `{ min, max }`)
  - `mail`: メールアドレス形式チェック (`true`)
  - `url`: URL (`http`/`https`) 形式チェック (`true`)
  - `zip`: 郵便番号形式チェック (`true`, `123-4567` / `1234567`)
  - `tel`: 電話番号形式チェック (`true`, 固定/携帯/フリーダイヤル等)
  - `date`: 日付形式チェック (`true`, `yyyy-MM-dd` / `yyyy/MM/dd` 実在日判定付き)
  - `time`: 時刻形式チェック (`true`, `HH:mm:ss` / `HH:mm`)
  - `alphaNum`: 半角英数字チェック (`true`)
  - `pattern`: 任意正規表現 (`RegExp`)
  - `enum`: 許可値の配列 (`['user', 'admin']` 等)
  - `custom`: カスタム検証関数 `(val, allData) => boolean | string` (false またはエラーメッセージ文字列で失敗)
  - `default`: 未指定時の補完値または生成関数
  - `messages`: ルール別カスタムエラーメッセージ (`{ required: '...', mail: '...', range: '...' }`)

### 7. `sendSlack.js` / `multipart.js`（通信・ファイルアップロード）
- **`sendSlack.send(webhookUrl, message)`**: Slack Webhook への通知送信。
- **`multipart.parse(req)`**: `multipart/form-data` によるファイルアップロードの解析。

### 8. `format.js` / `encrypt.js` / `http.js`（整形・暗号化・HTTPクライアント）
- **`format.money(val)` / `format.parseMoney(str)` / `format.toHalfWidth(str)` / `format.bytes(n)` / `format.mask(str)` / `format.truncate(str, len)`**: 日本語業務画面向けフォーマット（金額相互変換・全角半角等）。
- **`encrypt.encrypt(plain, key)` / `encrypt.decrypt(cipher, key)`**: AES-256-GCM 可逆暗号化・復号（改ざん検知 AuthTag 付き）。
- **`encrypt.randomToken(len)` / `encrypt.sha256(str)` / `encrypt.hmac(str, key)`**: ランダムトークン・ハッシュ生成。
- **`http.get(url, opt)` / `http.postJson(url, data, opt)` / `http.getJson(url, opt)`**: タイムアウト・リトライ付き HTTP クライアント。

### 9. `fileUtil.js` / `file.js`（ファイル・JSON入出力支援）
- **`fileUtil.readJson(path, def)` / `fileUtil.writeJson(path, data)`**: JSON の安全な読み書き（親ディレクトリ自動生成）。
- **`fileUtil.readText(path)` / `fileUtil.writeText(path, text)`**: テキストファイルの読み書き。
- **`fileUtil.list(dir, { ext, recursive })`**: 拡張子フィルタ・再帰探索付きファイル一覧。
- **`fileUtil.safeFileName(origName, allowedExts, prefix)`**: アップロードファイル名の安全な生成（拡張子検証・ユニーク名化）。

### 10. `jhtml.browser.js`（フロントエンド・ブラウザ用 JHTML ランタイム）
- **役割**: ブラウザ側（クライアントサイド）での動的 DOM 構築やテンプレートレンダリング。外部依存ゼロ（Pure JS）。
- **配置・読み込み方針**: 
  - HTML 側で `<script src="/jhtml.browser.js"></script>` を読み込むだけで即利用可能。
  - プロジェクト側の `public/` にファイルがなくても、サーバーがフレームワーク本体（`$MAACHANG_HOME/public/`）から自動フォールバック配信するため、コピーなしで動作する。
  - プロジェクト側でカスタマイズしたい場合は `public/jhtml.browser.js` を配置すれば優先される。
- **主な機能**:
  - `jhtml.html`...``: 自動エスケープ（XSS対策）付きタグ付きテンプレートリテラル。
  - `jhtml.raw(str)`: 生 HTML の混在出力。
  - `jhtml.render('template-id', data)`: `<script type="text/jhtml">` テンプレートのブラウザ側コンパイル＆実行。
  - `jhtml.renderTo('target-id', 'template-id', data)`: レンダリング結果を指定要素の innerHTML に直接反映。
  - `jhtml.$('id')` / `jhtml.$$('selector')`: 単一・複数 DOM 取得ショートカット。
  - `jhtml.refs('id1', 'id2', ...)`: 複数要素の一括取得（分割代入で大量の `getElementById` を 1行化）。
  - `jhtml.on(target, event, [selector], handler)`: 直接イベント登録および動的要素向けのイベント委任。
  - `jhtml.api`: 自動 JSON パース、Content-Type 付与、ローディング要素連動付き軽量 fetch クライアント (`api.get`, `api.post`, `api.put`, `api.del`)。
  - `jhtml.form(container)` / `jhtml.form.fill(container, data)`: フォーム入力値のオブジェクト一括取得および一括流し込み。
  - `jhtml.show` / `jhtml.hide` / `jhtml.toggle` / `jhtml.addClass` / `jhtml.removeClass`: 表示制御およびクラス操作糖衣構文。
  - `jhtml.state(init, onChange)`: プロパティ更新で画面が連動する極小リアクティブ状態オブジェクト。

---

# ローカル実行・デプロイ手順

`${MAACHANG_HOME}/bin` に PATH が通っているため、以下のコマンドがそのまま実行できます。

- `maachang`: カレントプロジェクトでローカル開発サーバー起動（デフォルト `http://localhost:3000/`）。
  - `-p <port>`: ポート番号指定（例: `maachang -p 8080`）
  - `-h <host>`: バインドホスト指定
  - `--prod`: 本番モード起動
- `mcbuild`: 本番デプロイ用にプロジェクト内の JHTML テンプレートを一括で `.jhtml.js` に事前コンパイル。
- `bun test`: 単体・結合テストの実行。

---

# ディレクトリ構成

| ディレクトリ・ファイル | 役割 |
|---|---|
| `public/` | Web コンテンツ・動的スクリプト (`*.mt.js` / `*.mt.html` / `*.jhtml`) の配置先 |
| `public/filter.mt.js` | 共通リクエストフィルター（認証・認可・共通前処理） |
| `lib/` | プロジェクト固有の `$loadLib()` モジュールの配置先 |
| `conf/` | 設定 JSON (`server.json`, `session.json`, `env.json`, `log.json` 等) の配置先。<br>`*.local.json` はローカル実行時優先（本番設定の上書き用・Git管理外）。 |
| `data/` | SQLite3 DB ファイル (`session.db` 等) の配置先 |
| `schema/` | テーブルスキーマ定義（DDL、SQL、テーブル仕様書）の保存・出力先 |
| `validates/` | バリデーション定義ファイル（入力検証スキーマ）の保存・配置先 |
| `log/` | 日別ローテーションログファイルの出力先 |
| `package.json` | プロジェクト設定・npm scripts (`start`, `build`) |
| `.claude/CLAUDE.md` | 本ファイル |

# あえてやってないこと

（プロジェクト固有の、あえてやってない事があればこの内容を削除して記載する）

# 未対応・残課題(随時更新)

（プロジェクト固有の、未対応・課題があればこの内容を削除して記載する）
