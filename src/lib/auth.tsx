import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Profile = Tables<"users">;

type AuthCtx = {
  user: User | null;
  profile: Profile | null;
  /** Runs the action now if signed in, otherwise asks the user to sign in first. */
  requireAuth: (action: () => void) => void;
  openProfile: () => void;
  profileOpen: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
const signedOut: AuthCtx = { user: null, profile: null, requireAuth: () => {}, openProfile: () => {}, profileOpen: false, signOut: async () => {} };

export function useAuth() {
  // Falls back to a signed-out state (e.g. mid hot-reload) instead of blanking the page.
  return useContext(Ctx) ?? signedOut;
}

/** Fresh user id at call time — safe inside callbacks that run after sign-in. */
export async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export const profileQueryKey = (id: string | undefined) => ["profile", id] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (event === "SIGNED_IN") {
        setSignInOpen(false);
        const action = pending.current;
        pending.current = null;
        if (action) window.setTimeout(action, 0);
      }
      void qc.invalidateQueries({ queryKey: ["winery"] });
    });
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
    return () => subscription.unsubscribe();
  }, [qc]);

  const profileQuery = useQuery({
    queryKey: profileQueryKey(user?.id),
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("*").eq("auth_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const profile = profileQuery.data ?? null;
  const needsName = !!user && profileQuery.isSuccess && !profile?.display_name;

  const requireAuth = useCallback((action: () => void) => {
    if (user) return action();
    pending.current = action;
    setSignInOpen(true);
  }, [user]);

  const signOut = useCallback(async () => {
    await qc.cancelQueries();
    qc.removeQueries({ queryKey: ["saves"] });
    qc.removeQueries({ queryKey: ["profile"] });
    await supabase.auth.signOut();
  }, [qc]);

  return (
    <Ctx.Provider value={{ user, profile, requireAuth, openProfile: () => setProfileOpen(true), profileOpen, signOut }}>
      {children}
      <SignInDialog open={signInOpen} onOpenChange={(o) => { setSignInOpen(o); if (!o) pending.current = null; }} />
      {user && (
        <ProfileDialog
          open={needsName || profileOpen}
          required={needsName}
          user={user}
          profile={profile}
          onDone={() => setProfileOpen(false)}
        />
      )}
    </Ctx.Provider>
  );
}

function SignInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!open) { setSent(false); setError(null); } }, [open]);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Please enter a valid email.");
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.href } });
    setBusy(false);
    if (error) return setError("Couldn’t send the link. Please try again.");
    setSent(true);
  };
  const google = async () => {
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.href });
    if (result.error) setError("Google sign-in didn’t work. Please try again.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>Sign in to save and recommend</DialogTitle>
          <DialogDescription>Browsing stays open to everyone.</DialogDescription>
        </DialogHeader>
        {sent ? (
          <p className="text-sm">Check <strong>{email}</strong> for a sign-in link.</p>
        ) : (
          <div className="space-y-4">
            <Button type="button" variant="outline" className="h-11 w-full rounded-full" onClick={google}>Continue with Google</Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <form onSubmit={sendLink} className="space-y-3">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email"
                className="h-11 w-full rounded-full border bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <Button disabled={busy} className="h-11 w-full rounded-full">{busy ? "Sending…" : "Email me a link"}</Button>
            </form>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

async function resizeToDataUrl(file: File, size = 160) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function ProfileDialog({ open, required, user, profile, onDone }: { open: boolean; required: boolean; user: User; profile: Profile | null; onDone: () => void }) {
  const qc = useQueryClient();
  const suggested = (user.user_metadata?.["full_name"] as string | undefined) ?? "";
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(profile?.display_name ?? suggested);
    setPhoto(profile?.avatar_url ?? null);
  }, [open, profile, suggested]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return setError("Please choose a display name.");
    setBusy(true); setError(null);
    const { error } = await supabase.from("users").upsert({ auth_id: user.id, display_name: trimmed, avatar_url: photo }, { onConflict: "auth_id" });
    setBusy(false);
    if (error) return setError("Couldn’t save your profile. Please try again.");
    await qc.invalidateQueries({ queryKey: profileQueryKey(user.id) });
    void qc.invalidateQueries({ queryKey: ["winery"] });
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !required) onDone(); }}>
      <DialogContent className="max-w-sm rounded-lg" onInteractOutside={(e) => { if (required) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (required) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{required ? "What should we call you?" : "Your profile"}</DialogTitle>
          <DialogDescription>Your name and photo appear on your recommendations.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={name} url={photo} className="size-16 text-xl" />
            <div className="flex flex-col items-start gap-1">
              <label className="cursor-pointer text-sm font-semibold text-primary">
                {photo ? "Change photo" : "Add a photo (optional)"}
                <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setPhoto(await resizeToDataUrl(file));
                }} />
              </label>
              {photo && <button type="button" className="text-sm text-muted-foreground" onClick={() => setPhoto(null)}>Remove photo</button>}
            </div>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Display name" aria-label="Display name" autoFocus
            className="h-11 w-full rounded-full border bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={busy} className="h-11 w-full rounded-full">{busy ? "Saving…" : "Save"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Avatar({ name, url, className = "", circleClass = "bg-tag text-tag-foreground" }: { name?: string | null | undefined; url?: string | null | undefined; className?: string; circleClass?: string }) {
  return url ? (
    <img src={url} alt="" referrerPolicy="no-referrer" className={`shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-semibold ${circleClass} ${className}`}>
      {(name?.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
