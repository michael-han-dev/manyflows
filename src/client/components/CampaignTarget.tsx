import type { CampaignInput } from '../../shared/domain';

type Target = CampaignInput['target'];

export function targetLabel(target: Target, boundMediaId: string | null = null) {
  switch (target.kind) {
    case 'all': return 'All posts and reels';
    case 'specific': return 'Specific post or reel';
    case 'next': return boundMediaId ? 'Next publication · bound' : 'Next publication · waiting';
  }
}

export function targetIncludesMedia(target: Target | null, mediaId: string, boundMediaId: string | null = null) {
  switch (target?.kind) {
    case 'all': return true;
    case 'specific': return target.mediaId === mediaId;
    case 'next': return boundMediaId === mediaId;
    case undefined: return false;
  }
}

export function CampaignTarget({ publishedTarget, draftTarget, boundMediaId }: { publishedTarget: Target | null; draftTarget: Target; boundMediaId: string | null }) {
  const changed = publishedTarget && (publishedTarget.kind !== draftTarget.kind || publishedTarget.kind === 'specific' && draftTarget.kind === 'specific' && publishedTarget.mediaId !== draftTarget.mediaId);
  return <div className="campaign-target">{publishedTarget ? <><span className="trigger-label">Published target: {targetLabel(publishedTarget, boundMediaId)}</span>{changed && <small>Draft target: {targetLabel(draftTarget)} · Unpublished changes</small>}</> : <span className="trigger-label">Draft target: {targetLabel(draftTarget)}</span>}</div>;
}
