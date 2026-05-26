import { createSignal } from 'solid-js';

export const Hello = () => {
  const [count, setCount] = createSignal(0);

  return (
    <main style={{ padding: '2rem', 'font-family': 'inherit' }}>
      <h1 style={{ 'letter-spacing': '0.2em' }}>JSHACK.ME — v2</h1>
      <p>Solid skeleton. Click the button to prove signals are wired.</p>
      <button
        type="button"
        onClick={() => setCount((value) => value + 1)}
        style={{
          padding: '0.5rem 1rem',
          background: 'transparent',
          color: 'inherit',
          border: '1px solid currentColor',
          'font-family': 'inherit',
          cursor: 'pointer',
        }}
      >
        clicks: {count()}
      </button>
    </main>
  );
};
