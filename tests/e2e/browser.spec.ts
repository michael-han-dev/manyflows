import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';
import { campaignInputSchema } from '../../src/shared/domain';

const campaignsSchema = z.object({ campaigns: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), draft: campaignInputSchema })) });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Owner password', { exact: true }).fill('e2e-local-password');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Account filter', { exact: true })).toBeVisible();
  const seeded = await page.request.post('/api/demo/seed');
  expect(seeded.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel('Account filter').locator('option')).toHaveCount(3);
  await page.getByLabel('Date range').selectOption('all');
}

test('owner creates and publishes a campaign with five reply variants and a working conversation', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
  const name = `Browser campaign ${Date.now()}`;
  const keyword = `BROWSER${Date.now()}`;
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Campaign account', exact: true }).selectOption('demo-studio');
  await page.getByRole('textbox', { name: 'Include keywords', exact: true }).fill(keyword);
  await page.getByRole('button', { name: 'Add reply variation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Public reply 4', exact: true }).fill('A fourth variation, saved by the owner.');
  await page.getByRole('button', { name: 'Add reply variation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Public reply 5', exact: true }).fill('A fifth variation, saved by the owner.');
  await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Resource URL', exact: true }).fill('https://www.notion.so/browser-guide');
  await page.getByRole('tab', { name: 'Visual flow', exact: true }).click();
  await expect(page.getByText('Conversation canvas', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('flow-editor.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send me the guide', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send me the guide', exact: true }).click();
  await expect(page.getByText('Here is your guide. Enjoy!', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish campaign', exact: true }).click();
  await expect.poll(async () => {
    const response = await page.request.get('/api/bootstrap');
    const current = campaignsSchema.parse(await response.json()).campaigns.find(item => item.name === name);
    return current?.status;
  }).toBe('live');
  const snapshot = campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json());
  expect(snapshot.campaigns.find(item => item.name === name)?.draft.replyVariations).toHaveLength(5);
  await page.getByRole('button', { name: 'Open demo studio', exact: true }).click();
  const studio = page.getByRole('dialog', { name: 'Demo studio', exact: true });
  await studio.getByRole('combobox', { name: 'Demo account', exact: true }).selectOption('demo-studio');
  await studio.getByRole('combobox', { name: 'Demo media', exact: true }).selectOption('demo-reel-guide');
  await studio.getByLabel('Demo username', { exact: true }).fill(`browser-${Date.now()}`);
  await studio.getByLabel('Demo comment', { exact: true }).fill(keyword);
  await studio.getByRole('button', { name: 'Simulate comment', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Send me the guide', exact: true })).toBeVisible();
  await studio.getByRole('button', { name: 'Send me the guide', exact: true }).click();
  await expect(studio.getByRole('link', { name: 'Get the guide', exact: false })).toBeVisible();
  const link = await studio.getByRole('link', { name: 'Get the guide', exact: false }).getAttribute('href');
  expect(link).toContain('/r/');
  if (!link) throw new Error('Missing tracked link');
  const redirect = await page.request.get(link, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe('https://www.notion.so/browser-guide');
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('campaigns-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('dashboard navigation remains usable on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png'), fullPage: true });
  const finalWidths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(finalWidths.document).toBeLessThanOrEqual(finalWidths.viewport + 1);
});
