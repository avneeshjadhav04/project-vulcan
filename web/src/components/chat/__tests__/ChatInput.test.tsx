import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, test, expect, vi } from 'vitest';
import ChatInput from '../ChatInput';
import { ErrorToastProvider } from '../../ui/ErrorToast';

describe('ChatInput component', () => {
  const defaultProps = {
    input: '',
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    streaming: false,
    effectiveChatId: undefined,
    getChatId: async () => 'test-chat',
    selectedModel: { providerId: '', modelId: '' },
    onModelChange: vi.fn(),
    attachedFiles: [],
    onFilesChange: vi.fn(),
    voiceState: 'idle' as const,
    voiceRecordingTime: 0,
    voiceTranscript: '',
    voicePartialText: '',
    onStartVoice: vi.fn(),
    onStopVoice: vi.fn(),
    onCancelVoice: vi.fn(),
    onVoiceTranscript: vi.fn(),
    toolsEnabled: false,
    onToggleTools: vi.fn(),
    sendError: '',
  };

  test('shows loading spinner when streaming', async () => {
    render(
      <ErrorToastProvider>
        <ChatInput {...{ ...defaultProps, streaming: true }} />
      </ErrorToastProvider>
    );
    // The stop button should have an animated Loader2 icon
    const stopBtn = screen.getByLabelText('Stop generating');
    expect(stopBtn).toBeInTheDocument();
    const spinner = stopBtn.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  test('displays error toast when sendError is set', () => {
    render(
      <ErrorToastProvider>
        <ChatInput {...{ ...defaultProps, sendError: 'Something went wrong' }} />
      </ErrorToastProvider>
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
  });
});
