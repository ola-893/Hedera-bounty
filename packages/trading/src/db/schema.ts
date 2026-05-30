import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const quotes = sqliteTable("quotes", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  accountId: text("account_id").notNull(),
  quoteHash: text("quote_hash").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull()
});

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  quoteId: text("quote_id").notNull(),
  status: text("status").notNull(),
  accountId: text("account_id").notNull(),
  transactionId: text("transaction_id"),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull()
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  accountId: text("account_id"),
  quoteId: text("quote_id"),
  proposalId: text("proposal_id"),
  message: text("message").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
  sequence: integer("sequence").notNull()
});
