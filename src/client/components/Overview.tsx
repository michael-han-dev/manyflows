import { ArrowRightIcon as ArrowRight, ExclamationTriangleIcon as CircleAlert, ChatBubbleIcon as MessageCircle, PlusIcon as Plus, RocketIcon as FlaskConical } from '@radix-ui/react-icons';
import type { Bootstrap } from '../../shared/domain';
import { Button, Empty, Icon, Status, number, rate } from './ui';
import { username } from './account-name';
import { PageHeading } from './PageHeading';
import './overview.css';

const campaignMetrics = ['Started', 'Finished', 'Waiting', 'Finish rate'] as const;
const featuredCampaignLimit = 5;

function countWithUnit(value: number, unit: string) {
  return `${number(value)} ${unit}${value === 1 ? '' : 's'}`;
}

export function Overview({ data, accountId, onCreate, onCampaigns, onActivity, onDemo }: { data: Bootstrap; accountId: string; onCreate: () => void; onCampaigns: () => void; onActivity: () => void; onDemo: () => void }) {
  const { metrics, accounts, campaigns, media, runs } = data;
  const liveCampaigns = campaigns.filter(campaign => campaign.status === 'live');
  const featuredCampaigns = [...liveCampaigns, ...campaigns.filter(campaign => campaign.status !== 'live')].slice(0, featuredCampaignLimit);
  const funnel = [
    { label: 'Comments matched', count: metrics.matchedComments, note: 'Campaigns triggered by a comment' },
    { label: 'Opening DMs', count: metrics.openingAccepted, note: 'Opening private replies accepted for sending' },
    { label: 'Button responders', count: metrics.buttonResponders, note: 'Contacts who tapped a reply button' },
    { label: 'Messages with links', count: metrics.linkMessagesAccepted, note: 'Accepted messages with a link button' },
    { label: 'Link visitors', count: metrics.uniqueClickers, note: 'Contacts credited with a link visit' },
  ];
  const largestStage = Math.max(1, ...funnel.map(stage => stage.count));
  const reportableReach = media.flatMap(item => item.reach === null ? [] : [item.reach]);
  const totalReach = reportableReach.length ? reportableReach.reduce((sum, reach) => sum + reach, 0) : null;
  const highlights = [
    { label: 'Conversations started', value: metrics.matchedComments, note: 'A comment triggered a campaign.' },
    { label: 'Opening DMs', value: metrics.openingAccepted, note: 'Opening private replies accepted for sending.' },
    { label: 'Email contacts', value: metrics.emailsCollected, note: 'Each contact who shared an email counts once.' },
    { label: 'Link visitors', value: metrics.uniqueClickers, note: 'Each contact credited with a link visit counts once.' },
  ];
  const rates = [
    { label: 'Button response rate', numerator: metrics.buttonResponders, numeratorLabel: 'responding contact', denominator: metrics.openingAccepted, denominatorLabel: 'accepted opening DM' },
    { label: 'Link click-through', numerator: metrics.uniqueClickers, numeratorLabel: 'attributed visitor', denominator: metrics.linkMessagesAccepted, denominatorLabel: 'accepted link message' },
    { label: 'Conversation completion', numerator: metrics.completedRuns, numeratorLabel: 'finished conversation', denominator: runs.length, denominatorLabel: 'started conversation' },
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
            Finished: number(completed),
            Waiting: number(waiting),
            'Finish rate': rate(completed, campaignRuns.length),
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
      <h2>Conversation totals</h2>
      <dl>{highlights.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{number(item.value)}</dd><dd className="overview-note">{item.note}</dd></div>)}</dl>
    </section>

    <div className="overview-reports">
      <section aria-labelledby="conversation-funnel">
        <h2 id="conversation-funnel">Conversation funnel</h2>
        <ol className="overview-stages">{funnel.map(step => <li key={step.label}>
          <div><strong>{step.label}</strong><small>{step.note}</small></div>
          <span className="overview-track" aria-hidden="true"><i style={{ width: `${step.count / largestStage * 100}%` }} /></span>
          <span className="overview-count">{number(step.count)}</span>
        </li>)}</ol>
        <h3 className="overview-rate-heading">Conversion rates</h3>
        <dl className="overview-ratios">
          {rates.map(metric => <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd className="overview-rate">{rate(metric.numerator, metric.denominator)}</dd>
            <dd className="overview-basis">{countWithUnit(metric.numerator, metric.numeratorLabel)} ÷ {countWithUnit(metric.denominator, metric.denominatorLabel)}</dd>
          </div>)}
        </dl>
        <details className="overview-definitions"><summary>How to read these numbers</summary>
          <ul>
            <li><strong>Time period.</strong> Counts follow the selected accounts and dates. A response or visit can come from a message sent earlier.</li>
            <li><strong>Message status.</strong> For live accounts, Instagram accepted the request to send. Demo sends are simulated. Delivery and read status are unavailable.</li>
            <li><strong>Link attribution.</strong> Forwarded links and link previews can register a visit under the original contact. Known automated visits are excluded.</li>
            <li><strong>Missing rates.</strong> A dash means there were no messages or conversations to divide by.</li>
          </ul>
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
