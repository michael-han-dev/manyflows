import type { Bootstrap } from '../../shared/domain';

export const username = (data: Bootstrap, id: string) => data.accounts.find(account => account.id === id)?.username ?? 'Unknown account';
