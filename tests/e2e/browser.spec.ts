import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { BUTTON_LABEL_LIMIT, BUTTON_MESSAGE_LIMIT, MESSAGING_WINDOW_SECONDS, campaignInputSchema, defaultCampaign, type CampaignInput } from '../../src/shared/domain';

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
  await page.goto('/');
  await expect(page).toHaveTitle('Manyflows · Instagram workspace');
  await page.screenshot({ path: testInfo.outputPath('login-desktop.png'), fullPage: true, animations: 'disabled' });
  await signIn(page);
  await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true, animations: 'disabled' });
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
  await expect(page.getByRole('tablist', { name: 'Campaign editor', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit link 1', exact: true }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await linkDialog.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://www.notion.so/browser-guide');
  await linkDialog.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(page.getByText(/^Advanced flow/)).toHaveCount(0);
  await expect(page.getByLabel('Visual conversation flow', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh workspace', exact: true })).toHaveCount(0);
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  await expect(preview.getByRole('button', { name: 'Send me the guide', exact: true })).toBeVisible();
  await expect(preview.getByText('Here is your guide. Enjoy!', { exact: true })).toBeVisible();
  await expect(preview.locator('.preview-response')).toHaveText('Send me the guide');
  const actions = page.getByRole('group', { name: 'Campaign actions', exact: true });
  const status = actions.getByRole('status');
  await expect(status).toHaveText('Draft');
  await actions.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await expect(status).toHaveText('Draft');
  await actions.getByRole('button', { name: 'Publish campaign', exact: true }).click();
  await expect(status).toHaveText('Published');
  await expect(page.getByText(/^Published target:/)).toHaveCount(0);
  await expect(page.getByText('Published. New conversations will use this version.', { exact: true })).toHaveCount(0);
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
  await page.screenshot({ path: testInfo.outputPath('campaigns-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Edit', exact: true }).click();
  await actions.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(status).toHaveText('Paused');
  await expect(actions.getByRole('button', { name: 'Publish campaign', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('dashboard navigation remains usable on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('navigation-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png'), fullPage: true, animations: 'disabled' });
  const finalWidths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(finalWidths.document).toBeLessThanOrEqual(finalWidths.viewport + 1);
});

test('content details and campaign actions fit without horizontal scrolling', async ({ page }, testInfo) => {
  await signIn(page);
  const caption = 'A longer post caption with enough detail to wrap across several lines while keeping every content metric and campaign action available.';
  const created = await page.request.post('/api/demo/media', { data: { accountId: 'demo-studio', id: `layout-${randomUUID()}`, caption, publishedAt: Date.now() } });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Content', exact: true }).click();
  const table = page.locator('.content-table');
  const row = table.getByRole('row').filter({ hasText: caption });
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const bounds = await table.evaluate(element => {
      const container = element.parentElement;
      if (!container) throw new Error('Content table container is missing.');
      return { available: container.clientWidth, content: container.scrollWidth, page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth };
    });
    expect.soft(bounds.content, `Content table must fit at ${width}px`).toBeLessThanOrEqual(bounds.available + 1);
    expect.soft(bounds.page, `Page must fit at ${width}px`).toBeLessThanOrEqual(bounds.viewport + 1);
    await expect(row).toBeVisible();
    const cells = row.getByRole('cell');
    await expect(cells).toHaveCount(7);
    for (const cell of await cells.all()) {
      await expect(cell).toBeVisible();
      const cellBounds = await cell.evaluate(element => ({ right: element.getBoundingClientRect().right, available: element.clientWidth, content: element.scrollWidth }));
      expect.soft(cellBounds.right, `Every content detail must fit at ${width}px`).toBeLessThanOrEqual(width + 1);
      expect.soft(cellBounds.content, `Content cell must not clip at ${width}px`).toBeLessThanOrEqual(cellBounds.available + 1);
    }
    for (const heading of ['Reach', 'Likes', 'Comments', 'Saves / shares', 'Engagement', 'Campaign']) await expect(table.getByRole('columnheader', { name: heading, exact: true })).toBeAttached();
    const action = row.getByRole('button', { name: 'Attach campaign', exact: true });
    const actionBounds = await action.boundingBox();
    expect(actionBounds).not.toBeNull();
    if (actionBounds) expect.soft(actionBounds.x + actionBounds.width, `Campaign action must fit at ${width}px`).toBeLessThanOrEqual(width + 1);
    if ([1440, 1024, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`content-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await row.getByRole('button', { name: 'Attach campaign', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign name', exact: true })).toBeVisible();
});

test('one-page builder shows the full example flow and preserves optional copy and links', async ({ page }, testInfo) => {
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
  const name = `Vertical ${randomUUID().slice(0, 8)}`;
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Campaign account', exact: true }).selectOption('demo-studio');
  await page.getByRole('textbox', { name: 'Opening message', exact: true }).fill('Your opening preview.');
  await page.getByRole('textbox', { name: 'Opening button label', exact: true }).fill('Send resources');
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  async function switchStep(label: string, checked: boolean) {
    const checkbox = page.getByRole('switch', { name: new RegExp(`^${label}(?: |$)`) });
    if (await checkbox.isChecked() !== checked) await checkbox.locator('..').click();
    if (checked) await expect(checkbox).toBeChecked(); else await expect(checkbox).not.toBeChecked();
  }
  const stages = [
    { toggle: 'Collect an email', field: 'Email collection prompt', value: 'Send your email before the links.' },
    { toggle: 'Require a follow', field: 'Follow request message', value: 'Follow, then confirm to continue.' },
    { toggle: 'Send a reminder', field: 'Reminder message', value: 'Remember your links.' },
  ];
  for (const stage of stages) {
    await switchStep(stage.toggle, true);
    await page.getByRole('textbox', { name: stage.field, exact: true }).fill(stage.value);
    if (stage.toggle === 'Require a follow') await preview.getByRole('button', { name: 'Not following', exact: true }).click();
    await expect(preview.getByText(stage.value, { exact: true })).toBeVisible();
    await switchStep(stage.toggle, false);
    await expect(preview.getByText(stage.value, { exact: true })).toHaveCount(0);
    await expect(preview.getByText('Here is your guide. Enjoy!', { exact: true })).toBeVisible();
    await switchStep(stage.toggle, true);
    await expect(page.getByRole('textbox', { name: stage.field, exact: true })).toHaveValue(stage.value);
    if (stage.toggle === 'Require a follow') await preview.getByRole('button', { name: 'Not following', exact: true }).click();
    await expect(preview.getByText(stage.value, { exact: true })).toBeVisible();
    if (stage.toggle === 'Require a follow') await preview.getByRole('button', { name: 'Following', exact: true }).click();
  }
  await page.getByRole('spinbutton', { name: 'Reminder minutes', exact: true }).fill('1');
  await switchStep('Opening message', false);
  for (const stage of stages) await expect(page.getByRole('switch', { name: new RegExp(`^${stage.toggle}(?: |$)`) })).not.toBeChecked();
  await expect(preview.locator('.preview-bubble > p')).toHaveText(['Here is your guide. Enjoy!']);
  await expect(preview.locator('.preview-response')).toHaveCount(0);
  await switchStep('Opening message', true);
  await expect(page.getByRole('textbox', { name: 'Opening message', exact: true })).toHaveValue('Your opening preview.');
  for (const stage of stages) {
    await switchStep(stage.toggle, true);
    await expect(page.getByRole('textbox', { name: stage.field, exact: true })).toHaveValue(stage.value);
  }
  await expect(page.getByRole('spinbutton', { name: 'Reminder minutes', exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Edit link 1', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await dialog.getByRole('textbox', { name: 'Link button label', exact: true }).fill('Guide');
  await dialog.getByRole('textbox', { name: 'Link URL', exact: true }).fill('example.com/guide');
  await dialog.getByRole('button', { name: 'Save link', exact: true }).click();
  for (const label of ['Checklist', 'Course']) {
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Add link', exact: true });
    await dialog.getByRole('textbox', { name: 'Link button label', exact: true }).fill('a'.repeat(BUTTON_LABEL_LIMIT + 1));
    await expect(dialog.getByRole('textbox', { name: 'Link button label', exact: true })).toHaveValue('a'.repeat(BUTTON_LABEL_LIMIT));
    await dialog.getByRole('textbox', { name: 'Link button label', exact: true }).fill(label);
    await dialog.getByRole('textbox', { name: 'Link URL', exact: true }).fill('mailto:reader@example.com');
    await dialog.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Link URL', exact: true }).fill(`example.com:8080/${label.toLowerCase()}`);
    await dialog.getByRole('button', { name: 'Save link', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeDisabled();
  await switchStep('Private message', false);
  await expect(preview.getByText('Private messages are off for this campaign.', { exact: true })).toBeVisible();
  await expect(preview.locator('.preview-bubble')).toHaveCount(0);
  await switchStep('Private message', true);
  await preview.getByRole('radio', { name: 'Comments', exact: true }).click();
  await expect(preview.getByText('Example comment', { exact: true })).toBeVisible();
  await switchStep('Public comment reply', false);
  await expect(preview.getByText('Public replies are off.', { exact: true })).toBeVisible();
  await switchStep('Public comment reply', true);
  await expect(preview.getByText('Public replies are off.', { exact: true })).toHaveCount(0);
  await preview.getByRole('radio', { name: 'Post', exact: true }).click();
  await expect(preview.getByText('Any post or reel', { exact: true })).toBeVisible();
  await preview.getByRole('radio', { name: 'DM', exact: true }).click();
  await expect(preview.locator('.preview-response')).toHaveText(['Send resources', 'alex@example.com']);
  await expect(preview.locator('.preview-bubble > p')).toHaveText(['Your opening preview.', stages[0].value, 'Here is your guide. Enjoy!', stages[2].value]);
  await expect(preview.getByText('After 60 seconds', { exact: true })).toBeVisible();
  const followStatus = preview.getByRole('group', { name: 'Example follow status' });
  await followStatus.getByRole('button', { name: 'Not following', exact: true }).click();
  await expect(preview.getByText(stages[1].value, { exact: true })).toBeVisible();
  await expect(preview.getByText('Here is your guide. Enjoy!', { exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'I followed', exact: true }).click();
  await expect(preview.getByText('Here is your guide. Enjoy!', { exact: true })).toHaveCount(0);
  await followStatus.getByRole('button', { name: 'Following', exact: true }).click();
  await expect(preview.getByText('Here is your guide. Enjoy!', { exact: true })).toBeVisible();
  await expect(preview.getByRole('textbox')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: /^(Send reply|Simulate a reply|Advance time)$/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Resource message', exact: true }).fill('Updated resource preview.');
  await expect(preview.getByText('Updated resource preview.', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /^Course.*simulate visit/ }).click();
  await expect(preview.getByText('Remember your links.', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('Link visited: yes', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /^Course.*visited/ }).click();
  await expect(preview.getByText('Remember your links.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Link visited: no', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /^Course.*simulate visit/ }).click();
  await page.getByRole('button', { name: 'Edit link 3', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await dialog.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.com/updated-course');
  await dialog.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(preview.getByText('Remember your links.', { exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: /^Course.*simulate visit/ })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Edit link 3', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await dialog.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.com:8080/course');
  await dialog.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(preview.getByText('Remember your links.', { exact: true })).toBeVisible();
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    const previewBounds = await preview.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(previewBounds.scroll).toBeLessThanOrEqual(previewBounds.width + 1);
    if ([1280, 390].includes(width)) {
      await page.getByRole('heading', { name: 'Deliver your resource', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`vertical-editor-${width}.png`), animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(async () => campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.name === name)?.draft.flow.nodes.find(item => item.id === 'resource'))
    .toMatchObject({ text: 'Updated resource preview.', buttons: [{ kind: 'url', label: 'Guide', url: 'https://example.com/guide' }, { kind: 'url', label: 'Checklist', url: 'https://example.com:8080/checklist' }, { kind: 'url', label: 'Course', url: 'https://example.com:8080/course' }] });
  await page.reload();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Edit', exact: true }).click();
  for (const stage of stages) await expect(page.getByRole('textbox', { name: stage.field, exact: true })).toHaveValue(stage.value);
  await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeDisabled();
});

test('automatic preview shows the opening reply and delay without bypassing the messaging deadline', async ({ page }) => {
  await signIn(page);
  const input = { ...defaultCampaign('demo-studio'), name: `Preview deadline ${randomUUID().slice(0, 8)}`, flow: { entry: 'initial', nodes: [
    { id: 'initial', kind: 'message', text: 'Visit or reply.', buttons: [{ kind: 'url', label: 'Open resource', url: 'https://example.com/' }], next: 'wait' },
    { id: 'wait', kind: 'delay', seconds: MESSAGING_WINDOW_SECONDS, next: 'expired-message' },
    { id: 'expired-message', kind: 'message', text: 'This must not send after expiry.', buttons: [], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] } } satisfies CampaignInput;
  expect((await page.request.post('/api/campaigns', { data: input })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: input.name }).getByRole('button', { name: 'Edit', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  await expect(preview.locator('.preview-response')).toHaveText('Example reply');
  await expect(preview.getByText(`After ${MESSAGING_WINDOW_SECONDS} seconds`, { exact: true })).toBeVisible();
  await expect(preview.getByText('The messaging window has closed, so the next message cannot be sent.', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /^Open resource.*simulate visit/ }).click();
  await expect(preview.getByRole('button', { name: 'Advance time', exact: true })).toHaveCount(0);
  await expect(preview.getByText('The messaging window has closed, so the next message cannot be sent.', { exact: true })).toBeVisible();
  await expect(preview.getByText('This must not send after expiry.', { exact: true })).toHaveCount(0);
});

test('preview keeps earlier link-condition results when a later link is visited', async ({ page }) => {
  await signIn(page);
  const input = { ...defaultCampaign('demo-studio'), name: `Preview condition ${randomUUID().slice(0, 8)}`, flow: { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Choose a response.', buttons: [{ kind: 'url', label: 'Early link', url: 'https://example.com/early' }, { kind: 'reply', label: 'Yes', next: 'check' }, { kind: 'reply', label: 'Absolutely', next: 'check' }], next: null },
    { id: 'check', kind: 'condition', field: '$link_clicked', operator: 'is_set', value: '', yes: 'done', no: 'resource' },
    { id: 'resource', kind: 'message', text: 'A later resource.', buttons: [{ kind: 'url', label: 'Read', url: 'https://example.com/' }], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] } } satisfies CampaignInput;
  expect((await page.request.post('/api/campaigns', { data: input })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: input.name }).getByRole('button', { name: 'Edit', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  await expect(preview.locator('.preview-response')).toHaveText('Yes');
  await expect(preview.getByText('A later resource.', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Absolutely', exact: true }).click();
  await expect(preview.locator('.preview-response')).toHaveText('Absolutely');
  await preview.getByRole('button', { name: /^Early link.*simulate visit/ }).click();
  await expect(preview.locator('.preview-response')).toHaveText('Absolutely');
  await expect(preview.getByText('A later resource.', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('Link visited: yes', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /^Early link.*visited/ }).click();
  await expect(preview.locator('.preview-response')).toHaveText('Absolutely');
  await expect(preview.getByText('Link visited: no', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /^Read.*simulate visit/ }).click();
  await expect(preview.getByText('Link visited: no', { exact: true })).toBeVisible();
  await expect(preview.getByText('Link visited: yes', { exact: true })).toHaveCount(0);
});

test('automatic preview evaluates example fields and tags and allows alternate paths without changing the draft', async ({ page }, testInfo) => {
  await signIn(page);
  const input = { ...defaultCampaign('demo-studio'), name: `Example branches ${randomUUID().slice(0, 8)}`, flow: { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Choose how to continue.', buttons: [{ kind: 'reply', label: 'Continue', next: 'email' }, { kind: 'reply', label: 'Talk to a person', next: 'handoff' }], next: null },
    { id: 'email', kind: 'collect', field: 'email', prompt: 'Where should we send it?', next: 'name' },
    { id: 'name', kind: 'collect', field: 'name', prompt: 'What is your name?', next: 'answer' },
    { id: 'answer', kind: 'collect', field: 'answer', prompt: 'Tell us more.', next: 'tag' },
    { id: 'tag', kind: 'action', tag: 'Interested', next: 'email-check' },
    { id: 'email-check', kind: 'condition', field: 'email', operator: 'contains', value: '@EXAMPLE.COM', yes: 'tag-check', no: 'other' },
    { id: 'tag-check', kind: 'condition', field: 'tags', operator: 'has_tag', value: 'Interested', yes: 'resource', no: 'other' },
    { id: 'resource', kind: 'message', text: 'Your matching resource.', buttons: [{ kind: 'url', label: 'Read resource', url: 'https://example.com/' }], next: 'link-check' },
    { id: 'link-check', kind: 'condition', field: '$link_clicked', operator: 'equals', value: 'TRUE', yes: 'clicked', no: 'pending' },
    { id: 'clicked', kind: 'message', text: 'Thanks for visiting.', buttons: [], next: 'done' },
    { id: 'pending', kind: 'message', text: 'Your link is ready when you are.', buttons: [], next: 'done' },
    { id: 'other', kind: 'message', text: 'An alternate resource.', buttons: [], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
    { id: 'handoff', kind: 'end', outcome: 'handoff' },
  ] } } satisfies CampaignInput;
  expect((await page.request.post('/api/campaigns', { data: input })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: input.name }).getByRole('button', { name: 'Edit', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  await expect(preview.locator('.preview-response')).toHaveText(['Continue', 'alex@example.com', 'Alex', 'Example answer']);
  await expect(preview.getByText('Your matching resource.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Your link is ready when you are.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Link condition: equals TRUE — No', { exact: true })).toBeVisible();
  await preview.getByRole('group', { name: 'Example result for email', exact: true }).getByRole('button', { name: 'No', exact: true }).click();
  await expect(preview.getByText('An alternate resource.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Your matching resource.', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('Assumed result:', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Reset preview', exact: true }).click();
  await preview.getByRole('button', { name: /^Read resource.*simulate visit/ }).click();
  await expect(preview.getByText('Thanks for visiting.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Link condition: equals TRUE — Yes', { exact: true })).toBeVisible();
  await expect(preview.getByText('Your link is ready when you are.', { exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Talk to a person', exact: true }).click();
  await expect(preview.locator('.preview-response')).toHaveText('Talk to a person');
  await expect(preview.getByText('Hand off to a person', { exact: true })).toBeVisible();
  await expect(preview.getByText('Where should we send it?', { exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Reset preview', exact: true }).click();
  await expect(preview.getByText('Your link is ready when you are.', { exact: true })).toBeVisible();
  await preview.screenshot({ path: testInfo.outputPath('automatic-custom-preview.png'), animations: 'disabled' });
  expect(campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.name === input.name)?.draft).toEqual(input);
});

test('ambiguous saved graphs are not silently converted to guided templates', async ({ page }) => {
  await signIn(page);
  const input = defaultCampaign('demo-studio');
  input.name = `Ambiguous ${randomUUID().slice(0, 8)}`;
  input.flow.nodes.push({ id: 'done', kind: 'end', outcome: 'complete' });
  const response = await page.request.post('/api/campaigns', { data: input });
  expect(response.ok()).toBeTruthy();
  const saved = z.object({ id: z.string() }).parse(await response.json());
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: input.name }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Opening message', exact: true })).toHaveCount(0);
  await expect(page.getByText('Each step needs a unique ID.', { exact: true }).first()).toBeVisible();
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  await expect(preview.getByText('The preview stopped because the flow has a missing, repeated, or duplicate step.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Conversation complete', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(`${input.name} edited`);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(async () => campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.id === saved.id)?.draft)
    .toEqual({ ...input, name: `${input.name} edited` });
});

test('editing campaign settings preserves a custom conversation graph', async ({ page }) => {
  await signIn(page);
  const input = { ...defaultCampaign('demo-studio'), name: `Custom ${randomUUID().slice(0, 8)}`, flow: { entry: 'custom-opening', nodes: [
    { id: 'custom-opening', kind: 'message', text: 'Choose to continue.', buttons: [{ kind: 'reply', label: 'Continue', next: 'custom-tag' }], next: null },
    { id: 'custom-tag', kind: 'action', tag: 'interested', next: 'custom-resource' },
    { id: 'custom-resource', kind: 'message', text: 'Your custom resource.', buttons: [], next: 'custom-done' },
    { id: 'custom-done', kind: 'end', outcome: 'handoff' },
  ] } } satisfies CampaignInput;
  const response = await page.request.post('/api/campaigns', { data: input });
  expect(response.ok()).toBeTruthy();
  const saved = z.object({ id: z.string() }).parse(await response.json());
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: input.name }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Opening message', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(`${input.name} edited`);
  await page.getByRole('textbox', { name: 'Include keywords', exact: true }).fill('CUSTOM');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(async () => campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.id === saved.id)?.draft).toEqual({ ...input, name: `${input.name} edited`, matching: { ...input.matching, include: ['CUSTOM'] } });
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: `${input.name} edited` }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign name', exact: true })).toHaveValue(`${input.name} edited`);
  expect(campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json()).campaigns.find(item => item.id === saved.id)?.draft.flow).toEqual(input.flow);
});

test('button-message limits are visible before publication', async ({ page }) => {
  await signIn(page);
  const input = defaultCampaign('demo-studio');
  input.name = `Long message ${randomUUID().slice(0, 8)}`;
  const opening = input.flow.nodes.find(item => item.id === 'opening');
  if (opening?.kind !== 'message') throw new Error('Default opening message is missing.');
  opening.text = 'x'.repeat(BUTTON_MESSAGE_LIMIT + 1);
  const response = await page.request.post('/api/campaigns', { data: input });
  expect(response.ok()).toBeTruthy();
  const saved = z.object({ id: z.string() }).parse(await response.json());
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: input.name }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText(`Step opening must use at most ${BUTTON_MESSAGE_LIMIT} characters with buttons.`, { exact: true }).first()).toBeVisible();
  expect((await page.request.post(`/api/campaigns/${saved.id}/publish`)).status()).toBe(400);
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

test('duplicating a live campaign opens a separate draft with its last saved settings', async ({ page }) => {
  await signIn(page);
  const fixture = await publishFixture(page);
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('row').filter({ hasText: fixture.input.name }).getByRole('button', { name: 'Edit', exact: true }).click();

  const actions = page.getByRole('group', { name: 'Campaign actions', exact: true });
  const keywords = page.getByRole('textbox', { name: 'Include keywords', exact: true });
  const savedKeyword = `saved-${fixture.keyword}`;
  await keywords.fill(savedKeyword);
  await actions.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await expect(actions.getByRole('status')).toHaveText('Published');
  await keywords.fill('unsaved keyword');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(actions.getByRole('status')).toHaveText('Published');

  await actions.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate campaign', exact: true });
  await expect(dialog.getByText(/last saved settings/)).toBeVisible();
  await expect(dialog.getByText(/discard your unsaved edits/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();

  const copyName = `${fixture.input.name} (copy)`;
  await expect(page.getByRole('heading', { name: copyName, exact: true })).toBeVisible();
  await expect(actions.getByRole('status')).toHaveText('Draft');
  await expect(keywords).toHaveValue(savedKeyword);
  const { campaigns } = campaignsSchema.parse(await (await page.request.get('/api/bootstrap')).json());
  const copy = campaigns.find(item => item.name === copyName);
  expect(copy).toMatchObject({ status: 'draft', publishedTarget: null });
  expect(copy?.id).not.toBe(fixture.id);
  expect(campaigns.find(item => item.id === fixture.id)).toMatchObject({
    status: 'live', publishedTarget: fixture.input.target, draft: { matching: { include: [savedKeyword] } },
  });
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
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('manyflows-contacts.csv');
  const path = await download.path();
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

test('shared controls support keyboard use, modal focus and reduced motion', async ({ page }, testInfo) => {
  await signIn(page);
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('14px "Geist"');
    await document.fonts.load('14px "Geist Mono"');
    await document.fonts.ready;
    const loaded: string[] = [];
    document.fonts.forEach(font => { if (font.status === 'loaded') loaded.push(font.family.replaceAll('"', '')); });
    return loaded;
  });
  expect(fonts).toEqual(expect.arrayContaining(['Geist', 'Geist Mono']));
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Campaigns/ }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
  const opening = page.getByRole('switch', { name: 'Opening message', exact: true });
  await opening.focus();
  await page.keyboard.press('Space');
  await expect(opening).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(opening).toBeChecked();
  const edit = page.getByRole('button', { name: 'Edit link 1', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save link', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('link-dialog-desktop.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await edit.click();
  await page.locator('.dialog-overlay').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  const views = page.getByRole('radiogroup', { name: 'Preview view', exact: true });
  await views.getByRole('radio', { name: 'DM', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(views.getByRole('radio', { name: 'Comments', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(views.getByRole('radio', { name: 'Comments', exact: true })).toBeChecked();
  await expect(page.getByRole('complementary', { name: 'Campaign preview', exact: true }).getByText('Example comment', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await opening.locator('.switch-thumb').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.01);
  await page.setViewportSize({ width: 320, height: 700 });
  await edit.click();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) { expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320); expect(bounds.height).toBeLessThanOrEqual(700); }
  await page.screenshot({ path: testInfo.outputPath('link-dialog-mobile.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
});

test('all workspace layouts remain usable across phone, tablet and desktop widths', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await signIn(page);
  let previousPage = 'Overview';
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Overview', 'Campaigns', 'Content', 'Inbox', 'Contacts', 'Activity', 'Settings']) {
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      if (name !== previousPage) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      if (!await nav.isVisible()) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await nav.getByRole('button', { name: new RegExp(`^${name}(?: |$)`) }).click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      previousPage = name;
      await expect(page.locator('main h1')).toBeVisible();
      const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(element => { const rect = element.getBoundingClientRect(); return rect.right > document.documentElement.clientWidth + 1 && rect.width > 0 && getComputedStyle(element).visibility !== 'hidden'; }).slice(0, 12).map(element => ({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', right: element.getBoundingClientRect().right })) }));
      expect(overflow.scroll, `${name} must fit at ${width}px. ${JSON.stringify(overflow.elements)}`).toBeLessThanOrEqual(overflow.width + 1);
      if (name === 'Settings') {
        const buttons = await page.locator('.settings-account .button').evaluateAll(elements => elements.map(element => ({ label: element.textContent, width: element.clientWidth, scroll: element.scrollWidth })));
        for (const button of buttons) expect(button.scroll, `${button.label} must fit its button at ${width}px`).toBeLessThanOrEqual(button.width + 1);
      }
      const skip = await page.getByRole('link', { name: 'Skip to content', exact: true }).boundingBox();
      if (skip) expect(skip.y + skip.height, 'Skip link stays hidden until keyboard focus').toBeLessThanOrEqual(0);
      if ([1440, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-${width}.png`), fullPage: ['Overview', 'Settings'].includes(name), animations: 'disabled' });
    }
    if (width <= 390) {
      const account = await page.getByLabel('Account filter', { exact: true }).boundingBox();
      const range = await page.getByLabel('Date range', { exact: true }).boundingBox();
      expect(account).not.toBeNull(); expect(range).not.toBeNull();
      if (account && range) {
        if (width > 380) expect(Math.abs(account.y - range.y)).toBeLessThanOrEqual(1);
        else expect(range.y).toBeGreaterThan(account.y);
      }
    }
  }
});

test('preview includes post context and workspace controls have consistent spacing', async ({ page }, testInfo) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
  await page.getByLabel('Campaign account', { exact: true }).selectOption('demo-studio');
  await page.getByRole('button', { name: /Specific post or reel/ }).click();
  const selectedPost = page.getByRole('group', { name: 'Choose content', exact: true }).getByRole('button').first();
  await selectedPost.click();
  const caption = await selectedPost.locator('strong').innerText();
  const preview = page.getByRole('complementary', { name: 'Campaign preview', exact: true });
  await preview.getByRole('radio', { name: 'Comments', exact: true }).click();
  await expect.soft(preview.getByText(caption, { exact: true }), 'Comments must retain the selected post caption above the replies').toBeVisible();
  const postBounds = await preview.getByRole('region', { name: 'Post preview', exact: true }).boundingBox();
  const commentBounds = await preview.getByRole('region', { name: 'Comments preview', exact: true }).boundingBox();
  expect(postBounds).not.toBeNull(); expect(commentBounds).not.toBeNull();
  if (postBounds && commentBounds) expect(postBounds.y + postBounds.height).toBeLessThanOrEqual(commentBounds.y + 1);
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const measurements = await page.evaluate(() => {
      const workspace = document.querySelector('.workspace-label');
      const header = document.querySelector('.editor-title');
      const workspaceText = workspace?.querySelector('strong');
      const controls = ['[aria-label="Account filter"]', '[aria-label="Date range"]', '[aria-label="Campaign account"]'].map(selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Missing workspace control');
        const style = getComputedStyle(element);
        const arrow = element.closest('.select-control')?.querySelector('svg');
        return { height: element.getBoundingClientRect().height, appearance: style.appearance, paddingRight: parseFloat(style.paddingRight), arrowInset: arrow ? element.getBoundingClientRect().right - arrow.getBoundingClientRect().right : null };
      });
      return { workspaceText: workspace?.textContent, workspaceIcons: workspace?.querySelectorAll('svg').length, headerMarkers: header?.querySelectorAll('.status i,.save-indicator').length, workspaceLineHeight: workspaceText?.getBoundingClientRect().height, workspaceTextLineHeight: workspaceText ? parseFloat(getComputedStyle(workspaceText).lineHeight) : null, controls };
    });
    expect.soft(measurements.workspaceText).not.toContain('Instagram automations');
    expect.soft(measurements.workspaceIcons).toBe(0);
    if (measurements.workspaceLineHeight && measurements.workspaceTextLineHeight) expect.soft(measurements.workspaceLineHeight).toBeLessThanOrEqual(measurements.workspaceTextLineHeight + 1);
    expect.soft(measurements.headerMarkers).toBe(0);
    expect.soft(new Set(measurements.controls.map(control => control.height)).size, 'Account, date and form controls must share one height').toBe(1);
    for (const select of measurements.controls) {
      expect.soft(select.appearance, 'Dropdown arrows need app-owned edge spacing').toBe('none');
      expect.soft(select.paddingRight).toBeGreaterThanOrEqual(32);
      expect.soft(select.arrowInset).toBeGreaterThanOrEqual(8);
    }
    if ([1440, 390].includes(width)) {
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`preview-controls-${width}.png`), animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: /All posts and reels/ }).click();
  await expect(preview.getByText('Example post from this account', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Next publication/ }).click();
  await expect(preview.getByText('Your next post or reel', { exact: true })).toBeVisible();
  await expect(preview.getByText('Example post from this account', { exact: true })).toHaveCount(0);
});

