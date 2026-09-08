# エラーハンドリング仕様書 (`docs/error-handling.md`)

maachang フレームワークにおけるサーバーエラーハンドリング、開発用リッチ画面、本番環境での安全な情報隠蔽、およびロギング仕様です。

---

## 1. 概要 & 設計方針

maachang では、**「開発時の爆速デバッグ体験」** と **「本番オンプレミス環境での堅牢なセキュリティ」** を両立するため、実行環境（開発モード / 本番モード）およびクライアントの要求（`Accept` ヘッダー）に応じてエラーレスポンスを自動的に切り替えます。

- **開発環境 (`maachang` / `isDev: true`)**:
  - ブラウザからのアクセス時は、発生元ファイルパス、エラー発生行および前後コードのシンタックスハイライト、完全なスタックトレースを含むモダンなダークテーマ HTML を返却。
  - API / fetch からのアクセス時は、`file`, `line`, `column`, `stack` を含む詳細 JSON を返却。
- **本番環境 (`maachang --prod` / `isDev: false`)**:
  - 内部パス、ファイル構造、コードスニペットなどの機密情報を完全に隠蔽。
  - HTML は安全な汎用 500 画面、API は `{"error": "Internal Server Error"}` のみを返却。
- **ログの完全保全**:
  - 開発・本番を問わず、エラー発生時は必ず `logger.error()` を経由して日別ローテーションログ（`./log/logout.YYYY-MM-DD.log`）およびターミナル標準出力にリクエスト情報・発生箇所・スタックトレースを記録。

---

## 2. 環境別のレスポンス仕様

### (1) 開発モード (`maachang` / `isDev: true`)

#### A. ブラウザ要求 (`Accept: text/html` を含む場合)
リッチなダークテーマ HTML エラー画面をレスポンスします。
- **ヘッダー部**: HTTP 500 バッジ、エラークラス名（`TypeError`, `ReferenceError` 等）、エラーメッセージ。
- **発生コードハイライト**: エラーが発生したファイル名、行番号（Line X）、および対象行の前後各5行のコードスニペットを表示（エラー発生行を赤系で強調ハイライト）。
- **スタックトレース**: 呼び出し元のスタックトレースを等幅フォントで視認性高く表示。
- **リクエスト情報**: HTTP メソッド、リクエスト URL、User-Agent を一覧表示。

#### B. API / JSON 要求 (`Accept: application/json` またはブラウザ以外)
HTTP ステータス 500 とともに、以下の形式の JSON を返却します。
```json
{
  "error": "Unhandled Server Error",
  "message": "Cannot read properties of undefined (reading 'name')",
  "file": "/path/to/project/public/api/user.mt.js",
  "line": 15,
  "column": 23,
  "stack": [
    "TypeError: Cannot read properties of undefined (reading 'name')",
    "at exports.handler (/path/to/project/public/api/user.mt.js:15:23)",
    "..."
  ]
}
```

---

## 3. 本番モード (`maachang --prod` / `isDev: false`)

外部からの不正アクセスや脆弱性探索を防ぐため、内部実装やコード行を一切開示しません。

#### A. ブラウザ要求 (`Accept: text/html`)
```html
<!DOCTYPE html>
<html>
<head><title>500 Internal Server Error</title></head>
<body>
  <h1>500 Internal Server Error</h1>
  <p>An unexpected error occurred.</p>
</body>
</html>
```

#### B. API / JSON 要求
```json
{
  "error": "Internal Server Error"
}
```

---

## 4. ソースコード追跡機構 (`sourceURL`)

maachang の `.mt.js` はオンデマンドで評価・実行されますが、内部でコード実行時に自動的に以下のディレクティブを付与しています：

```javascript
//# sourceURL=${filePath}
```

これにより、動的スクリプト内で発生した例外のスタックトレースから Bun / V8 ランタイムが正確な元ファイルパスと行・列番号（`extractErrorLocation`）を特定でき、正確なコードスニペットのハイライト表示を実現しています。

---

## 5. エラーログの記録仕様

エラー発生時は、HTTP レスポンスとは独立して必ず `src/errorHandler.js` がサーバーログへ以下のフォーマットで詳細を記録します。

### ログ出力例 (`./log/logout.YYYY-MM-DD.log`):
```text
2026-09-09 00:30:15.123 [ERROR] [Unhandled Server Error] GET http://localhost:3000/api/users
  Message: Cannot read properties of undefined (reading 'name')
  Location: /home/maachang/project/public/api/users.mt.js:15:23
  Stack:
TypeError: Cannot read properties of undefined (reading 'name')
    at exports.handler (/home/maachang/project/public/api/users.mt.js:15:23)
    at executeJs (/home/maachang/project/src/router.js:280:20)
    ...
```

本番モードでクライアントに汎用 500 を返却した場合でも、サーバー管理者はログファイルを確認することで発生箇所と原因を即座に特定・対処できます。
