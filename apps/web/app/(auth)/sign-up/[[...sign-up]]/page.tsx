import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted">
      <div className="flex flex-col items-center gap-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">TubeForge</h1>
          <p className="text-muted-foreground">Create your account to get started</p>
        </div>
        <SignUp />
      </div>
    </div>
  )
}
