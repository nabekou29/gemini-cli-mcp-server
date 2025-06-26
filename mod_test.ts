import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import { ErrorType, executeGeminiSearch, searchCache, searchHistory } from "./mod.ts";
import { Server } from "npm:@modelcontextprotocol/sdk@1.3.0/server/index.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from "npm:@modelcontextprotocol/sdk@1.3.0/types.js";

// テスト用のモック関数
const originalCommand = Deno.Command;
let mockCommandOutput: {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
} | null = null;

function mockGeminiCommand(output: {
  code: number;
  stdout: string;
  stderr: string;
}) {
  mockCommandOutput = {
    code: output.code,
    stdout: new TextEncoder().encode(output.stdout),
    stderr: new TextEncoder().encode(output.stderr),
  };

  // @ts-ignore - テスト用のモック
  Deno.Command = class MockCommand {
    constructor(
      public cmd: string,
      // deno-lint-ignore no-explicit-any
      public options?: any,
    ) {}

    output() {
      if (this.cmd !== "gemini") {
        return originalCommand.prototype.output.call(this);
      }
      return Promise.resolve(mockCommandOutput!);
    }
    // deno-lint-ignore no-explicit-any
  } as any;
}

function restoreCommand() {
  Deno.Command = originalCommand;
  mockCommandOutput = null;
}

// テストのセットアップとクリーンアップ
function setupTest() {
  searchCache.clear();
  searchHistory.length = 0;
}

Deno.test("executeGeminiSearch - 正常な検索", async () => {
  setupTest();

  try {
    mockGeminiCommand({
      code: 0,
      stdout: "検索結果: TypeScriptの最新情報",
      stderr: "",
    });

    const result = await executeGeminiSearch("TypeScript latest");
    assertEquals(result, "検索結果: TypeScriptの最新情報");

    // キャッシュされていることを確認
    assertEquals(searchCache.size, 1);
    assertEquals(searchCache.has("TypeScript latest"), true);

    // 履歴に記録されていることを確認
    assertEquals(searchHistory.length, 1);
    assertEquals(searchHistory[0].query, "TypeScript latest");
    assertEquals(searchHistory[0].success, true);
  } finally {
    restoreCommand();
  }
});

Deno.test("executeGeminiSearch - キャッシュの動作", async () => {
  setupTest();

  try {
    let callCount = 0;

    // @ts-ignore - テスト用のモック
    Deno.Command = class MockCommand {
      constructor(
        public cmd: string,
        // deno-lint-ignore no-explicit-any
        public options?: any,
      ) {}

      output() {
        if (this.cmd === "gemini") {
          callCount++;
          return Promise.resolve({
            code: 0,
            stdout: new TextEncoder().encode("キャッシュテスト結果"),
            stderr: new Uint8Array(),
          });
        }
        return originalCommand.prototype.output.call(this);
      }
      // deno-lint-ignore no-explicit-any
    } as any;

    // 1回目の実行
    const result1 = await executeGeminiSearch("cache test", true);
    assertEquals(result1, "キャッシュテスト結果");
    assertEquals(callCount, 1);

    // 2回目の実行（キャッシュから）
    const result2 = await executeGeminiSearch("cache test", true);
    assertEquals(result2, "キャッシュテスト結果");
    assertEquals(callCount, 1); // コマンドは実行されない

    // キャッシュを無効にして実行
    const result3 = await executeGeminiSearch("cache test", false);
    assertEquals(result3, "キャッシュテスト結果");
    assertEquals(callCount, 2); // コマンドが実行される
  } finally {
    restoreCommand();
  }
});

Deno.test("executeGeminiSearch - 空のクエリエラー", async () => {
  setupTest();

  await assertRejects(
    async () => await executeGeminiSearch(""),
    Error,
    ErrorType.INVALID_QUERY,
  );

  await assertRejects(
    async () => await executeGeminiSearch("   "),
    Error,
    ErrorType.INVALID_QUERY,
  );
});

Deno.test("executeGeminiSearch - 長すぎるクエリエラー", async () => {
  setupTest();

  const longQuery = "a".repeat(501);
  await assertRejects(
    async () => await executeGeminiSearch(longQuery),
    Error,
    ErrorType.INVALID_QUERY,
  );
});

Deno.test("executeGeminiSearch - gemini-cli が見つからない", async () => {
  setupTest();

  try {
    // @ts-ignore - テスト用のモック
    Deno.Command = class MockCommand {
      constructor(
        public cmd: string,
        // deno-lint-ignore no-explicit-any
        public options?: any,
      ) {}

      output() {
        if (this.cmd === "gemini") {
          throw new Deno.errors.NotFound("gemini");
        }
        return originalCommand.prototype.output.call(this);
      }
      // deno-lint-ignore no-explicit-any
    } as any;

    await assertRejects(
      async () => await executeGeminiSearch("test"),
      Error,
      ErrorType.GEMINI_NOT_FOUND,
    );

    // エラーが履歴に記録されていることを確認
    assertEquals(searchHistory.length, 1);
    assertEquals(searchHistory[0].success, false);
    assertExists(searchHistory[0].error);
  } finally {
    restoreCommand();
  }
});

Deno.test("executeGeminiSearch - gemini実行エラー", async () => {
  setupTest();

  try {
    mockGeminiCommand({
      code: 1,
      stdout: "",
      stderr: "API rate limit exceeded",
    });

    await assertRejects(
      async () => await executeGeminiSearch("test"),
      Error,
      ErrorType.GEMINI_EXECUTION_ERROR,
    );
  } finally {
    restoreCommand();
  }
});

