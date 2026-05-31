import { useEffect, useMemo, useRef, useState } from 'react';
import { Transaction } from '@hiero-ledger/sdk';
import { useWallet } from './contexts/WalletContext';
import { walletConnectWallet } from './services/wallets/walletconnect/walletConnectClient';

const API = '';
const NETWORK = import.meta.env.VITE_NETWORK || 'testnet';

type Message = {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
};

type QuoteData = {
  id: string;
  status: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact?: number;
  priceImpactBps?: number;
  quoteHash?: string;
  expiresAt?: string;
  source?: string;
  slippageBps?: number;
  policy?: { allowed: boolean; reasons?: string[]; warnings?: string[] };
};

type ProposalData = {
  proposalId: string;
  quoteId?: string;
  status: string;
  transactionBytes?: string;
  approvalSummary?: string;
  expiresAt?: string;
  quoteHash?: string;
};

type PortfolioToken = {
  tokenId: string;
  symbol: string;
  name?: string;
  balance: string;
  decimals: number;
};

type Portfolio = {
  accountId: string;
  hbarBalance: string;
  tokens: PortfolioToken[];
  recentTransactions: Array<{
    transactionId: string;
    consensusTimestamp?: string;
    result?: string;
    type?: string;
  }>;
};

type AuditEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  accountId?: string;
  quoteId?: string;
  proposalId?: string;
};

type Health = {
  ok: boolean;
  network: string;
  mainnetEnabled: boolean;
  liveQuotes: boolean;
};

type TradePreset = {
  label: string;
  detail: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
};

const TRADE_PRESETS: TradePreset[] = [
  { label: 'HBAR to SAUCE', detail: '10 HBAR', tokenIn: 'HBAR', tokenOut: 'SAUCE', amountIn: '10' },
  { label: 'HBAR to XSAUCE', detail: '5 HBAR', tokenIn: 'HBAR', tokenOut: 'XSAUCE', amountIn: '5' },
  { label: 'SAUCE to HBAR', detail: '100 SAUCE', tokenIn: 'SAUCE', tokenOut: 'HBAR', amountIn: '100' },
];

