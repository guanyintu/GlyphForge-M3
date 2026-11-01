import type { CommunityAPI } from "./client";
import {
  contentHash,
  metadata,
  validateCommunityPayload,
  type Listing,
  type User,
  type Version,
} from "./protocol";
type Store = {
  user: User | null;
  listings: Listing[];
  versions: Version[];
  likes: string[];
  events: string[];
  reports: string[];
};
const key = "glyphforge-community-demo-v1";
const read = (): Store =>
  JSON.parse(
    localStorage.getItem(key) ||
      '{"user":null,"listings":[],"versions":[],"likes":[],"events":[],"reports":[]}',
  );
const save = (s: Store) => localStorage.setItem(key, JSON.stringify(s));
export const demo: CommunityAPI = {
  mode: "demo",
  async user() {
    return read().user;
  },
  async login(_method, email) {
    const s = read();
    s.user = { id: email || "demo-author", name: email || "本地创作者" };
    save(s);
  },
  async logout() {
    const s = read();
    s.user = null;
    save(s);
  },
  async list(q, tag, sort, page, mine) {
    const s = read();
    return s.listings
      .filter(
        (w) =>
          (mine
            ? w.author_id === s.user?.id && w.status !== "deleted"
            : w.status === "published") &&
          `${w.title} ${w.description} ${w.tags.join(" ")}`.includes(q) &&
          (!tag || w.tags.includes(tag)),
      )
      .sort((a, b) =>
        sort === "popular"
          ? b.likes - a.likes
          : sort === "used"
            ? b.adoptions - a.adoptions
            : b.created_at.localeCompare(a.created_at),
      )
      .slice(page * 12, page * 12 + 12);
  },
  async versions(id) {
    return read()
      .versions.filter((v) => v.workflow_id === id)
      .reverse();
  },
  async version(id, version) {
    const s = read();
    if (
      !s.listings.some(
        (w) =>
          w.id === id &&
          (w.status === "published" || w.author_id === s.user?.id),
      )
    )
      throw new Error("方案已下架");
    const v = s.versions.find(
      (v) => v.workflow_id === id && v.version === version,
    );
    if (!v) throw new Error("版本不存在");
    return structuredClone(v);
  },
  async liked(id) {
    const s = read();
    return s.likes.includes(`${s.user?.id}:${id}`);
  },
  async write(action, body) {
    const operation = async () => {
      const s = read(),
        user = s.user;
      if (!user) throw new Error("请先登录");
      let w = s.listings.find((w) => w.id === body.workflow_id);
      if (action === "publish") {
        const m = metadata(
          String(body.title),
          String(body.description),
          body.tags as string[],
        );
        validateCommunityPayload(body.payload);
        if (w && w.author_id !== user.id) throw new Error("无作者权限");
        if (w && w.current_version !== body.expected_version)
          throw new Error("版本已变化，请刷新");
        if (!w) {
          w = {
            ...m,
            id: crypto.randomUUID(),
            author_id: user.id,
            author: user.name,
            status: "published",
            current_version: 0,
            created_at: new Date().toISOString(),
            views: 0,
            adoptions: 0,
            runs: 0,
            likes: 0,
          };
          s.listings.push(w);
        }
        Object.assign(w, m);
        w.current_version++;
        s.versions.push({
          workflow_id: w.id,
          version: w.current_version,
          payload: structuredClone(body.payload),
          content_hash: await contentHash(body.payload),
          created_at: new Date().toISOString(),
        });
      } else if (!w) throw new Error("方案不存在");
      else if (action === "edit") {
        if (w.author_id !== user.id) throw new Error("无作者权限");
        Object.assign(
          w,
          metadata(
            String(body.title),
            String(body.description),
            body.tags as string[],
          ),
        );
      } else if (action === "status") {
        if (w.author_id !== user.id) throw new Error("无作者权限");
        if (w.status === "deleted") throw new Error("已删除");
        if (!["published", "unlisted", "deleted"].includes(String(body.status)))
          throw new Error("状态无效");
        w.status = String(body.status);
      } else if (action === "like") {
        if (w.status !== "published") throw new Error("已下架");
        const k = `${user.id}:${w.id}`,
          has = s.likes.includes(k);
        if (body.liked && !has) {
          s.likes.push(k);
          w.likes++;
        }
        if (!body.liked && has) {
          s.likes = s.likes.filter((x) => x !== k);
          w.likes--;
        }
      } else if (action === "event") {
        if (
          w.status !== "published" ||
          !s.versions.some(
            (v) => v.workflow_id === w!.id && v.version === body.version,
          )
        )
          throw new Error("版本已下架");
        const k = `${user.id}:${w.id}:${body.kind}:${new Date().toISOString().slice(0, 13)}`,
          idem = `${user.id}:${body.id}`;
        if (!s.events.includes(k) && !s.events.includes(idem)) {
          s.events.push(k, idem);
          if (body.kind === "view") w.views++;
          if (body.kind === "adoption") w.adoptions++;
          if (body.kind === "run") w.runs++;
        }
      } else if (action === "report") {
        const k = `${user.id}:${w.id}`;
        if (!s.reports.includes(k)) s.reports.push(k);
      } else throw new Error("本地演示不提供管理员权限");
      save(s);
      return w;
    };
    return navigator.locks
      ? navigator.locks.request(key, operation)
      : operation();
  },
};
