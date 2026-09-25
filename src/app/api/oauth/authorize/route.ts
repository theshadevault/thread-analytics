import { checkOwnerPassword, createAuthCode, getClient, OAUTH_SCOPE } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

interface AuthParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
}

function readParams(sp: URLSearchParams): AuthParams {
  return {
    response_type: sp.get('response_type') ?? '',
    client_id: sp.get('client_id') ?? '',
    redirect_uri: sp.get('redirect_uri') ?? '',
    code_challenge: sp.get('code_challenge') ?? '',
    code_challenge_method: sp.get('code_challenge_method') || 'S256',
    state: sp.get('state') ?? '',
    scope: sp.get('scope') || OAUTH_SCOPE,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function htmlPage(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Thread Analytics</title><style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,sans-serif;max-width:26rem;margin:12vh auto;padding:0 1.25rem;line-height:1.5}
h1{font-size:1.25rem;margin:0 0 .25rem}p{color:#666;font-size:.9rem;margin:.25rem 0 1.25rem}
label{display:block;font-size:.8rem;font-weight:600;margin-bottom:.35rem}
input[type=password]{width:100%;padding:.6rem .7rem;font-size:1rem;border:1px solid #ccc;border-radius:.5rem;box-sizing:border-box}
button{margin-top:1rem;width:100%;padding:.65rem;font-size:.95rem;font-weight:600;color:#fff;background:#5b6cff;border:0;border-radius:.5rem;cursor:pointer}
.err{color:#d33;font-size:.85rem;margin-top:.5rem}.app{font-weight:600;color:#222}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#aaa}.app{color:#eee}input{background:#1c1c1c;color:#eee;border-color:#333}}
</style></head><body>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function formPage(p: AuthParams, clientName: string, error?: string): Response {
  const hidden = (['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope'] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`)
    .join('');
  return htmlPage(`
    <h1>Authorize access</h1>
    <p><span class="app">${esc(clientName || 'An application')}</span> wants to post and manage Threads on your behalf.</p>
    <form method="POST">
      ${hidden}
      <label for="pw">Owner password</label>
      <input id="pw" name="password" type="password" autofocus autocomplete="current-password" required>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
      <button type="submit">Authorize</button>
    </form>`);
}

/** Validate the client + redirect_uri. Returns the client name or an error string. */
async function validate(p: AuthParams): Promise<{ ok: true; clientName: string } | { ok: false; error: string }> {
  if (p.response_type !== 'code') return { ok: false, error: 'Only response_type=code is supported.' };
  if (!p.client_id || !p.redirect_uri) return { ok: false, error: 'Missing client_id or redirect_uri.' };
  if (!p.code_challenge) return { ok: false, error: 'PKCE code_challenge is required.' };
  const client = await getClient(p.client_id);
  if (!client) return { ok: false, error: 'Unknown client_id.' };
  if (!client.redirectUris.includes(p.redirect_uri)) {
    return { ok: false, error: 'redirect_uri is not registered for this client.' };
  }
  return { ok: true, clientName: client.clientName ?? '' };
}

export async function GET(req: Request) {
  const p = readParams(new URL(req.url).searchParams);
  const v = await validate(p);
  if (!v.ok) return htmlPage(`<h1>Cannot authorize</h1><p class="err">${esc(v.error)}</p>`, 400);
  return formPage(p, v.clientName);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const p = readParams(new URLSearchParams([...form.entries()].map(([k, v]) => [k, String(v)])));
  const password = String(form.get('password') ?? '');

  const v = await validate(p);
  if (!v.ok) return htmlPage(`<h1>Cannot authorize</h1><p class="err">${esc(v.error)}</p>`, 400);

  if (!checkOwnerPassword(password)) {
    return formPage(p, v.clientName, 'Incorrect password.');
  }

  const code = await createAuthCode({
    clientId: p.client_id,
    redirectUri: p.redirect_uri,
    codeChallenge: p.code_challenge,
    codeChallengeMethod: p.code_challenge_method,
    scope: p.scope,
  });

  const dest = new URL(p.redirect_uri);
  dest.searchParams.set('code', code);
  if (p.state) dest.searchParams.set('state', p.state);
  return Response.redirect(dest.toString(), 302);
}
