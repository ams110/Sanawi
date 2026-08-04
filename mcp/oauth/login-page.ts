/**
 * صفحة الدخول.
 *
 * هذه الصفحة هي كل الفرق بين «الصق رابطاً سرّياً» و«سجّل دخولك»: المستخدم
 * يكتب بريده وكلمة سرّه في موقعنا، فلا تمرّ كلمة سرّه في محادثة ولا تُخزَّن
 * عندنا ولا يراها كلود.
 *
 * صفحة واحدة بلا أصول خارجية: الدالّة تخدم HTML مجرّداً، وأي ملف CSS أو خط
 * خارجي يعني نداءً ثانياً قد يُحجب أو يبطئ لحظةً حسّاسة. والألوان تتبع وضع
 * الجهاز، فلا تصفعُ الصفحةُ بالأبيض من يفتحها ليلاً.
 */

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

const STYLE = `
  :root { color-scheme: light dark; --bg:#f7f7f5; --surface:#fff; --text:#1a1a18;
          --muted:#6b6b66; --border:#e3e3de; --brand:#2f7d5d; --danger:#b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14140f; --surface:#1e1e19; --text:#f2f2ee;
            --muted:#a3a39c; --border:#33332c; --brand:#5fbf92; --danger:#ff8a80; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--text); direction:rtl;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width:100%; max-width:380px; background:var(--surface); border:1px solid var(--border);
          border-radius:20px; padding:28px 24px; }
  h1 { margin:0 0 4px; font-size:22px; }
  p.sub { margin:0 0 22px; color:var(--muted); font-size:14px; line-height:1.6; }
  label { display:block; font-size:13px; font-weight:600; margin:14px 0 6px; }
  input { width:100%; padding:11px 13px; font-size:16px; border-radius:12px;
          border:1px solid var(--border); background:var(--bg); color:var(--text);
          direction:ltr; text-align:left; }
  input:focus { outline:none; border-color:var(--brand); }
  button { width:100%; margin-top:22px; padding:13px; font-size:16px; font-weight:700;
           border:0; border-radius:12px; background:var(--brand); color:#fff; cursor:pointer; }
  .error { margin:14px 0 0; padding:11px 13px; border-radius:12px; font-size:14px;
           background:color-mix(in srgb, var(--danger) 12%, transparent); color:var(--danger); }
  .note { margin:20px 0 0; font-size:12.5px; color:var(--muted); line-height:1.7; }
  code { direction:ltr; display:inline-block; font-size:12px; }
`

export interface LoginPageInput {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  resource: string
  error: string
}

export function loginPage(input: LoginPageInput): string {
  const hidden = (name: string, value: string): string =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>سنوي — الدخول</title>
<style>${STYLE}</style>
</head>
<body>
  <form class="card" method="post">
    <h1>سنوي</h1>
    <p class="sub">سجّل دخولك ليقرأ كلود التزاماتك ويسجّل إيداعاتك. نفس بريد التطبيق وكلمة سرّه.</p>

    ${input.error ? `<p class="error">${escapeHtml(input.error)}</p>` : ''}

    <label for="email">البريد</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus>

    <label for="password">كلمة السر</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>

    ${hidden('response_type', 'code')}
    ${hidden('client_id', input.clientId)}
    ${hidden('redirect_uri', input.redirectUri)}
    ${hidden('state', input.state)}
    ${hidden('code_challenge', input.challenge)}
    ${hidden('code_challenge_method', 'S256')}
    ${hidden('resource', input.resource)}

    <button type="submit">دخول والسماح لكلود</button>

    <p class="note">
      كلمة سرّك تُرسَل إلى خادم سنوي وحده ولا تُخزَّن: تُستبدَل فوراً بجلسة،
      ولا يراها كلود ولا تمرّ في أي محادثة. وكلود يرى ما تراه أنت فقط —
      سياسات قاعدة البيانات نفسها التي تحرس التطبيق.
    </p>
  </form>
</body>
</html>`
}

export function noticePage(baseUrl: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>سنوي — خادم MCP</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>خادم سنوي</h1>
    <p class="sub">هذه ليست صفحةً تُفتَح، بل خادمٌ يُضاف إلى كلود.</p>
    <p class="note">
      في كلود: <strong>Settings ← Connectors ← Add custom connector</strong>، وضع هذا العنوان:
      <br><br><code>${escapeHtml(baseUrl)}</code><br><br>
      سيفتح لك كلود صفحة دخول سنوي، وبعدها ترى أدواتك في المحادثة.
      لا يوجد رابط سرّي تنسخه ولا مفتاح تحفظه.
    </p>
  </div>
</body>
</html>`
}
