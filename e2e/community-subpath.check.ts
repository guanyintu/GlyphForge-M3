import { test, expect } from "@playwright/test";
test("repository subpath assets, OAuth return entry, refresh and offline local generation", async ({
  page,
  context,
}) => {
  const failures: string[] = [];
  page.on("requestfailed", (r) => failures.push(r.url()));
  await page.goto("./?code=missing-test-code");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "社区广场", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "进入本地演示" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto("./");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.locator(".candidate-text").first()).toBeVisible();
  expect(failures).toEqual([]);
});
