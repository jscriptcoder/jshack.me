import '@testing-library/jest-dom/vitest';

// jsdom lays nothing out, so it leaves `scrollIntoView` unimplemented; a screen that
// keeps its selection in sight would otherwise throw on every move. A no-op is all
// a layout-free DOM can honestly do, and a test that cares spies on it.
Element.prototype.scrollIntoView = () => {};
