import type { Command } from '../../components/Terminal/types';

type NcWhoamiContext = {
  readonly getUsername: () => string;
};

export const createNcWhoamiCommand = (context: NcWhoamiContext): Command => ({
  name: 'whoami',
  category: 'network',
  description: 'Show current user',
  fn: (): string => context.getUsername(),
});
