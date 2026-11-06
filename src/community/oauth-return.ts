const returnParams = ["code", "error", "error_code", "error_description", "access_token"];
const authParams = [...returnParams, "sb_flow_id", "refresh_token", "provider_token", "provider_refresh_token"];

export function oauthReturnUrl() {
  if (
    !import.meta.env.VITE_SUPABASE_URL ||
    !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    typeof window === "undefined"
  ) return null;

  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  return returnParams.some((key) => url.searchParams.has(key) || fragment.has(key))
    ? url
    : null;
}

export function clearOAuthReturn(url: URL) {
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (authParams.some((key) => fragment.has(key))) url.hash = "";
  for (const key of authParams) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}
