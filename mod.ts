#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env

import { Server } from "npm:@modelcontextprotocol/sdk@1.3.0/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.3.0/server/stdio.js";
import { z } from "npm:zod@3.24.1";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "npm:@modelcontextprotocol/sdk@1.3.0/types.js";

// キャッシュとログ管理
interface CacheEntry {
  result: string;
  timestamp: number;
}

interface SearchLog {
  query: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

// グローバルストレージ
const searchCache = new Map<string, CacheEntry>();
const searchHistory: SearchLog[] = [];
const CACHE_TTL = 60 * 60 * 1000; // 1時間
const MAX_HISTORY = 100;

// エラータイプの定義
enum ErrorType {
  GEMINI_NOT_FOUND = "GEMINI_NOT_FOUND",
  GEMINI_EXECUTION_ERROR = "GEMINI_EXECUTION_ERROR",
  INVALID_QUERY = "INVALID_QUERY",
  CACHE_ERROR = "CACHE_ERROR",
}

// Gemini CLIを実行するための関数（強化版）
async function executeGeminiSearch(
  query: string,
  useCache = true,
): Promise<string> {
  // 入力検証
  if (!query || query.trim().length === 0) {
    throw new Error(`${ErrorType.INVALID_QUERY}: 検索クエリが空です`);
  }

  if (query.length > 500) {
    throw new Error(
      `${ErrorType.INVALID_QUERY}: 検索クエリが長すぎます（最大500文字）`,
    );
  }

  // キャッシュチェック
  if (useCache) {
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.error(`[Cache Hit] Query: ${query}`);

      // 成功履歴を記録
      searchHistory.push({
        query,
        timestamp: Date.now(),
        success: true,
      });

      // 履歴サイズ管理
      if (searchHistory.length > MAX_HISTORY) {
        searchHistory.shift();
      }

      return cached.result;
    }
  }

  console.error(`[Gemini Search] Executing query: ${query}`);

  const command = new Deno.Command("gemini", {
    args: ["-p", `WebSearch: ${query}`],
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const { code, stdout, stderr } = await command.output();

    if (code !== 0) {
      const errorMessage = new TextDecoder().decode(stderr);
      throw new Error(`${ErrorType.GEMINI_EXECUTION_ERROR}: ${errorMessage}`);
    }

    const result = new TextDecoder().decode(stdout);

    // 結果をキャッシュ
    if (useCache) {
      searchCache.set(query, {
        result,
        timestamp: Date.now(),
      });
    }

    // 成功履歴を記録
    searchHistory.push({
      query,
      timestamp: Date.now(),
      success: true,
    });

    // 履歴サイズ管理
    if (searchHistory.length > MAX_HISTORY) {
      searchHistory.shift();
    }

    return result;
  } catch (error) {
    // エラー履歴を記録
    searchHistory.push({
      query,
      timestamp: Date.now(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `${ErrorType.GEMINI_NOT_FOUND}: gemini-cli が見つかりません。インストールされていることと、PATHに含まれていることを確認してください。`,
      );
    }
    throw error;
  }
}

// MCPサーバーの初期化
const server = new Server(
  {
    name: "gemini-cli-mcp-server",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

// ツールのスキーマ定義
const SearchWebSchema = z.object({
  query: z
    .string()
    .min(1, "検索クエリは必須です")
    .max(500, "検索クエリは500文字以内にしてください")
    .describe(
      "Web検索に使用するクエリ文字列（例：'TypeScript best practices 2024'）",
    ),
  useCache: z
    .boolean()
    .optional()
    .default(true)
    .describe("キャッシュされた結果を使用するか（デフォルト: true）"),
});

const ClearCacheSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "特定のクエリのキャッシュをクリア。未指定の場合は全キャッシュをクリア",
    ),
});

const ViewHistorySchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe("表示する履歴の件数（1-100、デフォルト: 10）"),
  includeErrors: z
    .boolean()
    .optional()
    .default(false)
    .describe("エラーになった検索も含めるか（デフォルト: false）"),
});

