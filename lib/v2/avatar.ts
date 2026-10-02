/** Разбор profiles.avatar_url: 'photo:<путь>?v=…' или 'preset:N'. */
export function parseAvatar(v: string | null | undefined): { kind: "photo"; path: string } | { kind: "preset"; n: number } | null {
  if (!v) return null;
  if (v.startsWith("photo:")) return { kind: "photo", path: v.slice(6).split("?")[0] };
  const m = /^preset:([1-8])$/.exec(v);
  return m ? { kind: "preset", n: Number(m[1]) } : null;
}