test('touch screens keep dropdowns, inputs and action buttons aligned', async ({ page, browser }, testInfo) => {
  await signIn(page);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
  try {
    const touch = await context.newPage();
    await touch.goto('/');
    await touch.getByRole('button', { name: 'Create campaign', exact: true }).first().click();
    expect(await touch.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBeTruthy();
    const sizes = await touch.evaluate(() => ['[aria-label="Account filter"]', '[aria-label="Date range"]', '[aria-label="Campaign account"]', '[aria-label="Campaign name"]', '.editor-actions .button'].map(selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Missing touch control');
      return element.getBoundingClientRect().height;
    }));
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeGreaterThanOrEqual(40);
    const bounds = await touch.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    for (const width of [390, 320]) {
      await touch.setViewportSize({ width, height: 844 });
      const labels = await touch.locator('.global-filters select').evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas').getContext('2d');
        if (!canvas) throw new Error('Text measurement unavailable');
        canvas.font = style.font;
        const value = element.querySelector('option:checked')?.textContent || '';
        return { value, required: canvas.measureText(value).width, available: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
      }));
      for (const label of labels) expect(label.required, `${label.value} must remain readable at ${width}px`).toBeLessThanOrEqual(label.available + 1);
      await touch.screenshot({ path: testInfo.outputPath(`touch-editor-${width}.png`), animations: 'disabled' });
    }
  } finally { await context.close(); }
});
