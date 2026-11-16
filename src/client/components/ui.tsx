import { useId, useRef, type ComponentProps, type ReactNode } from 'react';
import * as Modal from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { ArrowTopRightIcon, ArchiveIcon, ChatBubbleIcon, CheckIcon, Cross2Icon, ReloadIcon } from '@radix-ui/react-icons';

export type AppIcon = typeof ChatBubbleIcon;

export function Icon({ icon: IconComponent, size = 16, className = '' }: { icon: AppIcon; size?: number; className?: string }) {
  return <IconComponent width={size} height={size} aria-hidden="true" className={className} />;
}

export function Spinner() { return <Icon icon={ReloadIcon} className="spin" />; }

type ButtonProps = ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger'; size?: 'small' | 'medium' };
export function Button({ variant = 'secondary', size = 'medium', type = 'button', className = '', ...props }: ButtonProps) {
  return <button type={type} className={`button ${variant} ${size} ${className}`} {...props} />;
}

export function IconButton({ type = 'button', className = '', ...props }: ComponentProps<'button'> & { 'aria-label': string }) {
  return <button type={type} className={`icon-button ${className}`} {...props} />;
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}><i />{value === 'accepted' || value === 'succeeded' ? 'API accepted' : value.replaceAll('_', ' ')}</span>;
}

export function Empty({ title, text, action, icon = ArchiveIcon }: { title: string; text: string; action?: ReactNode; icon?: AppIcon }) {
  return <div className="empty"><span className="empty-icon"><Icon icon={icon} size={26} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return <div className={`field ${className}`}><label id={id}>{label}</label><div role="group" aria-labelledby={id}>{children}</div>{hint && <p className="field-hint">{hint}</p>}</div>;
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <label className="toggle-row" htmlFor={id}><span><strong id={`${id}-label`}>{label}</strong>{hint && <small id={`${id}-hint`}>{hint}</small>}</span><Switch.Root id={id} type="button" className="switch" checked={checked} onCheckedChange={onChange} aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}><Switch.Thumb className="switch-thumb" /></Switch.Root></label>;
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const previousFocus = useRef(document.activeElement);
  return <Modal.Root open onOpenChange={open => { if (!open) onClose(); }}><Modal.Portal><Modal.Overlay className="dialog-overlay" /><Modal.Content className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus(); }}><div className="dialog-header"><Modal.Title asChild><h2>{title}</h2></Modal.Title><Modal.Close asChild><IconButton aria-label="Close dialog"><Icon icon={Cross2Icon} /></IconButton></Modal.Close></div><div className="dialog-content">{children}</div></Modal.Content></Modal.Portal></Modal.Root>;
}

export const number = (value: number | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat().format(value);
export const date = (value: number | null) => value === null ? 'Never' : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const time = (value: number) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const rate = (numerator: number, denominator: number) => denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : '—';

export function ExternalLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={`external-link ${className}`}>{children}<Icon icon={ArrowTopRightIcon} size={14} /></a>;
}

export function DownloadButton({ filename, contents, type, children }: { filename: string; contents: string; type: string; children: ReactNode }) {
  function download() {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    URL.revokeObjectURL(url);
  }
  return <Button onClick={download}>{children}</Button>;
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      if (ref.current) { ref.current.dataset.copied = 'true'; window.setTimeout(() => { if (ref.current) delete ref.current.dataset.copied; }, 2000); }
    } catch { if (ref.current) ref.current.textContent = 'Select and copy the text'; }
  }
  return <Button ref={ref} size="small" className="copy-button" onClick={() => void copy()}><span>{label}</span><span className="copied"><Icon icon={CheckIcon} size={14} />Copied</span></Button>;
}
