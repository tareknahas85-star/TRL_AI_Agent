import { app, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSkillsDir } from '../core/paths'

// Manual settings transfer (Windows <-> Ubuntu). Never automatic. The bundle holds API keys, so it is
// always encrypted with a password you choose (scrypt + AES-256-GCM). Nothing leaves the machine.
const MAGIC = Buffer.from('TRLX1')
type Sel = { keys: boolean; skills: boolean; memory: boolean; mcp: boolean; conversations: boolean }
type Bundle = { v: 1; at: string; files: Record<string, string>; skills: Record<string, string> }

const GROUPS: Record<keyof Sel, string[]> = {
  keys: ['secure-keys.json', 'custom-models.json', 'custom-tools.json', 'hosts.json', 'vision.json', 'effort.json', 'spend.json', 'telegram.json', 'accounts.json'],
  skills: [],
  memory: ['memory.json', 'master-memory.json'],
  mcp: ['mcp-config.json'],
  conversations: ['conversations.json']
}

const ud = (n: string): string => path.join(app.getPath('userData'), n)

function encrypt(plain: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, 32)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc])
}

function decrypt(buf: Buffer, password: string): Buffer {
  if (buf.length < MAGIC.length + 44 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('هاد مو ملف إعدادات من البرنامج')
  let o = MAGIC.length
  const salt = buf.subarray(o, (o += 16))
  const iv = buf.subarray(o, (o += 12))
  const tag = buf.subarray(o, (o += 16))
  const key = crypto.scryptSync(password, salt, 32)
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  try {
    return Buffer.concat([d.update(buf.subarray(o)), d.final()])
  } catch {
    throw new Error('كلمة السر غلط أو الملف تالف')
  }
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = path.join(base, e.name)
    if (e.isDirectory()) out.push(...walk(dir, rel))
    else if (e.isFile()) out.push(rel)
  }
  return out
}

export function registerTransferHandlers(): void {
  ipcMain.handle('transfer:export', async (_e, sel: Sel, password: unknown) => {
    try {
      if (typeof password !== 'string' || password.length < 6) return { ok: false, error: 'كلمة السر لازم 6 أحرف على الأقل' }
      const b: Bundle = { v: 1, at: new Date().toISOString(), files: {}, skills: {} }
      for (const g of Object.keys(GROUPS) as (keyof Sel)[]) {
        if (!sel?.[g]) continue
        for (const n of GROUPS[g]) if (fs.existsSync(ud(n))) b.files[n] = fs.readFileSync(ud(n)).toString('base64')
      }
      if (sel?.skills) {
        const dir = getSkillsDir()
        for (const rel of walk(dir)) b.skills[rel.split(path.sep).join('/')] = fs.readFileSync(path.join(dir, rel)).toString('base64')
      }
      const r = await dialog.showSaveDialog({ title: 'احفظ ملف الإعدادات', defaultPath: 'TRL_AI_Agent-settings.trlx', filters: [{ name: 'TRL settings', extensions: ['trlx'] }] })
      if (r.canceled || !r.filePath) return { ok: false, error: 'انلغى' }
      fs.writeFileSync(r.filePath, encrypt(Buffer.from(JSON.stringify(b)), password))
      return { ok: true, path: r.filePath, files: Object.keys(b.files).length, skills: Object.keys(b.skills).length }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('transfer:import', async (_e, password: unknown) => {
    try {
      if (typeof password !== 'string' || !password) return { ok: false, error: 'اكتب كلمة السر' }
      const r = await dialog.showOpenDialog({ title: 'اختار ملف الإعدادات', properties: ['openFile'], filters: [{ name: 'TRL settings', extensions: ['trlx'] }] })
      if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'انلغى' }
      const b = JSON.parse(decrypt(fs.readFileSync(r.filePaths[0]), password).toString('utf-8')) as Bundle
      if (b.v !== 1) throw new Error('إصدار الملف مو مدعوم')
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const allowed = new Set(Object.values(GROUPS).flat())
      let files = 0
      for (const [n, data] of Object.entries(b.files ?? {})) {
        if (!allowed.has(n)) continue // never write anything outside the known list
        const dst = ud(n)
        if (fs.existsSync(dst)) fs.copyFileSync(dst, dst + '.bak-' + ts)
        fs.writeFileSync(dst, Buffer.from(data, 'base64'))
        files++
      }
      let skills = 0
      const sdir = getSkillsDir()
      for (const [rel, data] of Object.entries(b.skills ?? {})) {
        const dst = path.resolve(sdir, rel)
        if (!dst.startsWith(path.resolve(sdir) + path.sep) || fs.existsSync(dst)) continue // no path escape, keep existing skills
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.writeFileSync(dst, Buffer.from(data, 'base64'))
        skills++
      }
      return { ok: true, files, skills, at: b.at }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
