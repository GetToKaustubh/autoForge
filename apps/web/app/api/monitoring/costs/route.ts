import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiUsage, auditLogs } from '@/lib/db/schema'
import { and, eq, gte, desc, sql } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember } from '@/lib/auth/get-member'
import { subDays, format } from 'date-fns'

export async function GET(request: Request) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '30'), 90)
  const since = format(subDays(new Date(), days), "yyyy-MM-dd'T'HH:mm:ssxxx")

  // Aggregate cost by service
  const byCost = await db
    .select({
      service: apiUsage.service,
      totalCostUsd: sql<string>`sum(${apiUsage.costUsd})`,
      totalUnits: sql<string>`sum(${apiUsage.unitsUsed})`,
      callCount: sql<number>`count(*)::int`,
    })
    .from(apiUsage)
    .where(and(eq(apiUsage.organizationId, member.orgDbId), gte(apiUsage.recordedAt, new Date(since))))
    .groupBy(apiUsage.service)
    .orderBy(sql`sum(${apiUsage.costUsd}) desc nulls last`)

  // Recent audit log
  const logs = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, member.orgDbId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(20)

  const totalCost = byCost.reduce((s, r) => s + parseFloat(r.totalCostUsd ?? '0'), 0)

  const services = byCost.map((r) => ({
    service: r.service,
    costUsd: parseFloat(r.totalCostUsd ?? '0'),
    units: parseFloat(r.totalUnits ?? '0'),
    callCount: r.callCount,
  }))

  return NextResponse.json({ services, totalCost, logs, days })
}
