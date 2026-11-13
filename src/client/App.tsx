import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowRight, BarChart3, Check, ChevronDown, FlaskConical, Camera, LayoutDashboard, LockKeyhole, LogOut, Menu, MessageCircle, PanelLeftClose, Plus, RefreshCw, Settings2, ShieldCheck, Send, Users, X } from 'lucide-react';
import { defaultCampaign, type Bootstrap, type Campaign, type CampaignInput, type Media } from '../shared/domain';
import { ApiError, campaignSchema, getBootstrap, getSession, request } from './api';
import { CampaignEditor } from './components/CampaignEditor';
import { DemoStudio } from './components/DemoStudio';
import { ActivityView, Campaigns, Contacts, Content, Inbox, Overview, Settings } from './components/Views';
import { Empty, Icon, Spinner } from './components/ui';

type Page = 'overview' | 'campaigns' | 'content' | 'inbox' | 'contacts' | 'activity' | 'settings';
type Editor = { kind: 'new'; input: CampaignInput } | { kind: 'existing'; campaign: Campaign };
const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'campaigns', label: 'Campaigns', icon: MessageCircle },
  { id: 'content', label: 'Content', icon: Camera }, { id: 'inbox', label: 'Inbox', icon: MessageCircle },
  { id: 'contacts', label: 'Contacts', icon: Users }, { id: 'activity', label: 'Activity', icon: Activity }, { id: 'settings', label: 'Settings', icon: Settings2 },
] satisfies { id: Page; label: string; icon: typeof LayoutDashboard }[];

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [page, setPage] = useState<Page>('overview');
  const [accountId, setAccountId] = useState('');
  const [period, setPeriod] = useState('30');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [studio, setStudio] = useState<{ username?: string; accountId?: string } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const query = new URLSearchParams();
  if (accountId) query.set('accountId', accountId);
  if (period === 'custom') { if (from) query.set('from', String(new Date(`${from}T00:00:00`).getTime())); if (to) query.set('to', String(new Date(`${to}T23:59:59.999`).getTime())); }
  else if (period !== 'all') query.set('from', String(new Date(new Date().setHours(0, 0, 0, 0)).getTime() - (Number(period) - 1) * 86400000));
  const queryString = query.size ? `?${query.toString()}` : '';
  const currentQuery = useRef(queryString);
  currentQuery.current = queryString;

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try { const fresh = await getBootstrap(queryString); if (currentQuery.current === queryString) { setData(fresh); if (!quiet) setError(null); } return fresh; }
    catch (error) { if (error instanceof ApiError && error.status === 401) { setAuth('unauthenticated'); setData(null); } else if (!quiet) setError(error instanceof Error ? error.message : 'The workspace could not be loaded.'); throw error; }
    finally { if (!quiet) setRefreshing(false); }
  }, [queryString]);

  useEffect(() => { let current = true; getSession().then(authenticated => { if (current) setAuth(authenticated ? 'authenticated' : 'unauthenticated'); }).catch(error => { if (current) { setSessionError(error instanceof Error ? error.message : 'Could not reach the server.'); setAuth('unauthenticated'); } }); return () => { current = false; }; }, []);
  useEffect(() => { if (auth === 'authenticated') void refresh().catch(() => undefined); }, [auth, refresh]);
  useEffect(() => {
    if (auth !== 'authenticated') return;
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(true).catch(() => undefined); }, 5000);
    return () => window.clearInterval(interval);
  }, [auth, refresh]);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(null), 5000); return () => window.clearTimeout(timeout); }, [notice]);

  async function mutate(path: string, body?: unknown, method = 'POST') {
    setBusy(true);
    try {
      const payload = await request(path, { method, body });
      await refresh(true).catch(error => { if (!(error instanceof ApiError && error.status === 401)) setError('The change was saved, but the workspace could not refresh. Use Refresh workspace to load the latest records.'); });
      return payload;
    }
    catch (error) { if (error instanceof ApiError && error.status === 401) setAuth('unauthenticated'); throw error; }
    finally { setBusy(false); }
  }

  async function action(task: () => Promise<unknown>, message?: string) {
    setError(null);
    try { await task(); if (message) setNotice(message); }
    catch (error) { setError(error instanceof Error ? error.message : 'The action could not be completed.'); }
  }

  function navigate(next: Page) {
    if (editor && editorDirty && !window.confirm('Leave the campaign editor? Any unsaved changes will be discarded.')) return;
    setEditor(null); setPage(next); setMobileNav(false); setError(null);
  }

  function create(media?: Media) {
    if (!data?.accounts.length) { if (data?.configuration.demoEnabled) setStudio({}); else navigate('settings'); return; }
    const input = defaultCampaign(media?.accountId ?? (accountId || data.accounts[0]?.id || ''));
    if (media) input.target = { kind: 'specific', mediaId: media.id };
    setPage('campaigns'); setEditor({ kind: 'new', input }); setError(null);
  }

  async function saveCampaign(input: CampaignInput, publish: boolean) {
    const id = editor?.kind === 'existing' ? editor.campaign.id : null;
    const campaign = campaignSchema.parse(await mutate(id ? `/api/campaigns/${encodeURIComponent(id)}` : '/api/campaigns', input, id ? 'PUT' : 'POST'));
    if (publish) {
      try { const live = campaignSchema.parse(await mutate(`/api/campaigns/${encodeURIComponent(campaign.id)}/publish`)); setEditor({ kind: 'existing', campaign: live }); }
      catch (error) { setEditor({ kind: 'existing', campaign }); setError(`Draft saved. Publishing failed. ${error instanceof Error ? error.message : 'Please review the campaign and try again.'}`); throw error; }
    } else setEditor({ kind: 'existing', campaign });
  }

  async function duplicate(campaign: Campaign, destination: string) {
    const copy = campaignSchema.parse(await mutate(`/api/campaigns/${encodeURIComponent(campaign.id)}/duplicate`, { accountId: destination }));
    setEditor({ kind: 'existing', campaign: copy }); setPage('campaigns'); setNotice('A separate draft copy is ready to edit.');
  }

  async function sync(id?: string) {
    const ids = id ? [id] : data?.accounts.filter(account => !accountId || account.id === accountId).map(account => account.id) ?? [];
    for (const id of ids) await mutate(`/api/accounts/${encodeURIComponent(id)}/sync`);
    setNotice('Content sync completed. Available insights have been refreshed.');
  }

  if (auth === 'checking') return <div className="loading-screen"><RelayLogo /><Spinner /><p>Opening your workspace…</p></div>;
  if (auth === 'unauthenticated') return <Login initialError={sessionError} onLogin={() => { setSessionError(null); setAuth('authenticated'); }} />;
  const currentCampaign = editor?.kind === 'existing' ? data?.campaigns.find(campaign => campaign.id === editor.campaign.id) ?? editor.campaign : null;
  const activeAccount = data?.accounts.find(account => account.id === accountId);
  const demoVisible = data?.accounts.some(account => account.mode === 'demo' && (!accountId || account.id === accountId));

  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to content</a>{mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}<aside className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="sidebar-brand"><RelayLogo /><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNav(false)}><Icon icon={X} /></button></div><div className="workspace-label"><span className="workspace-avatar">R</span><div><strong>Personal workspace</strong><small>Instagram automations</small></div><Icon icon={ChevronDown} size={14} /></div><nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon icon={item.icon} size={19} />{item.label}{item.id === 'campaigns' && data && data.campaigns.filter(campaign => campaign.status === 'live').length > 0 && <span className="nav-count">{data.campaigns.filter(campaign => campaign.status === 'live').length}</span>}</button>)}</nav><div className="sidebar-bottom">{data?.configuration.demoEnabled && <button className="demo-shortcut" onClick={() => setStudio({})}><Icon icon={FlaskConical} size={18} /><span>Demo studio<small>Try a conversation</small></span><Icon icon={ArrowRight} size={15} /></button>}<div className="owner-row"><span className="owner-avatar">M</span><div><strong>Workspace owner</strong><small>Private access</small></div><button aria-label="Sign out" className="icon-button" onClick={() => void action(async () => { await request('/api/logout', { method: 'POST' }); setAuth('unauthenticated'); setData(null); setEditor(null); })}><Icon icon={LogOut} size={17} /></button></div></div></aside><div className="app-main"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Icon icon={Menu} size={21} /></button><span className="breadcrumb">Workspace<span>/</span><strong>{navigation.find(item => item.id === page)?.label}</strong>{editor && <><span>/</span><span>Campaign editor</span></>}</span></div><div className="global-filters"><div className="account-select"><span className="account-select-icon"><Icon icon={Camera} size={16} /></span><select aria-label="Account filter" value={accountId} onChange={event => { setAccountId(event.target.value); }}><option value="">All accounts</option>{data?.accounts.map(account => <option key={account.id} value={account.id}>@{account.username}{account.mode === 'demo' ? ' · Demo' : ''}</option>)}</select></div><select className="date-select" aria-label="Date range" value={period} onChange={event => setPeriod(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option><option value="custom">Custom dates</option></select><button className="icon-button refresh-button" aria-label="Refresh workspace" disabled={refreshing} onClick={() => void refresh().catch(() => undefined)}><Icon icon={RefreshCw} size={17} className={refreshing ? 'spin' : ''} /></button></div></header>{period === 'custom' && <div className="custom-dates"><label>From<input aria-label="From date" type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label><label>To<input aria-label="To date" type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label><span>Applies to recorded activity and metrics.</span></div>}{demoVisible && <div className="demo-banner"><Icon icon={FlaskConical} size={15} /><span><strong>Demo workspace</strong> · Sample content insights and simulated sends. No Instagram messages are sent.</span><button onClick={() => setStudio({})}>Open demo studio<Icon icon={ArrowRight} size={14} /></button></div>}{data && !data.configuration.metaConfigured && !demoVisible && <div className="configuration-banner"><Icon icon={ShieldCheck} size={15} /><span>Connect your own Meta app to start live automations.</span><button onClick={() => navigate('settings')}>View setup<Icon icon={ArrowRight} size={14} /></button></div>}<main id="main-content" tabIndex={-1} className={editor ? 'main-content editor-content' : 'main-content'}>{error && <div className="alert error global-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><Icon icon={X} size={16} /></button></div>}{!data ? refreshing ? <div className="loading-panel"><Spinner /><p>Loading your workspace…</p></div> : <Empty title="Your workspace could not be loaded" text="Check that the local API is running, then try again." action={<button className="button primary" onClick={() => void refresh().catch(() => undefined)}>Try again</button>} /> : editor ? <CampaignEditor key={editor.kind === 'new' ? 'new' : editor.campaign.id} campaign={currentCampaign} initial={editor.kind === 'new' ? editor.input : editor.campaign.draft} accounts={data.accounts} media={data.media} onBack={() => setEditor(null)} onDirtyChange={setEditorDirty} onSave={saveCampaign} onPause={async () => { if (currentCampaign) { const paused = campaignSchema.parse(await mutate(`/api/campaigns/${encodeURIComponent(currentCampaign.id)}/pause`)); setEditor({ kind: 'existing', campaign: paused }); } }} onDuplicate={async id => { if (currentCampaign) await duplicate(currentCampaign, id); }} /> : page === 'overview' ? <Overview data={data} accountId={accountId} onCreate={() => create()} onCampaigns={() => navigate('campaigns')} onActivity={() => navigate('activity')} onDemo={() => setStudio({})} /> : page === 'campaigns' ? <Campaigns data={data} onCreate={() => create()} onEdit={campaign => setEditor({ kind: 'existing', campaign })} onAction={(campaign, operation) => { if (operation === 'duplicate') void action(() => duplicate(campaign, campaign.accountId)); else void action(() => mutate(`/api/campaigns/${encodeURIComponent(campaign.id)}/${operation}`), operation === 'pause' ? 'Campaign paused for new entries.' : 'Campaign published.'); }} /> : page === 'content' ? <Content data={data} onAttach={media => create(media)} onSync={() => void action(() => sync())} busy={busy} /> : page === 'inbox' ? <Inbox data={data} onDemo={(username, accountId) => setStudio({ username, accountId })} /> : page === 'contacts' ? <Contacts data={data} /> : page === 'activity' ? <ActivityView data={data} /> : <Settings data={data} accountId={accountId} onSync={id => void action(() => sync(id))} onDemo={() => setStudio({})} busy={busy} />}</main><footer className="app-footer"><span><span className="connection-dot" />{activeAccount ? `@${activeAccount.username}` : 'All accounts'}{demoVisible ? ' · Demo data' : ' · Private workspace'}</span><span>Made for meaningful connections.</span></footer></div>{notice && <div className="toast" role="status"><Icon icon={Check} size={17} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon icon={X} size={15} /></button></div>}{studio && data?.configuration.demoEnabled && <DemoStudio data={data} initialUsername={studio.username} initialAccountId={studio.accountId ?? accountId} onClose={() => setStudio(null)} mutate={async (path, body) => { await mutate(path, body); }} />}</div>;
}

function RelayLogo() { return <div className="relay-logo"><svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 6h13c6 0 10 3.5 10 8.5S23 23 17 23h-3l-7 5V16h10c2 0 3-1 3-2.5S19 11 17 11H4V6Z" fill="currentColor" /><path d="M4 18h5v5H4v-5Z" fill="currentColor" opacity=".45" /></svg><span>relay<span className="logo-period">.</span></span></div>; }

function Login({ onLogin, initialError }: { onLogin: () => void; initialError: string | null }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(initialError);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await request('/api/login', { method: 'POST', body: { password } }); onLogin(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-story"><RelayLogo /><div><span className="eyebrow">A MORE PERSONAL CONNECTION</span><h1>Good conversations<br />start here.</h1><p>Bring your Instagram accounts, helpful resources, and community together in one quiet workspace.</p><div className="login-illustration" aria-hidden="true"><div className="illustration-comment"><span><Icon icon={MessageCircle} size={20} /></span><div><i /><i /></div><b>↗</b></div><div className="illustration-line" /><div className="illustration-resource"><span><Icon icon={Send} size={19} /></span><div><i /><i /><em>Your resource is ready<Icon icon={ArrowRight} size={14} /></em></div><span className="illustration-check"><Icon icon={Check} size={15} /></span></div></div></div><small>YOUR ACCOUNTS. YOUR CONVERSATIONS. YOUR DATA.</small></div><div className="login-form-wrap"><div className="mobile-login-brand"><RelayLogo /></div><form className="login-form" onSubmit={event => void submit(event)}><span className="login-lock"><Icon icon={LockKeyhole} size={23} /></span><h2>Welcome to your workspace.</h2><p>Sign in with your owner password to continue.</p>{error && <div className="alert error" role="alert">{error}</div>}<label htmlFor="owner-password">Owner password</label><input id="owner-password" name="password" aria-label="Owner password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" /><button className="button primary full-width" type="submit" disabled={busy || !password}>{busy ? <Spinner /> : <>Open workspace<Icon icon={ArrowRight} size={17} /></>}</button><span className="login-private"><Icon icon={ShieldCheck} size={14} />Private access for the workspace owner.</span></form><p className="login-bottom">Relay · Instagram conversations, thoughtfully automated.</p></div></div>;
}
