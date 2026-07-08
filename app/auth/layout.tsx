// Force all auth pages to be dynamic — they need runtime env vars for Supabase
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
