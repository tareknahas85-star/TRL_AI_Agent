// Linux (GNOME/Wayland) screen control for Computer Control: windows, UI snapshot (AT-SPI), click/type/keys/scroll (ydotool),
// screenshot. Only loaded on Linux. Needs: ydotool (+ ydotoold user service, user in group "input"), python3-pyatspi,
// wl-clipboard, gnome-screenshot, optional wmctrl/xdotool (X11 windows only).
import path from 'path'
import fsp from 'fs/promises'
import { app } from 'electron'

type Def = (name: string, desc: string, props: Record<string, unknown>, required: string[], fn: (a: Record<string, unknown>) => Promise<string>) => void
export interface LinuxGuiCtx {
  def: Def
  ask: (title: string, detail: string) => Promise<boolean>
  runSh: (script: string, cwd: string, timeoutMs?: number, signal?: AbortSignal) => Promise<string>
  cwd: () => string
  fullAccessOn: () => boolean
  getSignal?: () => AbortSignal | undefined
}

const str = { type: 'string' }
const num = { type: 'number' }
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const q = (v: string): string => "'" + v.replace(/'/g, "'\\''") + "'"

const ENV =
  'export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"; export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"; ' +
  'export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"; export YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-$XDG_RUNTIME_DIR/.ydotool_socket}"; '

const BLOCK_TITLE = /(password|passphrase|keyring|authenticat|polkit|sudo|unlock|credential|كلمة\s*(السر|المرور)|مصادقة)/i

// AT-SPI helper (python3-pyatspi). Prints JSON.
const ATSPI_PY = `
import sys, json
try:
    import pyatspi
except Exception as e:
    print(json.dumps({"error": "python3-pyatspi is not installed"})); sys.exit(0)
A = json.loads(sys.argv[1]); mode = A["mode"]; needle = (A.get("find") or "").lower()
desk = pyatspi.Registry.getDesktop(0)
def wins():
    for app in desk:
        try:
            if app is None: continue
            for w in app:
                if w is not None: yield app, w
        except Exception: pass
def active(w):
    try: return w.getState().contains(pyatspi.STATE_ACTIVE)
    except Exception: return False
if mode == "windows":
    out = []
    for app, w in wins():
        try:
            if (w.name or "") == "" or app.name == "mutter-x11-frames": continue
            out.append({"app": app.name, "title": w.name, "active": active(w), "role": w.getRoleName()})
        except Exception: pass
    la = [i for i, o in enumerate(out) if o["active"]]
    for i in la[:-1]: out[i]["active"] = False
    print(json.dumps({"windows": out})); sys.exit(0)
fw = None
wn = (A.get("window") or "").lower()
allw = list(wins())
if wn:
    cands = [c for c in allw if wn in (c[1].name or "").lower() or wn in (c[0].name or "").lower()]
    fw = next((c for c in cands if active(c[1])), cands[0] if cands else None)
else:
    acts = [c for c in allw if active(c[1])]
    fw = acts[-1] if acts else None
if not fw:
    print(json.dumps({"error": "no active window found (is accessibility enabled? run: gsettings set org.gnome.desktop.interface toolkit-accessibility true, then restart the app)"})); sys.exit(0)
app, win = fw
KEEP = {"push button","toggle button","menu item","check box","radio button","combo box","entry","text","link","page tab","list item","editbar","paragraph","label","heading","password text","spin button","slider","tree item","table cell","check menu item","radio menu item"}
items = []; seen = [0]
def walk(n, d):
    if d > 28 or seen[0] > 6000 or len(items) >= 90: return
    seen[0] += 1
    try:
        role = n.getRoleName(); st = n.getState()
        if not st.contains(pyatspi.STATE_SHOWING): 
            if d > 0: return
        name = n.name or ""
        val = ""
        try:
            val = n.queryText().getText(0, 120) if role in ("entry","text","password text","paragraph") else ""
        except Exception: pass
        if role in KEEP and (name or val) and role != "password text":
            if (not needle) or needle in name.lower() or needle in val.lower():
                x = y = None
                try:
                    e = n.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
                    if e.width > 0 and e.height > 0: x, y = e.x + e.width // 2, e.y + e.height // 2
                except Exception: pass
                items.append({"node": n, "type": role, "name": name[:80], "value": val[:80], "x": x, "y": y})
        for c in n:
            if c is not None: walk(c, d + 1)
    except Exception: pass
walk(win, 0)
if mode == "snapshot":
    print(json.dumps({"title": win.name, "proc": app.name, "items": [{k: v for k, v in i.items() if k != "node"} for i in items]})); sys.exit(0)
if mode == "click":
    if not items:
        print(json.dumps({"error": "element not found: " + A.get("find", "")})); sys.exit(0)
    i = items[0]; n = i["node"]; acted = False
    try:
        act = n.queryAction()
        for k in range(act.nActions):
            if act.getName(k) in ("click", "press", "activate", "jump", "select"):
                acted = act.doAction(k); break
        if not acted and act.nActions: acted = act.doAction(0)
    except Exception: pass
    print(json.dumps({"acted": bool(acted), "name": i["name"], "x": i["x"], "y": i["y"]})); sys.exit(0)
`

// evdev key codes for ydotool
const K: Record<string, number> = {
  esc: 1, escape: 1, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11, '-': 12, '=': 13, backspace: 14, tab: 15,
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25, '[': 26, ']': 27, enter: 28, return: 28, ctrl: 29, control: 29,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38, ';': 39, "'": 40, '`': 41, shift: 42, '\\': 43,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50, ',': 51, '.': 52, '/': 53, alt: 56, space: 57,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
  home: 102, up: 103, pageup: 104, pgup: 104, left: 105, right: 106, end: 107, down: 108, pagedown: 109, pgdn: 109,
  insert: 110, delete: 111, del: 111, super: 125, win: 125, meta: 125, menu: 127
}
const MODS = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'win', 'meta'])

