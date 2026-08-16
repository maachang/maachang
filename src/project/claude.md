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
- **車輪の再発明の禁止**: maachang が標準提供しているモジュール（`session.js`, `logger.js`）や組み込みヘルパー（`$request`, `$response`, `$db` 等）を優先活用し、独自ライブラリを安易に自作しない。
- **既存コメントの維持**: 処理内容が変わって意味が通じなくなる場合を除き、既存コメントを削除しない。
- **言語ルール**: コメントおよびユーザーへの返答・要約・説明文は常に**日本語**で記述する。
- **バグ修正フロー**: バグやエラーの原因調査を依頼された場合、即座に修正せず、まず原因と修正方針を報告して承認を得てから修正に着手する。
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
| `$loadLib("name.js")` | モジュールのロード | `lib/` → `${MAACHANG_HOME}/modules/` の順で検索してロード |
| `$loadConf("conf名")` | 設定 JSON の取得 | `conf/{conf名}.local.json`（ローカル優先）→ `conf/{conf名}.json` を取得 |
| `$db` | SQLite3 データベース操作 | `bun:sqlite` ラッパー。<br>`$db.get(sql, params)`, `$db.all(sql, params)`, `$db.run(sql, params)`, `$db.exec(sql)`, `$db.transaction(fn)` |
| `$require(mod)` | 標準ライブラリ require | `crypto`, `path`, `fs` 等の安全な呼び出し |

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
| `conf/` | 設定 JSON (`server.json`, `session.json`, `log.json` 等) の配置先。<br>`*.local.json` はローカル実行時優先（本番設定の上書き用）。 |
| `data/` | SQLite3 DB ファイル (`session.db` 等) の配置先 |
| `log/` | 日別ローテーションログファイルの出力先 |
| `package.json` | プロジェクト設定・npm scripts (`start`, `build`) |
| `.claude/CLAUDE.md` | 本ファイル |

# あえてやってないこと

（プロジェクト固有の、あえてやってない事があればこの内容を削除して記載する）

# 未対応・残課題(随時更新)

（プロジェクト固有の、未対応・課題があればこの内容を削除して記載する）