// ツール一覧の登録
server.setRequestHandler(ListToolsRequestSchema, () => {
  return {
    tools: [
      {
        name: "search_web_with_gemini",
        description: `Gemini CLIを使用してWeb検索を実行し、最新の情報を取得します。
        
        このツールは以下の機能を提供します：
        - リアルタイムのWeb検索
        - 結果のキャッシュ（1時間）
        - エラーハンドリングとリトライ戦略
        
        成功時：検索結果のテキストを返します
        エラー時：エラータイプと詳細なメッセージを返します`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Web検索に使用するクエリ文字列（例：'TypeScript best practices 2024'）",
              minLength: 1,
              maxLength: 500,
            },
            useCache: {
              type: "boolean",
              description: "キャッシュされた結果を使用するか（デフォルト: true）",
              default: true,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "clear_gemini_search_cache",
        description: `検索結果のキャッシュをクリアします。
        
        特定のクエリまたは全キャッシュをクリアできます。
        パフォーマンス向上のため、通常はキャッシュクリアは不要です。`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "特定のクエリのキャッシュをクリア。未指定の場合は全キャッシュをクリア",
            },
          },
        },
      },
      {
        name: "view_search_history",
        description: `最近の検索履歴を表示します。
        
        デバッグや検索パターンの分析に使用できます。`,
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "表示する履歴の件数（1-100、デフォルト: 10）",
              minimum: 1,
              maximum: 100,
              default: 10,
            },
            includeErrors: {
              type: "boolean",
              description: "エラーになった検索も含めるか（デフォルト: false）",
              default: false,
            },
          },
        },
      },
    ],
  };
});

