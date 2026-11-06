import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { createClient, initialize, signInWithOAuth } = vi.hoisted(() => {
  const initialize = vi.fn();
  const signInWithOAuth = vi.fn();
  return { createClient: vi.fn(() => ({ auth: { initialize, signInWithOAuth } })), initialize, signInWithOAuth };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const origin = "https://glyphforge-auth.example.invalid";
const key = "sb_publishable_mock_only";
const fetchSettings = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", `${origin}/`);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", key);
  vi.stubGlobal("location", { origin: "https://glyphforge.example.invalid" });
  vi.stubGlobal("fetch", fetchSettings);
  fetchSettings.mockResolvedValue(Response.json({ external: { github: true, email: true } }));
  signInWithOAuth.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["/", "/GlyphForge/"])("uses GitHub PKCE and preserves the redirect base %s", async (base) => {
  vi.stubEnv("BASE_URL", base);
  const { cloud } = await import("../community/client");
  await cloud.login();
  expect(createClient).toHaveBeenCalledWith(`${origin}/`, key, {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  expect(fetchSettings).toHaveBeenCalledWith(new URL(`${origin}/auth/v1/settings`), expect.objectContaining({
    headers: { apikey: key },
  }));
  expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
    provider: "github", options: { redirectTo: `${location.origin}${base}` },
  });
});

it("blocks navigation when GitHub is disabled even if Email is enabled", async () => {
  fetchSettings.mockResolvedValue(Response.json({ external: { github: false, email: true } }));
  const { cloud } = await import("../community/client");
  await expect(cloud.login()).rejects.toThrow("GitHub 登录尚未启用，请联系管理员");
  expect(signInWithOAuth).not.toHaveBeenCalled();
});

it("does not expose the raw settings error or proceed with login", async () => {
  fetchSettings.mockRejectedValue(new Error("private-fixture"));
  const { cloud } = await import("../community/client");
  await expect(cloud.login()).rejects.toThrow(/^暂时无法连接 GitHub 登录服务，请检查网络后重试。$/);
  expect(signInWithOAuth).not.toHaveBeenCalled();
});

it.each(["returned", "thrown"])("sanitizes a %s SDK error", async (kind) => {
  const error = new Error("private-fixture");
  if (kind === "returned") signInWithOAuth.mockResolvedValue({ error });
  else signInWithOAuth.mockRejectedValue(error);
  const { cloud, CommunityLoginError } = await import("../community/client");
  await expect(cloud.login()).rejects.toEqual(new CommunityLoginError(
    "GitHub 登录未完成。请重试；若问题持续，请联系管理员检查 GitHub OAuth 配置和回跳地址。",
  ));
});

it("clears OAuth return parameters even if SDK initialization rejects", async () => {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { href: `${location.origin}/GlyphForge/?keep=1&code=private-fixture#access_token=private-fixture` },
    history: { state: null, replaceState },
  });
  initialize.mockRejectedValue(new Error("private-fixture"));
  const { oauthCallbackError } = await import("../community/client");
  await expect(oauthCallbackError).resolves.toContain("请联系管理员检查 GitHub OAuth 配置和回跳地址");
  expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", new URL(`${location.origin}/GlyphForge/?keep=1`));
});
