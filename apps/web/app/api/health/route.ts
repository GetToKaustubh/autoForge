import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`)
    return NextResponse.json({ db: 'ok', url: process.env.DATABASE_URL?.slice(0, 50) })
  } catch (e) {
    const err = e as Error
    return NextResponse.json(
      { db: 'error', message: err.message, url: process.env.DATABASE_URL?.slice(0, 50) },
      { status: 500 }
    )
  }
}
