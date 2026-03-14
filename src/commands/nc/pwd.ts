import type { Command } from '../../components/Terminal/types';

type NcPwdContext = {
  readonly getCwd: () => string;
};

export const createNcPwdCommand = (context: NcPwdContext): Command => ({
  name: 'pwd',
  category: 'network',
  description: 'Print working directory',
  fn: (): string => context.getCwd(),
});
