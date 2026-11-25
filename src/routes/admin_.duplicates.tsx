import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, GitMerge, X, RotateCcw, Scan } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { duplicatePairsQuery, duplicateHistoryQuery, type Winery } from '@/lib/wine';
import { dismissDuplicatePair, mergeDuplicatePair, previewDuplicatePairs, applyDuplicatePreview, undoDuplicateMerge, restoreDuplicatePair, type DuplicatePair, type DuplicatePreview } from '@/lib/duplicates.functions';
import { WineryPairMap } from '@/components/WineMap';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { manualSourceBreakdown } from '@/lib/duplicate-sources';

export const Route = createFileRoute('/admin_/duplicates')({ head: () => ({ meta: [
  { title: 'Duplicate wineries — Grapevines' }, { name: 'description', content: 'Preview address and unique OSM matches and review reversible winery merges.' }, { name: 'robots', content: 'noindex' },
  { property: 'og:title', content: 'Duplicate wineries — Grapevines' }, { property: 'og:description', content: 'Preview address and unique OSM matches and review reversible winery merges.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
] }), component: DuplicatesPage });

function RecordDetails({ winery, number }: { winery: Winery; number: number }) {
  const sources = Array.isArray(winery.sources) ? winery.sources : [];
  const website = winery.website?.trim();
  const safeUrl = website && /^https?:\/\//i.test(website) ? website : undefined;
  return <div className="min-w-0 space-y-3"><h2 className="break-words font-semibold">{number}. {winery.name}</h2><dl className="space-y-3 text-sm"><div><dt className="text-muted-foreground">Sources</dt><dd className="break-words">{sources.length ? sources.map((s, i) => { const item = s && typeof s === 'object' && !Array.isArray(s) ? s : {}; return <div key={i}>{String(item['source'] ?? '—')} · {String(item['source_id'] ?? '—')}</div>; }) : '—'}</dd></div><div><dt className="text-muted-foreground">Website</dt><dd className="break-all">{safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer" className="text-primary underline">{website}</a> : website || '—'}</dd></div><div><dt className="text-muted-foreground">Address</dt><dd className="break-words">{winery.address || '—'}</dd></div></dl></div>;
}

function PairReview({ pair, active, onSelect, onChanged }: { pair: DuplicatePair; active: boolean; onSelect: () => void; onChanged: () => Promise<void> }) {
  const wineries = useMemo<[Winery, Winery]>(() => [pair.winery_a, pair.winery_b], [pair]);
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const element = useRef<HTMLLIElement>(null);
  const merge = useServerFn(mergeDuplicatePair);
  const dismiss = useServerFn(dismissDuplicatePair);
  function startMerge() { setKeep(''); setError(null); setOpen(true); }
  async function act(action: 'merge' | 'dismiss') {
    if (busy || (action === 'merge' && !keep)) return;
    setBusy(true); setError(null);
    try {
      if (action === 'merge') { await merge({ data: { a: keep, b: keep === pair.winery_a.id ? pair.winery_b.id : pair.winery_a.id } }); setOpen(false); }
      else await dismiss({ data: { a: pair.winery_a.id, b: pair.winery_b.id } });
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update this pair.'); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!active) return;
    function shortcut(e: KeyboardEvent) {
      if (busy || open || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable="true"],[role="tablist"]'))) return;
      if (e.key.toLowerCase() === 'm') { e.preventDefault(); startMerge(); }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); void act('dismiss'); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
  return <li ref={element} data-pair-id={`${pair.winery_a.id}-${pair.winery_b.id}`} aria-current={active ? 'true' : undefined} onClick={onSelect} onFocusCapture={onSelect} className={`rounded-lg bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5 ${active ? 'ring-2 ring-primary' : ''}`}><div className="mb-4 text-sm font-semibold text-primary">{pair.distance_metres.toFixed(1)} metres apart</div><div className="grid grid-cols-2 gap-4"><RecordDetails winery={pair.winery_a} number={1} /><RecordDetails winery={pair.winery_b} number={2} /></div><div className="mt-5"><WineryPairMap wineries={wineries} /></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={startMerge}><GitMerge className="size-4" />Merge</Button><Button variant="outline" disabled={busy} onClick={() => act('dismiss')}><X className="size-4" />Not a duplicate</Button></div>{error && !open && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent className="max-w-[calc(100%-32px)] sm:max-w-lg"><DialogTitle>Choose the winery to keep</DialogTitle><DialogDescription>Sources, saved visits and recommendations will move to the kept record. This merge can be undone.</DialogDescription><RadioGroup value={keep} onValueChange={setKeep} disabled={busy}>{wineries.map((w, i) => <Label key={w.id} htmlFor={`keep-${w.id}`} className="flex items-start gap-3 rounded-lg border border-border p-3 leading-normal"><RadioGroupItem id={`keep-${w.id}`} value={w.id} className="mt-1 shrink-0" /><span className="min-w-0 break-words">{i + 1}. {w.name}<span className="mt-1 block text-xs text-muted-foreground">{w.address || 'No address'}</span></span></Label>)}</RadioGroup>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={!keep || busy} onClick={() => act('merge')}><GitMerge className="size-4" />{busy ? 'Merging…' : 'Confirm merge'}</Button></DialogContent></Dialog></li>;
}

function DuplicatesPage() {
  const { user, profile } = useAuth();
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState('manual');
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<DuplicatePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const qc = useQueryClient();
  const getPreview = useServerFn(previewDuplicatePairs);
  const apply = useServerFn(applyDuplicatePreview);
  const undo = useServerFn(undoDuplicateMerge);
  const restore = useServerFn(restoreDuplicatePair);
  useEffect(() => { supabase.auth.getSession().finally(() => setTimeout(() => setChecked(true), 300)); }, []);
  const pairs = useQuery({ ...duplicatePairsQuery(user?.id ?? ''), enabled: !!profile?.is_admin });
  const history = useQuery({ ...duplicateHistoryQuery(user?.id ?? ''), enabled: !!profile?.is_admin });
  const manual = pairs.data?.filter(p => p.classification === 'manual') ?? [];
  const breakdown = manualSourceBreakdown(manual);
  const runSummary = history.data?.last_run;
  const displayedResult = result ?? (runSummary ? `${runSummary.dismissed} pairs dismissed · ${runSummary.merged} merged · ${runSummary.manual_remaining} remain in manual review` : null);
  const selected = Math.min(active, Math.max(0, manual.length - 1));
  useEffect(() => {
    function navigate(e: KeyboardEvent) {
      if (tab !== 'manual' || busy || !manual.length || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable="true"],[role="tablist"]'))) return;
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const next = Math.max(0, Math.min(manual.length - 1, selected + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1)));
      setActive(next);
      const pair = manual[next];
      if (pair) document.querySelector(`[data-pair-id="${pair.winery_a.id}-${pair.winery_b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    window.addEventListener('keydown', navigate); return () => window.removeEventListener('keydown', navigate);
  }, [tab, busy, manual, selected]);
  async function refresh() { await Promise.all(['admin-duplicates', 'admin-duplicate-history', 'wineries', 'winery', 'saves', 'admin-wineries'].map(key => qc.invalidateQueries({ queryKey: [key] }))); }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update duplicate review.'); } finally { setBusy(false); }
  }
  if (!checked || (user && !profile)) return <div className="min-h-dvh bg-background" />;
  if (!profile?.is_admin) return <main className="grid min-h-dvh place-items-center bg-background"><div className="text-center"><h1 className="text-7xl font-bold">404</h1><h2 className="mt-4 text-xl font-semibold">Page not found</h2><Button asChild className="mt-6"><Link to="/">Go home</Link></Button></div></main>;
  return <main className="min-h-dvh bg-background"><header className="mx-auto flex max-w-4xl items-center gap-3 px-4 pt-4"><Button asChild variant="outline" size="icon" className="rounded-full"><Link to="/admin" aria-label="Back to admin"><ArrowLeft className="size-5" /></Link></Button><h1 className="text-xl font-bold">Duplicate wineries</h1></header><div className="mx-auto max-w-4xl px-4 pb-16"><div className="my-5 flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-sm text-muted-foreground">{pairs.data ? `${pairs.data.length} candidate pairs` : 'Checking wineries…'}</p><Button variant="outline" disabled={busy || pairs.isPending} onClick={() => action(async () => { setPreview(await getPreview()); setPreviewOpen(true); setResult(null); })}><Scan className="size-4" />Preview automatic handling</Button></div>{error && <p role="alert" className="my-4 text-sm text-destructive">{error}</p>}{displayedResult && <p role="status" className="my-4 text-sm text-primary">{displayedResult}</p>}{(pairs.isError || history.isError) && <div role="alert" className="my-4 text-destructive">{pairs.error?.message || history.error?.message}<Button variant="outline" onClick={refresh} className="ml-3">Try again</Button></div>}
    <Tabs value={tab} onValueChange={setTab}><TabsList className="max-w-full"><TabsTrigger value="manual">Manual ({manual.length})</TabsTrigger><TabsTrigger value="merged">Merged ({history.data?.merged.length ?? 0})</TabsTrigger><TabsTrigger value="dismissed">Dismissed ({history.data?.dismissed.length ?? 0})</TabsTrigger></TabsList><TabsContent value="manual"><dl aria-label="Remaining pair sources" className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"><div><dt className="inline">OSM–DATAtourisme</dt><dd className="ml-2 inline font-semibold text-foreground">{breakdown.osmDatatourisme}</dd></div><div><dt className="inline">DATAtourisme–DATAtourisme</dt><dd className="ml-2 inline font-semibold text-foreground">{breakdown.datatourismeDatatourisme}</dd></div><div><dt className="inline">OSM–OSM</dt><dd className="ml-2 inline font-semibold text-foreground">{breakdown.osmOsm}</dd></div></dl>{pairs.data && manual.length === 0 && <p className="mt-8 text-muted-foreground">No uncertain pairs.</p>}<ul className="mt-5 space-y-5">{manual.map((pair, i) => <PairReview key={`${pair.winery_a.id}-${pair.winery_b.id}`} pair={pair} active={tab === 'manual' && i === selected} onSelect={() => setActive(i)} onChanged={refresh} />)}</ul></TabsContent><TabsContent value="merged"><ul className="mt-5 space-y-4">{history.data?.merged.map(entry => <li key={entry.id} className="rounded-lg bg-card p-4 shadow-[var(--shadow-soft)]"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{entry.mode === 'unique_osm' ? 'Unique OSM match' : entry.mode === 'automatic' ? 'Automatic merge' : 'Manual merge'} · {new Date(entry.created_at).toLocaleString()}</span><Button variant="outline" disabled={busy} onClick={() => action(async () => { await undo({ data: { id: entry.id } }); await refresh(); })}><RotateCcw className="size-4" />Undo</Button></div><div className="grid grid-cols-2 gap-4">{entry.wineries.map((w, i) => <div key={w.id}><p className="mb-2 text-xs font-semibold text-primary">{w.id === entry.kept_id ? 'Kept record' : 'Merged record'}</p><RecordDetails winery={w} number={i + 1} /></div>)}</div></li>)}</ul>{history.data?.merged.length === 0 && <p className="mt-8 text-muted-foreground">No merges.</p>}</TabsContent><TabsContent value="dismissed"><ul className="mt-5 space-y-4">{history.data?.dismissed.map(entry => <li key={`${entry.winery_a.id}-${entry.winery_b.id}`} className="rounded-lg bg-card p-4 shadow-[var(--shadow-soft)]"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{entry.reason}</span><Button variant="outline" disabled={busy} onClick={() => action(async () => { await restore({ data: { a: entry.winery_a.id, b: entry.winery_b.id } }); await refresh(); })}><RotateCcw className="size-4" />Restore to list</Button></div><div className="grid grid-cols-2 gap-4"><RecordDetails winery={entry.winery_a} number={1} /><RecordDetails winery={entry.winery_b} number={2} /></div></li>)}</ul>{history.data?.dismissed.length === 0 && <p className="mt-8 text-muted-foreground">No dismissed pairs.</p>}</TabsContent></Tabs>
    <Dialog open={previewOpen} onOpenChange={value => { if (!busy) setPreviewOpen(value); }}><DialogContent className="max-h-[85dvh] max-w-[calc(100%-32px)] overflow-y-auto sm:max-w-2xl"><DialogTitle>Automatic handling preview</DialogTitle><DialogDescription>{preview?.pairs.length ?? 0} candidate pairs · {preview?.pairs.filter(p => p.classification === 'manual').length ?? 0} stay in manual review</DialogDescription>{(['different', 'same', 'unique_osm', 'manual'] as const).map(group => { const entries = preview?.pairs.filter(p => p.classification === group) ?? []; return <section key={group} className="border-t border-border pt-4"><h3 className="font-semibold">{group === 'different' ? 'Different address' : group === 'same' ? 'Same address' : group === 'unique_osm' ? 'Unique OSM match' : 'Manual review'} · {entries.length}</h3><ol className="mt-2 space-y-3 text-sm">{entries.slice(0, 5).map(p => <li key={`${p.winery_a.id}-${p.winery_b.id}`} className="min-w-0 break-words"><p className="font-medium">{p.winery_a.name} ↔ {p.winery_b.name}</p><p className="text-muted-foreground">{p.winery_a.address || 'No address'} ↔ {p.winery_b.address || 'No address'}</p><p className="text-xs text-muted-foreground">{p.address_a.house || '—'} {p.address_a.street || '—'} ↔ {p.address_b.house || '—'} {p.address_b.street || '—'}</p></li>)}</ol>{entries.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No pairs.</p>}</section>; })}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy || !preview || !preview.pairs.some(p => p.classification !== 'manual')} onClick={() => action(async () => { if (!preview) return; const outcome = await apply({ data: { id: preview.id } }); setPreviewOpen(false); setPreview(null); setResult(`${outcome.merged} merged · ${outcome.dismissed} dismissed`); await refresh(); })}><GitMerge className="size-4" />{busy ? 'Applying…' : 'Apply'}</Button></DialogContent></Dialog>
  </div></main>;
}
