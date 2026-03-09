---
name: react-testing
description: React component testing patterns including components, hooks, context, and forms. Covers Vitest Browser Mode with vitest-browser-react (preferred) and @testing-library/react. Use when testing React applications. For general UI testing patterns, see the front-end-testing skill.
---

# React Testing

For general UI testing patterns (queries, events, async, accessibility), load the `front-end-testing` skill. For TDD workflow, load the `tdd` skill.

## Vitest Browser Mode with React (Preferred)

**Always prefer `vitest-browser-react` over `@testing-library/react`.** Tests run in a real browser, giving production-accurate rendering, events, and CSS.

### Setup

```bash
npm install -D vitest @vitest/browser-playwright vitest-browser-react @vitejs/plugin-react
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

### Component Testing

```tsx
import { render } from 'vitest-browser-react'
import { expect, test } from 'vitest'

test('should display command output lines', async () => {
  const screen = await render(
    <TerminalOutput lines={['total 3', 'notes.txt', 'downloads/']} />
  )

  await expect.element(screen.getByText(/notes\.txt/)).toBeVisible()
  await expect.element(screen.getByText(/downloads/)).toBeVisible()
})
```

**Key differences from `@testing-library/react`:**
- `render()` is async — use `await`
- Returns a `screen` scoped to the rendered component
- Use `expect.element()` for auto-retrying assertions
- No `act()` wrapper needed — CDP events + retry handle timing
- Auto-cleanup happens before each test (not after), so components stay visible for debugging

### Testing Props and Callbacks

```tsx
test('should call onSubmit when command entered', async () => {
  const handleSubmit = vi.fn()
  const screen = await render(<TerminalInput onSubmit={handleSubmit} prompt="jshacker@localhost>" />)

  await screen.getByRole('textbox').fill('ls()')
  await screen.getByRole('textbox').press('Enter')

  expect(handleSubmit).toHaveBeenCalledWith('ls()')
})
```

### Testing Conditional Rendering

```tsx
test('should show kernel panic when machine is bricked', async () => {
  const screen = await render(
    <SessionProvider initialBrickedMachines={new Set(['localhost'])}>
      <Terminal />
    </SessionProvider>
  )

  await expect.element(screen.getByText(/Kernel panic/i)).toBeVisible()
})
```

### Testing Hooks with renderHook

```tsx
import { renderHook } from 'vitest-browser-react'

test('should toggle WiFi connection state', async () => {
  const { result } = await renderHook(() => useWifiState(false))

  expect(result.current.wifiConnected).toBe(false)

  await act(() => {
    result.current.connect()
  })

  expect(result.current.wifiConnected).toBe(true)
})
```

### Testing Context Providers

```tsx
test('should show mission briefing when mission is active', async () => {
  const screen = await render(
    <MissionProvider activeMission={getMockMissionNetwork()}>
      <MissionStatus />
    </MissionProvider>
  )

  await expect.element(screen.getByText(/ACTIVE MISSION/i)).toBeVisible()
})
```

For hooks that need context:
```tsx
const { result } = await renderHook(() => useSession(), {
  wrapper: ({ children }) => (
    <SessionProvider>{children}</SessionProvider>
  ),
})
```

---

## Legacy: @testing-library/react Patterns

The patterns below apply when using `@testing-library/react` with jsdom. **Prefer `vitest-browser-react`** for new projects.

---

## Testing React Components

**React components are just functions that return JSX.** Test them like functions: inputs (props) → output (rendered DOM).

### Basic Component Testing

```tsx
// ✅ CORRECT - Test component behavior
it('should display async output lines with delay', () => {
  render(<AsyncOutput lines={['Scanning ports...', 'Port 22/tcp open ssh']} />);

  expect(screen.getByText(/Scanning ports/i)).toBeInTheDocument();
  expect(screen.getByText(/Port 22\/tcp open ssh/i)).toBeInTheDocument();
});
```

```tsx
// ❌ WRONG - Testing implementation
it('should set lineIndex state', () => {
  const wrapper = mount(<AsyncOutput lines={['line1']} />);
  expect(wrapper.state('lineIndex')).toBe(0); // Internal state!
});
```

### Testing Props

```tsx
// ✅ CORRECT - Test how props affect rendered output
it('should call onComplete when password submitted', async () => {
  const handleComplete = vi.fn();
  const user = userEvent.setup();

  render(<PasswordPrompt prompt="Password:" onComplete={handleComplete} />);

  await user.type(screen.getByLabelText(/password/i), 'cr4ck3d_w1f1');
  await user.keyboard('{Enter}');

  expect(handleComplete).toHaveBeenCalledWith('cr4ck3d_w1f1');
});
```

### Testing Conditional Rendering

```tsx
// ✅ CORRECT - Test what user sees in different states
it('should show network unreachable when WiFi disconnected', async () => {
  render(
    <SessionProvider initialWifiConnected={false}>
      <Terminal />
    </SessionProvider>
  );

  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), 'ping("192.168.1.50")');
  await user.keyboard('{Enter}');

  await screen.findByText(/Network is unreachable/i);
});
```

---

## Testing React Hooks

### Custom Hooks with renderHook

**Built into `@testing-library/react`** (import directly, no separate package needed):

```tsx
import { renderHook } from '@testing-library/react';

