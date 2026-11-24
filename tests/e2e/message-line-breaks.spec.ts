import { chooseOption } from './select-option';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

test('message line breaks survive the preview and automation conversation', async ({ page }) => {
  const opening = 'heyo! happy emailing,\n\nalso read the links below :)';
  const resource = 'Your guide is ready.\n\nEnjoy reading!';
  const prompt = 'Where can I reach you?\nEnter your email.\n\nThanks!';
  const keyword = randomUUID().slice(0, 8);
  const name = `Line breaks ${keyword}`;
  await page.goto('/');
  await page.getByLabel('Owner password', { exact: true }).fill('e2e-local-password');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Account filter', { exact: true })).toBeVisible();
  expect((await page.request.post('/api/demo/seed')).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(name);
  await chooseOption(page, 'Campaign account', /^@northstar\.studio · Demo$/);
  await page.getByRole('textbox', { name: 'Include keywords', exact: true }).fill(keyword);
  await page.getByRole('textbox', { name: 'Opening message', exact: true }).fill(opening);
  await page.getByRole('textbox', { name: 'Resource message', exact: true }).fill(resource);
  await page.getByRole('switch', { name: /^Collect an email/ }).locator('..').click();
  await page.getByRole('textbox', { name: 'Email collection prompt', exact: true }).fill(prompt);
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  for (const text of [opening, prompt, resource]) {
    const bubble = preview.locator('.preview-bubble > p').filter({ hasText: text });
    expect.soft(await bubble.innerText()).toBe(text);
    if (text === opening) await preview.getByRole('button', { name: 'Send me the guide', exact: true }).click();
    if (text === prompt && await preview.getByRole('textbox', { name: 'Preview email', exact: true }).count()) {
      await preview.getByRole('textbox', { name: 'Preview email', exact: true }).fill('lines@example.com');
      await preview.getByRole('button', { name: 'Send reply', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Publish campaign', exact: true }).click();
  const snapshotSchema = z.object({
    campaigns: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
    runs: z.array(z.object({ id: z.string(), campaignId: z.string() })),
    messages: z.array(z.object({ runId: z.string().nullable(), direction: z.string(), text: z.string() })),
  });
  await expect.poll(async () => snapshotSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.name === name)?.status).toBe('live');
  await page.getByRole('button', { name: 'Open demo studio', exact: true }).click();
  const studio = page.getByRole('dialog', { name: 'Demo studio', exact: true });
  await studio.getByRole('combobox', { name: 'Demo account' }).click();
  const menu = page.getByRole('listbox', { name: 'Demo account' });
  const dialogLayer = await studio.evaluate(element => Number(getComputedStyle(element).zIndex));
  expect(await menu.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(dialogLayer);
  await menu.getByRole('option', { name: '@northstar.studio', exact: true }).click();
  await chooseOption(page, 'Demo media', /^Three simple ideas for your next creative project/);
  await studio.getByLabel('Demo username', { exact: true }).fill(`lines-${keyword}`);
  await studio.getByLabel('Demo comment', { exact: true }).fill(keyword);
  await studio.getByRole('button', { name: 'Simulate comment', exact: true }).click();
  const recordedOpening = studio.locator('.recorded-message > p').filter({ hasText: opening });
  await expect(recordedOpening).toBeVisible();
  expect.soft(await recordedOpening.innerText()).toBe(opening);
  await studio.getByRole('button', { name: 'Send me the guide', exact: true }).click();
  const recordedPrompt = studio.locator('.recorded-message > p').filter({ hasText: prompt });
  await expect(recordedPrompt).toBeVisible();
  expect.soft(await recordedPrompt.innerText()).toBe(prompt);
  await studio.getByLabel('Demo text response', { exact: true }).fill('lines@example.com');
  await studio.getByRole('button', { name: 'Simulate response', exact: true }).click();
  const recordedResource = studio.locator('.recorded-message > p').filter({ hasText: resource });
  await expect(recordedResource).toBeVisible();
  expect.soft(await recordedResource.innerText()).toBe(resource);
  const snapshot = snapshotSchema.parse(await (await page.request.get('/api/bootstrap')).json());
  const campaign = snapshot.campaigns.find(item => item.name === name);
  const run = snapshot.runs.find(item => item.campaignId === campaign?.id);
  expect(run).toBeDefined();
  const texts = snapshot.messages.filter(item => item.runId === run?.id && item.direction === 'out').map(item => item.text);
  expect(texts).toContain(opening);
  expect(texts).toContain(resource);
  expect(texts).toContain(prompt);
});
