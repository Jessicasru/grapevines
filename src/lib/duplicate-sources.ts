type Sourced = { sources: unknown };
export function hasWinerySource(winery: Sourced, source: string) {
  return Array.isArray(winery.sources) && winery.sources.some(item => item && typeof item === 'object' && item.source === source);
}

export function manualSourceBreakdown(pairs: { winery_a: Sourced; winery_b: Sourced }[]) {
  const counts = { osmDatatourisme: 0, datatourismeDatatourisme: 0, osmOsm: 0 };
  for (const { winery_a: a, winery_b: b } of pairs) {
    const aDt = hasWinerySource(a, 'datatourisme'), bDt = hasWinerySource(b, 'datatourisme');
    const aOsm = hasWinerySource(a, 'osm'), bOsm = hasWinerySource(b, 'osm');
    if (aDt && bDt) counts.datatourismeDatatourisme++;
    else if ((aOsm && bDt) || (bOsm && aDt)) counts.osmDatatourisme++;
    else if (aOsm && bOsm) counts.osmOsm++;
  }
  return counts;
}