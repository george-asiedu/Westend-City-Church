import { WifiOff } from 'lucide-react';

export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <WifiOff className="h-10 w-10 text-muted" />
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="max-w-sm text-sm text-muted">Check your connection. Uploads in progress will continue once you are back online.</p>
    </main>
  );
}
