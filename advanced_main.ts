import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// キャッシュの型定義
interface CacheEntry {
  result: string;
  timestamp: number;
}

// メモリキャッシュ（本番環境ではDeno KVを使用することを推奨）
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000; // 1時間

// Gemini CLIを実行するための関数（キャッシュ付き）
async function executeGeminiSearch(query: string, useCache = true): Promise<string> {
  // キャッシュチェック
  if (useCache) {
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.error(`Using cached result for: ${query}`);
      return cached.result;
    }
  }

  const command = new Deno.Command("gemini", {
    args: ["-p", `WebSearch: ${query}`],
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const errorMessage = new TextDecoder().decode(stderr);
      throw new Error(`Gemini CLI error: ${errorMessage}`);
    }

    const result = new TextDecoder().decode(stdout);
    
    // 結果をキャッシュ
    if (useCache) {
      searchCache.set(query, {
        result,
        timestamp: Date.now(),
      });
    }

    return result;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "gemini-cli not found. Please ensure it's installed and in your PATH."
      );
    }
    throw error;
  }
}

// MCPサーバーの初期化
const server = new Server(
  {
    name: "gemini-cli-search-advanced",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {}, // リソース機能も追加
    },
  }
);

// 検索ツールのスキーマ
const SearchToolSchema = z.object({
  query: z.string().describe("The search query to send to Gemini"),
  useCache: z.boolean().optional().default(true).describe("Whether to use cached results"),
});

// キャッシュクリアツールのスキーマ
const ClearCacheSchema = z.object({
  query: z.string().optional().describe("Specific query to clear from cache, or empty to clear all"),
});

// ツール一覧の登録
server.setRequestHandler("tools/list", () => {
  return {
    tools: [
      {
        name: "gemini_search",
        description: "Search the web using Gemini CLI with caching support",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to send to Gemini",
            },
            useCache: {
              type: "boolean",
              description: "Whether to use cached results (default: true)",
              default: true,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "clear_search_cache",
        description: "Clear the search cache",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Specific query to clear from cache, or empty to clear all",
            },
          },
        },
      },
    ],
  };
});

// ツール実行ハンドラー
server.setRequestHandler("tools/call", async (request) => {
  try {
    switch (request.params.name) {
      case "gemini_search": {
        const args = SearchToolSchema.parse(request.params.arguments);
        
        console.error(`Executing Gemini search for: ${args.query} (cache: ${args.useCache})`);
        
        const result = await executeGeminiSearch(args.query, args.useCache);
        
        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }
      
      case "clear_search_cache": {
        const args = ClearCacheSchema.parse(request.params.arguments);
        
        if (args.query) {
          searchCache.delete(args.query);
          console.error(`Cleared cache for query: ${args.query}`);
          return {
            content: [
              {
                type: "text",
                text: `Cache cleared for query: "${args.query}"`,
              },
            ],
          };
        } else {
          const size = searchCache.size;
          searchCache.clear();
          console.error(`Cleared entire cache (${size} entries)`);
          return {
            content: [
              {
                type: "text",
                text: `Entire cache cleared (${size} entries)`,
              },
            ],
          };
        }
      }
      
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    console.error("Error in tool execution:", error);
    
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// リソース一覧の登録
server.setRequestHandler("resources/list", () => {
  return {
    resources: [
      {
        uri: "cache://status",
        name: "Cache Status",
        description: "Current cache status and statistics",
        mimeType: "application/json",
      },
    ],
  };
});

// リソース読み取りハンドラー
server.setRequestHandler("resources/read", (request) => {
  if (request.params.uri === "cache://status") {
    const cacheEntries = Array.from(searchCache.entries()).map(([query, entry]) => ({
      query,
      timestamp: new Date(entry.timestamp).toISOString(),
      age: Math.floor((Date.now() - entry.timestamp) / 1000 / 60), // 分単位
    }));
    
    return {
      contents: [
        {
          uri: "cache://status",
          mimeType: "application/json",
          text: JSON.stringify({
            totalEntries: searchCache.size,
            ttlMinutes: CACHE_TTL / 1000 / 60,
            entries: cacheEntries,
          }, null, 2),
        },
      ],
    };
  }
  
  throw new Error(`Unknown resource: ${request.params.uri}`);
});

// サーバーの起動
async function main() {
  const transport = new StdioServerTransport();
  
  console.error("Starting Advanced Gemini CLI MCP Server...");
  console.error(`Cache TTL: ${CACHE_TTL / 1000 / 60} minutes`);
  
  await server.connect(transport);
  
  console.error("Advanced Gemini CLI MCP Server is running on stdio");
}

// エラーハンドリング付きで起動
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}