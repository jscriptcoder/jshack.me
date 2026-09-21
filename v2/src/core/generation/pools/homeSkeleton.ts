/**
 * The stock parts of a person's home: the skeleton dotfiles Debian copies into every
 * new account, plus the lines a person accretes on top of them over the years.
 *
 * `.profile` and `.bash_logout` are the skeleton unchanged — identical on every box,
 * as they are on a real machine, which is why the variety test exempts them. `.bashrc`
 * starts from the skeleton and gains a handful of a person's own aliases and exports.
 *
 * Rules the git data keeps, because the tests hold the output to them: no software
 * version (a decimal would read as one), and no password.
 */

/** `~/.profile`, exactly as `/etc/skel/.profile` ships it. */
export const DEBIAN_PROFILE = `# ~/.profile: executed by the command interpreter for login shells.

# if running bash
if [ -n "$BASH_VERSION" ]; then
    # include .bashrc if it exists
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi

if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi
`;

/** `~/.bash_logout`, exactly as `/etc/skel/.bash_logout` ships it. */
export const DEBIAN_BASH_LOGOUT = `# ~/.bash_logout: executed by bash(1) when login shell exits.

# when leaving the console clear the screen to increase privacy

if [ "$SHLVL" = 1 ]; then
    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q
fi
`;

/** The skeleton `~/.bashrc`, before a person adds anything of their own. */
export const DEBIAN_BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

HISTCONTROL=ignoreboth
shopt -s histappend
HISTSIZE=1000
HISTFILESIZE=2000
shopt -s checkwinsize

if [ -x /usr/bin/dircolors ]; then
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
fi

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
`;

/** Lines a person adds to the bottom of their own `.bashrc`. */
export const BASHRC_ADDITIONS: readonly string[] = [
  "alias gs='git status'",
  "alias gl='git log --oneline --graph'",
  "alias ..='cd ..'",
  "alias ...='cd ../..'",
  "alias cls='clear'",
  "alias todo='cat ~/notes/*'",
  "alias py='python3'",
  "alias serve='python3 -m http.server'",
  'export EDITOR=vim',
  'export EDITOR=nano',
  'export PAGER=less',
  "PS1='[\\u \\W]\\$ '",
  'set -o vi',
  'shopt -s autocd',
  'shopt -s cdspell',
  '# clean this file up some day',
  'umask 022',
];

/** Editors a person sets git to open. */
export const GIT_EDITORS: readonly string[] = ['vim', 'nano', 'code --wait', 'emacs', 'nvim'];

/** Default branch names a person configures. */
export const GIT_DEFAULT_BRANCHES: readonly string[] = ['main', 'master', 'trunk', 'develop'];

/** Aliases a person keeps in `.gitconfig`, as name/command pairs. */
export const GIT_ALIASES: readonly (readonly [alias: string, command: string])[] = [
  ['st', 'status -sb'],
  ['co', 'checkout'],
  ['br', 'branch'],
  ['ci', 'commit'],
  ['lg', 'log --oneline --graph --decorate'],
  ['last', 'log -1 HEAD'],
  ['unstage', 'reset HEAD --'],
  ['amend', 'commit --amend --no-edit'],
  ['df', 'diff --word-diff'],
];
