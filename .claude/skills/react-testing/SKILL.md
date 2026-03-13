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

test('should display command output with correct type', async () => {
  const screen = await render(<CommandOutput text="Permission denied" type="error" />)

  await expect.element(screen.getByText(/permission denied/i)).toBeVisible()
  await expect.element(screen.getByText(/permission denied/i)).toHaveClass('text-red-500')
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
test('should call onExecute when command is submitted', async () => {
  const handleExecute = vi.fn()
  const screen = await render(<TerminalInput onExecute={handleExecute} />)

  await screen.getByRole('textbox').fill('nmap("192.168.1.1")')
  await screen.getByRole('textbox').press('Enter')

  expect(handleExecute).toHaveBeenCalledWith('nmap("192.168.1.1")')
})
```

### Testing Conditional Rendering

```tsx
test('should show permission denied when executing root-only command as guest', async () => {
  const screen = await render(
    <SessionProvider initialUser="guest">
      <Terminal />
    </SessionProvider>
  )

  await screen.getByRole('textbox').fill('reboot()')
  await screen.getByRole('textbox').press('Enter')

  await expect.element(screen.getByText(/permission denied/i)).toBeVisible()
})
```

### Testing Hooks with renderHook

```tsx
import { renderHook } from 'vitest-browser-react'

test('should toggle wifi connection status', async () => {
  const { result } = await renderHook(() => useWifiStatus(false))

  expect(result.current.connected).toBe(false)

  await act(() => {
    result.current.connect()
  })

  expect(result.current.connected).toBe(true)
})
```

### Testing Context Providers

```tsx
test('should show mission list when session is active', async () => {
  const screen = await render(
    <SessionProvider initialUser="root">
      <MissionList />
    </SessionProvider>
  )

  await expect.element(screen.getByText(/available contracts/i)).toBeVisible()
})
```

For hooks that need context:
```tsx
const { result } = await renderHook(() => useMission(), {
  wrapper: ({ children }) => (
    <MissionProvider>{children}</MissionProvider>
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
it('should display command output with correct styling', () => {
  render(<CommandOutput text="Permission denied" type="error" />);

  expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
  expect(screen.getByText(/permission denied/i)).toHaveClass('text-red-500');
});
```

```tsx
// ❌ WRONG - Testing implementation
it('should set output state', () => {
  const wrapper = mount(<CommandOutput text="Permission denied" />);
  expect(wrapper.state('text')).toBe('Permission denied'); // Internal state!
});
```

### Testing Props

```tsx
// ✅ CORRECT - Test how props affect rendered output
it('should call onExecute when command is submitted', async () => {
  const handleExecute = vi.fn();
  const user = userEvent.setup();

  render(<TerminalInput onExecute={handleExecute} />);

  await user.type(screen.getByRole('textbox'), 'nmap("192.168.1.1")');
  await user.keyboard('{Enter}');

  expect(handleExecute).toHaveBeenCalledWith('nmap("192.168.1.1")');
});
```

### Testing Conditional Rendering

```tsx
// ✅ CORRECT - Test what user sees in different states
it('should show command not found for unknown commands', async () => {
  const user = userEvent.setup();
  render(
    <SessionProvider>
      <Terminal />
    </SessionProvider>
  );

  await user.type(screen.getByRole('textbox'), 'foobar()');
  await user.keyboard('{Enter}');

  await screen.findByText(/foobar is not defined/i);
});
```

---

## Testing React Hooks

### Custom Hooks with renderHook

**Built into `@testing-library/react`** (import directly, no separate package needed):

```tsx
import { renderHook } from '@testing-library/react';

it('should toggle wifi connection status', () => {
  const { result } = renderHook(() => useWifiStatus(false));

  expect(result.current.connected).toBe(false);

  act(() => {
    result.current.connect();
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
it('should accept initial value', () => {
  const { result, rerender } = renderHook(
    ({ initialValue }) => useCounter(initialValue),
    { initialProps: { initialValue: 10 } }
  );

  expect(result.current.count).toBe(10);

  // Test with different initial value
  rerender({ initialValue: 20 });
  expect(result.current.count).toBe(20);
});
```

---

## Testing Context

### wrapper Option

**For hooks that need context providers:**

```tsx
const { result } = renderHook(() => useMission(), {
  wrapper: ({ children }) => (
    <MissionProvider>
      {children}
    </MissionProvider>
  ),
});

expect(result.current.activeMission).toBeNull();

act(() => {
  result.current.accept('seed-exfiltrate-easy');
});

expect(result.current.activeMission).toEqual(expect.objectContaining({ seed: 'seed-exfiltrate-easy' }));
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

const { result } = renderHook(() => useCommands(), {
  wrapper: AllProviders,
});
```

### Testing Components with Context

```tsx
// ✅ CORRECT - Wrap component in provider
const renderWithSession = (ui, { user = 'guest', ...options } = {}) => {
  return render(
    <SessionProvider initialUser={user}>
      {ui}
    </SessionProvider>,
    options
  );
};

it('should show mission list when session is active', () => {
  renderWithSession(<MissionList />, {
    user: 'root',
  });

  expect(screen.getByText(/available contracts/i)).toBeInTheDocument();
});
```

---

## Testing Forms

### Controlled Inputs

```tsx
it('should update input value as user types command', async () => {
  const user = userEvent.setup();

  render(<TerminalInput />);

  const input = screen.getByRole('textbox');

  await user.type(input, 'ls("/home")');

  expect(input).toHaveValue('ls("/home")');
});
```

### Form Submissions

```tsx
it('should submit password prompt with entered password', async () => {
  const handleSubmit = vi.fn();
  const user = userEvent.setup();

  render(<PasswordPrompt hostname="10.0.0.5" username="root" onSubmit={handleSubmit} />);

  await user.type(screen.getByLabelText(/password/i), 'cr4ck3d_p4ss');
  await user.keyboard('{Enter}');

  expect(handleSubmit).toHaveBeenCalledWith({
    hostname: '10.0.0.5',
    username: 'root',
    password: 'cr4ck3d_p4ss',
  });
});
```

### Form Validation

```tsx
it('should show error when submitting empty password', async () => {
  const user = userEvent.setup();

  render(<PasswordPrompt hostname="10.0.0.5" username="root" onSubmit={vi.fn()} />);

  // Submit without entering password
  await user.keyboard('{Enter}');

  // Validation error appears
  expect(screen.getByText(/password is required/i)).toBeInTheDocument();
});
```

---

## React-Specific Anti-Patterns

### 1. Unnecessary act() wrapping

❌ **WRONG - Manual act() everywhere**
```tsx
act(() => {
  render(<MyComponent />);
});

await act(async () => {
  await user.click(button);
});
```

✅ **CORRECT - RTL handles it**
```tsx
render(<MyComponent />);
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
let button;
beforeEach(() => {
  render(<MyComponent />);
  button = screen.getByRole('button'); // Shared state across tests
});

it('test 1', () => {
  // Uses shared button from beforeEach
});
```

✅ **CORRECT - Factory function per test**
```tsx
const renderComponent = () => {
  render(<MyComponent />);
  return {
    button: screen.getByRole('button'),
  };
};

it('test 1', () => {
  const { button } = renderComponent(); // Fresh state
});
```

For factory patterns, see `testing` skill.

---

### 4. Testing component internals

❌ **WRONG - Accessing component internals**
```tsx
const wrapper = shallow(<MyComponent />);
expect(wrapper.state('isOpen')).toBe(true); // Internal state
expect(wrapper.instance().handleClick).toBeDefined(); // Internal method
```

✅ **CORRECT - Test rendered output**
```tsx
render(<MyComponent />);
expect(screen.getByRole('dialog')).toBeInTheDocument(); // What user sees
```

---

### 5. Shallow rendering

❌ **WRONG - Shallow rendering**
```tsx
const wrapper = shallow(<MyComponent />);
// Child components not rendered - incomplete test
```

✅ **CORRECT - Full rendering**
```tsx
render(<MyComponent />);
// Full component tree rendered - realistic test
```

**Why:** Shallow rendering hides integration bugs between parent/child components.

---

## Testing Loading States

```tsx
it('should show scanning then results', async () => {
  render(<NmapOutput target="192.168.1.0/24" />);

  // Initially scanning
  expect(screen.getByText(/scanning/i)).toBeInTheDocument();

  // Wait for results
  await screen.findByText(/22\/tcp.*open/i);

  // Scanning done
  expect(screen.queryByText(/scanning/i)).not.toBeInTheDocument();
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
      <ThrowsError />
    </ErrorBoundary>
  );

  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

  spy.mockRestore();
});
```

---

## Testing Portals

```tsx
it('should render nano editor overlay in portal', () => {
  render(<NanoOverlay isOpen={true} filePath="/etc/hosts" />);

  // Portal renders outside root, but Testing Library finds it
  expect(screen.getByText(/\/etc\/hosts/i)).toBeInTheDocument();
});
```

**Testing Library queries the entire document,** so portals work automatically.

---

## Testing Suspense

```tsx
it('should show fallback then terminal content', async () => {
  render(
    <Suspense fallback={<div>Loading...</div>}>
      <LazyTerminal />
    </Suspense>
  );

  // Initially fallback
  expect(screen.getByText(/loading/i)).toBeInTheDocument();

  // Wait for terminal to render
  await screen.findByText(/jshack\.me/i);
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
