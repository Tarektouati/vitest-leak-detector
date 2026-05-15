'use client'

import { useState, useEffect } from 'react'

export function ClockWidget() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString())

  useEffect(() => {
    // Bug: the interval id is never passed to clearInterval.
    // When the component unmounts the interval keeps firing.
    // Node.js async_hooks reports both setTimeout and setInterval as
    // "Timeout" type, so the reporter will flag this as a Timeout leak.
    setInterval(() => {
      setTime(new Date().toLocaleTimeString())
    }, 1000)

    // Fix would be:
    //   const id = setInterval(...)
    //   return () => clearInterval(id)
  }, [])

  return <time dateTime={time}>{time}</time>
}
