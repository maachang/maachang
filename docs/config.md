# 設定ファイル・環境変数仕様書 (`docs/config.md`)

maachang フレームワークにおける設定ファイル（`conf/*.json`）および環境変数（`process.env`）の管理仕様です。

---

## 1. 概要

- **JS コメント (JSONC) 対応**: すべての設定 JSON ファイルで **単一行コメント（`//`）**、**複数行コメント（`/* ... */`）**、**末尾カンマ（Trailing Comma）** が使用できます。
- **環境変数の自動展開**: `conf/env.json` に定義された値は、サーバー起動時およびリクエスト実行時に自動的に `process.env` に直接展開されます。
- **ローカル上書き（`*.local.json`）**: 本番設定とローカル開発環境の分離のため、`conf/{name}.local.json` が存在する場合はローカル設定が最優先されます（Git 管理外）。

---

## 2. 設定ファイルの読み込み優先度 (`$loadConf`)

`$loadConf(name)` を呼び出した場合、以下の優先順序でファイルを探索・マージします：

1. `conf/{name}.local.json` （存在する場合、ローカル個別設定）
2. `conf/{name}.json` （ベース設定）

```javascript
// 例: conf/server.json または conf/server.local.json を取得
const serverConf = $loadConf('server');
console.log(serverConf.port); // 3000
```

---

## 3. 環境変数定義 (`conf/env.json`)

アプリケーション内で利用する環境変数や接続先設定は `conf/env.json` に定義します。

### 定義例 (`conf/env.json`):
```json
// アプリケーション共通環境設定
{
  "APP_ENV": "development", // 実行環境
  /* 外部連携APIエンドポイント */
  "API_BASE_URL": "https://api.example.com",
  "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/...",
  "DEBUG_MODE": "true",
}
```

### ローカル上書き例 (`conf/env.local.json`):
```json
// ローカル開発者専用設定 (Git管理外)
{
  "APP_ENV": "local",
  "API_BASE_URL": "http://localhost:8080",
  "DEBUG_MODE": "true",
}
```

### スクリプト内からの利用:
```javascript
// .mt.js, JHTML, lib/*.js から標準の process.env でアクセス可能
const apiUrl = process.env.API_BASE_URL;
const isDebug = process.env.DEBUG_MODE === 'true';
```

---

## 4. 主な設定ファイル一覧

| ファイル | 役割 | 主な設定項目 |
|---|---|---|
| `conf/server.json` | サーバー基本設定 | `host`, `port`, `cors` |
| `conf/session.json` | セッション管理設定 | `dbPath`, `cookieName`, `expiresIn`, `secure`, `sameSite` |
| `conf/env.json` | アプリケーション環境変数 | 任意のキー・バリュー（`process.env` に展開） |
| `conf/log.json` | ロガー設定 | `dir`, `file`, `level`, `stdout` |
| `conf/mime.json` | MIME タイプ拡張定義 | 拡張子と Content-Type のマッピング |
