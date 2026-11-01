import { CrcCalculator, Decoder, Stream } from '@garmin/fitsdk'

const crc = (bytes) => CrcCalculator.calculateCRC(bytes, 0, bytes.length)

export function inspectFit (input) {
  const bytes = new Uint8Array(input)
  if (bytes.length < 14 || ![12, 14].includes(bytes[0])) {
    throw new Error('Choose a FIT file with a standard 12- or 14-byte header.')
  }
  const view = new DataView(bytes.buffer)
  const headerSize = bytes[0]
  if (headerSize + view.getUint32(4, true) + 2 !== bytes.length) {
    throw new Error('The file is incomplete or contains chained FIT files, which are not supported.')
  }
  const stream = Stream.fromArrayBuffer(bytes.buffer)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new Error('This file failed the FIT integrity check. Choose an intact FIT file.')
  }

  const devices = []
  let cursor = headerSize
  // Every callback ends at a record boundary. Keep byte spans rather than
  // re-encoding decoded values, which could lose unknown or developer fields.
  const { messages, errors } = decoder.read({
    includeUnknownData: true,
    mergeHeartRates: false,
    mesgDefinitionListener: () => { cursor = stream.position },
    mesgListener: (number, message) => {
      if (number === 23) devices.push({ message, start: cursor, end: stream.position })
      cursor = stream.position
    }
  })
  if (errors.length) {
    const detail = errors.map(String).join('; ')
    throw new Error(detail.includes('compressed timestamp')
      ? 'This file uses compressed timestamps, which the Garmin reader does not support yet.'
      : `Could not read this FIT file: ${detail}`)
  }
  if (cursor !== bytes.length - 2) throw new Error('Could not identify every FIT record safely.')
  return { bytes, devices, messages, headerSize }
}

export function selectedEntries (count, ranges) {
  const selected = new Set()
  for (const { from, to } of ranges) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > count || from > to) {
      throw new Error(`Enter a whole-number range between 1 and ${count}, with the start no greater than the end.`)
    }
    for (let entry = from; entry <= to; entry++) selected.add(entry)
  }
  return selected
}

export function truncateFit (file, ranges) {
  const selected = selectedEntries(file.devices.length, ranges)
  if (!selected.size) return file.bytes.slice()
  const removed = file.devices.filter((_, index) => selected.has(index + 1))
  const size = file.bytes.length - removed.reduce((sum, entry) => sum + entry.end - entry.start, 0)
  const output = new Uint8Array(size)
  let source = 0
  let target = 0
  for (const { start, end } of removed) {
    output.set(file.bytes.subarray(source, start), target)
    target += start - source
    source = end
  }
  output.set(file.bytes.subarray(source), target)
  const view = new DataView(output.buffer)
  view.setUint32(4, size - file.headerSize - 2, true)
  if (file.headerSize === 14) view.setUint16(12, crc(output.subarray(0, 12)), true)
  view.setUint16(size - 2, crc(output.subarray(0, -2)), true)
  return output
}