it('should push and pop session stack for SSH', () => {
  const { result } = renderHook(() => useSessionStack());

  expect(result.current.canReturn()).toBe(false);

  act(() => {
    result.current.pushSession({ machine: 'fileserver', username: 'ftpuser' });
  });

  expect(result.current.canReturn()).toBe(true);

  act(() => {
    result.current.popSession();
  });

  expect(result.current.canReturn()).toBe(false);
});
```

**Pattern:**
- `result.current` - Current return value of hook
- `act()` - Wrap state updates
- `rerender()` - Re-run hook with new props

### Hooks with Props

```tsx
it('should accept initial path', () => {
  const { result, rerender } = renderHook(
    ({ initialPath }) => useCurrentPath(initialPath),
    { initialProps: { initialPath: '/home/jshacker' } }
  );

  expect(result.current.path).toBe('/home/jshacker');

  rerender({ initialPath: '/root' });
  expect(result.current.path).toBe('/root');
});
```

---

## Testing Context

### wrapper Option

**For hooks that need context providers:**

```tsx
const { result } = renderHook(() => useFileSystem(), {
  wrapper: ({ children }) => (
    <FileSystemProvider>
      {children}
    </FileSystemProvider>
  ),
});

expect(result.current.readFile('localhost', '/etc/hostname')).toBeDefined();

act(() => {
  result.current.writeFile('localhost', '/tmp/test.txt', 'hello');
});

expect(result.current.readFile('localhost', '/tmp/test.txt')?.content).toBe('hello');
```

### Multiple Providers

```tsx
const AllProviders = ({ children }) => (
  <SessionProvider>
    <MissionProvider>
      <FileSystemProvider>
        <NetworkProvider>
          {children}
        </NetworkProvider>
      </FileSystemProvider>
    </MissionProvider>
  </SessionProvider>
);

const { result } = renderHook(() => useNetworkCommands(), {
  wrapper: AllProviders,
});
```

### Testing Components with Context

```tsx
// ✅ CORRECT - Wrap component in provider
const renderWithSession = (ui, { session = getMockSession(), ...options } = {}) => {
  return render(
    <SessionProvider initialSession={session}>
      {ui}
    </SessionProvider>,
    options
  );
};

it('should show root prompt when logged in as root', () => {
  renderWithSession(<TerminalInput />, {
    session: getMockSession({ username: 'root', userType: 'root' }),
  });

  expect(screen.getByText(/root@localhost>/)).toBeInTheDocument();
});
```

---

## Testing Forms

### Controlled Inputs

```tsx
it('should update terminal input as user types', async () => {
  const user = userEvent.setup();

  render(<TerminalInput prompt="jshacker@localhost>" />);

  const input = screen.getByRole('textbox');

  await user.type(input, 'ssh("192.168.1.50")');

  expect(input).toHaveValue('ssh("192.168.1.50")');
});
```

### Form Submissions

```tsx
it('should execute command on enter', async () => {
  const handleCommand = vi.fn();
  const user = userEvent.setup();

  render(<TerminalInput onSubmit={handleCommand} prompt="jshacker@localhost>" />);

  await user.type(screen.getByRole('textbox'), 'nmap("192.168.1.50")');
  await user.keyboard('{Enter}');

  expect(handleCommand).toHaveBeenCalledWith('nmap("192.168.1.50")');
});
```

### Form Validation

```tsx
it('should show permission denied for root-only commands', async () => {
  const user = userEvent.setup();

  render(
    <SessionProvider initialSession={getMockSession({ userType: 'user' })}>
      <Terminal />
    </SessionProvider>
  );

  await user.type(screen.getByRole('textbox'), 'gpg("secret.gpg", "key")');
  await user.keyboard('{Enter}');

  expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
});
```

---

## React-Specific Anti-Patterns

### 1. Unnecessary act() wrapping

❌ **WRONG - Manual act() everywhere**
```tsx
act(() => {
  render(<Terminal />);
});

