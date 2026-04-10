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
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

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
});
```

### Component Testing

```tsx
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';

test('should display machine info when provided', async () => {
  const screen = await render(<MachineInfo ip="10.0.1.5" hostname="web-server" ports={3} />);

  await expect.element(screen.getByText(/10\.0\.1\.5/)).toBeVisible();
  await expect.element(screen.getByText(/web-server/)).toBeVisible();
});
```

**Key differences from `@testing-library/react`:**

- `render()` is async — use `await`
- Returns a `screen` scoped to the rendered component
- Use `expect.element()` for auto-retrying assertions
- No `act()` wrapper needed — CDP events + retry handle timing
- Auto-cleanup happens before each test (not after), so components stay visible for debugging

### Testing Props and Callbacks

```tsx
test('should call onCommand when input submitted', async () => {
  const handleCommand = vi.fn();
  const screen = await render(<CommandInput onCommand={handleCommand} />);

  await screen.getByRole('textbox').fill('ls -la /home');
  await screen.getByRole('textbox').press('Enter');

  expect(handleCommand).toHaveBeenCalledWith('ls -la /home');
});
```

### Testing Conditional Rendering

```tsx
test('should show connection error when machine is unreachable', async () => {
  const screen = await render(<SshConnection ip="10.0.1.5" bricked={true} />);

  await expect.element(screen.getByText(/connection timed out/i)).toBeVisible();
});
```

### Testing Hooks with renderHook

```tsx
import { renderHook } from 'vitest-browser-react';

test('should toggle WiFi connection state', async () => {
  const { result } = await renderHook(() => useWifiConnection());

  expect(result.current.connected).toBe(false);

  await act(() => {
    result.current.connect({ essid: 'NETGEAR-5G', bssid: 'AA:BB:CC:DD:EE:FF' });
  });

  expect(result.current.connected).toBe(true);
});
```

### Testing Context Providers

```tsx
test('should show terminal prompt when session is active', async () => {
  const screen = await render(
    <SessionProvider
      initialSession={{ userType: 'user', machine: 'localhost', currentPath: '/home/user' }}
    >
      <Terminal />
    </SessionProvider>,
  );

  await expect.element(screen.getByText(/user@localhost/)).toBeVisible();
});
```

For hooks that need context:

```tsx
const { result } = await renderHook(() => useSession(), {
  wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>,
});
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
it('should display machine hostname and IP', () => {
  render(<MachineInfo ip="10.0.1.5" hostname="web-server" ports={3} />);

  expect(screen.getByText(/web-server/)).toBeInTheDocument();
  expect(screen.getByText(/10\.0\.1\.5/)).toBeInTheDocument();
});
```

```tsx
// ❌ WRONG - Testing implementation
it('should set hostname state', () => {
  const wrapper = mount(<MachineInfo ip="10.0.1.5" hostname="web-server" />);
  expect(wrapper.state('hostname')).toBe('web-server'); // Internal state!
});
```

### Testing Props

```tsx
// ✅ CORRECT - Test how props affect rendered output
it('should execute command when submitted', async () => {
  const handleCommand = vi.fn();
  const user = userEvent.setup();

  render(<CommandInput onCommand={handleCommand} />);

  await user.type(screen.getByRole('textbox'), 'nmap 10.0.1.5');
  await user.keyboard('{Enter}');

  expect(handleCommand).toHaveBeenCalledWith('nmap 10.0.1.5');
});
```

### Testing Conditional Rendering

```tsx
// ✅ CORRECT - Test what user sees in different states
it('should show permission denied when guest runs root command', async () => {
  const user = userEvent.setup();
  render(<Terminal session={{ userType: 'guest' }} />);

  await user.type(screen.getByRole('textbox'), 'reboot');
  await user.keyboard('{Enter}');

  await screen.findByText(/permission denied/i);
});
```

---

## Testing React Hooks

### Custom Hooks with renderHook

**Built into `@testing-library/react`** (import directly, no separate package needed):

```tsx
import { renderHook } from '@testing-library/react';

it('should toggle WiFi connection state', () => {
  const { result } = renderHook(() => useWifiConnection());

  expect(result.current.connected).toBe(false);

  act(() => {
    result.current.connect({ essid: 'NETGEAR-5G', bssid: 'AA:BB:CC:DD:EE:FF' });
  });

  expect(result.current.connected).toBe(true);
});
```

**Pattern:**

- `result.current` - Current return value of hook
- `act()` - Wrap state updates
- `rerender()` - Re-run hook with new props

### Hooks with Props

```tsx
it('should accept initial session values', () => {
  const { result, rerender } = renderHook(({ userType }) => useSession(userType), {
    initialProps: { userType: 'guest' as UserType },
  });

  expect(result.current.userType).toBe('guest');

  // Test with different initial value
  rerender({ userType: 'root' as UserType });
  expect(result.current.userType).toBe('root');
});
```

---

## Testing Context

### wrapper Option

**For hooks that need context providers:**

```tsx
const { result } = renderHook(() => useSession(), {
  wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>,
});

