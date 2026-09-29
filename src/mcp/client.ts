import fs from 'fs/promises'
import path from 'path'

export type MCPServer = {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}
export type MCPConfig = { servers: MCPServer[] }

export async function loadMCPConfig(): Promise<MCPConfig> {
  try {
    const configPath = path.join(process.cwd(), 'src/mcp/config.json')
    const content = await fs.readFile(configPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return { servers: [] }
  }
}

export async function listMCPServers(): Promise<MCPServer[]> {
  const config = await loadMCPConfig()
  return config.servers
}

export function buildMCPSystemPrompt(servers: MCPServer[]): string {
  if (!servers.length) return ''
  return `\nAvailable MCP Servers: ${servers.map((s) => s.name).join(', ')}`
}
