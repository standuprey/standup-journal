import { ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const isAuthed = localStorage.getItem('sj-password') !== null && localStorage.getItem('sj-password') !== '';

  if (isAuthed) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-100">
      <div className="bg-zinc-800 p-8 rounded-lg shadow-lg w-80 text-center">
        <LockKeyhole className="w-12 h-12 mx-auto mb-4 text-indigo-500" />
        <label className="block mb-4 text-sm font-medium">Password</label>
        <input
          type="password"
          className="w-full p-2 border border-zinc-600 rounded mb-4 bg-zinc-900 text-zinc-100"
          placeholder="Enter password"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded transition"
          onClick={() => {
            const pw = (document.querySelector('input[type="password"]:focus') as HTMLInputElement)?.value;
            if (pw) {
              // Optimistically save
              localStorage.setItem('sj-password', pw);
              // Fetch list
              api.list().then(() => {
                // If success, render children
              }).catch(() => {
                // If failure, show error
                alert('Wrong password');
                localStorage.removeItem('sj-password');
              });
            }
          }}
        >
          Unlock
        </button>
      </div>
    </div>
  );
}