export default function App() {
  const { connected, address: accountId, balance, connect, disconnect } = useWallet();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentQuote, setCurrentQuote] = useState<QuoteData | null>(null);
  const [currentProposal, setCurrentProposal] = useState<ProposalData | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthStatus, setHealthStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const quoteAllowed = currentQuote?.status === 'quoted' && currentQuote.policy?.allowed !== false;
  const quoteBlocked = currentQuote?.status === 'blocked' || currentQuote?.policy?.allowed === false;
  const policyReasons = currentQuote?.policy?.reasons ?? [];
  const policyWarnings = currentQuote?.policy?.warnings ?? [];

  const tradeStage = useMemo(() => {
    if (currentProposal) return 'Wallet approval';
    if (quoteBlocked) return 'Policy review';
    if (quoteAllowed) return 'Quote ready';
    return 'Awaiting intent';
  }, [currentProposal, quoteAllowed, quoteBlocked]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    void refreshHealth();
  }, []);

  useEffect(() => {
    if (!connected || !accountId) {
      setPortfolio(null);
      return;
    }

    void refreshPortfolio(accountId);
    void refreshAudit();
  }, [connected, accountId]);

  function addMessage(role: Message['role'], content: string) {
    setMessages(prev => [...prev, { role, content, timestamp: new Date() }]);
  }

  async function refreshHealth() {
    setHealthStatus('checking');

    try {
      const res = await fetch(`${API}/api/health`);
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data?.message || 'Unexpected health response');
      }

      setHealth(data);
      setHealthStatus('ok');
      addMessage('system', `Backend connected on ${data.network}. Live quotes: ${data.liveQuotes ? 'on' : 'demo/fallback'}.`);
    } catch {
      setHealth(null);
      setHealthStatus('error');
      addMessage('system', 'Backend is offline. Start the API on port 3001 to request quotes.');
    }
  }

  async function refreshPortfolio(nextAccountId: string) {
    try {
      const res = await fetch(`${API}/api/portfolio/${nextAccountId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || res.statusText);
      }

      setPortfolio(data);
    } catch {
      setPortfolio(null);
    }
  }

  async function refreshAudit() {
    try {
      const res = await fetch(`${API}/api/audit/events?limit=8`);
      const data = await res.json();
      setAuditEvents(data.events ?? []);
    } catch {
      setAuditEvents([]);
    }
  }

  async function handleConnect() {
    setLoading(true);
    setConnectionError(null);

    try {
      await connect();
    } catch (err) {
      const message = getErrorMessage(err);
      setConnectionError(message);
      addMessage('system', `Connection failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleDisconnect() {
    disconnect();
    setCurrentQuote(null);
    setCurrentProposal(null);
    setAuditEvents([]);
    setConnectionError(null);
    addMessage('system', 'Wallet disconnected.');
  }

  async function handleSend() {
    if (!input.trim() || !connected || !accountId) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date() }]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, message: userMsg })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        addMessage('agent', `Error: ${data.error || res.statusText}`);
        return;
      }

      addMessage('agent', data.response || 'No response from agent.');

      if (data.action?.type === 'quote_request') {
        addMessage('system', 'Trade intent parsed. Requesting a policy-checked quote.');
        await fetchQuote({
          tokenIn: data.action.tokenIn,
          tokenOut: data.action.tokenOut,
          amountIn: data.action.amountIn,
        });
      }
    } catch (err) {
      addMessage('agent', `Network error: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
      void refreshAudit();
    }
  }

  async function fetchQuote(params: { tokenIn: string; tokenOut: string; amountIn: string }) {
    if (!accountId) return;

    try {
      setCurrentProposal(null);
      const res = await fetch(`${API}/api/trades/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, ...params })
      });

      const rawQuote = await res.json().catch(() => ({}));

      if (!res.ok) {
        addMessage('system', `Quote request failed: ${rawQuote.error || res.statusText}`);
        return;
      }

      const quote: QuoteData = {
        ...rawQuote,
        priceImpact: rawQuote.priceImpactBps != null ? rawQuote.priceImpactBps / 10000 : rawQuote.priceImpact,
      };

      setCurrentQuote(quote);

      if (quote.status === 'blocked') {
        addMessage('system', `Quote blocked by policy: ${quote.policy?.reasons?.join(', ') || 'Unknown reason'}`);
      } else {
        addMessage('system', `Quote ready: ${quote.amountIn} ${quote.tokenIn} -> ${quote.amountOut} ${quote.tokenOut}.`);
      }
    } catch (err) {
      addMessage('system', `Quote fetch error: ${getErrorMessage(err)}`);
    } finally {
      void refreshAudit();
    }
  }

  async function handleManualQuote(preset: TradePreset) {
    setLoading(true);
    await fetchQuote({
      tokenIn: preset.tokenIn,
      tokenOut: preset.tokenOut,
      amountIn: preset.amountIn,
    });
    setLoading(false);
  }

  async function handlePropose() {
    if (!currentQuote || !accountId) return;
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/trades/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, quoteId: currentQuote.id })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        addMessage('system', `Proposal failed: ${data.error || res.statusText}`);
        if (data.policy?.reasons?.length) {
          addMessage('system', `Policy: ${data.policy.reasons.join(', ')}`);
        }
        return;
      }

      setCurrentProposal(data);
      addMessage('system', `Proposal created. Transaction bytes are ready for wallet approval.`);
    } catch (err) {
      addMessage('system', `Proposal error: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
      void refreshAudit();
    }
  }

  async function handleComplete(action: 'submitted' | 'wallet_rejected') {
    if (!currentProposal) return;
    setLoading(true);

    try {
      let finalTransactionId: string | undefined;

      if (action === 'submitted') {
        if (!currentProposal.transactionBytes) {
          throw new Error('No transaction bytes provided in the proposal.');
        }

        addMessage('system', 'Waiting for wallet confirmation.');
        const txBytes = decodeBase64Bytes(currentProposal.transactionBytes);
        const transaction = Transaction.fromBytes(txBytes);
        let txId: string | null;
        try {
          txId = await walletConnectWallet.sendTransaction(transaction);
        } catch (walletErr) {
          const failureReason = getErrorMessage(walletErr);
          const failedStatus = /reject/i.test(failureReason) ? 'wallet_rejected' : 'failed';
          const failedTxId = extractTransactionId(failureReason);
          const data = await postTradeCompletion(currentProposal.proposalId, failedStatus, failedTxId, failureReason);

          addMessage(
            'system',
            failedStatus === 'wallet_rejected'
              ? `Wallet rejected the proposal. Status: ${data.status ?? failedStatus}`
              : `Wallet/network execution failed. Status: ${data.status ?? failedStatus}. ${failureReason}`
          );

          if (failedStatus === 'wallet_rejected') {
            setCurrentQuote(null);
            setCurrentProposal(null);
          } else {
            setCurrentProposal(prev => prev ? { ...prev, status: 'failed' } : prev);
          }
          return;
        }

        if (!txId) {
          throw new Error('Transaction failed or was rejected by wallet.');
        }

        finalTransactionId = txId;
      }

      const data = await postTradeCompletion(currentProposal.proposalId, action, finalTransactionId);

      addMessage(
        'system',
        action === 'submitted'
          ? `Transaction submitted. Status: ${data.status}. Transaction ID: ${data.transactionId}`
          : `Wallet rejected the proposal. Status: ${data.status}`
      );

      setCurrentQuote(null);
      setCurrentProposal(null);
    } catch (err) {
      addMessage('system', `Completion error: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
      void refreshAudit();
      if (accountId) void refreshPortfolio(accountId);
    }
  }

  async function postTradeCompletion(
    proposalId: string,
    status: 'submitted' | 'wallet_rejected' | 'failed',
    transactionId?: string,
    failureReason?: string
  ) {
    const res = await fetch(`${API}/api/trades/${proposalId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, transactionId, failureReason })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || res.statusText);
    }
    return data;
  }

  async function handleCheckStatus() {
    if (!currentProposal) return;
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/trades/${currentProposal.proposalId}/status`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }

      setCurrentProposal(prev => prev ? { ...prev, status: data.status } : prev);
      addMessage('system', `Proposal status: ${data.status}${data.transactionId ? ` (${data.transactionId})` : ''}`);
    } catch (err) {
      addMessage('system', `Status check error: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
      void refreshAudit();
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <div>
            <p className="eyebrow">Hedera AI Agent</p>
            <h1>Guarded Trading Desk</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <div className={`health-pill health-${healthStatus}`}>
            <span className="status-dot" />
            {healthStatus === 'ok' ? 'API online' : healthStatus === 'checking' ? 'Checking API' : 'API offline'}
          </div>
          <div className="network-badge">{health?.network ?? NETWORK}</div>
          {connected && (
            <button className="btn btn-secondary btn-compact" onClick={refreshAudit}>
              Refresh audit
            </button>
          )}
        </div>
      </header>

      {!connected ? (
        <main className="connect-view">
          <section className="landing-shell">
            <div className="launch-copy">
              <p className="eyebrow">Hedera testnet desk</p>
              <h2>Policy-checked trading, signed by your HashPack wallet.</h2>
              <p>
                Connect a testnet account, describe the swap you want, and let the agent prepare
                a guarded proposal before your wallet signs anything.
              </p>
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
                  {loading ? 'Connecting...' : 'Connect HashPack'}
                </button>
                <button className="btn btn-secondary" onClick={refreshHealth} disabled={healthStatus === 'checking'}>
                  Check API
                </button>
              </div>
              {connectionError && (
                <div className="connect-error" role="alert">
                  {connectionError}
                </div>
              )}
              <div className="landing-stats" aria-label="Connection status">
                <div>
                  <span>Network</span>
                  <strong>{health?.network ?? NETWORK}</strong>
                </div>
                <div>
                  <span>Quotes</span>
                  <strong>{health?.liveQuotes ? 'Live' : 'Demo'}</strong>
                </div>
                <div>
                  <span>Signing</span>
                  <strong>Wallet only</strong>
                </div>
              </div>
            </div>

            <div className="agent-visual" aria-label="Agent activity preview">
              <div className="agent-grid">
                <div className="agent-core" aria-hidden="true">
                  <span className="core-ring ring-one" />
                  <span className="core-ring ring-two" />
                  <strong>AI</strong>
                </div>
                <div className="agent-node node-intent">Intent</div>
                <div className="agent-node node-policy">Policy</div>
                <div className="agent-node node-quote">Quote</div>
                <div className="agent-node node-wallet">Wallet</div>
                <span className="signal signal-one" />
                <span className="signal signal-two" />
                <span className="signal signal-three" />
              </div>
              <div className="agent-feed">
                <div><span>01</span> Parse "swap 10 HBAR to SAUCE"</div>
                <div><span>02</span> Check recipient, slippage, and quote age</div>
                <div><span>03</span> Prepare testnet transaction bytes</div>
                <div><span>04</span> Wait for HashPack approval</div>
              </div>
            </div>
          </section>

          <section className="assurance-strip" aria-label="Safety controls">
            <div>
              <span>01</span>
              <strong>No custody</strong>
              <p>Private keys stay in the wallet. The backend never signs or moves funds.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Policy first</strong>
              <p>Allowed assets, slippage, quote freshness, and recipient checks gate proposals.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Audit ready</strong>
              <p>Intent, quote, block, proposal, and submission events are recorded for review.</p>
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="wallet-column">
            <section className="panel wallet-panel">
              <div className="panel-heading">
                <p className="eyebrow">Connected wallet</p>
                <button className="icon-button" onClick={handleDisconnect} aria-label="Disconnect wallet" title="Disconnect">
                  ×
                </button>
              </div>
              <strong className="account-id">{accountId}</strong>
              <div className="balance-row">
                <span>HBAR balance</span>
                <strong>{portfolio?.hbarBalance ?? balance ?? '--'}</strong>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <p className="eyebrow">Portfolio</p>
                {accountId && (
                  <button className="icon-button" onClick={() => refreshPortfolio(accountId)} aria-label="Refresh portfolio" title="Refresh">
                    ↻
                  </button>
                )}
              </div>
              <div className="token-list">
                {(portfolio?.tokens ?? []).slice(0, 5).map(token => (
                  <div className="token-row" key={token.tokenId}>
                    <div>
                      <strong>{token.symbol}</strong>
                      <span>{token.name || token.tokenId}</span>
                    </div>
                    <em>{formatAmount(token.balance)}</em>
                  </div>
                ))}
                {!portfolio?.tokens?.length && (
                  <div className="empty-state">No token balances loaded.</div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <p className="eyebrow">Quick quotes</p>
              </div>
              <div className="preset-list">
                {TRADE_PRESETS.map(preset => (
                  <button
                    className="preset-button"
                    key={`${preset.tokenIn}-${preset.tokenOut}-${preset.amountIn}`}
                    onClick={() => handleManualQuote(preset)}
                    disabled={loading}
                  >
                    <span>{preset.label}</span>
                    <strong>{preset.detail}</strong>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="chat-panel">
            <div className="chat-header">
              <div>
                <p className="eyebrow">Intent console</p>
                <h2>Agent conversation</h2>
              </div>
              <div className="stage-pill">{tradeStage}</div>
            </div>

            <div className="chat-scroll">
              {messages.length === 0 && (
                <div className="conversation-empty">
                  <span>Ready</span>
                  <strong>swap 10 HBAR for SAUCE</strong>
                </div>
              )}

              {messages.map((message, index) => (
                <article className={`message message-${message.role}`} key={`${message.timestamp.toISOString()}-${index}`}>
                  <div className="message-meta">
                    <span>{message.role === 'user' ? 'You' : message.role === 'agent' ? 'Agent' : 'System'}</span>
                    <time>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                  <p>{message.content}</p>
                </article>
              ))}

              {loading && (
                <article className="message message-system">
                  <div className="message-meta">
                    <span>System</span>
                    <time>now</time>
                  </div>
                  <p className="loading-dots">Processing</p>
                </article>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="composer">
              <input
                type="text"
                placeholder="Ask for a quote"
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && !event.shiftKey && handleSend()}
                disabled={loading}
              />
              <button className="btn btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
                Send
              </button>
            </div>
          </section>

          <aside className="trade-column">
            <section className="panel trade-ticket">
              <div className="panel-heading">
                <p className="eyebrow">Trade ticket</p>
                <span className={`ticket-status ${quoteBlocked ? 'blocked' : quoteAllowed ? 'ready' : ''}`}>
                  {tradeStage}
                </span>
              </div>

              {!currentQuote ? (
                <div className="quote-empty">
                  <strong>No active quote</strong>
                  <span>Quotes appear here after chat intent or quick quote selection.</span>
                </div>
              ) : (
                <>
                  <div className="swap-card">
                    <div>
                      <span>Pay</span>
                      <strong>{formatAmount(currentQuote.amountIn)} {currentQuote.tokenIn}</strong>
                    </div>
                    <div className="swap-divider">to</div>
                    <div>
                      <span>Receive</span>
                      <strong>{formatAmount(currentQuote.amountOut)} {currentQuote.tokenOut}</strong>
                    </div>
                  </div>

                  <div className="metric-grid">
                    <div>
                      <span>Impact</span>
                      <strong>{currentQuote.priceImpact != null ? `${(currentQuote.priceImpact * 100).toFixed(2)}%` : '--'}</strong>
                    </div>
                    <div>
                      <span>Slippage</span>
                      <strong>{currentQuote.slippageBps != null ? `${currentQuote.slippageBps} bps` : '--'}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>{currentQuote.source ?? 'quote provider'}</strong>
                    </div>
                    <div>
                      <span>Expires</span>
                      <strong>{formatTime(currentQuote.expiresAt)}</strong>
                    </div>
                  </div>

                  {(policyReasons.length > 0 || policyWarnings.length > 0) && (
                    <div className={`policy-box ${quoteBlocked ? 'policy-blocked' : ''}`}>
                      {[...policyReasons, ...policyWarnings].map(item => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  )}

                  {!currentProposal ? (
                    <div className="action-stack">
                      <button className="btn btn-primary" onClick={handlePropose} disabled={loading || !quoteAllowed}>
                        Create proposal
                      </button>
                      <button className="btn btn-secondary" onClick={() => setCurrentQuote(null)}>
                        Dismiss quote
                      </button>
                    </div>
                  ) : (
                    <div className="proposal-box">
                      <div>
                        <span>Proposal</span>
                        <strong>{currentProposal.proposalId}</strong>
                      </div>
                      <p>{currentProposal.approvalSummary}</p>
                      <div className="action-stack">
                        <button className="btn btn-primary" onClick={() => handleComplete('submitted')} disabled={loading}>
                          Sign and submit
                        </button>
                        <button className="btn btn-secondary" onClick={handleCheckStatus} disabled={loading}>
                          Check status
                        </button>
                        <button className="btn btn-danger" onClick={() => handleComplete('wallet_rejected')} disabled={loading}>
                          Reject proposal
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="panel audit-panel">
              <div className="panel-heading">
                <p className="eyebrow">Audit trail</p>
                <button className="icon-button" onClick={refreshAudit} aria-label="Refresh audit trail" title="Refresh">
                  ↻
                </button>
              </div>
              <div className="audit-list">
                {auditEvents.map(event => (
                  <div className="audit-item" key={event.id}>
                    <span>{event.type.replace(/_/g, ' ')}</span>
                    <strong>{event.message}</strong>
                    <time>{formatDateTime(event.createdAt)}</time>
                  </div>
                ))}
                {!auditEvents.length && (
                  <div className="empty-state">No audit events yet.</div>
                )}
              </div>
            </section>
          </aside>
        </main>
      )}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function extractTransactionId(message: string): string | undefined {
  return message.match(/\d+\.\d+\.\d+@\d+\.\d+/)?.[0];
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function formatAmount(value: string | undefined): string {
  if (!value) return '--';

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (numeric === 0) return '0';
  if (numeric < 0.000001) return numeric.toExponential(2);
  if (numeric < 1) return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (numeric < 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 4 });

  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTime(value: string | undefined): string {
  if (!value) return '--';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
