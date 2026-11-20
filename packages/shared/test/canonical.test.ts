import { describe, expect, it } from 'vitest';
import { canonicalJson, newId } from '../src/index.js';

describe('canonicalJson', () => {
  it('sorts keys recursively without whitespace', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
  it('rejects undefined values', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
  });
  it('rejects NaN and Infinity', () => {
    expect(() => canonicalJson(NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ x: Infinity })).toThrow(TypeError);
  });
  it('rejects functions', () => {
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
  });
  it('round-trips unicode strings', () => {
    const v = { s: 'héllo ​ 日本 "q"' };
    expect(JSON.parse(canonicalJson(v))).toEqual(v);
  });
  it('serialises null and booleans', () => {
    expect(canonicalJson({ n: null, t: true })).toBe('{"n":null,"t":true}');
  });
});

describe('newId', () => {
  it('produces prefixed ULIDs', () => {
    expect(newId('thr')).toMatch(/^thr_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it('is unique across 1000 ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('x')));
    expect(ids.size).toBe(1000);
  });
});