// ツール実行ハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();

  try {
    switch (request.params.name) {
      case "search_web_with_gemini": {
        const args = SearchWebSchema.parse(request.params.arguments);

        console.error(
          `[Tool Call] search_web_with_gemini - Query: "${args.query}", Cache: ${args.useCache}`,
        );

        try {
          const result = await executeGeminiSearch(args.query, args.useCache);

          console.error(
            `[Tool Success] Execution time: ${Date.now() - startTime}ms`,
          );

          return {
            content: [
              {
                type: "text",
                text: result,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const [errorType, ...messageParts] = errorMessage.split(": ");

          return {
            content: [
              {
                type: "text",
                text: `エラーが発生しました:
                
タイプ: ${errorType}
詳細: ${messageParts.join(": ")}

対処法:
${
                  errorType === ErrorType.GEMINI_NOT_FOUND
                    ? "1. gemini-cli がインストールされているか確認\n2. gemini コマンドがPATHに含まれているか確認\n3. 'which gemini' コマンドで場所を確認"
                    : errorType === ErrorType.INVALID_QUERY
                    ? "1. クエリが空でないことを確認\n2. クエリが500文字以内であることを確認"
                    : "1. gemini-cli が正常に動作するか確認\n2. ネットワーク接続を確認"
                }`,
              },
            ],
            isError: true,
          };
        }
      }

      case "clear_gemini_search_cache": {
        const args = ClearCacheSchema.parse(request.params.arguments);

        if (args.query) {
          const existed = searchCache.has(args.query);
          searchCache.delete(args.query);

          console.error(
            `[Cache Clear] Query: "${args.query}", Existed: ${existed}`,
          );

          return {
            content: [
              {
                type: "text",
                text: existed
                  ? `クエリ "${args.query}" のキャッシュをクリアしました`
                  : `クエリ "${args.query}" はキャッシュに存在しませんでした`,
              },
            ],
          };
        } else {
          const size = searchCache.size;
          searchCache.clear();

          console.error(`[Cache Clear] All caches cleared. Count: ${size}`);

          return {
            content: [
              {
                type: "text",
                text: `全キャッシュをクリアしました（${size}件）`,
              },
            ],
          };
        }
      }

      case "view_search_history": {
        const args = ViewHistorySchema.parse(request.params.arguments);

        const filtered = args.includeErrors
          ? searchHistory
          : searchHistory.filter((log) => log.success);

        const recent = filtered.slice(-(args.limit ?? 10)).reverse();

        const formatted = recent
          .map((log, i) => {
            const time = new Date(log.timestamp).toLocaleString("ja-JP");
            const status = log.success ? "✓" : "✗";
            const error = log.error ? ` (${log.error})` : "";
            return `${i + 1}. ${status} [${time}] "${log.query}"${error}`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: formatted || "検索履歴がありません",
            },
          ],
        };
      }

      default:
        throw new Error(`不明なツール: ${request.params.name}`);
    }
  } catch (error) {
    console.error(`[Tool Error] ${request.params.name}:`, error);

    return {
      content: [
        {
          type: "text",
          text: `内部エラー: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// リソース一覧の登録
server.setRequestHandler(ListResourcesRequestSchema, () => {
  return {
    resources: [
      {
        uri: "gemini://cache/status",
        name: "キャッシュステータス",
        description: "現在のキャッシュ状態と統計情報",
        mimeType: "application/json",
      },
      {
        uri: "gemini://history/recent",
        name: "最近の検索履歴",
        description: "最近実行された検索のログ",
        mimeType: "application/json",
      },
    ],
  };
});

// リソース読み取りハンドラー
server.setRequestHandler(ReadResourceRequestSchema, (request) => {
  switch (request.params.uri) {
    case "gemini://cache/status": {
      const cacheEntries = Array.from(searchCache.entries()).map(
        ([query, entry]) => ({
          query,
          timestamp: new Date(entry.timestamp).toISOString(),
          ageMinutes: Math.floor((Date.now() - entry.timestamp) / 1000 / 60),
          expires: new Date(entry.timestamp + CACHE_TTL).toISOString(),
        }),
      );

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                totalEntries: searchCache.size,
                ttlMinutes: CACHE_TTL / 1000 / 60,
                entries: cacheEntries,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "gemini://history/recent": {
      const recent = searchHistory.slice(-20).reverse();

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                total: searchHistory.length,
                showing: recent.length,
                history: recent.map((log) => ({
                  ...log,
                  timestamp: new Date(log.timestamp).toISOString(),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`不明なリソース: ${request.params.uri}`);
  }
});

// プロンプト一覧の登録
server.setRequestHandler(ListPromptsRequestSchema, () => {
  return {
    prompts: [
      {
        name: "search_analysis",
        description: "Web検索結果を分析して要約するプロンプト",
        arguments: [
          {
            name: "topic",
            description: "検索・分析したいトピック",
            required: true,
          },
        ],
      },
      {
        name: "comparative_search",
        description: "複数の観点から検索して比較分析するプロンプト",
        arguments: [
          {
            name: "items",
            description: "比較したい項目（カンマ区切り）",
            required: true,
          },
          {
            name: "criteria",
            description: "比較基準",
            required: true,
          },
        ],
      },
    ],
  };
});

// プロンプト取得ハンドラー
server.setRequestHandler(GetPromptRequestSchema, (request) => {
  switch (request.params.name) {
    case "search_analysis":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `以下のトピックについてWeb検索を行い、包括的な分析を提供してください。

トピック: ${request.params.arguments?.topic || "[トピックを指定してください]"}

以下の手順で進めてください：
1. search_web_with_gemini ツールを使用してトピックを検索
2. 必要に応じて関連キーワードで追加検索
3. 収集した情報を以下の観点で分析：
   - 主要なポイントの要約
   - 最新のトレンドや動向
   - 重要な統計やデータ
   - 今後の展望や予測
4. 情報源の信頼性も考慮して結論を提示

search_web_with_gemini ツールを使用して情報を収集してください。`,
            },
          },
        ],
      };

    case "comparative_search": {
      const items = request.params.arguments?.items || "項目1, 項目2";
      const criteria = request.params.arguments?.criteria || "特徴、利点、欠点";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `以下の項目について比較検索を行い、分析結果を提供してください。

比較項目: ${items}
比較基準: ${criteria}

以下の手順で進めてください：
1. 各項目について search_web_with_gemini ツールで個別に検索
2. 指定された基準に基づいて情報を整理
3. 比較表を作成して違いを明確化
4. それぞれの長所と短所を分析
5. 使用シナリオに応じた推奨事項を提示

必ず search_web_with_gemini ツールを使用して最新の情報を収集してください。`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`不明なプロンプト: ${request.params.name}`);
  }
});

// サーバーの起動
async function main() {
  const transport = new StdioServerTransport();

  console.error("=== Gemini CLI MCP Server v2.0.0 ===");
  console.error(`キャッシュTTL: ${CACHE_TTL / 1000 / 60}分`);
  console.error(`最大履歴数: ${MAX_HISTORY}件`);
  console.error("起動中...");

  await server.connect(transport);

  console.error("サーバーが正常に起動しました（stdio）");
}

// エラーハンドリング付きで起動
if (import.meta.main) {
  main().catch((error) => {
    console.error("致命的エラー:", error);
    Deno.exit(1);
  });
}

// エクスポート（テスト用）
export { ErrorType, executeGeminiSearch, searchCache, searchHistory };
