# JHTML ドキュメント

jhtml テンプレートファイル（`.mt.html`）を JavaScript コードに変換する超軽量なテンプレートエンジンモジュール。

---

## 概要

JHTML は、HTML テンプレート内に JavaScript コードを埋め込む独自のテンプレート構文を解析し、実行可能な JavaScript コードへ変換します。

- **テンプレート構文**: `<% %>`, `<%= %>`, `<%- %>`, `<%# %>`, `${ }` の埋め込みタグ
- **組み込み機能**: `$out`, `$escape`, `$include`, `$params`, `$request`, `$response`, `$db`
- **本番最適化**: 開発時は `.mt.html` をオンデマンド変換し、本番デプロイ時は `mcbuild` コマンドで事前コンパイル（`.jhtml.js`）して最速実行

---

## テンプレート構文

### 1. `<% ... %>` — コード埋め込み
制御構文（`if`, `for` など）を記述します。
```html
<% if (showHeader) { %>
  <h1>ヘッダー</h1>
<% } %>
```

### 2. `<%= ... %>` — 式の出力（自動 HTML エスケープ / XSS 対策）
JavaScript の式を評価し、HTML 特殊文字（`&`, `<`, `>`, `"`, `'`）を自動エスケープして出力します。
```html
<p>ユーザー名: <%= user.name %></p>
```

### 3. `<%- ... %>` — 生の HTML 出力（Raw 出力 / エスケープなし）
JavaScript の式を評価し、エスケープを行わずにそのまま HTML 出力へ挿入します（リッチテキスト等の出力用）。
```html
<div><%- user.htmlContent %></div>
```

### 4. `<%# ... %>` — コメント
コメント用タグ。変換後の JavaScript には出力されません。
```html
<%# ここはコメントです。出力されません。 %>
```

### 5. `${ ... }` — テンプレート式（出力ショートハンド / 自動 HTML エスケープ）
`<%= ... %>` と同等の機能を持つ簡略記法です。式の内容は自動的に HTML エスケープされます。
```html
<p>ユーザー名: ${user.name}</p>
<p>合計: ${items.reduce((a, b) => a + b, 0)}</p>
```

---

## 組み込み機能一覧

| 名前 | 種別 | 説明 |
|---|---|---|
| `$out` | Function | 文字列を出力バッファへ追加する関数。`$out("A")("B")` のようにチェーン呼び出し可能。 |
| `$escape` | Function | HTML 特殊文字（`&`, `<`, `>`, `"`, `'`）をエスケープする関数。 |
| `$include` | Async Function | 別テンプレート（`.mt.html` / `.jhtml.js` / `.html`）を読み込んで展開する関数。パラメータ受け渡しに対応（出力はエスケープされません）。 |
| `$params` | Object | `$include` 呼び出し時に渡されたパラメータオブジェクト（未指定時は `{}`）。 |
| `$request` | Function / Object | リクエストオブジェクト（`$request.query`, `$request.path` 等）。 |
| `$response` | Function / Object | レスポンスオブジェクト（`$response.json()`, `$response.status()` 等）。 |

---

## `$include` の使用方法

### 基本的な書き方（拡張子省略を推奨）

```html
${$include("./parts/header")}
```

または式タグでも記述可能です（コンパイル時に自動で `await` が補完されます）。

```html
<%= $include("./parts/header") %>
```

### 拡張子省略（`${$include("./parts/header")}`）が推奨される理由

maachang では、**開発中（ローカル）の実ファイルは `.mt.html`** ですが、**本番デプロイ時には `mcbuild` コマンドにより事前コンパイルされて `.jhtml.js`** に変換されます。

`$include` は内部で拡張子を自動解決するため、コード上は拡張子を省略して記述することで、開発環境（オンデマンドコンパイル）と本番環境（事前コンパイル）の両方で透過的かつ安全に動作します。

| パス指定例 | 開発環境（ローカル）の解決先 | 本番環境（mcbuild済）の解決先 | 備考 |
|---|---|---|---|
| `${$include("./parts/header")}` | `parts/header.mt.html` | `parts/header.jhtml.js` | **★ 推奨記法** |
| `${$include("./parts/header.mt.html")}` | `parts/header.mt.html` | `parts/header.jhtml.js`（自動読替） | 互換動作 |
| `${$include("./parts/footer.html")}` | `parts/footer.html` | `parts/footer.html` | 静的HTMLの直接埋め込み |

### パラメータの受け渡し (`$params`)

第2引数にオブジェクトを渡すことで、インクルード先テンプレートで `$params` として受け取ることができます。

**呼び出し元 (`public/index.mt.html`):**
```html
${$include("./parts/header", { title: "マイページ", isLogin: true })}
<main>コンテンツ</main>
${$include("./parts/footer.html")}
```

**インクルード先 (`public/parts/header.mt.html`):**
```html
<header>
  <h1>${$params.title}</h1>
  <% if ($params.isLogin) { %>
    <a href="/logout">ログアウト</a>
  <% } %>
</header>
```

### パス解決ルール

- **相対パス**: `./header` や `../parts/footer`（呼び出し元テンプレートのディレクトリ基準）
- **ルートパス**: `/parts/header`（`public/` ディレクトリ基準）
- **拡張子省略**: `${$include("./parts/header")}`（`.mt.html`、`.jhtml.js`、`.html`、`.htm` を自動解決）
- **静的 HTML**: `footer.html` などのプレーンな HTML ファイルもそのまま直接埋め込み可能

---

## フロントエンド（ブラウザ側）ランタイム (`jhtml.browser.js`)

maachang では、クライアントサイド（ブラウザ側）でも jhtml の構文や安全な HTML 生成を行える軽量ランタイム `jhtml.browser.js` を提供しています。
外部依存なし（Pure JS、数KB）で動作します。

### 読み込み方法

```html
<script src="/jhtml.browser.js"></script>
```

### 1. タグ付きテンプレートリテラル (`jhtml.html` / `jhtml.raw`)
JavaScript 内で安全・手軽に HTML を構築できます。式の内容は自動的に HTML エスケープされます。

```javascript
const { html, raw } = jhtml;

// 自動エスケープ（XSS対策）
const userContent = '<script>alert(1)</script>';
const title = 'お知らせ';
const cardHtml = html`
  <div class="card">
    <h3>${title}</h3>
    <p>${userContent}</p>
    ${raw('<span class="badge">Safe HTML</span>')}
  </div>
`;

// 配列展開も自動連結
const listHtml = html`
  <ul>
    ${items.map(item => html`<li>${item.name}</li>`)}
  </ul>
`;
```

### 2. JHTML テンプレート構文 (<script type="text/jhtml">)
HTML 側に `<% %>` や `${}` を使ったテンプレートを宣言しておき、データだけを渡してレンダリングします。

```html
<!-- HTML 側 -->
<script type="text/jhtml" id="tpl-user-card">
  <div class="user-card <%= isActive ? 'active' : '' %>">
    <h4>${name}</h4>
    <% if (bio) { %>
      <p class="bio">${bio}</p>
    <% } %>
  </div>
</script>

<div id="userList"></div>

<!-- JavaScript 側 -->
<script>
  // DOM の ID を指定してレンダリング
  const htmlStr = await jhtml.render('tpl-user-card', {
    name: 'Taro',
    bio: 'よろしくお願いします',
    isActive: true
  });

  // または renderTo で要素へ直接挿入
  await jhtml.renderTo('userList', 'tpl-user-card', userData);
</script>
```
