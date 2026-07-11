import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Supabase connection via connection pooler (PgBouncer) — prevents exhaustion on serverless
const connectionString = process.env.DATABASE_URL!

// In serverless environments, disable connection pooling at the postgres.js level
// (PgBouncer on Supabase handles this instead)
const client = postgres(connectionString, {
  max: 1,           // Single connection per serverless invocation
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(client, { schema })

export type Database = typeof db

// Convenience type exports from schema
export type {
  InferSelectModel,
  InferInsertModel,
} from 'drizzle-orm'
