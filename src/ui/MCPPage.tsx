import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plug, Plus, Trash2 } from 'lucide-react'
import type { MCPServerInfo } from '../preload/index.d'
import { Empty, Modal, PageShell, Toggle, ghostBtn, inputCls, primaryBtn } from './components/ui'

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

export function MCPPage() {
  const [servers, setServers] = useState<MCPServerInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', command: '', args: '', env: '' })
  const [error, setError] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const load = useCallback(() => window.api.mcp.list().then(setServers), [])
  useEffect(() => {
    load()
  }, [load])

  const add = async (): Promise<void> => {
    const r = await window.api.mcp.add({
      name: form.name.trim(),
      command: form.command.trim(),
      args: form.args.split(/\s+/).filter(Boolean),
      env: parseEnv(form.env)
    })
    if (!r.ok) return setError(r.error ?? 'خطأ')
    setAdding(false)
    setForm({ name: '', command: '', args: '', env: '' })
    setError('')
    load()
  }

  const test = async (name: string): Promise<void> => {
    setTesting(name)
    const r = await window.api.mcp.test(name)
    setResults((p) => ({ ...p, [name]: r }))
    setTesting(null)
  }

  const th = 'px-4 py-3 text-start font-medium text-muted'
  return (
    <PageShell
      title="MCP Servers"
      subtitle="ضيف سيرفرات MCP (stdio) مثل ما بتعمل في Claude Desktop: الأمر + الوسائط + متغيرات البيئة."
      action={
        <button className={primaryBtn + ' flex items-center gap-1'} onClick={() => setAdding(true)}>
          <Plus size={16} /> ضيف سيرفر
        </button>
      }
    >
      {servers.length === 0 ? (
        <Empty text="ما في سيرفرات MCP - ضيف واحد" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-outline">
          <table className="w-full text-sm">
            <thead className="bg-surface2">
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Command</th>
                <th className={th}>Args</th>
                <th className={th}>Status</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => {
                const r = results[s.name]
                return (
                  <tr key={s.name} className="border-t border-outline">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td dir="ltr" className="px-4 py-3 text-start font-mono text-xs">{s.command}</td>
                    <td dir="ltr" className="max-w-[220px] truncate px-4 py-3 text-start font-mono text-xs">{(s.args ?? []).join(' ')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Toggle
                          checked={s.enabled !== false}
                          label={`تفعيل ${s.name}`}
                          onChange={async () => {
                            await window.api.mcp.toggle(s.name)
                            load()
                          }}
                        />
                        {r && (
                          <span className={`text-xs ${r.ok ? 'text-success' : 'text-danger'}`} title={r.message}>
                            {r.ok ? '✓ ' : '✗ '}
                            {r.message.slice(0, 40)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button className={ghostBtn + ' flex items-center gap-1'} disabled={testing === s.name} onClick={() => test(s.name)}>
                          {testing === s.name ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} اختبار
                        </button>
                        <button
                          className={ghostBtn + ' text-danger'}
                          aria-label={`حذف ${s.name}`}
                          onClick={async () => {
                            if (confirm(`بدك تحذف السيرفر ${s.name}؟`)) {
                              await window.api.mcp.remove(s.name)
                              load()
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal title="ضيف سيرفر MCP" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <input dir="ltr" className={inputCls} placeholder="Name (e.g. filesystem)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input dir="ltr" className={inputCls} placeholder="Command (e.g. npx)" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
            <input dir="ltr" className={inputCls} placeholder="Args (e.g. -y @modelcontextprotocol/server-filesystem C:\\)" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} />
            <textarea dir="ltr" rows={3} className={inputCls + ' font-mono'} placeholder={'Env (KEY=value، سطر لكل متغير)'} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} />
            <p className="text-xs text-muted">
              نفس فكرة claude_desktop_config.json: command + args + env. مثال: npx -y @modelcontextprotocol/server-memory
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setAdding(false)}>إلغاء</button>
              <button className={primaryBtn} disabled={!form.name.trim() || !form.command.trim()} onClick={add}>حفظ</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
