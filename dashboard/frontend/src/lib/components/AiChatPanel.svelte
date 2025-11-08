<script lang="ts">
  import { sendAiMessage, fetchAiOutput } from '../api';
  import { sseClient } from '../sse';
  import { onMount, onDestroy } from 'svelte';

  let { 
    envId, 
    open = false, 
    latestSse = null,
    deviceAuth = null,
  }: { 
    envId: string; 
    open?: boolean; 
    latestSse?: string | null;
    deviceAuth?: { code: string; url: string } | null;
  } = $props();

  // Message structure for conversation
  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }

  let input = $state('');
  let messages = $state<Message[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let authStatus = $state<'unknown' | 'pending' | 'authenticated'>('unknown');
  let copilotReady = $state(false);
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let messagesContainer: HTMLDivElement | null = null;
  const EMPTY_SSE = Symbol('empty-sse');
  let lastSseToken: string | symbol | null = null;

  // Load conversation from localStorage on mount
  onMount(() => {
    const stored = localStorage.getItem(`ai-chat-${envId}`);
    if (stored) {
      try {
        messages = JSON.parse(stored);
      } catch (e) {
        console.error('Failed to load conversation history', e);
      }
    }

    // Set up SSE listeners for copilot events
    const copilotReadyHandler = (payload: any) => {
      if (payload.env_id === envId) {
        copilotReady = true;
        authStatus = 'authenticated';
        addSystemMessage('✅ GitHub Copilot is ready!');
      }
    };

    const copilotDeviceCodeHandler = (payload: any) => {
      if (payload.env_id === envId) {
        authStatus = 'pending';
        addSystemMessage('⏳ Authentication required. Please complete GitHub authentication.');
      }
    };

    sseClient.on('copilot-ready', copilotReadyHandler);
    sseClient.on('copilot-device-code', copilotDeviceCodeHandler);

    // Check initial auth status from deviceAuth prop
    if (deviceAuth) {
      authStatus = 'pending';
    }

    return () => {
      sseClient.off('copilot-ready', copilotReadyHandler);
      sseClient.off('copilot-device-code', copilotDeviceCodeHandler);
      if (copyTimer) clearTimeout(copyTimer);
    };
  });

  // Save conversation to localStorage when messages change
  $effect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`ai-chat-${envId}`, JSON.stringify(messages));
    }
  });

  // Auto-scroll to bottom when new messages arrive
  $effect(() => {
    if (messagesContainer && messages.length > 0) {
      setTimeout(() => {
        messagesContainer?.scrollTo({
          top: messagesContainer.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    }
  });

  // Monitor SSE updates for AI responses
  $effect(() => {
    if (!open) {
      lastSseToken = null;
      return;
    }

    const token: string | symbol = latestSse ?? EMPTY_SSE;
    if (token === lastSseToken) {
      return;
    }

    lastSseToken = token;
    refreshOutput();
  });

  function addSystemMessage(content: string) {
    messages = [...messages, {
      role: 'system',
      content,
      timestamp: Date.now()
    }];
  }

  function addUserMessage(content: string) {
    messages = [...messages, {
      role: 'user',
      content,
      timestamp: Date.now()
    }];
  }

  function addAssistantMessage(content: string) {
    // Check if last message is from assistant, if so update it, else add new
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages = [
        ...messages.slice(0, -1),
        {
          role: 'assistant',
          content,
          timestamp: Date.now()
        }
      ];
    } else {
      messages = [...messages, {
        role: 'assistant',
        content,
        timestamp: Date.now()
      }];
    }
  }

  async function refreshOutput() {
    try {
      const res = await fetchAiOutput(envId);
      if (res.output) {
        addAssistantMessage(res.output);
        error = null;
      }
    } catch (err) {
      // Only show error if we don't already have output
      if (messages.filter(m => m.role === 'assistant').length === 0) {
        error = (err as Error).message;
      }
    }
  }

  async function submit() {
    if (!input.trim() || loading) return;
    
    const message = input.trim();
    input = '';
    loading = true;
    error = null;

    addUserMessage(message);

    try {
      await sendAiMessage(envId, message);
      await refreshOutput();
    } catch (err) {
      error = (err as Error).message;
      addSystemMessage(`❌ Error: ${(err as Error).message}`);
    } finally {
      loading = false;
    }
  }

  async function copyDeviceCode() {
    if (!deviceAuth) return;
    
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deviceAuth.code);
        copyState = 'copied';
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch (err) {
      copyState = 'failed';
      // Fallback for mobile browsers without clipboard API
      window.prompt('Copy this code to GitHub:', deviceAuth.code);
    } finally {
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyState = 'idle';
      }, 2500);
    }
  }

  function clearConversation() {
    if (confirm('Clear conversation history?')) {
      messages = [];
      localStorage.removeItem(`ai-chat-${envId}`);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }
</script>

{#if open}
  <section class="panel">
    <header>
      <div class="header-content">
        <h3>AI Assistant (GitHub Copilot CLI)</h3>
        {#if copilotReady}
          <span class="status-badge ready">●  Ready</span>
        {:else if authStatus === 'pending'}
          <span class="status-badge pending">●  Auth Required</span>
        {:else}
          <span class="status-badge unknown">●  Starting...</span>
        {/if}
      </div>
      <button class="clear-button" on:click={clearConversation} title="Clear conversation">
        🗑️
      </button>
    </header>

    <!-- Auth Banner (shown when authentication required) -->
    {#if authStatus === 'pending' && deviceAuth}
      <div class="auth-banner">
        <div class="auth-content">
          <p class="auth-title">🔐 GitHub Authentication Required</p>
          <p class="auth-instruction">Complete authentication to use Copilot:</p>
          
          <div class="device-code-container">
            <code class="device-code">{deviceAuth.code}</code>
            <button 
              class="copy-button {copyState}" 
              on:click={copyDeviceCode}
              aria-label="Copy code"
            >
              {#if copyState === 'copied'}
                ✓ Copied
              {:else if copyState === 'failed'}
                ✗ Failed
              {:else}
                📋 Copy
              {/if}
            </button>
          </div>

          <a 
            href={deviceAuth.url} 
            target="_blank" 
            rel="noopener noreferrer"
            class="auth-link"
          >
            Open GitHub to Authenticate →
          </a>
          
          <p class="auth-note">After authenticating, this panel will update automatically.</p>
        </div>
      </div>
    {/if}

    <!-- Error Display -->
    {#if error}
      <div class="error-banner">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{error}</span>
      </div>
    {/if}

    <!-- Messages Area -->
    <div class="messages" bind:this={messagesContainer}>
      {#if messages.length === 0}
        <div class="empty-state">
          <p class="empty-icon">💬</p>
          <p class="empty-text">No conversation yet.</p>
          <p class="empty-hint">Ask GitHub Copilot anything!</p>
        </div>
      {:else}
        {#each messages as message (message.timestamp)}
          <div class="message {message.role}">
            <div class="message-header">
              <span class="message-role">
                {#if message.role === 'user'}
                  You
                {:else if message.role === 'assistant'}
                  Copilot
                {:else}
                  System
                {/if}
              </span>
              <span class="message-time">
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div class="message-content">
              {message.content}
            </div>
          </div>
        {/each}
      {/if}

      <!-- Loading Indicator -->
      {#if loading}
        <div class="message assistant loading">
          <div class="message-header">
            <span class="message-role">Copilot</span>
          </div>
          <div class="message-content">
            <span class="loading-dots">Thinking</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Input Area (Fixed at bottom) -->
    <div class="input-area">
      <textarea 
        bind:value={input} 
        on:keydown={handleKeyDown}
        rows="2" 
        placeholder="Ask Copilot..."
        disabled={loading}
        class:disabled={loading}
      ></textarea>
      <button 
        class="send-button" 
        on:click={submit} 
        disabled={loading || !input.trim()}
        aria-label="Send message"
      >
        {#if loading}
          ⏳
        {:else}
          ➤
        {/if}
      </button>
    </div>
    
    <small class="hint">Use Ctrl+Enter to send • Messages are saved per environment</small>
  </section>
{/if}

<style>
  .panel {
    margin-top: 1rem;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 16px;
    padding: 0;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.15);
    display: flex;
    flex-direction: column;
    max-height: 600px;
    overflow: hidden;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 16px 16px 0 0;
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .status-badge {
    font-size: 0.85rem;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-weight: 500;
    white-space: nowrap;
  }

  .status-badge.ready {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.4);
  }

  .status-badge.pending {
    background: rgba(251, 191, 36, 0.2);
    color: #f59e0b;
    border: 1px solid rgba(251, 191, 36, 0.4);
  }

  .status-badge.unknown {
    background: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.4);
  }

  .clear-button {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    font-size: 1.1rem;
    transition: all 0.2s;
    min-height: 44px;
    min-width: 44px;
  }

  .clear-button:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .clear-button:active {
    transform: scale(0.95);
  }

  /* Auth Banner */
  .auth-banner {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border: 2px solid #f59e0b;
    border-radius: 12px;
    padding: 1rem;
    margin: 1rem;
  }

  .auth-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .auth-title {
    font-weight: 600;
    font-size: 1.05rem;
    margin: 0;
    color: #92400e;
  }

  .auth-instruction {
    margin: 0;
    color: #78350f;
    font-size: 0.95rem;
  }

  .device-code-container {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .device-code {
    flex: 1;
    background: white;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #1e40af;
    text-align: center;
    border: 2px solid #dbeafe;
  }

  .copy-button {
    background: white;
    border: 2px solid #f59e0b;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    color: #92400e;
    min-height: 44px;
    min-width: 80px;
  }

  .copy-button:hover {
    background: #fbbf24;
    color: white;
    transform: translateY(-2px);
  }

  .copy-button:active {
    transform: translateY(0);
  }

  .copy-button.copied {
    background: #10b981;
    border-color: #10b981;
    color: white;
  }

  .copy-button.failed {
    background: #ef4444;
    border-color: #ef4444;
    color: white;
  }

  .auth-link {
    display: inline-block;
    background: #3b82f6;
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    text-align: center;
    transition: all 0.2s;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .auth-link:hover {
    background: #2563eb;
    transform: translateY(-2px);
  }

  .auth-link:active {
    transform: translateY(0);
  }

  .auth-note {
    margin: 0;
    font-size: 0.85rem;
    color: #78350f;
    font-style: italic;
  }

  /* Error Banner */
  .error-banner {
    background: #fee2e2;
    border: 2px solid #ef4444;
    border-radius: 12px;
    padding: 1rem;
    margin: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .error-icon {
    font-size: 1.5rem;
  }

  .error-text {
    color: #991b1b;
    font-weight: 500;
  }

  /* Messages Area */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 200px;
    max-height: 400px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #94a3b8;
    text-align: center;
    padding: 2rem;
  }

  .empty-icon {
    font-size: 3rem;
    margin: 0 0 0.5rem 0;
  }

  .empty-text {
    font-size: 1.1rem;
    margin: 0;
    font-weight: 500;
  }

  .empty-hint {
    font-size: 0.9rem;
    margin: 0.5rem 0 0 0;
  }

  .message {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .message.user {
    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
    border: 1px solid #93c5fd;
    align-self: flex-end;
    max-width: 85%;
  }

  .message.assistant {
    background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
    border: 1px solid #d1d5db;
    align-self: flex-start;
    max-width: 85%;
  }

  .message.system {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border: 1px solid #fcd34d;
    align-self: center;
    max-width: 90%;
    font-size: 0.9rem;
  }

  .message.loading {
    opacity: 0.7;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    font-weight: 600;
    color: #475569;
  }

  .message-time {
    font-size: 0.75rem;
    color: #94a3b8;
    font-weight: 400;
  }

  .message-content {
    color: #1e293b;
    line-height: 1.6;
    word-wrap: break-word;
    white-space: pre-wrap;
  }

  .loading-dots::after {
    content: '';
    animation: dots 1.5s steps(4, end) infinite;
  }

  @keyframes dots {
    0%, 20% { content: ''; }
    40% { content: '.'; }
    60% { content: '..'; }
    80%, 100% { content: '...'; }
  }

  /* Input Area */
  .input-area {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 0 0 16px 16px;
  }

  textarea {
    flex: 1;
    border-radius: 12px;
    border: 2px solid #cbd5e1;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    font-family: inherit;
    resize: none;
    transition: border-color 0.2s;
    background: white;
  }

  textarea:focus {
    outline: none;
    border-color: #667eea;
  }

  textarea.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .send-button {
    padding: 0 1.5rem;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-size: 1.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 48px;
    min-width: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .send-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(102, 126, 234, 0.4);
  }

  .send-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    display: block;
    text-align: center;
    color: #64748b;
    font-size: 0.8rem;
    padding: 0 1rem 1rem 1rem;
    margin: 0;
  }

  /* Mobile Optimizations */
  @media (max-width: 768px) {
    .panel {
      max-height: calc(100vh - 120px);
      margin: 0.5rem;
      border-radius: 12px;
    }

    header {
      padding: 1rem;
      flex-wrap: wrap;
    }

    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    h3 {
      font-size: 1rem;
    }

    .status-badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.6rem;
    }

    .messages {
      max-height: calc(100vh - 320px);
      padding: 0.75rem;
    }

    .message {
      max-width: 90%;
      padding: 0.6rem 0.8rem;
    }

    .device-code {
      font-size: 1rem;
      padding: 0.6rem 0.8rem;
    }

    .input-area {
      padding: 0.75rem;
      gap: 0.5rem;
    }

    textarea {
      font-size: 16px; /* Prevents zoom on iOS */
      padding: 0.6rem 0.8rem;
    }

    .send-button {
      min-width: 56px;
      min-height: 48px;
      padding: 0 1rem;
    }

    .hint {
      font-size: 0.75rem;
      padding: 0 0.75rem 0.75rem 0.75rem;
    }

    /* Ensure touch targets are large enough */
    .copy-button,
    .auth-link,
    .clear-button {
      min-height: 48px;
      padding: 0.75rem 1rem;
    }
  }

  /* Extra small screens */
  @media (max-width: 375px) {
    .header-content {
      font-size: 0.9rem;
    }

    h3 {
      font-size: 0.95rem;
    }

    .device-code {
      font-size: 0.95rem;
      letter-spacing: 0.05em;
    }
  }
</style>
