"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Dropdown filter that updates one URL search param (and resets paging). */
export function FilterSelect({ name, options, label }: { name: string; label: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const current = params.get(name) ?? "";
  const active = current !== "";

  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          next.delete("page");
          router.push(`${path}?${next}`);
        }}
        className={`h-10 appearance-none rounded-xl border bg-white pl-3.5 pr-9 text-[13px] font-medium outline-none transition focus:border-brand ${
          active ? "border-brand text-brand-strong" : "border-line text-zinc-700 hover:border-zinc-300"
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === "" ? label : o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" />
    </label>
  );
}
