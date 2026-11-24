import { expect, test } from '@playwright/test';
import { z } from 'zod';

const snapshotSchema = z.object({
  runs: z.array(z.object({})),
  metrics: z.object({
    completedRuns: z.number(),
    buttonResponders: z.number(),
    openingAccepted: z.number(),
    uniqueClickers: z.number(),
    linkMessagesAccepted: z.number(),
  }),
});

test('overview rates show their underlying counts and align across screen sizes', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner password', { exact: true }).fill('e2e-local-password');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('region', { name: 'Workspace results' })).toBeVisible();
  expect((await page.request.post('/api/demo/seed')).ok()).toBeTruthy();
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap' && response.ok());
  await page.reload();
  const { runs, metrics } = snapshotSchema.parse(await (await loaded).json());
  const rates = page.locator('.overview-ratios');
  const expected = [
    { label: 'Button response rate', top: metrics.buttonResponders, bottom: metrics.openingAccepted },
    { label: 'Link click-through', top: metrics.uniqueClickers, bottom: metrics.linkMessagesAccepted },
    { label: 'Conversation completion', top: metrics.completedRuns, bottom: runs.length },
  ];
  for (const metric of expected) {
    const row = rates.locator(':scope > div').filter({ has: page.getByText(metric.label, { exact: true }) });
    await expect(row.locator('dd').first()).toHaveText(metric.bottom ? `${(100 * metric.top / metric.bottom).toFixed(1)}%` : '—');
    await expect(row.locator('dd').last()).toHaveText(new RegExp(`^${metric.top.toLocaleString('en-US')} .+ ÷ ${metric.bottom.toLocaleString('en-US')} .+$`));
  }

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const rightEdges = await rates.locator('.overview-rate').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
    expect(Math.max(...rightEdges) - Math.min(...rightEdges)).toBeLessThanOrEqual(1);
    const [first, second] = await page.getByRole('region', { name: 'Workspace results' })
      .locator('dd:first-of-type').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
  }
  await page.getByText('How to read these numbers', { exact: true }).click();
  await expect(page.getByText('Link attribution.', { exact: true })).toBeVisible();
});