expect(result.current.userType).toBe('guest');

act(() => {
  result.current.switchUser('root', 'password123');
});

expect(result.current.userType).toBe('root');
```

### Multiple Providers

```tsx
const AllProviders = ({ children }) => (
  <GameProvider>
    <SessionProvider>
      <NetworkProvider>{children}</NetworkProvider>
    </SessionProvider>
  </GameProvider>
);

const { result } = renderHook(() => useNetworkCommands(), {
  wrapper: AllProviders,
});
```

### Testing Components with Context

```tsx
// ✅ CORRECT - Wrap component in provider
const renderWithSession = (ui, { session = null, ...options } = {}) => {
  return render(<SessionProvider initialSession={session}>{ui}</SessionProvider>, options);
};

it('should show root prompt when logged in as root', () => {
  renderWithSession(<Terminal />, {
    session: { userType: 'root', machine: 'localhost', currentPath: '/' },
  });

  expect(screen.getByText(/root@localhost/)).toBeInTheDocument();
});
```

---

## Testing Forms

### Controlled Inputs

```tsx
it('should update command as user types', async () => {
  const user = userEvent.setup();

  render(<CommandInput />);

  const input = screen.getByRole('textbox');

  await user.type(input, 'ssh admin@10.0.1.5');

  expect(input).toHaveValue('ssh admin@10.0.1.5');
});
```

### Form Submissions

```tsx
it('should submit game setup with user input', async () => {
  const handleSubmit = vi.fn();
  const user = userEvent.setup();

  render(<IntroScreen onSubmit={handleSubmit} />);

  await user.type(screen.getByLabelText(/workstation/i), 'hackbox');
  await user.type(screen.getByLabelText(/username/i), 'ghost');
  await user.type(screen.getByLabelText(/password/i), 'r00tpass');
  await user.click(screen.getByRole('button', { name: /new game/i }));

  expect(handleSubmit).toHaveBeenCalledWith({
    workstationName: 'hackbox',
    username: 'ghost',
    rootPassword: 'r00tpass',
  });
});
```

### Form Validation

```tsx
it('should show validation errors for empty fields', async () => {
  const user = userEvent.setup();

  render(<IntroScreen />);

  // Submit empty form
  await user.click(screen.getByRole('button', { name: /new game/i }));

  // Validation errors appear
  expect(screen.getByText(/workstation name is required/i)).toBeInTheDocument();
  expect(screen.getByText(/username is required/i)).toBeInTheDocument();
  expect(screen.getByText(/password is required/i)).toBeInTheDocument();
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
  render(<CommandInput />);
  input = screen.getByRole('textbox'); // Shared state across tests
});

it('test 1', () => {
  // Uses shared input from beforeEach
});
```

✅ **CORRECT - Factory function per test**

```tsx
const renderCommandInput = () => {
  render(<CommandInput />);
  return {
    input: screen.getByRole('textbox'),
  };
};

it('test 1', () => {
  const { input } = renderCommandInput(); // Fresh state
});
```

For factory patterns, see `testing` skill.

---

### 4. Testing component internals

❌ **WRONG - Accessing component internals**

```tsx
const wrapper = shallow(<Terminal />);
expect(wrapper.state('currentPath')).toBe('/home'); // Internal state
expect(wrapper.instance().handleCommand).toBeDefined(); // Internal method
```

✅ **CORRECT - Test rendered output**

```tsx
render(<Terminal />);
expect(screen.getByText(/user@localhost/)).toBeInTheDocument(); // What user sees
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
it('should show boot sequence then terminal', async () => {
  render(<BootScreen onComplete={vi.fn()} />);

  // Initially booting
  expect(screen.getByText(/loading/i)).toBeInTheDocument();

  // Wait for boot to complete
  await screen.findByText(/login/i);

  // Loading gone
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
});
```

---

## Testing Error Boundaries

```tsx
it('should catch errors with error boundary', () => {
  // Suppress console.error for this test
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

  render(
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <BrokenComponent />
    </ErrorBoundary>,
  );

  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

  spy.mockRestore();
});
```

---

## Testing Portals

```tsx
it('should render modal overlay in portal', () => {
  render(<MissionModal isOpen={true} seed="abc123" />);

  // Portal renders outside root, but Testing Library finds it
  expect(screen.getByText(/mission briefing/i)).toBeInTheDocument();
});
```

**Testing Library queries the entire document,** so portals work automatically.

---

## Testing Suspense

```tsx
it('should show fallback then content', async () => {
  render(
    <Suspense fallback={<div>Loading...</div>}>
      <LazyMissionPanel />
    </Suspense>,
  );

  // Initially fallback
  expect(screen.getByText(/loading/i)).toBeInTheDocument();

  // Wait for component
  await screen.findByText(/available contracts/i);
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
