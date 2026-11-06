import { createClient } from "@supabase/supabase-js";
import type { EventKind, Listing, User, Version } from "./protocol";
import { demo } from "./demo";
import { clearOAuthReturn, oauthReturnUrl } from "./oauth-return";
export interface CommunityAPI {
  mode: "cloud" | "demo" | "unconfigured";
  user(): Promise<User | null>;
  login(demoName?: string): Promise<void>;
  logout(): Promise<void>;
  list(
    q: string,
    tag: string,
    sort: string,
    page: number,
    mine: boolean,
  ): Promise<Listing[]>;
  versions(id: string): Promise<Version[]>;
  version(id: string, version: number): Promise<Version>;
  liked(id: string): Promise<boolean>;
  write(action: string, body: Record<string, unknown>): Promise<unknown>;
}
export class CommunityError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export class CommunityLoginError extends Error {}

const oauthConfigMessage =
  "GitHub 登录未完成。请重试；若问题持续，请联系管理员检查 GitHub OAuth 配置和回跳地址。";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const oauthReturn = oauthReturnUrl();
if (key && !key.startsWith("sb_publishable_"))
  throw new Error("前端只接受 Supabase publishable key");
const sb =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

export const oauthCallbackError =
  sb && oauthReturn
    ? sb.auth.initialize().catch(() => ({ error: true })).then(({ error }) => {
        const remaining = oauthReturnUrl();
        if (remaining) clearOAuthReturn(remaining);
        // A returned code can remain in the URL if this browser has no PKCE verifier.
        return error || remaining ? oauthConfigMessage : "";
      }).catch(() => oauthConfigMessage)
    : Promise.resolve("");

const check = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
export const cloud: CommunityAPI = {
  mode: sb ? "cloud" : "unconfigured",
  async user() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session
      ? {
          id: data.session.user.id,
          name: data.session.user.email?.split("@")[0] || "创作者",
        }
      : null;
  },
  async login() {
    if (!sb) throw new Error("尚未配置社区服务");
    // The SDK navigates directly to /authorize, which can show a raw error if GitHub is disabled.
    const settingsUrl = new URL("auth/v1/settings", `${url.replace(/\/$/, "")}/`);
    const githubEnabled = await fetch(settingsUrl, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => response.ok ? (await response.json()).external?.github : null)
      .catch(() => null);
    if (githubEnabled === false) {
      throw new CommunityLoginError("GitHub 登录尚未启用，请联系管理员配置 GitHub OAuth 和回跳地址。");
    }
    if (githubEnabled !== true) {
      throw new CommunityLoginError("暂时无法连接 GitHub 登录服务，请检查网络后重试。");
    }
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href,
        },
      });
      if (error) throw error;
    } catch {
      throw new CommunityLoginError(oauthConfigMessage);
    }
  },
  async logout() {
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw new Error(error.message);
    }
  },
  async list(q, tag, sort, page, mine) {
    if (!sb) return [];
    let query = sb.from("community_workflows").select("*");
    query = mine
      ? query.eq("author_id", (await this.user())?.id || "")
      : query.eq("status", "published");
    if (q)
      query = query.ilike(
        "search_text",
        `%${q.replaceAll("%", "").replaceAll("_", "").slice(0, 80)}%`,
      );
    if (tag) query = query.contains("tags", [tag]);
    return check(
      await query
        .order(
          sort === "popular"
            ? "likes"
            : sort === "used"
              ? "adoptions"
              : "created_at",
          { ascending: false },
        )
        .order("id")
        .range(page * 12, page * 12 + 11),
    ) as Listing[];
  },
  async versions(id) {
    if (!sb) throw new Error("未配置社区");
    return check(
      await sb
        .from("workflow_versions")
        .select("workflow_id,version,content_hash,created_at")
        .eq("workflow_id", id)
        .order("version", { ascending: false }),
    ) as Version[];
  },
  async version(id, version) {
    if (!sb) throw new Error("未配置社区");
    return check(
      await sb
        .from("workflow_versions")
        .select("*")
        .eq("workflow_id", id)
        .eq("version", version)
        .single(),
    ) as Version;
  },
  async liked(id) {
    if (!sb || !(await this.user())) return false;
    return !!check(
      await sb
        .from("workflow_likes")
        .select("workflow_id")
        .eq("workflow_id", id)
        .maybeSingle(),
    );
  },
  async write(action, body) {
    if (!sb) throw new Error("未配置社区");
    const { data, error } = await sb.functions.invoke("community", {
      body: { ...body, action },
    });
    if (error) {
      const response = error.context;
      if (response instanceof Response) {
        const detail = await response.json().catch(() => null);
        throw new CommunityError(
          detail?.error || error.message,
          response.status,
        );
      }
      throw error;
    }
    if (data?.error) throw new CommunityError(data.error, 400);
    return data;
  },
};
let api: CommunityAPI =
  !sb &&
  typeof localStorage !== "undefined" &&
  localStorage.getItem("glyphforge-community-demo-enabled") === "1"
    ? demo
    : cloud;
export function community() {
  return api;
}
export async function enableDemo() {
  if (sb) throw new Error("已配置云端服务");
  localStorage.setItem("glyphforge-community-demo-enabled", "1");
  api = demo;
}
export type Usage = {
  id: string;
  actor: string;
  workflow_id: string;
  version: number;
  kind: EventKind;
  at: number;
};
