import { chooseOption } from './select-option';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const snapshotSchema = z.object({ campaigns: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })) });

test('publication status follows confirmed actions when the workspace refresh fails', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner password', { exact: true }).fill('e2e-local-password');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Account filter', { exact: true })).toBeVisible();
  expect((await page.request.post('/api/demo/seed')).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
  const name = `Status ${randomUUID().slice(0, 8)}`;
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(name);
  await chooseOption(page, 'Campaign account', /^@northstar\.studio · Demo$/);
  const actions = page.getByRole('group', { name: 'Campaign actions', exact: true });
  await actions.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const saved = snapshotSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.name === name);
  expect(saved).toBeDefined();
  if (!saved) throw new Error('Saved campaign is missing');
  await page.route('**/api/bootstrap*', route => route.abort());
  await actions.getByRole('button', { name: 'Publish campaign', exact: true }).click();
  await expect.poll(async () => snapshotSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.id === saved.id)?.status).toBe('live');
  await expect(actions.getByRole('status')).toHaveText('Published', { timeout: 3000 });
  await actions.getByRole('button', { name: 'More campaign actions' }).click();
  await page.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  await expect(actions.getByRole('status')).toHaveText('Paused');
  await actions.getByRole('button', { name: 'More campaign actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.unroute('**/api/bootstrap*');
  expect((await page.request.post(`/api/campaigns/${saved.id}/publish`)).ok()).toBeTruthy();
  await expect(actions.getByRole('status')).toHaveText('Published', { timeout: 12000 });
  await page.route(`**/api/campaigns/${saved.id}/publish`, async route => {
    const response = await route.fetch();
    expect((await page.request.post(`/api/campaigns/${saved.id}/pause`)).ok()).toBeTruthy();
    await route.fulfill({ response });
  });
  await actions.getByRole('button', { name: 'Publish changes', exact: true }).click();
  await expect(actions.getByRole('button', { name: /^Publish (changes|campaign)$/ })).toBeEnabled();
  await expect(actions.getByRole('status')).toHaveText('Paused', { timeout: 1000 });
});
