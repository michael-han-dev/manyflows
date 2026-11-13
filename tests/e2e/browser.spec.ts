import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { campaignInputSchema, defaultCampaign, type CampaignInput } from '../../src/shared/domain';

const campaignsSchema = z.object({ campaigns: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), draft: campaignInputSchema, publishedTarget: campaignInputSchema.shape.target.nullable() })) });

async function publishFixture(page: Page, patch: Partial<CampaignInput> = {}) {
  const keyword = randomUUID().slice(0, 8);
  const input = { ...defaultCampaign('demo-studio'), name: `Fixture ${keyword}`, publicReply: false, matching: { mode: 'phrase', include: [keyword], exclude: [] }, ...patch } satisfies CampaignInput;
  const response = await page.request.post('/api/campaigns', { data: input });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { id } = z.object({ id: z.string() }).parse(await response.json());
  expect((await page.request.post(`/api/campaigns/${id}/publish`)).ok()).toBeTruthy();
  return { id, input, keyword };
}

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

test('a live campaign keeps its published target visible after editing the draft', async ({ page }) => {
  await signIn(page);
  const fixture = await publishFixture(page);
  const update = await page.request.put(`/api/campaigns/${fixture.id}`, { data: { ...fixture.input, target: { kind: 'specific', mediaId: 'demo-reel-guide' } } });
  expect(update.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  const row = page.getByRole('row').filter({ hasText: fixture.input.name });
  await expect(row).toContainText('Published target: All posts and reels');
  await expect(row).toContainText('Draft target: Specific post or reel');
  const data = campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json());
  expect(data.campaigns.find(item => item.id === fixture.id)?.publishedTarget?.kind).toBe('all');
});

test('contact CSV neutralizes a collected spreadsheet formula', async ({ page }) => {
  await signIn(page);
  const flow: CampaignInput['flow'] = { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'May I ask your name?', buttons: [{ kind: 'reply', label: 'Yes', next: 'name' }], next: null },
    { id: 'name', kind: 'collect', field: 'name', prompt: 'Your name?', next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] };
  const fixture = await publishFixture(page, { flow });
  const username = `csv-${randomUUID().slice(0, 8)}`;
  await page.request.post('/api/demo/comment', { data: { accountId: 'demo-studio', mediaId: 'demo-reel-guide', username, text: fixture.keyword } });
  await page.request.post('/api/demo/respond', { data: { accountId: 'demo-studio', username, buttonIndex: 0 } });
  const captured = await page.request.post('/api/demo/respond', { data: { accountId: 'demo-studio', username, text: '=HYPERLINK("https://example.com","Click")' } });
  expect(captured.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Contacts', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error('CSV download was not saved');
  const csv = await readFile(path, 'utf8');
  expect(csv).toContain('"\'=HYPERLINK(');
  expect(csv).not.toContain(',"=HYPERLINK(');
});

test('the owner deletes a contact through an explicit confirmation', async ({ page }) => {
  await signIn(page);
  const fixture = await publishFixture(page);
  const username = `remove-${randomUUID().slice(0, 8)}`;
  const eventId = randomUUID();
  const incoming = { accountId: 'demo-studio', mediaId: 'demo-reel-guide', username, text: fixture.keyword, eventId };
  expect((await page.request.post('/api/demo/comment', { data: incoming })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Contacts', exact: true }).click();
  await page.getByRole('button', { name: `Delete contact @${username}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete contact', exact: true });
  await expect(dialog.getByRole('button', { name: 'Permanently delete contact', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Type DELETE', exact: true }).fill('DELETE');
  await dialog.getByRole('button', { name: 'Permanently delete contact', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`@${username}`, { exact: true })).toBeHidden();
  const exported = z.object({ contacts: z.array(z.object({ username: z.string() })), messages: z.array(z.object({ text: z.string() })) }).parse(await (await page.request.get('/api/export')).json());
  expect(exported.contacts.some(item => item.username === username)).toBeFalsy();
  expect((await page.request.post('/api/demo/comment', { data: incoming })).ok()).toBeTruthy();
  const replayed = z.object({ contacts: z.array(z.object({ username: z.string() })) }).parse(await (await page.request.get('/api/bootstrap')).json());
  expect(replayed.contacts.some(item => item.username === username)).toBeFalsy();
});

test('processing work shows an outage and lets the owner retry safely', async ({ page }) => {
  await signIn(page);
  const fixture = await publishFixture(page);
  expect((await page.request.post('/api/demo/job-failure', { data: { accountId: 'demo-studio', enabled: true } })).ok()).toBeTruthy();
  const eventId = randomUUID();
  expect((await page.request.post('/api/demo/comment', { data: { accountId: 'demo-studio', mediaId: 'demo-reel-guide', username: `ui-retry-${randomUUID().slice(0, 8)}`, text: fixture.keyword, eventId } })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Processing work', exact: true })).toBeVisible();
  expect((await page.request.post('/api/demo/job-failure', { data: { accountId: 'demo-studio', enabled: false } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Retry processing', exact: true }).first().click();
  await expect.poll(async () => {
    const data = z.object({ jobs: z.array(z.object({ id: z.string() })) }).parse(await (await page.request.get('/api/bootstrap')).json());
    return data.jobs.some(item => item.id === `demo-studio:comment:${eventId}`);
  }).toBeFalsy();
});
