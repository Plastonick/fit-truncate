<script>
  import { inspectFit, selectedEntries, truncateFit } from './fit.js'

  let file = $state(null)
  let filename = $state('')
  let error = $state('')
  let busy = $state(false)
  let ranges = $state([])
  let from = $state(1)
  let to = $state(1)
  let page = $state(1)
  let jump = $state(1)
  const pageSize = 50
  const selected = $derived(selectedEntries(file?.devices.length ?? 0, ranges))
  const pageCount = $derived(Math.max(1, Math.ceil((file?.devices.length ?? 0) / pageSize)))
  const rows = $derived(file?.devices.slice((page - 1) * pageSize, page * pageSize) ?? [])
  const preferredColumns = ['timestamp', 'deviceIndex', 'productName', 'manufacturer']
  const columns = $derived.by(() => {
    const available = new Set(file?.devices.flatMap(({ message }) => Object.keys(message)) ?? [])
    return [...new Set([...preferredColumns, ...available])].filter((key) => available.has(key))
  })
  const session = $derived(file?.messages.sessionMesgs?.[0])
  const bytesRemoved = $derived(file?.devices.reduce((sum, entry, index) => sum + (selected.has(index + 1) ? entry.end - entry.start : 0), 0) ?? 0)

  const format = (value) => {
    if (value == null) return '—'
    if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
    if (typeof value === 'object') return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item)
    return String(value)
  }
  const label = (key) => key.replace(/([A-Z])/g, ' $1').toLowerCase()
  const size = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

  async function load (event) {
    const chosen = event.currentTarget.files[0]
    if (!chosen) return
    file = null
    ranges = []
    error = ''
    busy = true
    try {
      file = inspectFit(await chosen.arrayBuffer())
      filename = chosen.name
      from = to = page = jump = 1
    } catch (cause) {
      error = cause.message
    } finally {
      busy = false
      event.target.value = ''
    }
  }

  function addRange (event) {
    event.preventDefault()
    try {
      const range = { from: Number(from), to: Number(to) }
      selectedEntries(file.devices.length, [range])
      ranges = [...ranges, range]
      error = ''
    } catch (cause) {
      error = cause.message
    }
  }

  function goToEntry (event) {
    event.preventDefault()
    const entry = Number(jump)
    if (Number.isInteger(entry) && entry >= 1 && entry <= file.devices.length) {
      page = Math.ceil(entry / pageSize)
    }
  }

  function download () {
    try {
      const bytes = truncateFit(file, ranges)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${filename.replace(/\.fit$/i, '')}-trimmed.fit`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      error = ''
    } catch (cause) {
      error = cause.message
    }
  }
</script>

<main>
    <header>
        <h1>FIT truncate</h1>
        <p>Inspect a FIT file. Remove unwanted device information entries.</p>
    </header>

    <section aria-label="Open file" class="upload">
        <label for="fit-file">Open a .fit file</label>
        <input id="fit-file" type="file" accept=".fit" onchange={load} disabled={busy}/>
        <p class="muted">Everything stays in your browser. Your file is never uploaded.</p>
    </section>

    {#if busy}<p role="status">Reading file…</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if file}
        <section aria-label="File information">
            <h2 class="filename">{filename}</h2>
            <dl>
                <div>
                    <dt>File size</dt>
                    <dd>{size(file.bytes.length)}</dd>
                </div>
                <div>
                    <dt>Device entries</dt>
                    <dd>{file.devices.length.toLocaleString()}</dd>
                </div>
                <div>
                    <dt>Activity records</dt>
                    <dd>{(file.messages.recordMesgs?.length ?? 0).toLocaleString()}</dd>
                </div>
                {#if session?.sport}
                    <div>
                        <dt>Sport</dt>
                        <dd>{format(session.sport)}</dd>
                    </div>
                {/if}
                {#if session?.startTime}
                    <div>
                        <dt>Started</dt>
                        <dd>{format(session.startTime)}</dd>
                    </div>
                {/if}
            </dl>
        </section>

        {#if file.devices.length}
            <section aria-labelledby="remove-heading">
                <h2 id="remove-heading">Choose entries to remove</h2>
                <p>Ranges include both endpoints and refer only to the original <code>device_info</code> entry numbers
                    below.</p>
                <form class="controls" onsubmit={addRange}>
                    <label>From entry <input
                        type="number"
                        min="1"
                        max={file.devices.length}
                        step="1"
                        required
                        bind:value={from}
                    /></label>
                    <label>To entry <input
                        type="number"
                        min="1"
                        max={file.devices.length}
                        step="1"
                        required
                        bind:value={to}
                    /></label>
                    <button type="submit">Add removal range</button>
                </form>
                {#if ranges.length}
                    <ul class="ranges" aria-label="Queued removal ranges">
                        {#each ranges as range, index}
                            <li>Entries {range.from.toLocaleString()}–{range.to.toLocaleString()}
                                <button
                                    class="quiet"
                                    onclick={() => ranges = ranges.filter((_, i) => i !== index)}
                                    aria-label={`Undo removal range ${range.from} to ${range.to}`}
                                >Undo
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
                <div class="download">
                    <p aria-live="polite"><strong>{selected.size.toLocaleString()}</strong> to remove ·
                        <strong>{(file.devices.length - selected.size).toLocaleString()}</strong> to keep
                        · {size(bytesRemoved)} saved</p>
                    <button class="primary" onclick={download} disabled={!selected.size}>Download edited FIT</button>
                    {#if ranges.length}
                        <button class="quiet" onclick={() => ranges = []}>Clear ranges</button>
                    {/if}
                </div>
            </section>

            <section aria-labelledby="entries-heading">
                <h2 id="entries-heading">Device information</h2>
                <div class="table-tools">
                    <p id="table-hint" class="muted">Showing {(page - 1) * pageSize + 1}
                        –{Math.min(page * pageSize, file.devices.length)} of {file.devices.length.toLocaleString()}.
                        Marked rows will be removed.</p>
                    <form class="controls" onsubmit={goToEntry}>
                        <label>Go to entry <input
                            type="number"
                            min="1"
                            max={file.devices.length}
                            step="1"
                            required
                            bind:value={jump}
                        /></label>
                        <button type="submit">Go</button>
                    </form>
                </div>
                <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the table.) -->
                <div
                    class="table-wrap"
                    tabindex="0"
                    role="region"
                    aria-label="Device entries, scroll horizontally for all fields"
                    aria-describedby="table-hint"
                >
                    <table>
                        <thead>
                        <tr>
                            <th scope="col">Entry</th>
                            <th scope="col">Action</th>
                            {#each columns as column}
                                <th scope="col">{label(column)}</th>
                            {/each}
                        </tr>
                        </thead>
                        <tbody>
                        {#each rows as entry, index}
                            {@const number = (page - 1) * pageSize + index + 1}
                            <tr class:removed={selected.has(number)}>
                                <th scope="row">{number}</th>
                                <td>{selected.has(number) ? 'Remove' : 'Keep'}</td>
                                {#each columns as column}
                                    <td>{format(entry.message[column])}</td>
                                {/each}
                            </tr>
                        {/each}
                        </tbody>
                    </table>
                </div>
                <nav class="pagination" aria-label="Device entries pages">
                    <button onclick={() => page = 1} disabled={page === 1}>First</button>
                    <button onclick={() => page--} disabled={page === 1}>Previous</button>
                    <span aria-live="polite">Page {page} of {pageCount}</span>
                    <button onclick={() => page++} disabled={page === pageCount}>Next</button>
                    <button onclick={() => page = pageCount} disabled={page === pageCount}>Last</button>
                </nav>
            </section>
        {:else}
            <p>This file has no <code>device_info</code> entries to remove.</p>
        {/if}
    {/if}
</main>
