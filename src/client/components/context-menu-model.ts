export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  caption?: string;
  disabled?: boolean;
  checked?: boolean;
  keepOpen?: boolean;
  separatorBefore?: boolean;
  danger?: boolean;
  children?: ContextMenuAction[];
}

export type ContextMenuTrigger = 'pointer' | 'touch' | 'keyboard';
