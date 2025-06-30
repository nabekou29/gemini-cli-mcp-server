<div align="center">

# 🔮 Gemini CLI MCP Server

> **🤖 このプロジェクトは100% Claude Codeによって開発されました**

<p align="center">
  <img src="https://img.shields.io/badge/Deno-1.40+-000000?style=for-the-badge&logo=deno&logoColor=white" alt="Deno Version">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License">
  <img src="https://img.shields.io/badge/MCP-Compatible-purple?style=for-the-badge" alt="MCP Compatible">
  <img src="https://img.shields.io/badge/Claude-Desktop-orange?style=for-the-badge" alt="Claude Desktop">
  <img src="https://img.shields.io/badge/Built%20with-Claude%20Code-6B5FF0?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code">
</p>

<p align="center">
  <strong>Google Gemini CLIを活用した高速Web検索をClaude Desktopに統合</strong>
</p>

<p align="center">
  <a href="#-特徴">特徴</a> •
  <a href="#-クイックスタート">クイックスタート</a> •
  <a href="#-インストール">インストール</a> •
  <a href="#-使い方">使い方</a> •
  <a href="#-api">API</a> •
  <a href="#-貢献">貢献</a>
</p>

</div>

---

## ✨ 特徴

<table>
<tr>
<td width="60%" valign="top">

### 🚀 **高速検索**

リアルタイムWeb検索で最新情報を即座に取得

### 💾 **スマートキャッシュ**

1時間の自動キャッシュで高速レスポンス

### 🛡️ **堅牢なエラーハンドリング**

詳細なエラーメッセージと解決策を提供

### 🎯 **MCP標準準拠**

Model Context Protocolに完全準拠

</td>
<td width="40%" valign="top">

```typescript
// 使用例
await search_web_with_gemini({
  query: "Deno 最新機能 2024",
  useCache: true
});

// レスポンス
{
  "content": [{
    "type": "text",
    "text": "検索結果..."
  }]
}
```

</td>
</tr>
</table>

## 🚀 クイックスタート

### 📋 前提条件

- **Deno** v1.40以上
- **[gemini-cli](https://github.com/google/generative-ai-docs/tree/main/examples/gemini-cli)** がPATHに設定済み
- **Claude Desktop** アプリケーション

### ⚡ 30秒セットアップ

1. **Claude Desktopの設定ファイルを開く**

   | OS         | パス                                                              |
   | ---------- | ----------------------------------------------------------------- |
   | 🍎 macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
   | 🪟 Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |

2. **以下の設定を追加**

   ```json
   {
     "mcpServers": {
       "gemini-cli-search": {
         "command": "deno",
         "args": [
           "run",
           "--allow-run=gemini",
           "https://raw.githubusercontent.com/nabekou29/gemini-cli-mcp-server/main/mod.ts"
         ]
       }
     }
   }
   ```

3. **Claude Desktopを再起動** 🎉

## 📦 インストール

### 🌐 方法1: GitHubから直接実行（推奨）

インストール不要！上記のクイックスタートの設定だけでOK

### 💻 方法2: ローカルインストール

```bash
# リポジトリをクローン
git clone https://github.com/nabekou29/gemini-cli-mcp-server.git
cd gemini-cli-mcp-server

# 開発モードで実行
deno task dev

# または実行ファイルをビルド
deno task build
```

<details>
<summary>📝 ローカル実行の設定</summary>

```json
{
  "mcpServers": {
    "gemini-cli-search": {
      "command": "deno",
      "args": [
        "run",
        "--allow-run=gemini",
        "/path/to/gemini-cli-mcp-server/mod.ts"
      ]
    }
  }
}
```

</details>

## 🎮 使い方

### 🔍 Web検索を実行

```typescript
// Claudeで使用例
"TypeScript 5.6の新機能について検索して";
"Deno vs Bun 2024年の比較を調べて";
```

### 🧹 キャッシュ管理

```typescript
// 特定のクエリのキャッシュをクリア
clear_gemini_search_cache({ query: "TypeScript" });

// 全キャッシュをクリア
clear_gemini_search_cache({});
```

### 📊 検索履歴

```typescript
// 最近の検索履歴を表示
view_search_history({
  limit: 20,
  includeErrors: false,
});
```

## 📚 API

### 🛠️ ツール

| ツール                      | 説明             | パラメータ                                                       |
| --------------------------- | ---------------- | ---------------------------------------------------------------- |
| `search_web_with_gemini`    | Web検索を実行    | `query` (string, 必須)<br>`useCache` (boolean, デフォルト: true) |
| `clear_gemini_search_cache` | キャッシュクリア | `query` (string, オプション)                                     |
| `view_search_history`       | 履歴表示         | `limit` (number, 1-100)<br>`includeErrors` (boolean)             |

### 📂 リソース

| URI                       | 説明                 |
| ------------------------- | -------------------- |
| `gemini://cache/status`   | 現在のキャッシュ状態 |
| `gemini://history/recent` | 最近の検索履歴       |

### 💬 プロンプト

| 名前                 | 説明                 |
| -------------------- | -------------------- |
| `search_analysis`    | トピックの包括的分析 |
| `comparative_search` | 複数項目の比較分析   |

## 🤖 開発について

このプロジェクトは**100% Claude Code**によって開発されました。コードの生成、テストの作成、ドキュメントの執筆まで、すべてClaude Codeによって行われています。

### Claude Codeによる開発の特徴

- 🧠 **高品質なコード生成** - ベストプラクティスに従った実装
- 🔍 **包括的なエラーハンドリング** - 予期しないエラーへの対処
- 📚 **詳細なドキュメント** - わかりやすく構造化された説明
- ✅ **テスト駆動開発** - 信頼性の高いコード

## 🤝 貢献

貢献を歓迎します！以下の方法で参加できます：

1. 🐛 [Issue](https://github.com/nabekou29/gemini-cli-mcp-server/issues)でバグ報告
2. 💡 新機能の提案
3. 🔧 プルリクエストの送信

### 開発環境のセットアップ

```bash
# テストの実行
deno test --allow-run=gemini

# フォーマット
deno fmt

# リント
deno lint
```

## 📄 ライセンス

このプロジェクトは[MIT License](LICENSE)の下で公開されています。

---

<div align="center">

**Built with 🤖 [Claude](https://claude.ai) by [nabekou29](https://github.com/nabekou29)**

<p>
  <em>このプロジェクトは100% Claude Codeによって開発されました</em>
</p>

<p>
  <a href="https://github.com/nabekou29/gemini-cli-mcp-server">
    <img src="https://img.shields.io/github/stars/nabekou29/gemini-cli-mcp-server?style=social" alt="GitHub stars">
  </a>
</p>

</div>


