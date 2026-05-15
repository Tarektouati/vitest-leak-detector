import { ClockWidget } from '../components/ClockWidget'
import { DataLoader } from '../components/DataLoader'

export default function Home() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Async Leak Demo</h1>
      <p>
        This app intentionally leaks async resources to demonstrate{' '}
        <code>vitest-leak-detector</code>. Run <code>pnpm test</code> to see the
        reporter output.
      </p>
      <section>
        <h2>Clock (Interval leak)</h2>
        <ClockWidget />
      </section>
      <section>
        <h2>Data Loader (Timeout leak)</h2>
        <DataLoader query="next.js" />
      </section>
    </main>
  )
}