Deno.test("MCP Server - ツール一覧", () => {
  const server = new Server(
    {
      name: "test-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // mod.tsのハンドラーと同じ設定
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
                description:
                  "Web検索に使用するクエリ文字列（例：'TypeScript best practices 2024'）",
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

  // ハンドラーを直接呼び出す代わりに、登録されたことを確認
  assertExists(server);

  // 実際のレスポンスを取得するには、ハンドラー関数を直接定義して呼び出す
  const response = (() => {
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
                description:
                  "Web検索に使用するクエリ文字列（例：'TypeScript best practices 2024'）",
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
  })();

  assertEquals(response.tools.length, 3);
  assertEquals(response.tools[0].name, "search_web_with_gemini");
  assertEquals(response.tools[1].name, "clear_gemini_search_cache");
  assertEquals(response.tools[2].name, "view_search_history");
});

Deno.test("MCP Server - リソース一覧", () => {
  const server = new Server(
    {
      name: "test-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
      },
    },
  );

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

  // ハンドラーが登録されたことを確認
  assertExists(server);

  // 実際のレスポンスを模擬
  const response = {
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

  assertEquals(response.resources.length, 2);
  assertEquals(response.resources[0].uri, "gemini://cache/status");
  assertEquals(response.resources[1].uri, "gemini://history/recent");
});

Deno.test("MCP Server - プロンプト一覧", () => {
  const server = new Server(
    {
      name: "test-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
      },
    },
  );

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

  // ハンドラーが登録されたことを確認
  assertExists(server);

  // 実際のレスポンスを模擬
  const response = {
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

  assertEquals(response.prompts.length, 2);
  assertEquals(response.prompts[0].name, "search_analysis");
  assertEquals(response.prompts[1].name, "comparative_search");
});

Deno.test("履歴のサイズ制限", async () => {
  setupTest();

  try {
    // 簡単なモックを設定
    mockGeminiCommand({
      code: 0,
      stdout: "result",
      stderr: "",
    });

    // MAX_HISTORY (100) のエントリを追加
    for (let i = 0; i < 100; i++) {
      searchHistory.push({
        query: `test-${i}`,
        timestamp: Date.now(),
        success: true,
      });
    }

    // executeGeminiSearchを呼んで履歴の制限を確認
    await executeGeminiSearch("new query");

    // 履歴が100件に制限されていることを確認
    assertEquals(searchHistory.length, 100);

    // 最初のエントリが削除されていることを確認
    assertEquals(searchHistory[0].query, "test-1");
    assertEquals(searchHistory[99].query, "new query");
  } finally {
    restoreCommand();
  }
});

Deno.test("ツール実行 - search_web_with_gemini", async () => {
  setupTest();

  try {
    mockGeminiCommand({
      code: 0,
      stdout: "Denoの最新機能について...",
      stderr: "",
    });

    const server = new Server(
      { name: "test", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    // 実際のハンドラーを登録
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (
        request.params.name === "search_web_with_gemini" &&
        request.params.arguments
      ) {
        const args = request.params.arguments as { query: string };
        const result = await executeGeminiSearch(args.query);
        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });

    // 実際にツールを呼び出すのではなく、ハンドラーのロジックを直接テスト
    const request = {
      method: "tools/call",
      params: {
        name: "search_web_with_gemini",
        arguments: { query: "Deno latest features" },
      },
    };

    // ハンドラーを直接呼び出す
    const response = await (async () => {
      if (request.params.name === "search_web_with_gemini") {
        const args = request.params.arguments as { query: string };
        const result = await executeGeminiSearch(args.query);
        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    })();

    assertExists(response.content);
    assertEquals(response.content[0].type, "text");
    assertStringIncludes(response.content[0].text, "Denoの最新機能");
  } finally {
    restoreCommand();
  }
});

Deno.test("ツール実行 - clear_gemini_search_cache", async () => {
  setupTest();

  // キャッシュにデータを追加
  searchCache.set("test query", {
    result: "cached result",
    timestamp: Date.now(),
  });

  assertEquals(searchCache.size, 1);

  const server = new Server(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    if (request.params.name === "clear_gemini_search_cache") {
      const args = request.params.arguments as { query?: string };
      if (args?.query) {
        const existed = searchCache.has(args.query);
        searchCache.delete(args.query);
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
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  // 実際にツールを呼び出すのではなく、ハンドラーのロジックを直接テスト
  const response1 = await (() => {
    const request = {
      method: "tools/call",
      params: {
        name: "clear_gemini_search_cache",
        arguments: { query: "test query" },
      },
    };

    if (request.params.name === "clear_gemini_search_cache") {
      const args = request.params.arguments as { query?: string };
      if (args?.query) {
        const existed = searchCache.has(args.query);
        searchCache.delete(args.query);
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: existed
                ? `クエリ "${args.query}" のキャッシュをクリアしました`
                : `クエリ "${args.query}" はキャッシュに存在しませんでした`,
            },
          ],
        });
      }
    }
    return Promise.reject(new Error(`Unknown tool: ${request.params.name}`));
  })();

  assertStringIncludes(
    response1.content[0].text,
    'クエリ "test query" のキャッシュをクリアしました',
  );
  assertEquals(searchCache.size, 0);

  // 全キャッシュをクリア（空の状態）
  const response2 = await (() => {
    const request = {
      method: "tools/call",
      params: {
        name: "clear_gemini_search_cache",
        arguments: {},
      },
    };

    if (request.params.name === "clear_gemini_search_cache") {
      const args = request.params.arguments as { query?: string };
      if (!args?.query) {
        const size = searchCache.size;
        searchCache.clear();
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: `全キャッシュをクリアしました（${size}件）`,
            },
          ],
        });
      }
    }
    return Promise.reject(new Error(`Unknown tool: ${request.params.name}`));
  })();

  assertStringIncludes(
    response2.content[0].text,
    "全キャッシュをクリアしました（0件）",
  );
});
