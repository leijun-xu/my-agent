import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const DEPRECATED_TOOLS = new Set(['searchTrainTickets'])
const apiKey = process.env.VARIFLIGHT_API_KEY?.trim()
const upstreamEntry = process.env.VARIFLIGHT_MCP_ENTRY

if (!upstreamEntry) {
  console.error('VARIFLIGHT_MCP_ENTRY is missing.')
  process.exit(1)
}

const upstreamTransport = new StdioClientTransport({
  command: process.execPath,
  args: [upstreamEntry],
  env: {
    PATH: process.env.PATH || '',
    VARIFLIGHT_API_KEY: apiKey || 'not-configured',
    VARIFLIGHT_API_URL: process.env.VARIFLIGHT_API_URL?.trim()
      || 'https://mcp.variflight.com/api/v1/mcp/data',
  },
})

const upstream = new Client({
  name: 'my-agent-variflight-proxy',
  version: '1.0.0',
})

const server = new Server({
  name: 'variflight',
  version: '1.1.0',
}, {
  capabilities: {
    tools: {},
  },
})

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const result = await upstream.listTools(request.params)
  return {
    ...result,
    tools: result.tools.filter(({ name }) => !DEPRECATED_TOOLS.has(name)),
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (DEPRECATED_TOOLS.has(request.params.name)) {
    return {
      content: [{ type: 'text', text: `Tool ${request.params.name} is deprecated and disabled.` }],
      isError: true,
    }
  }
  if (!apiKey) {
    return {
      content: [{ type: 'text', text: 'VARIFLIGHT_API_KEY is not configured.' }],
      isError: true,
    }
  }
  return upstream.callTool(request.params, undefined, { timeout: 55000 })
})

await upstream.connect(upstreamTransport)
await server.connect(new StdioServerTransport())

async function shutdown() {
  await Promise.allSettled([server.close(), upstream.close()])
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await shutdown()
    process.exit(0)
  })
}
