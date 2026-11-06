import { describe, expect, it } from 'vitest';
import { pageAtOffset } from '../src/layout';

const tops = [0, 100, 250, 400, 900];
const topOf = (i: number) => tops[i]!;

describe('pageAtOffset', () => {
  it('menemukan halaman yang memuat posisi', () => {
    expect(pageAtOffset(5, topOf, 0)).toBe(0);
    expect(pageAtOffset(5, topOf, 99)).toBe(0);
    expect(pageAtOffset(5, topOf, 100)).toBe(1);
    expect(pageAtOffset(5, topOf, 399)).toBe(2);
    expect(pageAtOffset(5, topOf, 5000)).toBe(4);
  });
  it('posisi negatif -> halaman pertama; tanpa halaman -> 0', () => {
    expect(pageAtOffset(5, topOf, -50)).toBe(0);
    expect(pageAtOffset(0, topOf, 10)).toBe(0);
  });
});
