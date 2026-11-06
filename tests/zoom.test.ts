import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  MAX_ZOOM,
  pinchZoom,
  scrollForFocal,
  snapZoom,
  swipeDirection,
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

describe('swipeDirection', () => {
  const none = { left: false, right: false };
  it('zoom 1x: swipe horizontal pindah halaman', () => {
    expect(swipeDirection({ dx: -100, dy: 10, zoom: 1, startEdge: none, endEdge: none })).toBe('next');
    expect(swipeDirection({ dx: 100, dy: 10, zoom: 1, startEdge: none, endEdge: none })).toBe('prev');
  });
  it('gerakan vertikal atau pendek diabaikan', () => {
    expect(swipeDirection({ dx: -100, dy: 200, zoom: 1, startEdge: none, endEdge: none })).toBeNull();
    expect(swipeDirection({ dx: -30, dy: 0, zoom: 1, startEdge: none, endEdge: none })).toBeNull();
  });
  it('saat di-zoom, hanya pindah halaman jika mentok di tepi', () => {
    const atLeft = { left: true, right: false };
    const atRight = { left: false, right: true };
    expect(swipeDirection({ dx: 100, dy: 0, zoom: 2.5, startEdge: none, endEdge: none })).toBeNull();
    expect(swipeDirection({ dx: 100, dy: 0, zoom: 2.5, startEdge: atLeft, endEdge: atLeft })).toBe('prev');
    expect(swipeDirection({ dx: -100, dy: 0, zoom: 2.5, startEdge: atRight, endEdge: atRight })).toBe('next');
    // mulai di tengah lalu panning sampai tepi: tidak boleh pindah halaman
    expect(swipeDirection({ dx: 100, dy: 0, zoom: 2.5, startEdge: none, endEdge: atLeft })).toBeNull();
  });
});
