import { chooseOption } from './select-option';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultCampaign } from '../../src/shared/domain';

test('content campaign names and status badges stay separated at every screen size', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Owner password', { exact: true }).fill('e2e-local-password');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Account filter', { exact: true })).toBeVisible();
  expect((await page.request.post('/api/demo/seed')).ok()).toBeTruthy();

  const suffix = randomUUID();
  const names = ['Bread', 'A campaign with a long name that needs to wrap inside the content table'];
  for (const [index, name] of names.entries()) {
    const mediaId = `campaign-layout-${suffix}-${index}`;
    expect((await page.request.post('/api/demo/media', { data: { accountId: 'demo-studio', id: mediaId, caption: `Campaign layout ${suffix} ${index}`, publishedAt: Date.now() } })).ok()).toBeTruthy();
    const response = await page.request.post('/api/campaigns', { data: { ...defaultCampaign('demo-studio'), name, target: { kind: 'specific', mediaId } } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const { id } = z.object({ id: z.string() }).parse(await response.json());
    expect((await page.request.post(`/api/campaigns/${id}/publish`)).ok()).toBeTruthy();
  }

  await page.reload();
  await chooseOption(page, 'Date range', 'All time');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Content', exact: true }).click();
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    for (const [index, name] of names.entries()) {
      const row = page.getByRole('row').filter({ hasText: `Campaign layout ${suffix} ${index}` });
      const campaign = row.locator('.content-campaign').filter({ hasText: name });
      await expect(campaign).toBeVisible();
      const title = await campaign.getByText(name, { exact: true }).boundingBox();
      const status = await campaign.locator('.status').boundingBox();
      if (!title || !status) throw new Error('Campaign name and status must be visible.');
      const sameLine = status.y < title.y + title.height && title.y < status.y + status.height;
      const gap = sameLine ? status.x - (title.x + title.width) : status.y - (title.y + title.height);
      expect.soft(gap, `Campaign name and status need a visible gap at ${width}px for ${name}`).toBeGreaterThanOrEqual(4);
      const bounds = await campaign.evaluate(element => ({ available: element.clientWidth, content: element.scrollWidth, right: element.getBoundingClientRect().right }));
      expect.soft(bounds.content, `Campaign must not clip at ${width}px`).toBeLessThanOrEqual(bounds.available + 1);
      expect.soft(bounds.right, `Campaign must fit at ${width}px`).toBeLessThanOrEqual(width + 1);
      await expect(campaign).toContainText('Published association');
      await expect(campaign).toContainText('Published target: Specific post or reel');
      await expect(row.getByRole('button', { name: 'Attach campaign', exact: true })).toBeVisible();
      if ([1440, 390].includes(width)) await campaign.screenshot({ path: testInfo.outputPath(`campaign-association-${index}-${width}.png`), animations: 'disabled' });
    }
  }
});
