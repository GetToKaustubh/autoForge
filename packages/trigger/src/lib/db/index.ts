import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const client = postgres(process.env.DATABASE_URL!, {
  max: 5,
  idle_timeout: 30,
  prepare: false,   // Required for Supabase Transaction Pooler (port 6543)
})

export const db = drizzle(client, { schema })
