import type { RunResult } from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

/**
 * The app's drizzle instance, a `createTestDb()` in tests, or a transaction
 * opened on either — so a helper can run inside or outside a transaction.
 */
export type Db = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;
