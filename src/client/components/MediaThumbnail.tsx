import { ImageIcon as Image, PlayIcon as Play } from '@radix-ui/react-icons';
import type { Media } from '../../shared/domain';
import { Icon } from './ui';

export function MediaThumbnail({ media, large = false }: { media: Media; large?: boolean }) {
  return <span className={`media-thumbnail ${large ? 'large' : ''}`}>{media.thumbnailUrl ? <img src={media.thumbnailUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /> : null}<Icon icon={media.type === 'REELS' || media.type === 'VIDEO' ? Play : Image} size={large ? 26 : 19} /></span>;
}
