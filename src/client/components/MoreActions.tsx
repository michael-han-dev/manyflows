import { useRef } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import { Icon, IconButton, type AppIcon } from './ui';
import './more-actions.css';

type MenuAction = {
  label: string;
  icon: AppIcon;
  run: () => void;
  destructive?: boolean;
};

export function MoreActions({ label, actions, disabled }: {
  label: string;
  actions: MenuAction[];
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef<MenuAction | null>(null);

  return <Menu.Root>
    <Menu.Trigger asChild>
      <IconButton ref={trigger} aria-label={label} title={label} disabled={disabled}>
        <Icon icon={DotsHorizontalIcon} size={18} />
      </IconButton>
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Content className="more-actions" align="end" sideOffset={4} collisionPadding={8}
        onCloseAutoFocus={event => {
          const action = selected.current;
          if (!action) return;
          selected.current = null;
          event.preventDefault();
          // A dialog opened by this action restores focus to the persistent trigger.
          trigger.current?.focus({ preventScroll: true });
          action.run();
        }}>
        {actions.map(action => <Menu.Item key={action.label}
          className={action.destructive ? 'destructive' : undefined}
          onSelect={() => { selected.current = action; }}>
          <Icon icon={action.icon} />{action.label}
        </Menu.Item>)}
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
