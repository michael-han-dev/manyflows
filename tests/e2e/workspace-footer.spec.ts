import { expect, test } from '@playwright/test';

test('sidebar and workspace footers share a divider at the end of the page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner password', { exact: true }).fill('e2e-local-password');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign performance' })).toBeVisible();
  const footer = page.getByRole('contentinfo');
  const ownerRow = page.locator('.owner-row');
  for (const width of [1440, 1024, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(footer.getByText(/All accounts/)).toBeVisible();
    await expect.poll(async () => {
      const [owner, workspace] = await Promise.all([ownerRow.boundingBox(), footer.boundingBox()]);
      if (!owner || !workspace) throw new Error('Footer unavailable');
      return Math.max(Math.abs(owner.y - workspace.y), Math.abs(owner.x + owner.width - workspace.x));
    }).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(footer.getByText(/All accounts/)).toBeVisible();
});
