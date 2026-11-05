import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
test.beforeAll(() =>
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--config",
      "e2e/share.vite.config.ts",
    ],
    { stdio: "pipe" },
  ),
);
async function open(page: any) {
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "社区广场", exact: true }).click();
}
async function demo(page: any) {
  await open(page);
  await page.getByRole("button", { name: "进入本地演示" }).click();
  await page.getByLabel("社区登录邮箱").fill("author");
  await page.getByRole("button", { name: "演示登录", exact: true }).click();
  await expect(page.getByText("创作者 · author")).toBeVisible();
}
async function publish(page: any, title = "星河配方") {
  await page.getByRole("button", { name: "发布当前工作流" }).click();
  await page.getByLabel("发布标题", { exact: true }).fill(title);
  await page
    .getByLabel("发布描述", { exact: true })
    .fill("组合宇宙与职业，在本地延续灵感");
  await page.getByLabel("发布标签", { exact: true }).fill("取名,宇宙");
  const panel = page.getByLabel("发布社区方案", { exact: true });
  for (const checkbox of await panel.getByRole("checkbox").all())
    await checkbox.check();
  await page.getByRole("button", { name: "生成公开内容预览" }).click();
  await expect(page.getByLabel("公开内容完整预览")).toContainText("glyphforge");
  await page.getByRole("button", { name: "确认公开发布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();
}
test("production demo: login publish search like adopt local run count refresh offline; clear simulation label", async ({
  page,
  context,
}) => {
  await demo(page);
  await publish(page);
  await page.getByLabel("搜索社区方案").fill("星河");
  await page.getByLabel("社区标签", { exact: true }).fill("宇宙");
  await page.getByLabel("社区排序").selectOption("used");
  await page.getByRole("button", { name: /星河配方/ }).click();
  const detail = page.getByLabel("社区方案详情", { exact: true });
  await detail.getByRole("button", { name: "点赞", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "撤销点赞" }),
  ).toHaveAttribute("aria-pressed", "true");
  await detail.getByRole("button", { name: "下载并预览 v1" }).click();
  await expect(page.getByLabel("社区只读导入预览")).toContainText("固定种子");
  const before = await page.evaluate(async () => {
    const h = await import("/share-harness/share.js");
    return Promise.all(h.db.tables.map((t: any) => t.count()));
  });
  await detail.getByRole("button", { name: "下载并预览 v1" }).click();
  expect(
    await page.evaluate(async () => {
      const h = await import("/share-harness/share.js");
      return Promise.all(h.db.tables.map((t: any) => t.count()));
    }),
  ).toEqual(before);
  await page.getByRole("button", { name: "确认采纳到本地工坊" }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.locator(".candidate-text").first()).toBeVisible();
  await page.getByRole("button", { name: "社区广场", exact: true }).click();
  await page.getByRole("button", { name: "刷新统计", exact: true }).click();
  await expect(page.getByRole("button", { name: /星河配方/ })).toContainText(
    "1 运行",
  );
  await expect(page.getByRole("button", { name: /星河配方/ })).toContainText(
    "1 采纳",
  );
  await page.reload();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "社区广场", exact: true }).click();
  await expect(page.getByText(/登录与计数均为模拟/)).toBeVisible();
  await expect(page.getByRole("button", { name: /星河配方/ })).toContainText(
    "1 点赞",
  );
  await page.screenshot({
    path: "test-results/community-desktop.png",
    fullPage: true,
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.getByRole("button", { name: "工作流工坊", exact: true }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.locator(".candidate-text").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.locator(".candidate-text").first()).toBeVisible();
  await context.setOffline(false);
});
test("immutable versions, owner edits, alternate account, report and local hiding", async ({
  page,
}) => {
  await demo(page);
  await publish(page, "版本配方");
  await page.getByRole("button", { name: /版本配方/ }).click();
  await page.getByLabel("编辑方案描述").fill("描述已修改");
  await page.getByRole("button", { name: "保存描述", exact: true }).click();
  await page.getByRole("button", { name: "以当前工作流发布新版本" }).click();
  await page.getByLabel("发布标题", { exact: true }).fill("版本配方二");
  await page.getByRole("button", { name: "生成公开内容预览" }).click();
  await page.getByRole("button", { name: "确认公开发布", exact: true }).click();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: /版本配方二/ }).click();
  await expect(
    page.getByRole("button", { name: "下载并预览 v1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载并预览 v2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "点赞", exact: true }).click();
  await page.getByRole("checkbox", { name: "我的发布", exact: true }).check();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "我的发布", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "点赞", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("社区登录邮箱").fill("visitor");
  await page.getByRole("button", { name: "演示登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "点赞", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "点赞", exact: true }).click();
  await expect(page.getByLabel("社区方案详情", { exact: true })).toContainText(
    "点赞 2",
  );
  await expect(
    page.getByRole("button", { name: "保存描述", exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("举报原因").fill("检查内容来源是否合适");
  await page.getByRole("button", { name: "提交举报", exact: true }).click();
  await expect(page.getByRole("status").filter({hasText: "举报已提交"})).toBeVisible();
  await page.getByRole("button", { name: "本机隐藏", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /版本配方二/ }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "恢复本机隐藏", exact: true }).click();
  await expect(page.getByRole("button", { name: /版本配方二/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/community-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("anonymous browsing and unavailable cloud leave local creation usable", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByText("社区服务尚未配置。离线工坊与已导入方案可继续使用。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "GitHub 登录" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "工作流工坊", exact: true }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect(page.getByText(/生成完成/)).toBeVisible();
});
