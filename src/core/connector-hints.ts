// When a request clearly needs an outside service that is not connected yet, the model is told so (and the user gets the answer
// "connect X in Settings > Connectors") instead of pretending or guessing. Connecting needs the user's own sign-in, so it never happens by itself.
const HINTS: { id: string; title: string; re: RegExp }[] = [
  { id: 'google', title: 'Google (Gmail / Calendar / Drive ...)', re: /gmail|جيميل|ايميلاتي|إيميلاتي|بريدي|google (calendar|drive|docs|sheets)|تقويم(ي)? (غوغل|جوجل)|درايف|my emails|my calendar/i },
  { id: 'github', title: 'GitHub', re: /github|pull request|\bPRs?\b|issues? #?\d+|مستودع|ريبو/i },
  { id: 'notion', title: 'Notion', re: /notion|نوشن/i },
  { id: 'canva', title: 'Canva', re: /canva|كانفا/i },
  { id: 'miro', title: 'Miro', re: /\bmiro\b|ميرو/i },
  { id: 'linear', title: 'Linear', re: /\blinear\b/i },
  { id: 'cloudflare', title: 'Cloudflare', re: /cloudflare|كلاودفلير/i },
  { id: 'dropbox', title: 'Dropbox', re: /dropbox|دروبوكس/i },
  { id: 'ms365', title: 'Microsoft 365', re: /outlook|onedrive|office 365|microsoft 365|ms365|اوتلوك|أوتلوك/i },
  { id: 'gcloud', title: 'Google Cloud', re: /gcloud|google cloud|\bgke\b|cloud run|bigquery/i },
  { id: 'kubernetes', title: 'Kubernetes', re: /kubectl|\bpods?\b|kubernetes|\bk8s\b/i },
  { id: 'terraform', title: 'Terraform', re: /terraform|\btfstate\b/i }
]

export function neededConnectors(input: string, connected: string[], googleConnected: boolean): { id: string; title: string }[] {
  return HINTS.filter((h) => h.re.test(input) && !(h.id === 'google' ? googleConnected : connected.includes(h.id))).map((h) => ({ id: h.id, title: h.title }))
}
