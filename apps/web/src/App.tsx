import { useState, useRef, useEffect } from 'react';
import { useWallet } from './contexts/WalletContext';
import { walletConnectWallet } from './services/wallets/walletconnect/walletConnectClient';
import { Transaction } from '@hashgraph/sdk';
import { Buffer } from 'buffer';

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
  policy?: { allowed: boolean; reasons?: string[] };
};

type ProposalData = {
  proposalId: string;
  status: string;
  transactionBytes?: string;
  approvalSummary?: string;
  expiresAt?: string;
};

export default function App() {
  const { connected, address: accountId, connect, disconnect } = useWallet();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentQuote, setCurrentQuote] = useState<QuoteData | null>(null);
  const [currentProposal, setCurrentProposal] = useState<ProposalData | null>(null);
  const [healthStatus, setHealthStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Health check on mount
  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setHealthStatus('ok');
          addSystemMessage(`Backend connected — ${data.network} network, live quotes: ${data.liveQuotes}`);
        } else {
          setHealthStatus('error');
          addSystemMessage('Backend health check returned unexpected response.');
        }
      })
      .catch(() => {
        setHealthStatus('error');
        addSystemMessage('Cannot reach backend API. Make sure the server is running on port 3001.');
      });
  }, []);

  function addSystemMessage(content: string) {
    setMessages(prev => [...prev, { role: 'system', content, timestamp: new Date() }]);
  }

  function addAgentMessage(content: string) {
    setMessages(prev => [...prev, { role: 'agent', content, timestamp: new Date() }]);
  }

  const handleConnect = async () => {
    setLoading(true);
    try {
      await connect();
    } catch (err: any) {
      addSystemMessage(`Connection failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setCurrentQuote(null);
    setCurrentProposal(null);
    addSystemMessage('Disconnected.');
  };

  // Send chat message
  const handleSend = async () => {
    if (!input.trim() || !connected) return;
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

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        addAgentMessage(`Error: ${err.error || res.statusText}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      addAgentMessage(data.response || 'No response from agent.');

      // If agent detected a trade intent, automatically fetch a quote
      if (data.action?.type === 'quote_request') {
        addSystemMessage('Trade intent detected. Fetching quote...');
        await fetchQuote({
          tokenIn: data.action.tokenIn,
          tokenOut: data.action.tokenOut,
          amountIn: data.action.amountIn,
        });
      }
    } catch (err: any) {
      addAgentMessage(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch quote from backend
  const fetchQuote = async (params: { tokenIn: string; tokenOut: string; amountIn: string }) => {
    try {
      const res = await fetch(`${API}/api/trades/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, ...params })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addSystemMessage(`Quote request failed: ${err.error || res.statusText}`);
        return;
      }

      const rawQuote = await res.json();
      // Normalize: backend returns priceImpactBps (basis points), frontend uses priceImpact (decimal)
      const quote: QuoteData = {
        ...rawQuote,
        priceImpact: rawQuote.priceImpactBps != null ? rawQuote.priceImpactBps / 10000 : rawQuote.priceImpact,
      };
      setCurrentQuote(quote);

      if (quote.status === 'blocked') {
        addSystemMessage(`Quote BLOCKED by policy: ${quote.policy?.reasons?.join(', ') || 'Unknown reason'}`);
      } else {
        addSystemMessage(
          `Quote ready: ${quote.amountIn} ${quote.tokenIn} → ${quote.amountOut} ${quote.tokenOut}` +
          (quote.priceImpact != null ? ` (impact: ${(quote.priceImpact * 100).toFixed(2)}%)` : '')
        );
      }
    } catch (err: any) {
      addSystemMessage(`Quote fetch error: ${err.message}`);
    }
  };

  // Manual quote (allow user to type a quote directly)
  const handleManualQuote = async (tokenIn: string, tokenOut: string, amountIn: string) => {
    setLoading(true);
    await fetchQuote({ tokenIn, tokenOut, amountIn });
    setLoading(false);
  };

  // Propose trade (get transaction bytes)
  const handlePropose = async () => {
    if (!currentQuote || !accountId) return;
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/trades/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, quoteId: currentQuote.id })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        addSystemMessage(`Proposal failed: ${data.error || res.statusText}`);
        if (data.policy) {
          addSystemMessage(`Policy: ${JSON.stringify(data.policy)}`);
        }
        setLoading(false);
        return;
      }

      setCurrentProposal(data);
      addSystemMessage(
        `Proposal created: ${data.proposalId}\n` +
        `Summary: ${data.approvalSummary || 'N/A'}\n` +
        `Expires: ${data.expiresAt || 'N/A'}\n` +
        `Transaction bytes ready for wallet signing.`
      );
    } catch (err: any) {
      addSystemMessage(`Proposal error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Complete trade (simulate wallet signing for demo)
  const handleComplete = async (action: 'submitted' | 'wallet_rejected') => {
    if (!currentProposal) return;
    setLoading(true);

    try {
      let finalTransactionId = undefined;

      if (action === 'submitted') {
        if (!currentProposal.transactionBytes) {
           throw new Error("No transaction bytes provided in the proposal.");
        }
        
        // Deserialize the transaction from bytes
        addSystemMessage("Please confirm the transaction in your wallet...");
        const txBytes = Buffer.from(currentProposal.transactionBytes, 'base64');
        const transaction = Transaction.fromBytes(txBytes);
        
        // Send the transaction using WalletConnect
        const txId = await walletConnectWallet.sendTransaction(transaction);
        if (!txId) {
           throw new Error("Transaction failed or was rejected by wallet");
        }
        finalTransactionId = txId;
      }

      const res = await fetch(`${API}/api/trades/${currentProposal.proposalId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action,
          transactionId: finalTransactionId
        })
      });

      const data = await res.json();
      addSystemMessage(
        action === 'submitted'
          ? `Transaction submitted! Status: ${data.status}. Transaction ID: ${data.transactionId}`
          : `Transaction rejected. Status: ${data.status}`
      );
      setCurrentQuote(null);
      setCurrentProposal(null);
    } catch (err: any) {
      addSystemMessage(`Completion error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Check proposal status
  const handleCheckStatus = async () => {
    if (!currentProposal) return;
    try {
      const res = await fetch(`${API}/api/trades/${currentProposal.proposalId}/status`);
      const data = await res.json();
      addSystemMessage(`Proposal status: ${data.status}${data.transactionId ? ` (TX: ${data.transactionId})` : ''}`);
    } catch (err: any) {
      addSystemMessage(`Status check error: ${err.message}`);
    }
  };

  // View audit log
  const handleViewAudit = async () => {
    try {
      const res = await fetch(`${API}/api/audit/events?limit=10`);
      const data = await res.json();
      if (data.events?.length > 0) {
        const lines = data.events.map((e: any) => `[${e.type}] ${e.message} (${e.createdAt})`);
        addSystemMessage(`Recent audit events:\n${lines.join('\n')}`);
      } else {
        addSystemMessage('No audit events yet.');
      }
    } catch (err: any) {
      addSystemMessage(`Audit fetch error: ${err.message}`);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Hedera Trading Agent</h1>
          <span className={`status-dot ${healthStatus}`} />
          <span className="network-badge">{NETWORK}</span>
        </div>
        <div className="header-right">
          {connected && (
            <button className="btn btn-small btn-outline" onClick={handleViewAudit}>
              Audit Log
            </button>
          )}
        </div>
      </header>

      {!connected ? (
        <div className="connect-panel">
          <h2>Connect Your Wallet</h2>
          <p>Connect your Hashpack wallet to interact with the trading agent.</p>
          <div className="connect-form">
            <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
              {loading ? 'Connecting...' : 'Connect HashPack'}
            </button>
          </div>
        </div>
      ) : (
        <div className="main-layout">
          <div className="sidebar">
            <div className="account-info">
              <span className="label">Account</span>
              <span className="value">{accountId}</span>
              <button className="btn btn-small btn-ghost" onClick={handleDisconnect}>Disconnect</button>
            </div>

            <div className="quick-actions">
              <h3>Quick Trades</h3>
              <button className="btn btn-small btn-outline" onClick={() => handleManualQuote('HBAR', 'SAUCE', '10')} disabled={loading}>
                Swap 10 HBAR → SAUCE
              </button>
              <button className="btn btn-small btn-outline" onClick={() => handleManualQuote('HBAR', 'XSAUCE', '5')} disabled={loading}>
                Swap 5 HBAR → XSAUCE
              </button>
              <button className="btn btn-small btn-outline" onClick={() => handleManualQuote('SAUCE', 'HBAR', '100')} disabled={loading}>
                Swap 100 SAUCE → HBAR
              </button>
            </div>

            {currentQuote && currentQuote.status !== 'blocked' && (
              <div className="quote-panel">
                <h3>Active Quote</h3>
                <div className="quote-detail">
                  <span>{currentQuote.amountIn} {currentQuote.tokenIn}</span>
                  <span className="arrow">→</span>
                  <span>{currentQuote.amountOut} {currentQuote.tokenOut}</span>
                </div>
                {currentQuote.priceImpact != null && (
                  <div className="quote-impact">
                    Impact: {(currentQuote.priceImpact * 100).toFixed(2)}%
                  </div>
                )}
                {!currentProposal ? (
                  <div className="quote-actions">
                    <button className="btn btn-primary" onClick={handlePropose} disabled={loading}>
                      {loading ? 'Creating...' : 'Create Proposal'}
                    </button>
                    <button className="btn btn-small btn-ghost" onClick={() => setCurrentQuote(null)}>
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <div className="proposal-actions">
                    <p className="proposal-summary">{currentProposal.approvalSummary}</p>
                    <button className="btn btn-primary" onClick={() => handleComplete('submitted')} disabled={loading}>
                      ✓ Sign & Submit
                    </button>
                    <button className="btn btn-small btn-danger" onClick={() => handleComplete('wallet_rejected')} disabled={loading}>
                      ✗ Reject
                    </button>
                    <button className="btn btn-small btn-ghost" onClick={handleCheckStatus}>
                      Check Status
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="chat-section">
            <div className="chat-box">
              {messages.length === 0 && (
                <div className="empty-chat">
                  <p>Start by typing a trade command like:</p>
                  <code>"swap 10 HBAR for SAUCE"</code>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`message message-${m.role}`}>
                  <div className="message-header">
                    <span className="message-role">
                      {m.role === 'user' ? 'You' : m.role === 'agent' ? 'Agent' : 'System'}
                    </span>
                    <span className="message-time">
                      {m.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="message-body">{m.content}</div>
                </div>
              ))}
              {loading && (
                <div className="message message-system">
                  <div className="message-body loading-dots">Processing</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="input-bar">
              <input
                type="text"
                placeholder="e.g. swap 10 HBAR for SAUCE"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={loading}
              />
              <button className="btn btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
