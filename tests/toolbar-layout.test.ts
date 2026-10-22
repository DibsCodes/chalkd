import { describe, expect, it } from 'vitest';
import { splitSlots, visiblePresets } from '../src/renderer/ui/toolbar-layout';

describe('splitSlots', () => {
  it('shows everything when there is room', () => {
    expect(splitSlots(Infinity, 4, 3)).toEqual([4, 3]);
    expect(splitSlots(7, 4, 3)).toEqual([4, 3]);
  });

  it('trims pens and highlighters evenly', () => {
    expect(splitSlots(6, 4, 3)).toEqual([3, 3]);
    expect(splitSlots(5, 4, 3)).toEqual([3, 2]);
    expect(splitSlots(4, 4, 3)).toEqual([2, 2]);
    expect(splitSlots(3, 4, 3)).toEqual([2, 1]);
  });

  it('gives spare places to the bigger group', () => {
    expect(splitSlots(6, 8, 1)).toEqual([5, 1]);
    expect(splitSlots(6, 1, 8)).toEqual([1, 5]);
  });

  it('always keeps one of each', () => {
    expect(splitSlots(0, 4, 3)).toEqual([1, 1]);
    expect(splitSlots(1, 4, 3)).toEqual([1, 1]);
  });
});

describe('visiblePresets', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const ids = (shown: { id: string }[]) => shown.map((p) => p.id);

  it('shows the first ones', () => {
    expect(ids(visiblePresets(list, 3, 'b'))).toEqual(['a', 'b', 'c']);
    expect(ids(visiblePresets(list, 3, null))).toEqual(['a', 'b', 'c']);
    expect(ids(visiblePresets(list, 9, 'e'))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('keeps the selected one in the last place', () => {
    expect(ids(visiblePresets(list, 3, 'e'))).toEqual(['a', 'b', 'e']);
    expect(ids(visiblePresets(list, 1, 'd'))).toEqual(['d']);
  });
});
