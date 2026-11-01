import { CrcCalculator, Decoder, Profile, Stream } from '@garmin/fitsdk'

// FIT header layout: byte 0 is the header size, bytes 4–7 the data size, and
// a 14-byte header carries its own CRC in bytes 12–13. A 2-byte file CRC
// always follows the data.
const DATA_SIZE_OFFSET = 4
const HEADER_CRC_OFFSET = 12
const CRC_SIZE = 2

const crc = (bytes) => CrcCalculator.calculateCRC(bytes, 0, bytes.length)

const concat = (parts) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((offset, part) => {
    output.set(part, offset)
    return offset + part.length
  }, 0)
  return output
}

export function inspectFit(input) {
  const bytes = new Uint8Array(input)
  const headerSize = bytes[0]
  if (bytes.length < 14 || ![12, 14].includes(headerSize)) {
    throw new Error('Choose a FIT file with a standard 12- or 14-byte header.')
  }
  const dataSize = new DataView(bytes.buffer).getUint32(DATA_SIZE_OFFSET, true)
  if (headerSize + dataSize + CRC_SIZE !== bytes.length) {
    throw new Error('The file is incomplete or contains chained FIT files, which are not supported.')
  }
  const stream = Stream.fromArrayBuffer(bytes.buffer)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new Error('This file failed the FIT integrity check. Choose an intact FIT file.')
  }

  const devices = []
  let cursor = headerSize
  // Every listener call ends at a record boundary, so each device message's
  // byte span can be cut out later without re-encoding anything (re-encoding
  // could lose unknown or developer fields).
  const { messages, errors } = decoder.read({
    // Load-bearing: the decoder only calls mesgListener for messages it can
    // name, and unknown messages are only named when this is enabled. Without
    // it, an unknown message would silently join the next device's span and be
    // deleted with it.
    includeUnknownData: true,
    mergeHeartRates: false,
    mesgDefinitionListener: () => {
      cursor = stream.position
    },
    mesgListener: (number, message) => {
      if (number === Profile.MesgNum.DEVICE_INFO) devices.push({ message, start: cursor, end: stream.position })
      cursor = stream.position
    },
  })
  if (errors.length) {
    const detail = errors.map(String).join('; ')
    if (detail.includes('compressed timestamp')) {
      throw new Error('This file uses compressed timestamps, which the Garmin reader does not support yet.')
    }
    throw new Error(`Could not read this FIT file: ${detail}`)
  }
  if (cursor !== bytes.length - CRC_SIZE) throw new Error('Could not identify every FIT record safely.')
  return { bytes, devices, messages, headerSize }
}

// Ranges use 1-based, inclusive device entry numbers, matching what the UI shows.
export function checkRange(count, range) {
  const { from, to } = range
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > count || from > to) {
    throw new Error(`Enter a whole-number range between 1 and ${count}, with the start no greater than the end.`)
  }
  return range
}

export const isRemoved = (ranges, entry) => ranges.some(({ from, to }) => from <= entry && entry <= to)

export function removedDevices(file, ranges) {
  ranges.forEach((range) => checkRange(file.devices.length, range))
  return file.devices.filter((_, index) => isRemoved(ranges, index + 1))
}

export function truncateFit(file, ranges) {
  // Devices are in file order, so the bytes to keep are the gaps between them:
  // [0, start₁), [end₁, start₂), … [endₙ, length).
  const edges = [0, ...removedDevices(file, ranges).flatMap(({ start, end }) => [start, end]), file.bytes.length]
  const kept = edges
    .filter((_, index) => index % 2 === 0)
    .map((start, index) => file.bytes.subarray(start, edges[index * 2 + 1]))
  const output = concat(kept)

  // Removing bytes invalidates the data size and both CRCs, so recompute them.
  const view = new DataView(output.buffer)
  view.setUint32(DATA_SIZE_OFFSET, output.length - file.headerSize - CRC_SIZE, true)
  if (file.headerSize === 14) view.setUint16(HEADER_CRC_OFFSET, crc(output.subarray(0, HEADER_CRC_OFFSET)), true)
  view.setUint16(output.length - CRC_SIZE, crc(output.subarray(0, -CRC_SIZE)), true)
  return output
}
