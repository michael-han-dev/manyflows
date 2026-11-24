const scenarios = new Set(['preview_media', 'success', 'discovery_failure', 'partial', 'empty_cursor', 'cursor_loop', 'reauth', 'revoked', 'expired', 'hostile', 'conflicting_duplicate', 'follow_true', 'follow_false', 'follow_missing', 'follow_malformed', 'follow_error']);

function reply(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function metaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input instanceof URL ? input.href : input, init);
  const url = new URL(request.url);
  if (url.origin !== 'https://graph.facebook.com' || !url.pathname.startsWith('/v27.0/')) throw new Error('Unexpected Meta fixture host or version');
  const path = url.pathname.slice('/v27.0/'.length);
  if (request.redirect !== 'manual') throw new Error('Meta redirects must be refused');
  if (path === 'oauth/access_token' && request.method === 'GET') {
    const code = url.searchParams.get('code') ?? '';
    const scenario = code.startsWith('example_') ? code.slice('example_'.length) : '';
    if (!scenarios.has(scenario) || url.searchParams.get('client_id') !== 'example_meta_app' || url.searchParams.get('client_secret') !== 'e2e-meta-secret' || url.searchParams.get('redirect_uri') !== 'http://127.0.0.1:8788/auth/instagram/callback') throw new Error('Unexpected Meta token exchange');
    return reply({ access_token: `example_token_${scenario}`, ...(scenario === 'expired' ? { expires_in: 1 } : {}) });
  }
  const authorization = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer example_token_';
  const scenario = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : '';
  if (!scenarios.has(scenario)) throw new Error('Unexpected Meta fixture authorization');
  if (path === 'me' && request.method === 'GET' && url.searchParams.get('fields') === 'client_business_id') return reply({ id: 'example_system_user', client_business_id: scenario === 'preview_media' ? 'example_preview_business' : 'example_business' });
  if (path === 'me/assigned_instagram_accounts' && request.method === 'GET' && url.searchParams.get('fields') === 'id,username' && url.searchParams.get('limit') === '100') {
    if (scenario === 'preview_media') return reply({ data: [{ id: 'example_preview_account', username: 'example_preview_account' }] });
    const after = url.searchParams.get('after');
    if ([...url.searchParams.keys()].some(key => !['fields', 'limit', 'after'].includes(key))) throw new Error('Discovery followed paging.next');
    if (scenario === 'discovery_failure' && after) return reply({ error: { code: 1, message: 'example private upstream detail' } }, 500);
    if (scenario === 'empty_cursor') return reply({ data: [], paging: { cursors: { after: '' }, next: 'https://example.invalid/never-follow' } });
    if (scenario === 'cursor_loop') return reply({ data: [], paging: { cursors: { after: 'example_loop' }, next: 'https://example.invalid/never-follow' } });
    if (after === null) {
      if (scenario === 'reauth') return reply({ data: [{ id: 'example_ig_1', username: 'example_creator_one' }] });
      return reply({ data: [{ id: 'example_ig_1', username: 'example_creator_one' }], paging: { cursors: { after: 'example_cursor' }, next: scenario === 'hostile' ? 'https://example.invalid/never-follow' : 'https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?after=example_cursor&example_poison=never-follow' } });
    }
    if (after === 'example_cursor') return reply({ data: [{ id: 'example_ig_2', username: 'example_creator_two' }, { id: 'example_ig_1', username: scenario === 'conflicting_duplicate' ? 'example_conflicting_name' : 'example_creator_one' }] });
  }
  if (/^example_(?:ig_[12]|preview_account)\/subscribed_apps$/.test(path) && request.method === 'POST' && url.searchParams.get('subscribed_fields') === 'comments,messages,messaging_postbacks') {
    if (scenario === 'partial' && path.startsWith('example_ig_2/')) return reply({ error: { code: 10, message: 'example private subscription detail' } }, 400);
    return reply({ success: true });
  }
  if (scenario === 'preview_media' && path === 'example_preview_account/media' && request.method === 'GET') {
    const fields = new Set(url.searchParams.get('fields')?.split(','));
    const base = 'https://example.invalid/media-preview';
    const timestamp = '2026-01-01T00:00:00Z';
    return reply({ data: [
      { id: 'example_photo', caption: 'Portrait photograph', media_type: 'IMAGE', timestamp, media_url: fields.has('media_url') ? base + '/portrait' : undefined },
      { id: 'example_reel', caption: 'Studio reel', media_type: 'VIDEO', media_product_type: 'REELS', timestamp, thumbnail_url: fields.has('thumbnail_url') ? base + '/poster' : undefined, media_url: base + '/video' },
      { id: 'example_expired', caption: 'Expired image', media_type: 'IMAGE', timestamp, media_url: base + '/expired' },
      { id: 'example_no_poster', caption: 'Reel without a poster', media_type: 'VIDEO', timestamp, media_url: base + '/video' },
    ] });
  }
  if (/^example_ig_[12]\/media$/.test(path) && request.method === 'GET') {
    if (scenario === 'revoked') return reply({ error: { code: 190, message: 'example private revoked detail' } }, 400);
    return reply({ data: [] });
  }
  if (/^example_follow_sender_[0-9]+$/.test(path) && request.method === 'GET') {
    if (url.searchParams.get('fields') !== 'is_user_follow_business' || [...url.searchParams.keys()].length !== 1) throw new Error('Unexpected follow profile fields');
    if (scenario === 'follow_missing') return reply({ id: path });
    if (scenario === 'follow_malformed') return reply({ is_user_follow_business: 'true' });
    if (scenario === 'follow_error') return reply({ error: { code: 10, message: 'example private profile error' } }, 400);
    return reply({ is_user_follow_business: scenario === 'follow_true' });
  }
  if ((/^example_ig_[12]\/messages$/.test(path) || /^example_comment\/replies$/.test(path)) && request.method === 'POST') {
    if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected Meta send content type');
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || !('message' in body) || (path.endsWith('/messages') && !('recipient' in body))) throw new Error('Unexpected Meta send body');
    return reply({ id: 'example_sent_message' });
  }
  throw new Error(`Unexpected Meta fixture request: ${request.method} ${url.origin}${url.pathname}`);
}
