import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Plug, Plus, Trash2 } from 'lucide-react'
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
  const [imp, setImp] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<{ source: string; file: string; servers: MCPServerInfo[] }[] | null>(null)
  const [pasted, setPasted] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [impMsg, setImpMsg] = useState('')
  const [plugins, setPlugins] = useState<{ id: string; name: string; origin: string; version: string; skills: string[]; mcp: string[]; remoteMcp: number }[]>([])
  const [pickedPl, setPickedPl] = useState<Record<string, boolean>>({})
  const [plMsg, setPlMsg] = useState('')
  const doImportPlugins = async (): Promise<void> => {
    const ids = plugins.filter((p) => pickedPl[p.id]).map((p) => p.id)
    const r = await window.api.mcp.importPlugins(ids)
    setPlMsg(`سكيلز انضافت: ${r.skills.length}${r.skippedSkills.length ? ' (متخطّاة موجودة: ' + r.skippedSkills.length + ')' : ''} | MCP انضافت (مطفية): ${r.mcp.join('، ') || '—'}`)
    load()
  }
  const keyOf = (src: string, n: string): string => src + '::' + n
  const doScan = async (): Promise<void> => {
    setScanning(true)
    setImpMsg('')
    void window.api.mcp.scanPlugins().then(setPlugins)
    const r = await window.api.mcp.scan()
    setFound(r)
    setPicked(Object.fromEntries(r.flatMap((g) => g.servers.map((s) => [keyOf(g.source, s.name), true]))))
    setScanning(false)
  }
  const doParse = async (): Promise<void> => {
    const s = await window.api.mcp.parse(pasted)
    setImpMsg(s.length ? '' : 'ما لقيت سيرفرات بالنص (الصق JSON فيه mcpServers أو جزء [mcp_servers.x] من Codex).')
    setFound([...(found ?? []).filter((g) => g.source !== 'نص ملصوق'), ...(s.length ? [{ source: 'نص ملصوق', file: '', servers: s }] : [])])
    setPicked((p) => ({ ...p, ...Object.fromEntries(s.map((x) => [keyOf('نص ملصوق', x.name), true])) }))
  }
  const doImport = async (): Promise<void> => {
    const chosen = (found ?? []).flatMap((g) => g.servers.filter((s) => picked[keyOf(g.source, s.name)]))
    const r = await window.api.mcp.import(chosen)
    setImpMsg(`انضافت: ${r.added.join('، ') || '—'}${r.skipped.length ? ' | تخطّيت (موجودة): ' + r.skipped.join('، ') : ''}. السيرفرات المستوردة مطفية، جرّب "اختبار" وبعدين فعّلها.`)
    load()
  }
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
        <div className="flex gap-2">
          <button className={ghostBtn + ' flex items-center gap-1 border border-outline'} onClick={() => { setImp(true); void doScan() }}>
            <Download size={16} /> استيراد من Claude / ChatGPT / Google
          </button>
          <button className={primaryBtn + ' flex items-center gap-1'} onClick={() => setAdding(true)}>
            <Plus size={16} /> ضيف سيرفر
          </button>
        </div>
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

      {imp && (
        <Modal title="استيراد سيرفرات MCP" onClose={() => setImp(false)}>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted">بفحص ملفات الإعدادات المحلية: Claude Desktop، Claude Code، Google (Gemini CLI)، وChatGPT (Codex CLI). أو الصق JSON/TOML من أي مكان.</p>
            <button className={ghostBtn + ' flex items-center gap-1 border border-outline'} disabled={scanning} onClick={doScan}>
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} فحص من جديد
            </button>
            {found && found.length === 0 && <p className="text-muted">ما لقيت ملفات إعدادات فيها سيرفرات MCP. ممكن تلصق النص تحت.</p>}
            <div className="max-h-56 space-y-2 overflow-auto">
              {(found ?? []).map((g) => (
                <div key={g.source} className="rounded-xl border border-outline p-2">
                  <div className="text-xs font-semibold">{g.source}</div>
                  {g.file && <div dir="ltr" className="truncate text-start font-mono text-[10px] text-muted">{g.file}</div>}
                  {g.servers.map((s) => (
                    <label key={s.name} className="mt-1 flex items-center gap-2">
                      <input type="checkbox" checked={!!picked[keyOf(g.source, s.name)]} onChange={(e) => setPicked({ ...picked, [keyOf(g.source, s.name)]: e.target.checked })} />
                      <span className="font-medium">{s.name}</span>
                      <span dir="ltr" className="truncate font-mono text-[11px] text-muted">{s.command} {(s.args ?? []).join(' ')}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-outline p-2">
              <div className="text-xs font-semibold">Plugins (ChatGPT / Claude): سكيلز + سيرفرات MCP</div>
              {plugins.length === 0 && <p className="text-xs text-muted">ما لقيت Plugins مثبّتة.</p>}
              <div className="max-h-40 space-y-1 overflow-auto">
                {plugins.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!pickedPl[p.id]} onChange={(e) => setPickedPl({ ...pickedPl, [p.id]: e.target.checked })} />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-[11px] text-muted">{p.origin} · {p.skills.length} skills · {p.mcp.length} MCP{p.remoteMcp ? ' (+' + p.remoteMcp + ' عن بعد، مو مدعومة)' : ''}</span>
                  </label>
                ))}
              </div>
              <button className={ghostBtn + ' mt-1 border border-outline'} disabled={!plugins.some((p) => pickedPl[p.id])} onClick={doImportPlugins}>استيراد Plugins المحددة</button>
              {plMsg && <p className="text-xs text-success">{plMsg}</p>}
            </div>
            <textarea dir="ltr" rows={4} className={inputCls + ' font-mono text-xs'} placeholder='{"mcpServers":{"name":{"command":"npx","args":["-y","pkg"]}}}' value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button className={ghostBtn + ' border border-outline'} disabled={!pasted.trim()} onClick={doParse}>أضف من النص</button>
            {impMsg && <p className="text-xs text-success">{impMsg}</p>}
            <div className="flex justify-end gap-2">
              <button className={ghostBtn} onClick={() => setImp(false)}>سكّر</button>
              <button className={primaryBtn} disabled={!found?.some((g) => g.servers.some((s) => picked[keyOf(g.source, s.name)]))} onClick={doImport}>استيراد المحدد</button>
            </div>
          </div>
        </Modal>
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
