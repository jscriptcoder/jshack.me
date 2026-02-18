import type { OutputLine, AuthorData } from './types';

type TerminalOutputProps = {
  readonly lines: readonly OutputLine[];
};

const AuthorCard = ({ data }: { data: AuthorData }) => (
  <div className="flex items-start gap-6 py-4 pl-4 max-w-3xl">
    <img
      src={data.avatar}
      alt={data.name}
      className="w-[152px] h-[152px] rounded-full shrink-0"
      style={{
        borderWidth: '2px',
        borderStyle: 'solid',
        borderColor: 'var(--theme-avatar-border)',
      }}
    />
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-bold" style={{ color: 'var(--theme-text-bright)' }}>
        {data.name}
      </h2>
      <div className="flex flex-col gap-3" style={{ color: 'var(--theme-text)' }}>
        {data.description.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {data.links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: 'var(--theme-link)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--theme-link-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--theme-link)';
            }}
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  </div>
);

const renderLine = (line: OutputLine) => {
  switch (line.type) {
    case 'banner':
      return (
        <div data-testid="terminal-banner" style={{ color: 'var(--theme-text-bright)' }}>
          {line.content}
        </div>
      );
    case 'command':
      return (
        <div data-testid="terminal-command" style={{ color: 'var(--theme-text-bright)' }}>
          <span style={{ color: 'var(--theme-text-dim)' }}>{line.prompt} </span>
          {line.content}
        </div>
      );
    case 'result':
      return (
        <div data-testid="terminal-result" className="pl-4" style={{ color: 'var(--theme-text)' }}>
          {line.content || '\u00A0'}
        </div>
      );
    case 'error':
      return (
        <div data-testid="terminal-error" className="pl-4" style={{ color: 'var(--theme-error)' }}>
          {line.content}
        </div>
      );
    case 'author':
      return <AuthorCard data={line.content} />;
  }
};

export const TerminalOutput = ({ lines }: TerminalOutputProps) => {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      {lines.map((line) => (
        <div
          key={line.id}
          className={
            line.type === 'banner'
              ? 'whitespace-pre'
              : line.type === 'author'
                ? 'break-words'
                : 'whitespace-pre-wrap break-all'
          }
        >
          {renderLine(line)}
        </div>
      ))}
    </div>
  );
};
