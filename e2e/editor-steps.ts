import { expect, type Page } from "@playwright/test";

/** Editor regressions explicitly follow the same secondary entry as a user. */
export async function enterEditor(page: Page) {
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".studio")).toBeVisible();
}
export async function openEditor(page: Page, url = "/") {
  await page.goto(url);
  await enterEditor(page);
}
export async function reloadEditor(page: Page) {
  await page.reload();
  await enterEditor(page);
}
