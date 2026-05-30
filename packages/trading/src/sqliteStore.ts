import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { AuditEventRecord, TradeProposal, TradeQuote, TradingStore } from "./types";
import type { Client } from "@hiero-ledger/sdk";
import { submitHcsMessage } from "../../hedera/src/hcs";

export interface SqliteTradingStoreOptions {
  client?: Client;
  hcsAuditTopicId?: string;
}

export class SqliteTradingStore implements TradingStore {
  private readonly db: Database.Database;

  constructor(path: string, private readonly options: SqliteTradingStoreOptions = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.init();
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        account_id TEXT NOT NULL,
        quote_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL,
        status TEXT NOT NULL,
        account_id TEXT NOT NULL,
        transaction_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        account_id TEXT,
        quote_id TEXT,
        proposal_id TEXT,
        message TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sequence INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quotes_account_id ON quotes(account_id);
      CREATE INDEX IF NOT EXISTS idx_proposals_account_id ON proposals(account_id);
      CREATE INDEX IF NOT EXISTS idx_audit_events_sequence ON audit_events(sequence DESC);
    `);
  }

  async saveQuote(quote: TradeQuote): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO quotes (id, status, account_id, quote_hash, payload, created_at, expires_at)
      VALUES (@id, @status, @accountId, @quoteHash, @payload, @createdAt, @expiresAt)
    `).run({
      id: quote.id,
      status: quote.status,
      accountId: quote.accountId,
      quoteHash: quote.quoteHash,
      payload: JSON.stringify(quote),
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt
    });
  }

  async getQuote(id: string): Promise<TradeQuote | undefined> {
    const row = this.db.prepare("SELECT payload FROM quotes WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as TradeQuote : undefined;
  }

  async saveProposal(proposal: TradeProposal): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO proposals (id, quote_id, status, account_id, transaction_id, payload, created_at, expires_at)
      VALUES (@id, @quoteId, @status, @accountId, @transactionId, @payload, @createdAt, @expiresAt)
    `).run({
      id: proposal.id,
      quoteId: proposal.quoteId,
      status: proposal.status,
      accountId: proposal.accountId,
      transactionId: proposal.transactionId ?? null,
      payload: JSON.stringify(proposal),
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt
    });
  }

  async getProposal(id: string): Promise<TradeProposal | undefined> {
    const row = this.db.prepare("SELECT payload FROM proposals WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as TradeProposal : undefined;
  }

  async updateProposal(id: string, patch: Partial<TradeProposal>): Promise<TradeProposal | undefined> {
    const existing = await this.getProposal(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    await this.saveProposal(updated);
    return updated;
  }

  async addAuditEvent(event: AuditEventRecord): Promise<void> {
    const nextSequence = ((this.db.prepare("SELECT MAX(sequence) AS seq FROM audit_events").get() as { seq: number | null }).seq ?? 0) + 1;
    this.db.prepare(`
      INSERT INTO audit_events (id, type, account_id, quote_id, proposal_id, message, data, created_at, sequence)
      VALUES (@id, @type, @accountId, @quoteId, @proposalId, @message, @data, @createdAt, @sequence)
    `).run({
      id: event.id,
      type: event.type,
      accountId: event.accountId ?? null,
      quoteId: event.quoteId ?? null,
      proposalId: event.proposalId ?? null,
      message: event.message,
      data: JSON.stringify(event.data),
      createdAt: event.createdAt,
      sequence: nextSequence
    });

    if (this.options.client && this.options.hcsAuditTopicId) {
      // Dispatch to HCS asynchronously to avoid blocking the API response
      submitHcsMessage(this.options.hcsAuditTopicId, {
        event: event.type,
        reason: event.message,
        ...event.data,
        ts: event.createdAt
      }, this.options.client).catch((err) => {
        console.error(`[Audit] Failed to submit to HCS Topic ${this.options.hcsAuditTopicId}:`, err);
      });
    }
  }

  async listAuditEvents(limit: number): Promise<AuditEventRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM audit_events ORDER BY sequence DESC LIMIT ?")
      .all(limit) as Array<{
        id: string;
        type: string;
        account_id: string | null;
        quote_id: string | null;
        proposal_id: string | null;
        message: string;
        data: string;
        created_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at,
      data: JSON.parse(row.data),
      ...(row.account_id ? { accountId: row.account_id } : {}),
      ...(row.quote_id ? { quoteId: row.quote_id } : {}),
      ...(row.proposal_id ? { proposalId: row.proposal_id } : {})
    }));
  }
}
