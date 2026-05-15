import { ClockWidget } from '../components/ClockWidget'
import { DataLoader } from '../components/DataLoader'
import { AnalyticsTracker } from '../components/AnalyticsTracker'

export default function Home() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Async Leak Demo</h1>
      <p>
        This app intentionally leaks async resources to demonstrate{' '}
        <code>vitest-leak-detector</code>. Run <code>pnpm test</code> to see the
        reporter output.
      </p>
      {/* Renders null — fires a fire-and-forget analytics call */}
      <AnalyticsTracker event="page_view" />
      <section>
        <h2>Clock (Timeout leak via setInterval)</h2>
        <ClockWidget />
      </section>
      <section>
        <h2>Data Loader (Timeout leak via setTimeout)</h2>
        <DataLoader query="next.js" />
      </section>
    </main>
  )
}
