import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, GitMerge, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { duplicatePairsQuery, type Winery } from "@/lib/wine";
import { dismissDuplicatePair, mergeDuplicatePair, type DuplicatePair } from "@/lib/duplicates.functions";
import { WineryPairMap } from "@/components/WineMap";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute('/admin_/duplicates')({ head: () => ({ meta: [
  { title: 'Duplicate wineries — Grapevines' }, { name: 'description', content: 'Manually review and merge candidate duplicate wineries in Alsace.' }, { name: 'robots', content: 'noindex' },
  { property: 'og:title', content: 'Duplicate wineries — Grapevines' }, { property: 'og:description', content: 'Manually review and merge candidate duplicate wineries in Alsace.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
] }), component: DuplicatesPage });

function RecordDetails({ winery, number }: { winery: Winery; number: number }) {
  const sources = Array.isArray(winery.sources) ? winery.sources : [];
  const website = winery.website?.trim();
  const safeUrl = website && /^https?:\/\//i.test(website) ? website : undefined;
  return <div className="min-w-0 space-y-3"><h2 className="break-words font-semibold">{number}. {winery.name}</h2><dl className="space-y-3 text-sm"><div><dt className="text-muted-foreground">Sources</dt><dd className="break-words">{sources.length ? sources.map((s, i) => { const item = s && typeof s === 'object' && !Array.isArray(s) ? s : {}; return <div key={i}>{String(item['source'] ?? '—')} · {String(item['source_id'] ?? '—')}</div>; }) : '—'}</dd></div><div><dt className="text-muted-foreground">Website</dt><dd className="break-all">{safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer" className="text-primary underline">{website}</a> : website || '—'}</dd></div><div><dt className="text-muted-foreground">Address</dt><dd className="break-words">{winery.address || '—'}</dd></div></dl></div>;
}

function PairReview({ pair, onChanged }: { pair: DuplicatePair; onChanged: () => Promise<void> }) {
  const wineries = useMemo<[Winery,Winery]>(() => [pair.winery_a,pair.winery_b], [pair]);
  const [open,setOpen] = useState(false);
  const [keep,setKeep] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const merge = useServerFn(mergeDuplicatePair);
  const dismiss = useServerFn(dismissDuplicatePair);
  async function act(action: 'merge' | 'dismiss') {
    setBusy(true); setError(null);
    try {
      if (action === 'merge') { if (!keep) return; await merge({ data: { a: keep, b: keep === pair.winery_a.id ? pair.winery_b.id : pair.winery_a.id } }); setOpen(false); }
      else await dismiss({ data: { a: pair.winery_a.id, b: pair.winery_b.id } });
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update this pair.'); } finally { setBusy(false); }
  }
  return <li className="rounded-lg bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5"><div className="mb-4 text-sm font-semibold text-primary">{pair.distance_metres.toFixed(1)} metres apart</div><div className="grid grid-cols-2 gap-4"><RecordDetails winery={pair.winery_a} number={1} /><RecordDetails winery={pair.winery_b} number={2} /></div><div className="mt-5"><WineryPairMap wineries={wineries} /></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { setKeep(''); setError(null); setOpen(true); }}><GitMerge className="size-4" />Merge</Button><Button variant="outline" disabled={busy} onClick={() => act('dismiss')}><X className="size-4" />Not a duplicate</Button></div>{error && !open && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent className="max-w-[calc(100%-32px)] sm:max-w-lg"><DialogTitle>Choose the winery to keep</DialogTitle><DialogDescription>The other record will be deleted after its sources, saved visits and recommendations are moved.</DialogDescription><RadioGroup value={keep} onValueChange={setKeep} disabled={busy}>{wineries.map((w,i) => <Label key={w.id} htmlFor={`keep-${w.id}`} className="flex items-start gap-3 rounded-lg border border-border p-3 leading-normal"><RadioGroupItem id={`keep-${w.id}`} value={w.id} className="mt-1 shrink-0" /><span className="min-w-0 break-words">{i+1}. {w.name}<span className="mt-1 block text-xs text-muted-foreground">{w.address || 'No address'}</span></span></Label>)}</RadioGroup>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={!keep || busy} onClick={() => act('merge')}><GitMerge className="size-4" />{busy ? 'Merging…' : 'Confirm merge'}</Button></DialogContent></Dialog></li>;
}

function DuplicatesPage() {
  const { user,profile } = useAuth();
  const [checked,setChecked] = useState(false);
  const qc = useQueryClient();
  useEffect(() => { supabase.auth.getSession().finally(() => setTimeout(() => setChecked(true),300)); }, []);
  const pairs = useQuery({ ...duplicatePairsQuery(user?.id ?? ''), enabled: !!profile?.is_admin });
  if (!checked || (user && !profile)) return <div className="min-h-dvh bg-background" />;
  if (!profile?.is_admin) return <main className="grid min-h-dvh place-items-center bg-background"><div className="text-center"><h1 className="text-7xl font-bold">404</h1><h2 className="mt-4 text-xl font-semibold">Page not found</h2><Button asChild className="mt-6"><Link to="/">Go home</Link></Button></div></main>;
  async function refresh() { await Promise.all(['admin-duplicates','wineries','winery','saves','admin-wineries'].map((key) => qc.invalidateQueries({ queryKey: [key] }))); }
  return <main className="min-h-dvh bg-background"><header className="mx-auto flex max-w-4xl items-center gap-3 px-4 pt-4"><Button asChild variant="outline" size="icon" className="rounded-full"><Link to="/admin" aria-label="Back to admin"><ArrowLeft className="size-5" /></Link></Button><h1 className="text-xl font-bold">Duplicate wineries</h1></header><div className="mx-auto max-w-4xl px-4 pb-16"><p aria-live="polite" className="mt-4 text-sm text-muted-foreground">{pairs.data ? `${pairs.data.length} candidate pairs · Alsace` : 'Checking wineries…'}</p>{pairs.isError && <div role="alert" className="mt-5 text-sm text-destructive">{pairs.error.message}<Button variant="outline" onClick={() => pairs.refetch()} className="ml-3">Try again</Button></div>}{pairs.data?.length === 0 && <p className="mt-8 text-muted-foreground">No candidate duplicates.</p>}<ul className="mt-5 space-y-5">{pairs.data?.map((pair) => <PairReview key={`${pair.winery_a.id}-${pair.winery_b.id}`} pair={pair} onChanged={refresh} />)}</ul></div></main>;
}