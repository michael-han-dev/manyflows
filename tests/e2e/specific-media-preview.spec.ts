import { expect, test } from '@playwright/test';

test('selected post and reel images follow the target across preview views', async ({ page }, testInfo) => {
  const api = page.request;
  expect((await api.post('/api/login', { data: { password: 'e2e-local-password' } })).ok()).toBeTruthy();
  const login = await api.get('/api/accounts/connect', { maxRedirects: 0 });
  const state = new URL(login.headers().location).searchParams.get('state');
  if (!state) throw new Error('Missing connection state');
  const callback = await api.get('/auth/instagram/callback', { params: { state, code: 'example_preview_media' }, maxRedirects: 0 });
  expect(new URL(callback.headers().location).searchParams.get('connection')).toBe('connected');

  try {
    await page.route('https://example.invalid/media-preview/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/expired')) return route.fulfill({ status: 404 });
      const width = path.endsWith('/poster') ? 900 : 600;
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1200"><rect width="100%" height="100%" fill="tan"/></svg>` });
    });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Content', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Portrait photograph' }).getByRole('button', { name: 'Attach campaign' }).click();
    const preview = page.getByRole('complementary', { name: 'Campaign preview' });
    const attachment = preview.getByRole('region', { name: 'Post preview' });
    const mediaPicker = page.getByRole('group', { name: 'Choose content' });
    await expect(preview.getByRole('radio', { name: 'DM', exact: true })).toBeChecked();

    for (const view of ['DM', 'Comments', 'Post']) {
      await preview.getByRole('radio', { name: view, exact: true }).click();
      const photo = attachment.getByRole('img', { name: 'Selected post' });
      await expect(photo).toHaveAttribute('src', 'https://example.invalid/media-preview/portrait');
      await expect.poll(() => photo.evaluate(img => img instanceof HTMLImageElement && img.naturalWidth)).toBe(600);
      await expect(photo).toHaveCSS('object-fit', 'contain');
      await expect(attachment).toContainText('Portrait photograph');
    }
    await preview.getByRole('radio', { name: 'DM', exact: true }).click();
    await mediaPicker.getByRole('button', { name: /Studio reel/ }).click();
    const poster = attachment.getByRole('img', { name: 'Selected reel' });
    await expect(poster).toHaveAttribute('src', 'https://example.invalid/media-preview/poster');
    await expect.poll(() => poster.evaluate(img => img instanceof HTMLImageElement && img.naturalWidth)).toBe(900);
    await expect(attachment).toContainText('Studio reel');
    await preview.screenshot({ path: testInfo.outputPath('reel-attachment.png') });

    for (const caption of ['Expired image', 'Reel without a poster']) {
      await mediaPicker.getByRole('button', { name: new RegExp(caption) }).click();
      await expect(attachment.getByText('Image unavailable')).toBeVisible();
      await expect(attachment).toContainText(caption);
      await expect(attachment.getByRole('img')).toHaveCount(0);
    }
    await page.getByRole('button', { name: /Next publication/ }).click();
    await expect(attachment).toHaveCount(0);
  } finally {
    expect((await api.delete('/api/accounts/example_preview_account', { data: { confirmation: 'DELETE' } })).ok()).toBeTruthy();
  }
});
