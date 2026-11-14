/**
 * NASA GIBS satellite images of an area (true colour, burned-land false colour or thermal) with
 * that day's fire detections drawn by NASA, plus a NASA Worldview link. Static WMS image URLs on a
 * public NASA server: no key, no call to our API. Approach adapted from the team's `brasa` repo.
 */
import type { BBox } from './types';

/**
 * Which satellite draws the picture. NOAA-20 VIIRS has continuous GIBS imagery since March 2018,
 * while Suomi NPP's has gaps (blank tiles on many days since 2024), so it is only used for
 * Nov 2015 – Feb 2018; earlier days use MODIS Terra.
 */
const SNPP_FROM = '2015-11-24';
const NOAA20_FROM = '2018-03-01';
const WIDTH = 640;
const MIN_H = 220;
const MAX_H = 640;

export type ImageView = 'true-color' | 'fire' | 'thermal';
export const IMAGE_VIEWS: ImageView[] = ['true-color', 'fire', 'thermal'];
export type ImageSensor = 'NOAA20' | 'SNPP' | 'MODIS';

export const imageSensor = (date: string): ImageSensor => (date >= NOAA20_FROM ? 'NOAA20' : date >= SNPP_FROM ? 'SNPP' : 'MODIS');
export const SENSOR_LABEL: Record<ImageSensor, string> = { NOAA20: 'NOAA-20 VIIRS', SNPP: 'Suomi NPP VIIRS', MODIS: 'Terra MODIS' };

const LAYERS: Record<ImageSensor, Record<ImageView | 'fires', string>> = {
  NOAA20: {
    'true-color': 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    fire: 'VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1',
    thermal: 'VIIRS_NOAA20_Brightness_Temp_BandI5_Day',
    fires: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
  },
  SNPP: {
    'true-color': 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    fire: 'VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1',
    thermal: 'VIIRS_SNPP_Brightness_Temp_BandI5_Day',
    fires: 'VIIRS_SNPP_Thermal_Anomalies_375m_All',
  },
  MODIS: {
    'true-color': 'MODIS_Terra_CorrectedReflectance_TrueColor',
    fire: 'MODIS_Terra_CorrectedReflectance_Bands721',
    thermal: 'MODIS_Terra_Brightness_Temp_Band31_Day',
    fires: 'MODIS_Combined_Thermal_Anomalies_All',
  },
};

/** Bottom to top. The thermal palette would hide the red fire points, so it goes alone. */
function layers(sensor: ImageSensor, view: ImageView): string[] {
  const l = LAYERS[sensor];
  return view === 'thermal' ? [l.thermal] : [l[view], l.fires];
}

/** Box and height for a 640-px-wide image; the box grows around its centre instead of stretching. */
function frame(b: BBox): { box: BBox; height: number } {
  const [w, s, e, n] = b;
  const px = Math.round((WIDTH * (n - s)) / Math.max(1e-6, e - w));
  if (px < MIN_H) {
    const half = ((e - w) * MIN_H) / WIDTH / 2, mid = (n + s) / 2;
    return { box: [w, Math.max(-90, mid - half), e, Math.min(90, mid + half)], height: MIN_H };
  }
  if (px > MAX_H) {
    const half = ((n - s) * WIDTH) / MAX_H / 2, mid = (w + e) / 2;
    return { box: [Math.max(-180, mid - half), s, Math.min(180, mid + half), n], height: MAX_H };
  }
  return { box: b, height: px };
}

const r4 = (v: number) => Number(v.toFixed(4));

/** WMS 1.3.0 GetMap; with EPSG:4326 the BBOX order is south,west,north,east. */
export function gibsImage(bbox: BBox, date: string, view: ImageView, sensor: ImageSensor = imageSensor(date)) {
  const { box, height } = frame(bbox);
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    CRS: 'EPSG:4326',
    FORMAT: 'image/jpeg',
    LAYERS: layers(sensor, view).join(','),
    TIME: date,
    WIDTH: String(WIDTH),
    HEIGHT: String(height),
    BBOX: [box[1], box[0], box[3], box[2]].map(r4).join(','),
  });
  return { url: `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`, width: WIDTH, height, box };
}

export function worldviewUrl(bbox: BBox, date: string, view: ImageView, sensor: ImageSensor = imageSensor(date)): string {
  const params = new URLSearchParams({ v: bbox.map(r4).join(','), t: date, l: layers(sensor, view).reverse().join(',') });
  return `https://worldview.earthdata.nasa.gov/?${params}`;
}
