import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, test, expect, vi, beforeAll, afterEach } from 'vitest';
import { useRef, useEffect } from 'react';
import ChatMessages, { type ChatMessagesRef } from '../ChatMessages';

// Mock IntersectionObserver and ResizeObserver so the component can mount
// without browser APIs.
class FakeIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeAll(() => {
  window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof window.IntersectionObserver;
  window.ResizeObserver = FakeResizeObserver as unknown as typeof window.ResizeObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom does not compute layout, so offsetTop is always 0. Install a global
// getter that gives each message a realistic vertical position based on its
// index inside the ChatMessages inner wrapper.
const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
  configurable: true,
  get() {
    if (this.id?.startsWith('msg-')) {
      const parent = this.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(this);
        return index * 50;
      }
    }
    return originalOffsetTop?.get?.call(this) ?? 0;
  },
});

const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    if (this.id?.startsWith('msg-')) return 40;
    return originalClientHeight?.get?.call(this) ?? 0;
  },
});

function TestHarness({
  messages,
  streaming = false,
  streamedContent = '',
  toolExecutions = [],
  creatingChat = false,
  chatId = 'chat-1',
}: {
  messages: { id: string; role: string; content: string; created_at: string }[];
  streaming?: boolean;
  streamedContent?: string;
  toolExecutions?: any[];
  creatingChat?: boolean;
  chatId?: string;
}) {
  const ref = useRef<ChatMessagesRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);

  // Expose the imperative handle and container ref for assertions
  useEffect(() => {
    (window as any).__testChatMessagesRef = ref.current;
    (window as any).__testContainerRef = containerRef.current;
  });

  return (
    <div style={{ height: '400px' }}>
      <ChatMessages
        ref={ref}
        messages={messages}
        streaming={streaming}
        streamedContent={streamedContent}
        toolExecutions={toolExecutions}
        creatingChat={creatingChat}
        chatId={chatId}
        messageMeta={{}}
        showScrollBtn={false}
        scrollContainerRef={containerRef as React.RefObject<HTMLDivElement>}
        wasNearBottomRef={wasNearBottomRef}
        setShowScrollBtn={() => {}}
        onScroll={() => {}}
        onRegenerate={() => {}}
        onEditMessage={() => {}}
        onSuggestion={() => {}}
      />
    </div>
  );
}

function mockScrollContainer(container: HTMLElement) {
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => 1200,
  });
  container.scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
    const top = typeof options === 'number' ? options : options?.top ?? 0;
    Object.defineProperty(this, 'scrollTop', {
      configurable: true,
      value: top,
    });
  }) as unknown as HTMLElement['scrollTo'];
}

function setMessageOffsetTop(messageId: string, top: number) {
  const element = document.getElementById(`msg-${messageId}`);
  if (!element) return;
  Object.defineProperty(element, 'offsetTop', {
    configurable: true,
    value: top,
  });
  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    value: 40,
  });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top,
      bottom: top + 40,
      height: 40,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: top,
    }),
  });
}

describe('ChatMessages snap-to-latest-user-message', () => {
  test('new user message is scrolled to top of the response area on send', () => {
    const initialMessages = [
      { id: 'm1', role: 'user', content: 'First message', created_at: '2024-01-01T00:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'Response one', created_at: '2024-01-01T00:00:01Z' },
    ];

    const { rerender } = render(<TestHarness messages={initialMessages} />);

    const container = (window as any).__testContainerRef as HTMLElement;
    expect(container).toBeDefined();
    mockScrollContainer(container);
    setMessageOffsetTop('m1', 0);
    setMessageOffsetTop('m2', 50);

    // Simulate sending: request the snap, then append the new message.
    (window as any).__testChatMessagesRef?.requestSnapToLatestUserMessage();

    const newMessages = [
      ...initialMessages,
      { id: 'm3', role: 'user', content: 'Second message', created_at: '2024-01-01T00:00:02Z' },
    ];

    rerender(<TestHarness messages={newMessages} streaming={true} />);

    setMessageOffsetTop('m3', 100);

    const lastUserMessage = document.getElementById('msg-m3');
    expect(lastUserMessage).toBeInTheDocument();

    // The latest user message should be pinned at the top of the visible
    // response area (scrollTop == message.offsetTop - top gap).
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(lastUserMessage!.offsetTop - container.scrollTop).toBeLessThanOrEqual(16);
  });

  test('response fill area is rendered below the latest user message while streaming', () => {
    const initialMessages = [
      { id: 'm1', role: 'user', content: 'Hello', created_at: '2024-01-01T00:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'Hi there', created_at: '2024-01-01T00:00:01Z' },
    ];

    const { rerender } = render(<TestHarness messages={initialMessages} />);

    const container = (window as any).__testContainerRef as HTMLElement;
    mockScrollContainer(container);

    // Simulate sending a new message that starts streaming.
    (window as any).__testChatMessagesRef?.requestSnapToLatestUserMessage();
    const newMessages = [
      ...initialMessages,
      { id: 'm3', role: 'user', content: 'Follow-up', created_at: '2024-01-01T00:00:02Z' },
    ];

    rerender(
      <TestHarness messages={newMessages} streaming={true} streamedContent="Working..." />,
    );

    const streaming = document.getElementById('msg-streaming');
    expect(streaming).toBeInTheDocument();
    expect(streaming).toHaveTextContent('Working...');
  });
});
