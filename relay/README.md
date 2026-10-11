# TRL relay (اختياري، للوصول من برا البيت)

الـ relay وسيط "أعمى": بيمرّر رسائل مشفّرة من الطرفين (الكمبيوتر والتلفون) وما بيشوف مفاتيح ولا محتوى ولا بيخزّن شي.
بدونو التطبيق بيشتغل عالشبكة المحلية (Wi-Fi نفسو) مباشرة؛ معو بيشتغل من أي مكان.

## الخيار 1: Cloudflare Worker (مجاني، على حسابك الشخصي)

```
cd relay/worker
npx wrangler login
npx wrangler deploy
```
بتاخد عنوان متل `https://trl-relay.<حسابك>.workers.dev`. حطو بالبرنامج (الإعدادات ← تطبيق الموبايل) بهالشكل:
`wss://trl-relay.<حسابك>.workers.dev` وبعدين اعمل QR جديد.

## الخيار 2: Node على أي سيرفر

```
npx esbuild relay/server.ts --bundle --platform=node --format=esm --outfile=relay.mjs --external:ws
node relay.mjs 8787      # وحطو ورا TLS (Caddy / nginx) ليصير wss://
```
