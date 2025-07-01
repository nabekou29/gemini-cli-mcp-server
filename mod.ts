#!/usr/bin/env -S deno run --allow-run=gemini

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

// Cache and log management
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

// Global storage
const searchCache = new Map<string, CacheEntry>();
const searchHistory: SearchLog[] = [];
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_HISTORY = 100;

// Error type definitions
enum ErrorType {
  GEMINI_NOT_FOUND = "GEMINI_NOT_FOUND",
  GEMINI_EXECUTION_ERROR = "GEMINI_EXECUTION_ERROR",
  INVALID_QUERY = "INVALID_QUERY",
  CACHE_ERROR = "CACHE_ERROR",
}

// Function to execute Gemini CLI (enhanced version)
async function executeGeminiSearch(
  query: string,
  useCache = true,
): Promise<string> {
  // Input validation
  if (!query || query.trim().length === 0) {
    throw new Error(`${ErrorType.INVALID_QUERY}: Search query is empty`);
  }

  if (query.length > 500) {
    throw new Error(
      `${ErrorType.INVALID_QUERY}: Search query is too long (max 500 characters)`,
    );
  }

  // Cache check
  if (useCache) {
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.error(`[Cache Hit] Query: ${query}`);

      // Record success history
      searchHistory.push({
        query,
        timestamp: Date.now(),
        success: true,
      });

      // Manage history size
      if (searchHistory.length > MAX_HISTORY) {
        searchHistory.shift();
      }

      return cached.result;
    }
  }

  console.error(`[Gemini Search] Executing query: ${query}`);

  const command = new Deno.Command("gemini", {
    args: [
      "-p",
      `You are a read-only web search assistant. Your ONLY task is to search the web for information and return the results. You MUST NOT attempt to write files, modify data, or perform any actions other than searching and returning information. 

Web search query: ${query}

Please search for this information and provide the results. Remember: READ-ONLY search only.`,
    ],
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

    // Cache the result
    if (useCache) {
      searchCache.set(query, {
        result,
        timestamp: Date.now(),
      });
    }

    // Record success history
    searchHistory.push({
      query,
      timestamp: Date.now(),
      success: true,
    });

    // Manage history size
    if (searchHistory.length > MAX_HISTORY) {
      searchHistory.shift();
    }

    return result;
  } catch (error) {
    // Record error history
    searchHistory.push({
      query,
      timestamp: Date.now(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `${ErrorType.GEMINI_NOT_FOUND}: gemini-cli not found. Please ensure it is installed and included in your PATH.`,
      );
    }
    throw error;
  }
}

// Initialize MCP server
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

// Tool schema definitions
const SearchWebSchema = z.object({
  query: z
    .string()
    .min(1, "Search query is required")
    .max(500, "Search query must be 500 characters or less")
    .describe(
      "Search query string for web search (e.g., 'TypeScript best practices')",
    ),
  useCache: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to use cached results (default: true)"),
});

const ClearCacheSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Clear cache for specific query. If not specified, clears all cache",
    ),
});

const ViewHistorySchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe("Number of history entries to display (1-100, default: 10)"),
  includeErrors: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include searches that resulted in errors (default: false)"),
});

