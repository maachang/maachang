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

### 利用方法・配置方針

maachang では、プロジェクトが単体で自己完結し、本番環境へのデプロイやオフライン実行時にも安全に動作することを最重視しています。そのため、**プロジェクト内に静的ファイルとして配置する運用（方法A）を公式推奨**とし、フレームワーク側からの暗黙的なフォールバック配信（方法B）は非推奨としています。

#### 【推奨】方法A: プロジェクト内に配置して読み込む（自己完結型）
プロジェクト単体でアセットを完結させ、デプロイ先での依存崩れを防ぎます。
- **新規プロジェクトの場合**: `mkmc <プロジェクト名>` で作成すると、`public/jhtml.browser.js` が**自動的に同梱**されます。
- **既存プロジェクト（または sdServer 等）の場合**: maachang の `public/jhtml.browser.js` をプロジェクトの `public/`（または `public/js/`）にコピーして配置します。

```bash
# プロジェクトルートで配置
cp ${MAACHANG_HOME}/public/jhtml.browser.js ./public/
# または js ディレクトリ配下へ配置
# cp ${MAACHANG_HOME}/public/jhtml.browser.js ./public/js/
```

#### フレームワーク本体からの自動フォールバック機能（コピー不要）
maachang サーバー（ルーター）は、プロジェクトの `public/` に要求された静的ファイルが存在しない場合、**フレームワーク本体（`$MAACHANG_HOME/public`）配下を自動でフォールバック探索**します（`$loadLib` や `$loadConf` と同様の階層解決）。

そのため、**プロジェクト側にファイルをコピーしていなくても**、HTML に以下を記述するだけで即座に動作します：
```html
<script src="/jhtml.browser.js"></script>
```

> **プロジェクトでのカスタマイズ（オーバーライド）**:
> もしプロジェクト側の `public/jhtml.browser.js` に同名ファイルを配置した場合は、プロジェクト側のファイルが最優先で配信されます。
---

### 機能と使い方

`jhtml.browser.js` は、用途に合わせて **2つの書き方（テンプレートリテラル vs JHTML構文）** を使い分けられます。

#### 1. タグ付きテンプレートリテラル (`jhtml.html` / `jhtml.raw`)
JavaScript 内でサクッと安全に HTML を組み立てたい場合に最適です。式（`${...}`）は自動的に HTML エスケープされます。手動の `escapeHtml()` の記述や、書き忘れによる XSS を根絶できます。

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

### 3. DOM 操作ショートカット (`jhtml.$` / `jhtml.$$` / `jhtml.refs`)

`document.getElementById` や `querySelectorAll` の記述量を大幅に削減する極小ヘルパーです。

```javascript
const { $, $$, refs } = jhtml;

// 単一要素取得 (ID または セレクタ)
const btn = $('submitBtn');             // getElementById('submitBtn') 優先
const activeTab = $('.tab-btn.active'); // querySelector('.tab-btn.active')

// 複数要素取得 (Array.from(querySelectorAll))
const tabButtons = $$('.tab-btn');
tabButtons.forEach(b => b.classList.remove('active'));

// 複数 ID の一括取得 (オブジェクト分割代入で大量の const 宣言を1行に短縮)
const { overlay, title, progressBar, alertBox } = refs(
    'overlay', 'title', 'progressBar', 'alertBox'
);
```

### 4. イベントリスナー & イベント委任 (`jhtml.on`)

直接要素への登録に加え、`innerHTML` による動的追加・再描画後もイベントが途切れない **イベント委任（Event Delegation）** をサポートしています。

```javascript
const { on } = jhtml;

// 直接バインド (セレクタ指定で複数要素も一度に登録可能)
on('.tab-btn', 'click', (e) => {
    // タブ切り替え処理
});

// 【強力】イベント委任 (動的に生成される要素に最適)
// #modelList 配下の .btn-select がクリックされた時に発火
on('#modelList', 'click', '.btn-select', (e, target) => {
    console.log('選択されたID:', target.dataset.id);
});
```

### 5. 軽量 API 通信クライアント (`jhtml.api`)

ブラウザ標準の `fetch` をラップし、JSON シリアライズ/デシリアライズ、エラー判定、ローディングオーバーレイの表示制御を 1 行で完結させます。

```javascript
const { api } = jhtml;

// 1. GET リクエスト (自動 JSON パース)
const res = await api.get('/api/models');
console.log(res.models);

// 2. POST リクエスト (オブジェクトを自動 JSON 化 & Content-Type 付与)
await api.post('/api/models', { modelId: 'sd-v1-5' });

// 3. ローディング要素との自動連動
// 通信開始時に #loadingOverlay を表示し、完了時に自動で非表示化
await api.post('/api/generate', promptData, { loading: '#loadingOverlay' });

// 4. その他の HTTP メソッド
await api.put('/api/config', newConfig);
await api.del('/api/models/sd-v1-5');
```

### 6. フォーム入出力ユーティリティ (`jhtml.form` / `jhtml.form.fill`)

設定画面や入力フォームの値を 1 行でオブジェクト化したり、API から取得したデータをフォームへ一括流し込みできます。

```javascript
const { form, api } = jhtml;

// 1. フォームの入力値を一括取得（input/select/textarea をオブジェクト化）
// name 属性、または id 属性をキーとして抽出 (checkbox は boolean, number は数値化)
const formData = form('#settingsForm');
// => { endpoint: 'http://localhost:8080', apiKey: 'secret', enableLlm: true }

// そのまま API 送信
await api.post('/api/settings', formData);

// 2. オブジェクトデータをフォームの各入力欄へ一括反映 (fill)
const settings = await api.get('/api/settings');
form.fill('#settingsForm', settings);
```

### 7. 表示・スタイル制御 (`show` / `hide` / `toggle` / `addClass` / `removeClass`)

`el.style.display` や `classList` 操作の直感的なショートカットです。セレクタ文字列または DOM 要素を渡せます。

```javascript
const { show, hide, toggle, addClass, removeClass } = jhtml;

// 表示 / 非表示
show('#loadingOverlay');         // display = 'block'
show('#loadingOverlay', 'flex'); // display = 'flex'
hide('#loadingOverlay');         // display = 'none'

// 条件付き表示 (真偽値で切り替え)
toggle('#deleteModal', isModalOpen);

// クラス操作 (複数クラス一括対応)
addClass('.tab-btn', 'active');
removeClass('.tab-btn', 'active');
```

### 8. 簡易リアクティブ状態 (`jhtml.state`)

Proxy を利用した極小（数十行）のリアクティブオブジェクトです。プロパティを書き換えるだけで、画面描画を自動更新できます。

```javascript
const { state, renderTo, api } = jhtml;

// 状態オブジェクトを作成 (プロパティ変更時にコールバック実行)
const app = state({ models: [], activeId: '' }, async (prop, val) => {
    // 状態が変化したら該当エリアを自動再描画
    await renderTo('modelList', 'tpl-model-card', { models: app.models, activeId: app.activeId });
});

// データを代入するだけで、画面が自動再描画される
app.models = await api.get('/api/models');
```
