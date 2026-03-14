import type { Command, AuthorData } from '../components/Terminal/types';

export const authorCommand: Command = {
  name: 'author',
  category: 'general',
  description: 'Display information about the author',
  manual: {
    synopsis: 'author()',
    description:
      'Display a profile card with information about the author of this terminal, including avatar, description, and social links.',
    examples: [{ command: 'author()', description: 'Show author profile card' }],
  },
  fn: (): AuthorData => ({
    __type: 'author',
    name: 'Francisco Ramos (jscriptcoder)',
    description: [
      'Hey there! 👋',
      "I'm Francisco Ramos, a fullstack engineer with 20+ years in the game. " +
        "Started out building websites back in the early 2000s and never really stopped. I've worked across the entire stack, " +
        'from frontend and backend to DevOps, picking up whatever tools got the job done.',
      'Along the way I got really into Machine Learning and Deep Reinforcement Learning, ' +
        'teaching machines to teach themselves, basically. Built some fun stuff there, from AI training environments to ' +
        'neural network experiments. My Github is full of ML projects if you want to check them out.',
      'Then I went down the Web3 rabbit hole, building DEX aggregators, smart contract tools, ' +
        'and dApps with Solidity. Blockchain was a wild ride.',
      'These days my biggest passion is cybersecurity, especially web security. At my current job I helped uncover ' +
        'several security vulnerabilities, which really got me hooked. I earned a Nanodegree as Security Engineer from Udacity, ' +
        "I'm grinding through TryHackMe rooms and Portswigger labs whenever I get the chance, and currently working towards my Burp Suite certification.",
      'This little hacking terminal is where all those worlds collide, code, hacking, and the love of breaking things, ' +
        'responsibly of course. Hack away! 😉',
    ],
    avatar: 'https://avatars.githubusercontent.com/u/613724',
    links: [
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/jscriptcoder' },
      { label: 'GitHub', url: 'https://github.com/jscriptcoder' },
    ],
  }),
};
