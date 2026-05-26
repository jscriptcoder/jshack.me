export const ReworkNoticeScreen = () => (
  <div className="flex h-full flex-col items-center justify-center p-4 font-mono">
    {/* Logo — mirrors IntroScreen */}
    <div className="mb-3 text-center">
      <h1
        className="text-5xl font-bold tracking-widest sm:text-6xl"
        style={{ color: 'var(--theme-text-bright)' }}
      >
        JSHACK.ME
      </h1>
      <div className="mt-2 h-px w-full" style={{ backgroundColor: 'var(--theme-text-dim)' }} />
    </div>

    {/* Tagline */}
    <p className="mb-8 text-base tracking-wide" style={{ color: 'var(--theme-text-dim)' }}>
      Down for rework.
    </p>

    {/* Body */}
    <div className="flex max-w-lg flex-col items-center">
      <div
        className="text-center text-base leading-relaxed"
        style={{ color: 'var(--theme-text-dim)' }}
      >
        <p className="mb-4">
          JSHACK.ME is being rewritten from scratch. The current build has been retired while the
          new engine comes together.
        </p>
        <p className="mb-4">Same world, same shell, sharper internals.</p>
        <p>Back soon.</p>
      </div>
    </div>
  </div>
);
