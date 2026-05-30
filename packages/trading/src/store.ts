import type { AuditEventRecord, TradeProposal, TradeQuote, TradingStore } from "./types";

export class InMemoryTradingStore implements TradingStore {
  private readonly quotes = new Map<string, TradeQuote>();
  private readonly proposals = new Map<string, TradeProposal>();
  private readonly auditEvents: AuditEventRecord[] = [];

  async saveQuote(quote: TradeQuote): Promise<void> {
    this.quotes.set(quote.id, quote);
  }

  async getQuote(id: string): Promise<TradeQuote | undefined> {
    return this.quotes.get(id);
  }

  async saveProposal(proposal: TradeProposal): Promise<void> {
    this.proposals.set(proposal.id, proposal);
  }

  async getProposal(id: string): Promise<TradeProposal | undefined> {
    return this.proposals.get(id);
  }

  async updateProposal(id: string, patch: Partial<TradeProposal>): Promise<TradeProposal | undefined> {
    const existing = this.proposals.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.proposals.set(id, updated);
    return updated;
  }

  async addAuditEvent(event: AuditEventRecord): Promise<void> {
    this.auditEvents.unshift(event);
  }

  async listAuditEvents(limit: number): Promise<AuditEventRecord[]> {
    return this.auditEvents.slice(0, limit);
  }
}