await act(async () => {
  await user.click(button);
});
```

✅ **CORRECT - RTL handles it**
```tsx
render(<Terminal />);
await user.click(button);
```

**Modern RTL auto-wraps:**
- `render()`
- `userEvent` methods
- `fireEvent`
- `waitFor`, `findBy`

**When you DO need manual `act()`:**
- Custom hook state updates (`renderHook`)
- Direct state mutations (rare, usually bad practice)

---

### 2. Manual cleanup() calls

❌ **WRONG - Manual cleanup**
```tsx
afterEach(() => {
  cleanup(); // Automatic since RTL 9!
});
```

✅ **CORRECT - No cleanup needed**
```tsx
// Cleanup happens automatically after each test
```

---

### 3. beforeEach render pattern

❌ **WRONG - Shared render in beforeEach**
```tsx
let input;
beforeEach(() => {
  render(<TerminalInput prompt=">" />);
  input = screen.getByRole('textbox'); // Shared state across tests
});

it('test 1', () => {
  // Uses shared input from beforeEach
});
```

✅ **CORRECT - Factory function per test**
```tsx
const renderTerminalInput = (props = {}) => {
  render(<TerminalInput prompt="jshacker@localhost>" {...props} />);
  return {
    input: screen.getByRole('textbox'),
  };
};

it('test 1', () => {
  const { input } = renderTerminalInput(); // Fresh state
});
```

For factory patterns, see `testing` skill.

---

### 4. Testing component internals

❌ **WRONG - Accessing component internals**
```tsx
const wrapper = shallow(<NanoEditor />);
expect(wrapper.state('unsavedChanges')).toBe(true); // Internal state
expect(wrapper.instance().handleSave).toBeDefined(); // Internal method
```

✅ **CORRECT - Test rendered output**
```tsx
render(<NanoEditor filePath="/tmp/test.txt" content="hello" />);
expect(screen.getByText(/\^S Save/i)).toBeInTheDocument(); // What user sees
```

---

### 5. Shallow rendering

❌ **WRONG - Shallow rendering**
```tsx
const wrapper = shallow(<Terminal />);
// Child components not rendered - incomplete test
```

✅ **CORRECT - Full rendering**
```tsx
render(<Terminal />);
// Full component tree rendered - realistic test
```

**Why:** Shallow rendering hides integration bugs between parent/child components.

---

## Testing Loading States

```tsx
it('should show scanning animation then nmap results', async () => {
  render(<AsyncOutput lines={['Starting Nmap...', 'PORT   STATE SERVICE', '22/tcp open  ssh']} />);

  // Initially shows first line
  expect(screen.getByText(/Starting Nmap/i)).toBeInTheDocument();

  // Wait for all lines
  await screen.findByText(/22\/tcp open/i);
});
```

---

## Testing Error Boundaries

```tsx
it('should catch errors with error boundary', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

  render(
    <ErrorBoundary fallback={<div>Terminal crashed</div>}>
      <BrokenComponent />
    </ErrorBoundary>
  );

  expect(screen.getByText(/Terminal crashed/i)).toBeInTheDocument();

  spy.mockRestore();
});
```

---

## Testing Portals

```tsx
it('should render nano editor as overlay', () => {
  render(<NanoEditor filePath="/tmp/test.txt" content="hello" isOpen={true} />);

  // Portal renders outside root, but Testing Library finds it
  expect(screen.getByText(/hello/)).toBeInTheDocument();
});
```

**Testing Library queries the entire document,** so portals work automatically.

---

## Testing Suspense

```tsx
it('should show fallback then content', async () => {
  render(
    <Suspense fallback={<div>Loading terminal...</div>}>
      <LazyTerminal />
    </Suspense>
  );

  // Initially fallback
  expect(screen.getByText(/loading terminal/i)).toBeInTheDocument();

  // Wait for component
  await screen.findByText(/JSHACK\.ME/i);
});
```

---

## Summary Checklist

React-specific checks:

- [ ] **Preferred**: Using `vitest-browser-react` with Vitest Browser Mode (real browser)
- [ ] **Fallback**: Using `@testing-library/react` if Browser Mode not yet configured
- [ ] All Playwright/Browser Mode tests are idempotent (no shared state between tests)
- [ ] Using `renderHook()` for custom hooks
- [ ] Using `wrapper` option for context providers
- [ ] No manual `act()` calls (handled automatically)
- [ ] No manual `cleanup()` calls (automatic)
- [ ] Testing component output, not internal state
- [ ] Using factory functions, not `beforeEach` render
- [ ] Using `expect.element()` for auto-retrying assertions (Browser Mode)
- [ ] Following TDD workflow (see `tdd` skill)
- [ ] Using general UI testing patterns (see `front-end-testing` skill)
- [ ] Using test factories for data (see `testing` skill)
