export function createBrowserManager({ launch } = {}) {
  let browser, pending, tail = Promise.resolve()
  return {
    async withPage(run, signal) {
      const previous = tail
      let release
      tail = new Promise((resolve) => { release = resolve })
      await previous
      let context
      const onAbort = () => { void context?.close().catch(() => {}) }
      try {
        if (signal.aborted) throw signal.reason
        if (!browser?.isConnected()) {
          pending ??= launch().finally(() => { pending = null })
          browser = await pending
        }
        if (signal.aborted) throw signal.reason
        context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block', acceptDownloads: false })
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) throw signal.reason
        return await run(await context.newPage(), signal)
      } finally {
        signal.removeEventListener('abort', onAbort)
        await context?.close().catch(() => {})
        release()
      }
    },
    async close() { await browser?.close(); browser = null },
  }
}
