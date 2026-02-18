import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalOutput } from './TerminalOutput';
import type { OutputLine, AuthorData } from './types';

// --- Factory Functions ---

const createTextLine = (
  overrides?: Partial<{
    id: number;
    type: 'command' | 'result' | 'error' | 'banner';
    content: string;
    prompt: string;
  }>,
): OutputLine => ({
  id: 1,
  type: 'result',
  content: 'test content',
  ...overrides,
});

const createAuthorLine = (content: AuthorData, id = 1): OutputLine => ({
  id,
  type: 'author',
  content,
});

const createAuthorData = (overrides?: Partial<AuthorData>): AuthorData => ({
  __type: 'author',
  name: 'Test Author',
  description: ['A test description'],
  avatar: 'https://example.com/avatar.jpg',
  links: [
    { label: 'GitHub', url: 'https://github.com/test' },
    { label: 'Twitter', url: 'https://twitter.com/test' },
  ],
  ...overrides,
});

// --- Tests ---

describe('TerminalOutput', () => {
  describe('banner lines', () => {
    it('should render banner content', () => {
      const lines = [createTextLine({ type: 'banner', content: 'Welcome to JSHACK.ME' })];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('Welcome to JSHACK.ME')).toBeInTheDocument();
    });

    it('should preserve whitespace in banner', () => {
      const lines = [createTextLine({ type: 'banner', content: 'ASCII ART' })];

      const { container } = render(<TerminalOutput lines={lines} />);

      // The whitespace-pre class is on the wrapper div
      const wrapperDiv = container.querySelector('.whitespace-pre');
      expect(wrapperDiv).toBeInTheDocument();
    });
  });

  describe('command lines', () => {
    it('should render command with prompt', () => {
      const lines = [
        createTextLine({
          type: 'command',
          content: 'ls()',
          prompt: 'jshacker@localhost>',
        }),
      ];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('jshacker@localhost>')).toBeInTheDocument();
      expect(screen.getByText('ls()')).toBeInTheDocument();
    });

    it('should render prompt in different color than command', () => {
      const lines = [
        createTextLine({
          type: 'command',
          content: 'pwd()',
          prompt: 'root@localhost>',
        }),
      ];

      render(<TerminalOutput lines={lines} />);

      const promptElement = screen.getByText('root@localhost>');
      expect(promptElement).toHaveStyle({ color: 'var(--theme-text-dim)' });
    });
  });

  describe('result lines', () => {
    it('should render result content', () => {
      const lines = [createTextLine({ type: 'result', content: '/home/jshacker' })];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('/home/jshacker')).toBeInTheDocument();
    });

    it('should render result with indentation', () => {
      const lines = [createTextLine({ type: 'result', content: 'output text' })];

      render(<TerminalOutput lines={lines} />);

      const element = screen.getByText('output text');
      expect(element).toHaveClass('pl-4');
    });

    it('should render empty result as non-breaking space', () => {
      const lines = [createTextLine({ type: 'result', content: '' })];

      const { container } = render(<TerminalOutput lines={lines} />);

      const resultDiv = container.querySelector('.pl-4');
      expect(resultDiv).toBeInTheDocument();
      expect(resultDiv?.textContent).toBe('\u00A0');
    });

    it('should apply theme text color to results', () => {
      const lines = [createTextLine({ type: 'result', content: 'some output' })];

      render(<TerminalOutput lines={lines} />);

      const element = screen.getByText('some output');
      expect(element).toHaveStyle({ color: 'var(--theme-text)' });
    });
  });

  describe('error lines', () => {
    it('should render error content', () => {
      const lines = [createTextLine({ type: 'error', content: 'Permission denied' })];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });

    it('should render error in error color', () => {
      const lines = [createTextLine({ type: 'error', content: 'File not found' })];

      render(<TerminalOutput lines={lines} />);

      const element = screen.getByText('File not found');
      expect(element).toHaveStyle({ color: 'var(--theme-error)' });
    });

    it('should render error with indentation', () => {
      const lines = [createTextLine({ type: 'error', content: 'Error message' })];

      render(<TerminalOutput lines={lines} />);

      const element = screen.getByText('Error message');
      expect(element).toHaveClass('pl-4');
    });
  });

  describe('author card', () => {
    it('should render author name', () => {
      const authorData = createAuthorData({ name: 'Francisco Ramos' });
      const lines = [createAuthorLine(authorData)];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('Francisco Ramos')).toBeInTheDocument();
    });

    it('should render author description', () => {
      const authorData = createAuthorData({ description: ['Software Engineer'] });
      const lines = [createAuthorLine(authorData)];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    });

    it('should render author avatar', () => {
      const authorData = createAuthorData({
        name: 'Test User',
        avatar: 'https://example.com/photo.jpg',
      });
      const lines = [createAuthorLine(authorData)];

      render(<TerminalOutput lines={lines} />);

      const img = screen.getByAltText('Test User');
      expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg');
    });

    it('should render author links', () => {
      const authorData = createAuthorData({
        links: [
          { label: 'GitHub', url: 'https://github.com/testuser' },
          { label: 'LinkedIn', url: 'https://linkedin.com/in/testuser' },
        ],
      });
      const lines = [createAuthorLine(authorData)];

      render(<TerminalOutput lines={lines} />);

      const githubLink = screen.getByRole('link', { name: 'GitHub' });
      const linkedinLink = screen.getByRole('link', { name: 'LinkedIn' });

      expect(githubLink).toHaveAttribute('href', 'https://github.com/testuser');
      expect(linkedinLink).toHaveAttribute('href', 'https://linkedin.com/in/testuser');
    });

    it('should open links in new tab', () => {
      const authorData = createAuthorData();
      const lines = [createAuthorLine(authorData)];

      render(<TerminalOutput lines={lines} />);

      const link = screen.getByRole('link', { name: 'GitHub' });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('multiple lines', () => {
    it('should render all lines in order', () => {
      const lines: OutputLine[] = [
        { id: 1, type: 'command', content: 'ls()', prompt: 'user@host>' },
        { id: 2, type: 'result', content: 'file1.txt file2.txt' },
        { id: 3, type: 'command', content: 'cat("secret")', prompt: 'user@host>' },
        { id: 4, type: 'error', content: 'Permission denied' },
      ];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('ls()')).toBeInTheDocument();
      expect(screen.getByText('file1.txt file2.txt')).toBeInTheDocument();
      expect(screen.getByText('cat("secret")')).toBeInTheDocument();
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });

    it('should render mixed content types', () => {
      const authorData = createAuthorData({ name: 'Dev' });
      const lines: OutputLine[] = [
        { id: 1, type: 'banner', content: '=== Welcome ===' },
        { id: 2, type: 'author', content: authorData },
        { id: 3, type: 'result', content: 'Done!' },
      ];

      render(<TerminalOutput lines={lines} />);

      expect(screen.getByText('=== Welcome ===')).toBeInTheDocument();
      expect(screen.getByText('Dev')).toBeInTheDocument();
      expect(screen.getByText('Done!')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should render empty container when no lines', () => {
      const { container } = render(<TerminalOutput lines={[]} />);

      const outputDiv = container.querySelector('.flex-1.overflow-y-auto');
      expect(outputDiv).toBeInTheDocument();
      expect(outputDiv?.children).toHaveLength(0);
    });
  });
});
