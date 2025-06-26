import { assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { Server } from "npm:@modelcontextprotocol/sdk@1.3.0/server/index.js";
import { ListToolsRequestSchema } from "npm:@modelcontextprotocol/sdk@1.3.0/types.js";

Deno.test("MCP Server initialization", () => {
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

  assertExists(server);
});

Deno.test("Tools list handler registration", () => {
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

  // ハンドラーの登録が例外なく実行できることを確認
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

  // ハンドラーが登録されたことは、例外が投げられなかったことで確認
  assertExists(server);
});