// "ctrl+s", "alt+tab", "Enter", "{ENTER}", "^s" (SendKeys style) -> list of key names in order
function parseKeys(raw: string): string[] | null {
  let t = raw.trim()
  const sk = t.match(/^([\^%+]+)(.+)$/)
  if (sk && !t.includes('+') ) {
    const mods = [...sk[1]].map((c) => (c === '^' ? 'ctrl' : c === '%' ? 'alt' : 'shift'))
    t = [...mods, sk[2].replace(/[{}]/g, '')].join('+')
  } else if (sk && /^[\^%]/.test(t)) {
    const mods = [...sk[1]].map((c) => (c === '^' ? 'ctrl' : c === '%' ? 'alt' : 'shift'))
    t = [...mods, sk[2].replace(/[{}]/g, '')].join('+')
  }
  t = t.replace(/^\{(\w+)\}$/, '$1')
  const parts = t.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean)
  if (!parts.length || parts.some((p) => K[p] === undefined)) return null
  return parts
}

function keyCmd(parts: string[]): string {
  const mods = parts.filter((p) => MODS.has(p))
  const rest = parts.filter((p) => !MODS.has(p))
  const seq: string[] = []
  for (const m of mods) seq.push(`${K[m]}:1`)
  for (const r of rest) seq.push(`${K[r]}:1`, `${K[r]}:0`)
  for (const m of [...mods].reverse()) seq.push(`${K[m]}:0`)
  return `ydotool key ${seq.join(' ')}`
}

