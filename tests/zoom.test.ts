import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  MAX_ZOOM,
  pinchZoom,
  scrollForFocal,
  snapZoom,
} from '../src/zoom';

describe('zoom', () => {
  it('membatasi zoom dalam 1..MAX', () => {
    expect(clampZoom(0.3)).toBe(1);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(1);
  });
  it('snap ke 1 saat hampir 1', () => {
    expect(snapZoom(1.05)).toBe(1);
    expect(snapZoom(1.5)).toBe(1.5);
  });
  it('pinch mengikuti rasio jarak jari', () => {
    expect(pinchZoom(1, 100, 200)).toBeCloseTo(2);
    expect(pinchZoom(2, 100, 50)).toBeCloseTo(1);
    expect(pinchZoom(2, 100, 1000)).toBe(MAX_ZOOM);
    expect(pinchZoom(2, 0, 50)).toBe(2);
  });
});

describe('scrollForFocal', () => {
  it('menjaga titik fokus tetap di bawah jari', () => {
    // konten 1200 lebar, viewport 400, titik fokus di 50% konten, jari di x=200
    expect(scrollForFocal(0.5, 200, 1200, 400)).toBe(400);
  });
  it('dijepit ke batas scroll', () => {
    expect(scrollForFocal(0, 300, 1200, 400)).toBe(0);
    expect(scrollForFocal(1, 0, 1200, 400)).toBe(800);
    expect(scrollForFocal(0.5, 0, 300, 400)).toBe(0);
  });
});
