/**
 * Creator avatar served from our own store (`/api/avatar/[id]`), which falls back to an
 * initial-letter image — Kalodata's own avatar URLs expire after 5 minutes.
 */
export function Avatar({ id, name, size = 38 }: { id?: string; name: string; size?: number }) {
  const src = id ? `/api/avatar/${id}?n=${encodeURIComponent(name)}` : `/api/avatar/_?n=${encodeURIComponent(name)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny avatars from our own route, no optimisation needed
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-[22%] bg-slate-100 object-cover shadow-sm ring-2 ring-white"
      style={{ width: size, height: size }}
    />
  );
}
