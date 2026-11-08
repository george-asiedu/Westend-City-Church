export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 safe-top">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={56} height={56} />
          <div>
            <p className="text-lg font-semibold">WCC Media</p>
            <p className="text-sm text-muted">The Life Cathedral</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
