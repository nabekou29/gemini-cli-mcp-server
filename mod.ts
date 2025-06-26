#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env

import { Server } from "npm:@modelcontextprotocol/sdk@1.3.0/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.3.0/server/stdio.js";
import { z } from "npm:zod@3.24.1";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "npm:@modelcontextprotocol/sdk@1.3.0/types.js";

// Gemini CLIを実行するための関数
async function executeGeminiSearch(query: string): Promise<string> {
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

    return new TextDecoder().decode(stdout);
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
    name: "gemini-cli-search",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 検索ツールのスキーマ
const SearchToolSchema = z.object({
  query: z.string().describe("The search query to send to Gemini"),
});

// ツール一覧の登録
server.setRequestHandler(ListToolsRequestSchema, () => {
  return {
    tools: [
      {
        name: "gemini_search",
        description: "Search the web using Gemini CLI",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to send to Gemini",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// ツール実行ハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "gemini_search") {
      // 入力値の検証
      const args = SearchToolSchema.parse(request.params.arguments);
      
      console.error(`Executing Gemini search for: ${args.query}`);
      
      // Gemini CLIを実行
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
  } catch (error) {
    console.error("Error in tool execution:", error);
    
    // エラーレスポンスを返す
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// サーバーの起動
async function main() {
  const transport = new StdioServerTransport();
  
  console.error("Starting Gemini CLI MCP Server...");
  
  await server.connect(transport);
  
  console.error("Gemini CLI MCP Server is running on stdio");
}

// エラーハンドリング付きで起動
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}