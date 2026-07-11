import { OrganizationList } from '@clerk/nextjs'

export default function SelectOrgPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted">
      <div className="flex flex-col items-center gap-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">TubeForge</h1>
          <p className="text-muted-foreground">Select or create your workspace</p>
        </div>
        <OrganizationList
          hidePersonal
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
        />
      </div>
    </div>
  )
}
