import * as Picker from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon } from '@radix-ui/react-icons';
import { Icon } from './ui';
import './select.css';

type Option<Value extends string> = { value: Value; label: string };
type SelectProps<Value extends string> = {
  label: string;
  value: Value;
  options: readonly Option<Value>[];
  onValueChange: (value: Value) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function Select<Value extends string>({ label, value, options, onValueChange, placeholder, disabled, className = '' }: SelectProps<Value>) {
  // Radix reserves the empty string for a placeholder. The account filter uses it as a selectable value.
  const selected = options.find(option => option.value === value);
  return <Picker.Root value={selected ? `option:${selected.value}` : ''} disabled={disabled || options.length === 0}
    onValueChange={key => {
      const option = options.find(item => `option:${item.value}` === key);
      if (option) onValueChange(option.value);
    }}>
    <Picker.Trigger className={`select-control ${className}`} aria-label={label}>
      <Picker.Value placeholder={placeholder || 'No options available'} />
      <Picker.Icon asChild><ChevronDownIcon /></Picker.Icon>
    </Picker.Trigger>
    <Picker.Portal>
      <Picker.Content className="select-menu" position="popper" align="start" sideOffset={4} collisionPadding={8} aria-label={label}>
        <Picker.Viewport>
          {options.map(option => <Picker.Item key={option.value} value={`option:${option.value}`} className="select-option">
            <Picker.ItemText>{option.label}</Picker.ItemText>
            <Picker.ItemIndicator><Icon icon={CheckIcon} /></Picker.ItemIndicator>
          </Picker.Item>)}
        </Picker.Viewport>
      </Picker.Content>
    </Picker.Portal>
  </Picker.Root>;
}