export function addLinuxGuiTools(c: LinuxGuiCtx): void {
  const { def, ask, runSh, fullAccessOn } = c
  const sh = (cmd: string, ms = 30000): Promise<string> => runSh(ENV + cmd, c.cwd(), ms, c.getSignal?.())
  const atspi = (args: Record<string, unknown>, ms = 45000): Promise<string> =>
    sh(`python3 -c ${q(ATSPI_PY)} ${q(JSON.stringify(args))}`, ms)
  const parseJ = (r: string): any => {
    const m = r.match(/\{[\s\S]*\}/)
    try {
      return m ? JSON.parse(m[0]) : null
    } catch {
      return null
    }
  }
  const ydoErr = (r: string): string | null =>
    /ydotool: (notice: )?(ydotoold|.*socket)|failed to connect|No such file|Permission denied|not found/i.test(r)
      ? 'Error: ydotool is not ready (' + r.split('\n')[0].slice(0, 160) + '). The user must: sudo usermod -aG input $USER, set the /dev/uinput udev rule, run "systemctl --user enable --now ydotool", then log out and in.'
      : null
  const guard = async (): Promise<string | null> => {
    const j = parseJ(await atspi({ mode: 'windows' }, 20000))
    const act = (j?.windows ?? []).find((w: any) => w.active)
    if (act && BLOCK_TITLE.test(`${act.title} ${act.app}`) && !fullAccessOn())
      return `blocked: the foreground window ("${act.title}", ${act.app}) looks like a security/credential prompt. Ask the user to handle it himself.`
    return null
  }

  def('pc_windows', 'List the open windows (app + title, active one marked). Native Wayland windows come from accessibility (AT-SPI).', {}, [], async () => {
    const j = parseJ(await atspi({ mode: 'windows' }, 20000))
    if (!j) return 'Error: could not read windows (is python3-pyatspi installed and accessibility enabled?)'
    if (j.error) return 'Error: ' + j.error
    const list = (j.windows as any[]).map((w) => `${w.active ? '* ' : '  '}${w.app} | ${w.title}`)
    return list.length ? list.join('\n') : 'No windows found (accessibility may be off: gsettings set org.gnome.desktop.interface toolkit-accessibility true).'
  })

  def('pc_focus', 'Bring a window to the foreground by part of its title (works for X11/XWayland windows; native Wayland windows may not be focusable).', { title: str }, ['title'], async (a) => {
    if (!(await ask('بدو يعمل تركيز على نافذة', s(a.title)))) return 'Error: the user denied this.'
    const r = await sh(`wmctrl -a ${q(s(a.title))} 2>&1 && echo "OK: focused" || (xdotool search --name ${q(s(a.title))} windowactivate 2>&1 | head -1; echo done)`, 15000)
    return /OK: focused/.test(r) ? r.trim() : 'Error: could not focus a window with that title (Wayland restricts focus changes). Try pc_open or click the window.\n' + r.trim().slice(0, 200)
  })

  def(
    'pc_ui_snapshot',
    'Describe the foreground window as a list of visible UI elements (type, name, x, y center) using accessibility (AT-SPI). Optional "find" filters by name; optional "window" picks a window by part of its title or app name (use it when the foreground window is not the one you want).',
    { find: str, window: str },
    [],
    async (a) => {
      const g = await guard()
      if (g) return g
      const j = parseJ(await atspi({ mode: 'snapshot', find: s(a.find), window: s(a.window) }))
      if (!j) return 'Error: could not read the window tree (is python3-pyatspi installed?)'
      if (j.error) return 'Error: ' + j.error
      const items = j.items as { type: string; name: string; value?: string; x: number | null; y: number | null }[]
      return `Window: ${j.title} (${j.proc})\n` + items.map((i) => `${i.type} | ${i.name}${i.value ? ' | value: ' + i.value : ''} | (${i.x ?? '?'},${i.y ?? '?'})`).join('\n')
    }
  )

  def(
    'pc_click',
    'Click at screen coordinates (x,y) OR on a UI element by (part of) its name (preferred, uses accessibility actions); pass "window" (part of the window title or app name) to target a specific window instead of the foreground one. Set double=true for double click, right=true for right click.',
    { x: num, y: num, name: str, window: str, double: { type: 'boolean' }, right: { type: 'boolean' } },
    [],
    async (a) => {
      const g = await guard()
      if (g) return g
      if (!(await ask('بدو يدوس بالماوس', a.name ? `على العنصر: ${s(a.name)}` : `على الإحداثيات (${s(a.x)}, ${s(a.y)})`))) return 'Error: the user denied this.'
      let x = a.x as number | undefined
      let y = a.y as number | undefined
      if (a.name) {
        const j = parseJ(await atspi({ mode: 'click', find: s(a.name), window: s(a.window) }))
        if (!j) return 'Error: could not read the window tree'
        if (j.error) return 'Error: ' + j.error
        if (j.acted && !a.right && !a.double) return `OK: activated "${j.name}"`
        x = j.x ?? undefined
        y = j.y ?? undefined
        if (x == null || y == null) return `Error: found "${j.name}" but it has no position and no click action`
      }
      if (x == null || y == null) return 'Error: give x,y or name'
      const btn = a.right ? '0xC1' : '0xC0'
      const clicks = a.double ? `ydotool click ${btn}; sleep 0.08; ydotool click ${btn}` : `ydotool click ${btn}`
      // ydotool absolute units are 2 screen pixels on GNOME (measured), and the pointer only lands correctly when the
      // previous absolute position had a 0 on one axis, so park at (1,0) (top edge, not the hot corner) first, then go to the target.
      const tx = Math.round(x / 2)
      const ty = Math.round(y / 2)
      const r = await sh(
        `ydotool mousemove --absolute -x 1 -y 0 2>&1; sleep 0.1; ydotool mousemove --absolute -x ${tx} -y ${ty} 2>&1; sleep 0.15; ${clicks} 2>&1`,
        20000
      )
      return ydoErr(r) ?? `OK: clicked at ${Math.round(x)},${Math.round(y)}`
    }
  )

  def('pc_type', 'Type text into the focused field (supports Arabic/Unicode via paste).', { text: str }, ['text'], async (a) => {
    const g = await guard()
    if (g) return g
    if (!(await ask('بدو يكتب نص', s(a.text).slice(0, 500)))) return 'Error: the user denied this.'
    const r = await sh(`wl-paste -n > /tmp/.trl-clip-old 2>/dev/null; printf %s ${q(s(a.text))} | wl-copy && sleep 0.15 && ydotool key 29:1 47:1 47:0 29:0 2>&1; sleep 0.3; [ -s /tmp/.trl-clip-old ] && wl-copy < /tmp/.trl-clip-old; rm -f /tmp/.trl-clip-old; echo done`, 20000)
    return ydoErr(r) ?? 'OK: typed'
  })

  def(
    'pc_keys',
    'Send a key combination, e.g. "Enter", "ctrl+s", "alt+tab", "Down", "ctrl+a", "ctrl+shift+t", "F5". (SendKeys style like "^s" or "{ENTER}" also works.)',
    { keys: str },
    ['keys'],
    async (a) => {
      const k = s(a.keys)
      const parts = parseKeys(k)
      if (!parts) return 'Error: unknown key combination: ' + k
      if (!fullAccessOn() && /^(ctrl\+alt\+(delete|del|backspace)|alt\+f4|ctrl\+alt\+f\d+|super\+l)$/.test(parts.join('+'))) return 'Error: this key combination is blocked.'
      const g = await guard()
      if (g) return g
      if (!(await ask('بدو يبعت اختصار لوحة مفاتيح', k))) return 'Error: the user denied this.'
      const r = await sh(keyCmd(parts) + ' 2>&1', 15000)
      return ydoErr(r) ?? 'OK: sent'
    }
  )

  def('pc_scroll', 'Scroll the mouse wheel at the current position. amount>0 scrolls up, <0 scrolls down (in notches).', { amount: num }, ['amount'], async (a) => {
    const g = await guard()
    if (g) return g
    const n = Math.round(Number(a.amount) || 0)
    if (!(await ask('بدو يعمل سكرول', String(n)))) return 'Error: the user denied this.'
    const r = await sh(`ydotool mousemove --wheel -x 0 -y ${n} 2>&1`, 15000)
    return ydoErr(r) ?? 'OK: scrolled'
  })

  def(
    'pc_screenshot',
    'Save a screenshot of the screen to a PNG file and return its path (text-only models cannot see it; use pc_ui_snapshot to read the screen).',
    {},
    [],
    async () => {
      const dir = path.join(app.getPath('userData'), 'screens')
      await fsp.mkdir(dir, { recursive: true })
      const file = path.join(dir, `shot-${Date.now()}.png`)
      const r = await sh(`gnome-screenshot -f ${q(file)} 2>&1; [ -s ${q(file)} ] && echo "OK: ${file}" || echo "Error: screenshot failed"`, 30000)
      return r.includes('OK: ') ? r.trim() : 'Error: screenshot failed (is gnome-screenshot installed?) ' + r.trim().slice(0, 160)
    }
  )
}