// Register tool list
server.setRequestHandler(ListToolsRequestSchema, () => {
  return {
    tools: [
      {
        name: "search_web_with_gemini",
        description: `Execute web search using Gemini CLI and retrieve latest information.
        
        This tool provides the following features:
        - Real-time web search
        - Result caching (1 hour)
        - Error handling and retry strategy
        
        On success: Returns search result text
        On error: Returns error type and detailed message`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query string for web search (e.g., 'TypeScript best practices')",
              minLength: 1,
              maxLength: 500,
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
        name: "clear_gemini_search_cache",
        description: `Clear search result cache.
        
        Can clear cache for specific query or all caches.
        For performance improvement, cache clearing is usually unnecessary.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Clear cache for specific query. If not specified, clears all cache",
            },
          },
        },
      },
      {
        name: "view_search_history",
        description: `Display recent search history.
        
        Can be used for debugging and analyzing search patterns.`,
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description:
                "Number of history entries to display (1-100, default: 10)",
              minimum: 1,
              maximum: 100,
              default: 10,
            },
            includeErrors: {
              type: "boolean",
              description:
                "Include searches that resulted in errors (default: false)",
              default: false,
            },
          },
        },
      },
    ],
  };
});

// Tool execution handler
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
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const [errorType, ...messageParts] = errorMessage.split(": ");

          return {
            content: [
              {
                type: "text",
                text: `An error occurred:
                
Type: ${errorType}
Details: ${messageParts.join(": ")}

Solution:
${
  errorType === ErrorType.GEMINI_NOT_FOUND
    ? "1. Check if gemini-cli is installed\n2. Check if gemini command is in PATH\n3. Check location with 'which gemini' command"
    : errorType === ErrorType.INVALID_QUERY
      ? "1. Check that query is not empty\n2. Check that query is 500 characters or less"
      : "1. Check if gemini-cli works properly\n2. Check network connection"
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
                  ? `Cleared cache for query "${args.query}"`
                  : `Query "${args.query}" was not found in cache`,
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
                text: `Cleared all cache (${size} entries)`,
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
            const time = new Date(log.timestamp).toLocaleString("en-US");
            const status = log.success ? "✓" : "✗";
            const error = log.error ? ` (${log.error})` : "";
            return `${i + 1}. ${status} [${time}] "${log.query}"${error}`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: formatted || "No search history found",
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    console.error(`[Tool Error] ${request.params.name}:`, error);

    return {
      content: [
        {
          type: "text",
          text: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Register resource list
server.setRequestHandler(ListResourcesRequestSchema, () => {
  return {
    resources: [
      {
        uri: "gemini://cache/status",
        name: "Cache Status",
        description: "Current cache status and statistics",
        mimeType: "application/json",
      },
      {
        uri: "gemini://history/recent",
        name: "Recent Search History",
        description: "Log of recently executed searches",
        mimeType: "application/json",
      },
    ],
  };
});

// Resource read handler
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
      throw new Error(`Unknown resource: ${request.params.uri}`);
  }
});

// Register prompt list
server.setRequestHandler(ListPromptsRequestSchema, () => {
  return {
    prompts: [
      {
        name: "search_analysis",
        description: "Prompt to analyze and summarize web search results",
        arguments: [
          {
            name: "topic",
            description: "Topic to search and analyze",
            required: true,
          },
        ],
      },
      {
        name: "comparative_search",
        description:
          "Prompt to search from multiple perspectives and perform comparative analysis",
        arguments: [
          {
            name: "items",
            description: "Items to compare (comma-separated)",
            required: true,
          },
          {
            name: "criteria",
            description: "Comparison criteria",
            required: true,
          },
        ],
      },
    ],
  };
});

// Get prompt handler
server.setRequestHandler(GetPromptRequestSchema, (request) => {
  switch (request.params.name) {
    case "search_analysis":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please perform web search on the following topic and provide comprehensive analysis.

Topic: ${request.params.arguments?.topic || "[Please specify topic]"}

Please proceed with the following steps:
1. Search the topic using search_web_with_gemini tool
2. Perform additional searches with related keywords as needed
3. Analyze collected information from the following perspectives:
   - Summary of key points
   - Latest trends and movements
   - Important statistics and data
   - Future prospects and predictions
4. Present conclusions considering the reliability of information sources

Please collect information using the search_web_with_gemini tool.`,
            },
          },
        ],
      };

    case "comparative_search": {
      const items = request.params.arguments?.items || "item1, item2";
      const criteria =
        request.params.arguments?.criteria ||
        "features, advantages, disadvantages";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please perform comparative search on the following items and provide analysis results.

Comparison items: ${items}
Comparison criteria: ${criteria}

Please proceed with the following steps:
1. Search each item individually with search_web_with_gemini tool
2. Organize information based on specified criteria
3. Create comparison table to clarify differences
4. Analyze pros and cons of each
5. Present recommendations based on usage scenarios

Be sure to collect latest information using the search_web_with_gemini tool.`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${request.params.name}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();

  console.error("=== Gemini CLI MCP Server v2.0.0 ===");
  console.error(`Cache TTL: ${CACHE_TTL / 1000 / 60} minutes`);
  console.error(`Max history: ${MAX_HISTORY} entries`);
  console.error("Starting...");

  await server.connect(transport);

  console.error("Server started successfully (stdio)");
}

// Start with error handling
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}

// Export (for testing)
export { ErrorType, executeGeminiSearch, searchCache, searchHistory };
