import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { useRef, useLayoutEffect } from 'react';
import { useChatScroll } from '../useChatScroll';

beforeAll(() => {
  class FakeResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  window.ResizeObserver = FakeResizeObserver as unknown as typeof window.ResizeObserver;
});

function TestHarness({ chatId, suppress }: { chatId?: string; suppress?: boolean }) {
  const suppressRef = useRef(suppress ?? false);
  suppressRef.current = suppress ?? false;
  const { containerRef } = useChatScroll(chatId, { suppressResetRef: suppressRef });

  useLayoutEffect(() => {
    (window as any).__testContainer = containerRef.current;
  });

  return <div ref={containerRef} data-testid="scroll-container" style={{ height: '400px', overflowY: 'auto' }}>
    <div style={{ height: '1200px' }} />
  </div>;
}

describe('useChatScroll', () => {
  test('resets scroll to bottom when switching between existing chats', () => {
    const { rerender } = render(<TestHarness chatId="chat-a" />);
    const container = screen.getByTestId('scroll-container');
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 });

    // Re-render to trigger the reset effect with the mocked dimensions.
    rerender(<TestHarness chatId="chat-a" />);
    expect(container.scrollTop).toBeGreaterThan(0);

    rerender(<TestHarness chatId="chat-b" />);
    expect(container.scrollTop).toBeGreaterThan(700);
  });

  test('does not override a pending snap when creating a new chat', () => {
    const { rerender } = render(<TestHarness chatId={undefined} suppress={true} />);
    const container = screen.getByTestId('scroll-container');
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 });
    container.scrollTop = 123;

    rerender(<TestHarness chatId="new-chat" suppress={true} />);

    // The reset should have been suppressed; scroll position stays at the snap
    // value instead of jumping to the bottom.
    expect(container.scrollTop).toBe(123);
  });
});
