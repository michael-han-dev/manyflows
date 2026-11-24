import type { Account, Bootstrap } from '../../shared/domain';

export const username = (data: Bootstrap, id: string) => data.accounts.find(account => account.id === id)?.username ?? 'Unknown account';

export function accountOptions(accounts: Account[], showMode = false) {
  return accounts.map(account => ({
    value: account.id,
    label: `@${account.username}${showMode && account.mode === 'demo' ? ' · Demo' : ''}`,
  }));
}
