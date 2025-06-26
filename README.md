# Gemini CLI MCP Server for Deno

Google Gemini CLIを使用したWeb検索機能を提供するModel Context Protocol (MCP)サーバーのDeno実装です。

## 必要条件

- Deno v1.40以上
- [gemini-cli](https://github.com/google/generative-ai-docs/tree/main/examples/gemini-cli)がインストール済みでPATHに通っていること

## インストール

### 方法1: GitHubから直接実行（推奨）

インストール不要で、GitHubから直接実行できます。

### 方法2: ローカルクローン

```bash
git clone https://github.com/nabekou29/gemini-cli-mcp-server.git
cd gemini-cli-mcp-server
```

## 使用方法

### 開発モード

```bash
deno task dev
```

### ビルド

実行可能ファイルを作成する場合：

```bash
deno task build
```

### Claude Desktopの設定

Claude Desktopの設定ファイルに以下を追加してください：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json` **Windows**:
`%APPDATA%\Claude\claude_desktop_config.json`

#### 方法1: GitHubから直接実行（推奨）

```json
{
  "mcpServers": {
    "gemini-cli-search": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-run",
        "--allow-env",
        "https://raw.githubusercontent.com/nabekou29/gemini-cli-mcp-server/main/mod.ts"
      ]
    }
  }
}
```

#### 方法2: ローカルファイルから実行

```json
{
  "mcpServers": {
    "gemini-cli-search": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-run",
        "--allow-env",
        "/path/to/gemini-cli-mcp-server/main.ts"
      ]
    }
  }
}
```

#### 方法3: ビルドした実行ファイルを使用

```json
{
  "mcpServers": {
    "gemini-cli-search": {
      "command": "/path/to/gemini-cli-mcp-server"
    }
  }
}
```

## 提供される機能

### ツール

#### `search_web_with_gemini`

Gemini CLIを使用してWeb検索を実行し、最新の情報を取得します。

**機能:**

- リアルタイムのWeb検索
- 結果の自動キャッシュ（1時間）
- 詳細なエラーハンドリング

**パラメータ:**

- `query` (string, 必須): 検索クエリ（1-500文字）
- `useCache` (boolean, オプション): キャッシュを使用するか（デフォルト: true）

**使用例:**

```
"最新のTypeScriptの機能について検索して"
"Deno vs Node.js 2024年の比較を検索"
```

#### `clear_gemini_search_cache`

検索結果のキャッシュをクリアします。

**パラメータ:**

- `query` (string, オプション): 特定のクエリのキャッシュをクリア。未指定の場合は全キャッシュをクリア

#### `view_search_history`

最近の検索履歴を表示します。

**パラメータ:**

- `limit` (number, オプション): 表示件数（1-100、デフォルト: 10）
- `includeErrors` (boolean, オプション): エラーも含めるか（デフォルト: false）

### リソース

- `gemini://cache/status`: 現在のキャッシュ状態
- `gemini://history/recent`: 最近の検索履歴

### プロンプト

- `search_analysis`: トピックについて包括的な分析を行うプロンプト
- `comparative_search`: 複数項目の比較分析を行うプロンプト

## テスト

### ユニットテスト

```bash
deno task test
```

### 動作確認（コマンドライン）

GitHubから直接実行してテスト：

```bash
# 直接実行
deno run --allow-read --allow-run --allow-env \
  https://raw.githubusercontent.com/nabekou29/gemini-cli-mcp-server/main/mod.ts
```

## トラブルシューティング

### gemini-cli not found エラー

gemini-cliがインストールされていない、またはPATHに追加されていない場合に発生します。

```bash
# gemini-cliの存在確認
which gemini

# インストールされていない場合はインストール
# (インストール方法はgemini-cliのドキュメントを参照)
```

### Permission denied エラー

必要な権限が不足している場合に発生します。以下の権限が必要です：

- `--allow-read`: ファイル読み取り
- `--allow-run`: 外部コマンド（gemini）の実行
- `--allow-env`: 環境変数へのアクセス

## ライセンス

MIT License
