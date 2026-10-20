/**
 * A small GTFS-Realtime decoder: just the fields this app reads.
 *
 * The official bindings sit on protobufjs, whose generated decoders rely on
 * `new Function` — not something to depend on under Hermes in a release
 * build. The wire format is simple enough to read directly; the test suite
 * checks this decoder against gtfs-realtime-bindings' encoder.
 *
 * Field numbers from gtfs-realtime.proto:
 *   FeedMessage { header = 1; repeated entity = 2 }
 *   FeedHeader { timestamp = 3 }
 *   FeedEntity { id = 1; trip_update = 3; vehicle = 4 }
 *   VehiclePosition { trip = 1; position = 2; current_stop_sequence = 3; timestamp = 5; stop_id = 7; vehicle = 8 }
 *   Position { latitude = 1 (float); longitude = 2 (float); bearing = 3 (float); speed = 5 (float) }
 *   TripDescriptor { trip_id = 1; start_time = 2; start_date = 3; route_id = 5; direction_id = 6 }
 *   VehicleDescriptor { id = 1; label = 2; license_plate = 3 }
 *   TripUpdate { trip = 1; stop_time_update = 2; timestamp = 4; delay = 5 }
 *   StopTimeUpdate { stop_sequence = 1; arrival = 2; departure = 3; stop_id = 4 }
 *   StopTimeEvent { delay = 1; time = 2 }
 */

class Reader {
  pos: number;
  private readonly view: DataView;

  constructor(
    private readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get done() {
    return this.pos >= this.end;
  }

  /** A varint as its low and high 32 bits. */
  private varint64(): [number, number] {
    let lo = 0;
    let hi = 0;
    let byte = 0;
    for (let i = 0; i < 4; i += 1) {
      byte = this.byte();
      lo = (lo | ((byte & 0x7f) << (i * 7))) >>> 0;
      if (byte < 0x80) return [lo, hi];
    }
    byte = this.byte();
    lo = (lo | ((byte & 0x7f) << 28)) >>> 0;
    hi = (byte & 0x7f) >> 4;
    if (byte < 0x80) return [lo, hi];
    for (let i = 0; i < 5; i += 1) {
      byte = this.byte();
      hi = (hi | ((byte & 0x7f) << (i * 7 + 3))) >>> 0;
      if (byte < 0x80) return [lo, hi];
    }
    throw new Error('malformed varint');
  }

  private byte() {
    if (this.pos >= this.end) throw new Error('truncated protobuf');
    return this.buf[this.pos++];
  }

  /** uint32/uint64 (exact up to 2^53, which covers timestamps). */
  uint(): number {
    const [lo, hi] = this.varint64();
    return hi * 0x1_0000_0000 + lo;
  }

  /** int32: negative values arrive as ten-byte varints. */
  int32(): number {
    return this.varint64()[0] | 0;
  }

  float(): number {
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  bytes(): Reader {
    const length = this.uint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.end) throw new Error('truncated protobuf');
    return new Reader(this.buf, start, start + length);
  }

  string(): string {
    const sub = this.bytes();
    let out = '';
    // Feed strings are ids and short labels; decode UTF-8 by hand to avoid TextDecoder.
    for (let at = sub.pos; at < sub.end; ) {
      const b = this.buf[at];
      let code: number;
      if (b < 0x80) {
        code = b;
        at += 1;
      } else if (b < 0xe0) {
        code = ((b & 0x1f) << 6) | (this.buf[at + 1] & 0x3f);
        at += 2;
      } else if (b < 0xf0) {
        code = ((b & 0x0f) << 12) | ((this.buf[at + 1] & 0x3f) << 6) | (this.buf[at + 2] & 0x3f);
        at += 3;
      } else {
        code = ((b & 0x07) << 18) | ((this.buf[at + 1] & 0x3f) << 12) | ((this.buf[at + 2] & 0x3f) << 6) | (this.buf[at + 3] & 0x3f);
        at += 4;
      }
      out += String.fromCodePoint(code);
    }
    return out;
  }

  tag(): [field: number, wire: number] {
    const key = this.uint();
    return [Math.floor(key / 8), key & 7];
  }

  skip(wire: number) {
    if (wire === 0) this.varint64();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

export type RtTrip = {
  tripId: string | null;
  routeId: string | null;
  startDate: string | null;
  startTime: string | null;
  directionId: number | null;
};

export type RtVehiclePosition = {
  entityId: string;
  trip: RtTrip | null;
  latitude: number | null;
  longitude: number | null;
  bearing: number | null;
  timestamp: number | null;
  currentStopSequence: number | null;
  stopId: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
};

export type RtStopTimeUpdate = { stopSequence: number | null; stopId: string | null; arrivalDelay: number | null; departureDelay: number | null };

export type RtTripUpdate = { trip: RtTrip | null; delay: number | null; stopTimeUpdates: RtStopTimeUpdate[] };

export type RtFeed = { timestamp: number | null; vehicles: RtVehiclePosition[]; tripUpdates: RtTripUpdate[] };

const readTrip = (r: Reader): RtTrip => {
  const trip: RtTrip = { tripId: null, routeId: null, startDate: null, startTime: null, directionId: null };
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === 2) trip.tripId = r.string();
    else if (field === 2 && wire === 2) trip.startTime = r.string();
    else if (field === 3 && wire === 2) trip.startDate = r.string();
    else if (field === 5 && wire === 2) trip.routeId = r.string();
    else if (field === 6 && wire === 0) trip.directionId = r.uint();
    else r.skip(wire);
  }
  return trip;
};

const readVehicle = (r: Reader, entityId: string): RtVehiclePosition => {
  const v: RtVehiclePosition = {
    entityId,
    trip: null,
    latitude: null,
    longitude: null,
    bearing: null,
    timestamp: null,
    currentStopSequence: null,
    stopId: null,
    vehicleId: null,
    vehicleLabel: null,
  };
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === 2) v.trip = readTrip(r.bytes());
    else if (field === 2 && wire === 2) {
      const p = r.bytes();
      while (!p.done) {
        const [pf, pw] = p.tag();
        if (pf === 1 && pw === 5) v.latitude = p.float();
        else if (pf === 2 && pw === 5) v.longitude = p.float();
        else if (pf === 3 && pw === 5) v.bearing = p.float();
        else p.skip(pw);
      }
    } else if (field === 3 && wire === 0) v.currentStopSequence = r.uint();
    else if (field === 5 && wire === 0) v.timestamp = r.uint();
    else if (field === 7 && wire === 2) v.stopId = r.string();
    else if (field === 8 && wire === 2) {
      const d = r.bytes();
      while (!d.done) {
        const [df, dw] = d.tag();
        if (df === 1 && dw === 2) v.vehicleId = d.string();
        else if (df === 2 && dw === 2) v.vehicleLabel = d.string();
        else d.skip(dw);
      }
    } else r.skip(wire);
  }
  return v;
};

