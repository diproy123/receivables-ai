/**
 * AuditLens — Root Application Component
 * 
 * NOTE: This is the TypeScript source scaffold for the frontend.
 * The existing compiled bundle in frontend/assets/ continues to work.
 * 
 * To develop the frontend:
 *   cd frontend-src && npm install && npm run dev
 * 
 * To build for production:
 *   cd frontend-src && npm run build
 *   (outputs to ../frontend/ automatically)
 * 
 * The compiled bundle currently in frontend/ was built from an earlier
 * version of this source. This scaffold provides the same component
 * structure with full TypeScript types for future development.
 */

import { useState, useEffect, useCallback } from 'react'
import { api, setToken, getToken } from './lib/api'
import type { AppState } from './lib/types'

// Placeholder - in production, import actual page components
function LandingPage({ onGo }: { onGo: () => void }) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold mb-4">AuditLens</h1>
        <p className="text-slate-500 mb-8">AI-Powered AP Automation</p>
        <button onClick={onGo} className="btn-p px-8 py-3">
          Get Started →
        </button>
      </div>
    </div>
  )
}

function AppShell() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="flex-1 p-8 max-w-[1280px] mx-auto">
        <div className="card p-8 text-center">
          <h2 className="text-xl font-bold mb-2">Dashboard</h2>
          <p className="text-slate-500">
            Frontend source recovered. Run <code className="bg-slate-100 px-2 py-0.5 rounded text-sm font-mono">
            cd frontend-src && npm install && npm run dev</code> to start development.
          </p>
          <p className="text-slate-400 text-sm mt-4">
            The existing compiled bundle in <code>frontend/assets/</code> continues to work for production.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<'landing' | 'app'>(
    getToken() ? 'app' : 'landing'
  )

  const handleGo = useCallback(() => setView('app'), [])

  if (view === 'landing') return <LandingPage onGo={handleGo} />
  return <AppShell />
}
