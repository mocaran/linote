import { sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  body: text("body").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.id] }), index("notes_user_updated_idx").on(table.userId, table.updatedAt)]);
