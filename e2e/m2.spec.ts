import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route(/https?:\/\//, route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
async function open(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('.result-timing')).toContainText('生成完成');
}

test('M2: conflicting relation edits preserve native IndexedDB rows and metadata across reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^资源中心/ }).click();
  await page.getByRole('button', { name: '新建关系词库', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑关系词库' });
  await dialog.getByLabel('关系词库名称').fill('M2关系保护');
  for (const [left, right] of [['朝', '暮'], ['山', '海']]) {
    await dialog.getByLabel('左词 A').fill(left); await dialog.getByLabel('右词 B').fill(right);
    await dialog.getByRole('button', { name: '添加词对', exact: true }).click();
  }
  await expect(dialog.locator('.relation-row')).toHaveCount(2);
  const snapshot = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('glyphforge-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const tx = db.transaction(['resources', 'relations']);
      const read = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [resources, rows] = await Promise.all([read(tx.objectStore('resources').getAll()), read(tx.objectStore('relations').getAll())]);
      const resource = resources.find(r => r.name === 'M2关系保护');
      return { schema: db.version, resource, rows: rows.filter(r => r.resourceId === resource.id) };
    } finally { db.close(); }
  });
  const before = await snapshot();
  await dialog.locator('.relation-row').filter({ hasText: '朝' }).getByRole('button', { name: '修改', exact: true }).click();
  await dialog.getByLabel('左词 A').fill(' 山 '); await dialog.getByLabel('右词 B').fill('海');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog.getByText('相同关系已存在，原关系未修改', { exact: true })).toBeVisible();
  expect(await snapshot()).toEqual(before);
  await page.reload();
  expect(await snapshot()).toEqual(before);
});

test('M2: selecting the current workflow cannot overwrite an unsaved rename or clear results', async ({ page }) => {
  await open(page);
  const count = await page.locator('.candidate').count();
  expect(count).toBeGreaterThan(0);
  await page.getByLabel('工作流名称').fill('刚刚修改的名字');
  await page.locator('.saved-workflows > button.current').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByLabel('工作流名称')).toHaveValue('刚刚修改的名字');
  await expect(page.locator('.candidate')).toHaveCount(count);
  await expect(page.locator('.save-status')).toContainText('已保存到本地');
  await page.reload();
  await expect(page.getByLabel('工作流名称')).toHaveValue('刚刚修改的名字');
});

test('M2: all saved workflows remain discoverable after twelve', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('glyphforge-v1'); r.onsuccess = () => resolve(r.result); });
    const tx = database.transaction('workflows', 'readwrite'), store = tx.objectStore('workflows');
    const original = await new Promise<any>(resolve => { const r = store.getAll(); r.onsuccess = () => resolve(r.result[0]); });
    for (let i = 0; i < 14; i++) store.put({ ...original, id: `m2-${i}`, name: `我的配方 ${i}` });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    database.close();
  });
  await page.reload();
  await expect(page.locator('.saved-workflows > button')).toHaveCount(17);
  await page.getByRole('button', { name: '我的配方 13', exact: true }).click();
  await expect(page.getByLabel('工作流名称')).toHaveValue('我的配方 13');
});

test('M2: unapplied NameScript survives attempted switching and has explicit discard', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'NameScript', exact: true }).click();
  const code = page.locator('.cm-content');
  await code.fill('let words = resource("animals");\nlet result = output(words);');
  await page.locator('.saved-workflows > button').filter({ hasText: '叠字的快乐' }).click();
  await expect(code).toBeVisible();
  await expect(code).toContainText('let words');
  await expect(page.locator('.toast')).toContainText('未应用');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('未应用');
  await page.getByRole('button', { name: '放弃代码修改', exact: true }).click();
  await page.locator('.saved-workflows > button').filter({ hasText: '叠字的快乐' }).click();
  await expect(page.getByLabel('工作流名称')).toHaveValue('叠字的快乐');
});

test('M2: database startup failure stays visible and can retry without clearing data', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      if (!(window as any).m2AllowOpen) throw new DOMException('M2 storage denied', 'SecurityError');
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('本地数据库无法打开');
  await page.evaluate(() => { (window as any).m2AllowOpen = true; });
  await page.getByRole('button', { name: '重试打开', exact: true }).click();
  await expect(page.locator('.result-timing')).toContainText('生成完成');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('M2: touch navigation closes the drawer and empty workflows explain the next step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: /^我的收藏/ }).click();
  await expect(page.locator('.mobile-sidebar-backdrop')).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '新建工作流', exact: true }).click();
  await expect(page.locator('.mobile-sidebar-backdrop')).toHaveCount(0);
  await expect(page.getByText('从词库到名字，只需三步')).toBeVisible();
  await page.getByRole('button', { name: '选一个示例配方', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /宇宙浪漫命名器/ }).click();
  await page.getByRole('button', { name: /^运行工作流/ }).click();
  await expect(page.locator('.result-timing')).toContainText('生成完成');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('mobile.png'), fullPage: true });
});

test('M2: create a resource and connect a new workflow through accessible inputs without dragging', async ({ page }) => {
  const external: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.getByRole('button', { name: /^资源中心/ }).click();
  await page.getByRole('button', { name: '新建词库', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑词库' });
  await dialog.getByLabel('词库名称').fill('M2 小猫');
  await dialog.getByLabel('添加词条').fill('小猫\n月光');
  await dialog.getByRole('button', { name: '添加到词库', exact: true }).click();
  await expect(dialog.getByLabel('编辑词条 小猫', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '新建工作流', exact: true }).click();
  await page.getByRole('button', { name: '添加词库节点', exact: true }).click();
  await page.getByRole('combobox', { name: '引用词库', exact: true }).selectOption({ label: 'M2 小猫 · 2 词' });
  await page.getByRole('button', { name: '添加节点', exact: true }).click();
  await page.locator('.node-library').getByRole('button', { name: /结果输出/ }).click();
  const input = page.getByLabel('节点输入 1', { exact: true });
  await input.selectOption('');
  await page.getByRole('button', { name: /^运行工作流/ }).click();
  await expect(page.locator('.toast')).toContainText(/输入|连接/);
  await input.focus();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^运行工作流/ }).click();
  await expect(page.locator('.candidate-text')).toHaveText(['小猫', '月光']);
  await page.screenshot({ path: test.info().outputPath('connected.png'), fullPage: true });
  await page.getByRole('button', { name: 'NameScript', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('output(');
  await page.getByRole('button', { name: '节点画布', exact: true }).click();
  await page.locator('.star-button').first().click();
  await page.getByRole('button', { name: /^我的收藏/ }).click();
  await expect(page.locator('.candidate-text')).toHaveText(['小猫']);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});
