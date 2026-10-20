import { strToU8, zipSync } from 'fflate';

/**
 * A tiny, structurally complete GTFS archive built in memory, so tests need
 * no network. Tram 4 runs both directions on weekdays, bus 128 on weekdays,
 * night bus 240 at 25:30 on Saturday's timetable (i.e. early Sunday morning).
 */
export type FixtureOptions = {
  omit?: string[];
  /** Nest every table in a folder, as some publishers do. */
  prefix?: string;
  feedDates?: { start: string; end: string } | null;
  extraFiles?: Record<string, string>;
  /** Store instead of deflate. */
  stored?: boolean;
};

const lines = (...rows: string[]) => rows.join('\n');

export const fixtureTables = (): Record<string, string> => ({
  'agency.txt': lines('agency_id,agency_name,agency_url,agency_timezone', '2,MPK Wrocław,https://www.wroclaw.pl,Europe/Warsaw'),
  'routes.txt': lines(
    'route_id,route_short_name,route_long_name,route_type,route_color',
    '4,4,"BISKUPIN - OPORÓW",0,E30613',
    '128,128,LEŚNICA - KRZYKI,3,',
    '240,240,NOCNA,3,',
    'a,a,EXPRESS,3,',
  ),
  'stops.txt': lines(
    '﻿stop_id,stop_code,stop_name,stop_lat,stop_lon',
    '1,10101,Rynek,51.11000,17.03200',
    '2,10102,Rynek,51.11010,17.03210',
    '3,20201,Świdnicka,51.10500,17.03300',
    '4,30301,Oporów,51.08000,16.98000',
    '5,40401,Biskupin,51.10000,17.10000',
    '6,50501,"Krzyki, pętla",51.07000,17.03000',
    // A post no trip serves, sharing its name with a served one.
    '7,20202,Świdnicka,51.10510,17.03310',
  ),
  'calendar.txt': lines(
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WEEKDAY,1,1,1,1,1,0,0,20260601,20261231',
    'SATURDAY,0,0,0,0,0,1,0,20260601,20261231',
  ),
  'calendar_dates.txt': lines(
    'service_id,date,exception_type',
    // Wednesday 2026-06-17 runs as a holiday: no weekday service.
    'WEEKDAY,20260617,2',
  ),
  'trips.txt': lines(
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id,brigade_id,vehicle_id',
    '4,WEEKDAY,t4a,Oporów,0,s4a,7,1',
    '4,WEEKDAY,t4a2,Oporów,0,s4a,8,1',
    '4,WEEKDAY,t4b,Biskupin,1,s4b,7,1',
    '128,WEEKDAY,t128,Krzyki,0,s128,1,2',
    '240,SATURDAY,tn1,Krzyki,0,s128,1,2',
    'a,WEEKDAY,ta,Rynek,0,s128,1,2',
  ),
  'stop_times.txt': lines(
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    't4a,08:00:00,08:00:00,1,1',
    't4a,08:05:00,08:05:00,3,2',
    't4a,08:15:00,08:15:00,4,3',
    't4a2,09:00:00,09:00:00,1,1',
    't4a2,09:05:00,09:05:00,3,2',
    't4a2,09:15:00,09:15:00,4,3',
    't4b,10:00:00,10:00:00,4,1',
    't4b,10:10:00,10:10:00,2,2',
    't4b,10:20:00,10:20:00,5,3',
    't128,12:00:00,12:00:00,2,1',
    't128,12:20:00,12:20:00,6,2',
    'tn1,25:30:00,25:30:00,1,1',
    'tn1,25:45:00,25:45:00,6,2',
    'ta,13:00:00,13:00:00,6,1',
    'ta,13:20:00,13:20:00,1,2',
  ),
  'shapes.txt': lines(
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    's4a,51.11000,17.03200,1',
    's4a,51.08000,16.98000,3',
    's4a,51.10500,17.03300,2',
    's4b,51.08000,16.98000,1',
    's4b,51.10000,17.10000,2',
    's128,51.11000,17.03200,1',
    's128,51.07000,17.03000,2',
  ),
});

export const buildFixtureZip = ({ omit = [], prefix = '', feedDates = null, extraFiles = {}, stored = false }: FixtureOptions = {}) => {
  const tables: Record<string, string> = { ...fixtureTables(), ...extraFiles };
  if (feedDates) {
    tables['feed_info.txt'] = lines(
      'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date',
      `MPK,https://www.wroclaw.pl,pl,${feedDates.start},${feedDates.end}`,
    );
  }
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, text] of Object.entries(tables)) {
    if (omit.includes(name)) continue;
    files[`${prefix}${name}`] = [strToU8(text), { level: stored ? 0 : 6 }];
  }
  // looksLikeZip wants more than a kilobyte, like a real archive.
  files[`${prefix}README.txt`] = [strToU8('x'.repeat(2048)), { level: 0 }];
  return zipSync(files);
};

/** Epoch ms of a Wrocław wall-clock time. */
export const warsaw = (isoLocal: string, offsetHours = 2) =>
  Date.parse(`${isoLocal}${offsetHours === 2 ? '+02:00' : '+01:00'}`);
