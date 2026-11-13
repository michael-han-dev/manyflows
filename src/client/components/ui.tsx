import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowUpRight, Check, Inbox, LoaderCircle, X, type LucideIcon } from 'lucide-react';

export function Icon({ icon: IconComponent, size = 18, className = '' }: { icon: LucideIcon; size?: number; className?: string }) {
  return <IconComponent size={size} strokeWidth={1.7} aria-hidden="true" className={className} />;
}

export function Spinner() { return <LoaderCircle size={17} aria-hidden="true" className="spin" />; }

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}><i />{value === 'accepted' || value === 'succeeded' ? 'API accepted' : value.replaceAll('_', ' ')}</span>;
}

export function Empty({ title, text, action, icon = Inbox }: { title: string; text: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="empty"><span className="empty-icon"><Icon icon={icon} size={26} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return <div className={`field ${className}`}><label id={id}>{label}</label><div role="group" aria-labelledby={id}>{children}</div>{hint && <p className="field-hint">{hint}</p>}</div>;
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="switch" aria-hidden="true"><span /></span></label>;
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    const element = dialog.current;
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={`dialog ${wide ? 'dialog-wide' : ''}`} onCancel={onClose} aria-labelledby={titleId} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon icon={X} /></button></div><div className="dialog-content">{children}</div></dialog>;
}

export const number = (value: number | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat().format(value);
export const date = (value: number | null) => value === null ? 'Never' : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const time = (value: number) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const rate = (numerator: number, denominator: number) => denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : '—';

export function ExternalLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={`external-link ${className}`}>{children}<Icon icon={ArrowUpRight} size={14} /></a>;
}

export function DownloadButton({ filename, contents, type, children }: { filename: string; contents: string; type: string; children: ReactNode }) {
  function download() {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    URL.revokeObjectURL(url);
  }
  return <button className="button secondary" onClick={download}>{children}</button>;
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      if (ref.current) { ref.current.dataset.copied = 'true'; window.setTimeout(() => { if (ref.current) delete ref.current.dataset.copied; }, 2000); }
    } catch { if (ref.current) ref.current.textContent = 'Select and copy the text'; }
  }
  return <button ref={ref} className="button small secondary copy-button" onClick={() => void copy()}><span>{label}</span><span className="copied"><Icon icon={Check} size={14} />Copied</span></button>;
}
