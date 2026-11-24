import { ArrowRightIcon as ArrowRight, ExclamationTriangleIcon as CircleAlert, ChatBubbleIcon as MessageCircle, PlusIcon as Plus, RocketIcon as FlaskConical } from '@radix-ui/react-icons';
import type { Bootstrap } from '../../shared/domain';
import { Button, Empty, Icon, Status, number, rate } from './ui';
import { username } from './account-name';
import { PageHeading } from './PageHeading';
import './overview.css';

const campaignMetrics = ['Started', 'Completed', 'Waiting', 'Completion'] as const;
const featuredCampaignLimit = 5;

export function Overview({ data, accountId, onCreate, onCampaigns, onActivity, onDemo }: { data: Bootstrap; accountId: string; onCreate: () => void; onCampaigns: () => void; onActivity: () => void; onDemo: () => void }) {
  const { metrics, accounts, campaigns, media, runs } = data;
  const liveCampaigns = campaigns.filter(campaign => campaign.status === 'live');
  const featuredCampaigns = [...liveCampaigns, ...campaigns.filter(campaign => campaign.status !== 'live')].slice(0, featuredCampaignLimit);
  const funnel = [
    { label: 'Matched comments', count: metrics.matchedComments, note: 'Campaign entries' },
    { label: 'Opening messages', count: metrics.openingAccepted, note: 'API accepted' },
    { label: 'Button responses', count: metrics.buttonResponders, note: 'Unique responding contacts' },
    { label: 'Resource messages', count: metrics.linkMessagesAccepted, note: 'API accepted' },
    { label: 'Link visits', count: metrics.uniqueClickers, note: 'Unique attributed contacts' },
  ];
  const largestStage = Math.max(1, ...funnel.map(stage => stage.count));
  const reportableReach = media.flatMap(item => item.reach === null ? [] : [item.reach]);
  const totalReach = reportableReach.length ? reportableReach.reduce((sum, reach) => sum + reach, 0) : null;
  const highlights = [
    { label: 'Matched comments', value: number(metrics.matchedComments), note: 'Comments entering a flow' },
    { label: 'Opening messages', value: number(metrics.openingAccepted), note: 'API accepted · delivery unavailable' },
    { label: 'Emails collected', value: number(metrics.emailsCollected), note: 'Valid email addresses captured' },
    { label: 'Link click-through', value: rate(metrics.uniqueClickers, metrics.linkMessagesAccepted), note: `${number(metrics.uniqueClickers)} attributed clickers / ${number(metrics.linkMessagesAccepted)} link messages` },
  ];

  return <div className="workspace-overview">
    <PageHeading title="Overview" action={<Button variant="primary" onClick={onCreate}><Icon icon={Plus} size={17} />Create campaign</Button>} />

    {!accounts.length && <section className="overview-setup">
      <h2>Connect your first account</h2>
      <p>Add an Instagram account in Settings{data.configuration.demoEnabled ? ', or explore a demo with sample content and saved campaigns.' : ' to start building campaigns.'}</p>
      {data.configuration.demoEnabled && <Button onClick={onDemo}><Icon icon={FlaskConical} size={16} />Set up demo workspace</Button>}
    </section>}

    <section className="overview-performance" aria-labelledby="campaign-performance">
      <header className="overview-section-heading">
        <div><h2 id="campaign-performance">Campaign performance</h2><p>{number(liveCampaigns.length)} live · {number(campaigns.length)} total</p></div>
        <button className="text-button" onClick={onCampaigns}>All campaigns<Icon icon={ArrowRight} size={15} /></button>
      </header>
      {featuredCampaigns.length ? <div className="overview-campaign-list">
        <div className="overview-column-labels" aria-hidden="true">
          <span>Campaign</span><span>Status</span>
          <div>{campaignMetrics.map(label => <span key={label}>{label}</span>)}</div>
        </div>
        {featuredCampaigns.map(campaign => {
          const campaignRuns = runs.filter(run => run.campaignId === campaign.id);
          const completed = campaignRuns.filter(run => run.state === 'complete').length;
          const waiting = campaignRuns.filter(run => run.state === 'waiting' || run.state === 'delayed').length;
          const results = {
            Started: number(campaignRuns.length),
            Completed: number(completed),
            Waiting: number(waiting),
            Completion: rate(completed, campaignRuns.length),
          };
          return <article className="overview-campaign" key={campaign.id}>
            <div className="overview-campaign-name"><h3>{campaign.name}</h3><small>@{username(data, campaign.accountId)}</small></div>
            <Status value={campaign.status} />
            <dl>{campaignMetrics.map(label => <div key={label}><dt>{label}</dt><dd>{results[label]}</dd></div>)}</dl>
          </article>;
        })}
      </div> : <Empty title="No campaigns yet" text="Choose a post and write the reply people will receive when they comment." action={<Button onClick={onCreate}>Create your first campaign<Icon icon={ArrowRight} size={15} /></Button>} icon={MessageCircle} />}
    </section>

    {metrics.failedActions > 0 && <button className="attention-banner" onClick={onActivity}><Icon icon={CircleAlert} /><span><strong>{number(metrics.failedActions)} actions need attention</strong>Review failed or uncertain sends in Activity.</span><Icon icon={ArrowRight} /></button>}

    <section className="overview-results" aria-label="Workspace results">
      <dl>{highlights.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd><dd className="overview-note">{item.note}</dd></div>)}</dl>
    </section>

    <div className="overview-reports">
      <section aria-labelledby="conversation-funnel">
        <h2 id="conversation-funnel">Conversation funnel</h2>
        <ol className="overview-stages">{funnel.map(step => <li key={step.label}>
          <div><strong>{step.label}</strong><small>{step.note}</small></div>
          <span className="overview-track" aria-hidden="true"><i style={{ width: `${step.count / largestStage * 100}%` }} /></span>
          <span className="overview-count">{number(step.count)}</span>
        </li>)}</ol>
        <dl className="overview-ratios">
          <div><dt>Button response rate</dt><dd>{rate(metrics.buttonResponders, metrics.openingAccepted)}</dd></div>
          <div><dt>Flow completion</dt><dd>{rate(metrics.completedRuns, runs.length)}</dd></div>
        </dl>
        <details className="overview-definitions"><summary>How these numbers are calculated</summary>
          <p>Button response rate is unique responding contacts divided by API-accepted opening messages. Link click-through is unique attributed clicking contacts divided by API-accepted link messages. Completion is completed runs divided by started runs. A dash means the denominator is zero.</p>
          <p>Counts reflect the selected account and dates. Link previews and forwarded links can record visits without the original recipient opening the link.</p>
        </details>
      </section>

      <section aria-labelledby="overview-accounts">
        <h2 id="overview-accounts">Your accounts</h2>
        <ul className="overview-accounts">{accounts.filter(account => !accountId || account.id === accountId).map(account => <li key={account.id}>
          <span className="avatar">{account.name.slice(0, 1)}</span>
          <div><strong>@{account.username}</strong><small>{account.mode === 'demo' ? 'Demo workspace' : account.name}</small></div>
          <Status value={account.status} />
        </li>)}</ul>
        {!accounts.length && <p className="overview-note">Connected accounts will appear here.</p>}
        <dl className="overview-reach"><dt>{accountId ? 'Reported content reach' : 'Combined content reach'}</dt><dd>{number(totalReach)}</dd></dl>
        <p className="overview-note">{accountId ? 'Sum of available content reach.' : 'Sum across accounts and posts. People are not deduplicated.'}{reportableReach.length < media.length && ' Some content has no available insights.'}</p>
      </section>
    </div>
  </div>;
}
