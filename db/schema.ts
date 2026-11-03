import { sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  body: text("body").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.id] }), index("notes_user_updated_idx").on(table.userId, table.updatedAt)]);

export const accounts = sqliteTable("accounts", {
  username: text("username").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("sessions_user_idx").on(table.userId)]);

export const insights = sqliteTable("insights", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  mode: text("mode").notNull(),
  title: text("title").notNull(),
  scope: text("scope").notNull(),
  noteCount: text("note_count").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [primaryKey({columns:[table.userId,table.id]}),index("insights_user_created_idx").on(table.userId,table.createdAt)]);
