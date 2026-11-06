import { createClient } from '@supabase/supabase-js';

const REF = 'rsntccggnvmuazvpxstf';
const ORIGIN = `https://${REF}.supabase.co`;

// Loaded only by the restricted browser runners on their loopback Vite server.
export async function signInTestAccount({ key, email, password }) {
  if (location.origin !== 'http://127.0.0.1:5173') return false;
  const client = createClient(ORIGIN, key, {
    auth: {
      storageKey: 'glyphforge-m3-test-login',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  // Use the SDK's session format in the temporary context used by the app.
  localStorage.setItem(`sb-${REF}-auth-token`, JSON.stringify(data.session));
  return true;
}

export async function loadTestSession(page, key, account) {
  const signedIn = await page.evaluate(async (input) => {
    const { signInTestAccount } = await import('/scripts/community-test-session.mjs');
    return signInTestAccount(input);
  }, { key, email: account.email, password: account.password });
  if (!signedIn) throw new Error('Test account sign-in failed');
  await page.getByRole('button', { name: '刷新统计', exact: true }).click();
}