const readStopTimeEventDelay = (r: Reader): number | null => {
  let delay: number | null = null;
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === 0) delay = r.int32();
    else r.skip(wire);
  }
  return delay;
};

const readTripUpdate = (r: Reader): RtTripUpdate => {
  const update: RtTripUpdate = { trip: null, delay: null, stopTimeUpdates: [] };
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === 2) update.trip = readTrip(r.bytes());
    else if (field === 5 && wire === 0) update.delay = r.int32();
    else if (field === 2 && wire === 2) {
      const s = r.bytes();
      const stu: RtStopTimeUpdate = { stopSequence: null, stopId: null, arrivalDelay: null, departureDelay: null };
      while (!s.done) {
        const [sf, sw] = s.tag();
        if (sf === 1 && sw === 0) stu.stopSequence = s.uint();
        else if (sf === 2 && sw === 2) stu.arrivalDelay = readStopTimeEventDelay(s.bytes());
        else if (sf === 3 && sw === 2) stu.departureDelay = readStopTimeEventDelay(s.bytes());
        else if (sf === 4 && sw === 2) stu.stopId = s.string();
        else s.skip(sw);
      }
      update.stopTimeUpdates.push(stu);
    } else r.skip(wire);
  }
  return update;
};

export const decodeFeed = (buffer: Uint8Array): RtFeed => {
  const feed: RtFeed = { timestamp: null, vehicles: [], tripUpdates: [] };
  const r = new Reader(buffer);
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === 2) {
      const h = r.bytes();
      while (!h.done) {
        const [hf, hw] = h.tag();
        if (hf === 3 && hw === 0) feed.timestamp = h.uint();
        else h.skip(hw);
      }
    } else if (field === 2 && wire === 2) {
      const e = r.bytes();
      let id = '';
      const pending: Reader[] = [];
      const updates: Reader[] = [];
      while (!e.done) {
        const [ef, ew] = e.tag();
        if (ef === 1 && ew === 2) id = e.string();
        else if (ef === 4 && ew === 2) pending.push(e.bytes());
        else if (ef === 3 && ew === 2) updates.push(e.bytes());
        else e.skip(ew);
      }
      // The id may come after the payload in the wire order, so read payloads last.
      for (const v of pending) feed.vehicles.push(readVehicle(v, id));
      for (const u of updates) feed.tripUpdates.push(readTripUpdate(u));
    } else r.skip(wire);
  }
  return feed;
};
