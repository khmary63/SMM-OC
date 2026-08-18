"use client";

import { useRef, useState } from "react";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Частые",
    emojis: ["🔥", "✨", "💡", "🚀", "👍", "❤️", "😊", "🎉", "⭐", "✅", "📌", "💬"],
  },
  {
    label: "Эмоции",
    emojis: ["😀", "😄", "😉", "😍", "🥳", "😎", "🤔", "😢", "😱", "🙌", "👏", "🤝"],
  },
  {
    label: "Символы",
    emojis: ["➡️", "⬇️", "⚡", "🎯", "📈", "📉", "🕐", "📅", "💰", "🎁", "🆕", "❗"],
  },
];

type Mutation = { value: string; cursor: number };

function wrapSelection(value: string, start: number, end: number, marker: string): Mutation {
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
  const cursor = selected ? end + marker.length * 2 : start + marker.length;
  return { value: next, cursor };
}

function toggleBulletList(value: string, start: number, end: number): Mutation {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIdx = value.indexOf("\n", end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const allPrefixed = lines.every((l) => l.trim() === "" || l.startsWith("• "));
  const nextLines = lines.map((l) => {
    if (l.trim() === "") return l;
    if (allPrefixed) return l.replace(/^• /, "");
    return l.startsWith("• ") ? l : `• ${l}`;
  });
  const nextBlock = nextLines.join("\n");
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return { value: next, cursor: lineStart + nextBlock.length };
}

export function FormattableField({
  as,
  name,
  defaultValue = "",
  disabled,
  required,
  placeholder,
  rows,
  className = "input",
}: {
  as: "input" | "textarea";
  name: string;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);

  function apply(mutate: (v: string, s: number, e: number) => Mutation) {
    const el = ref.current;
    if (!el || disabled) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const { value: next, cursor } = mutate(value, start, end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function insertEmoji(emoji: string) {
    apply((v, s, e) => {
      const next = v.slice(0, s) + emoji + v.slice(e);
      return { value: next, cursor: s + emoji.length };
    });
    setEmojiOpen(false);
  }

  return (
    <div className="relative">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <button
          type="button"
          className="rounded border border-zinc-200 px-2 py-0.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50"
          disabled={disabled}
          onClick={() => apply((v, s, e) => wrapSelection(v, s, e, "**"))}
          title="Жирный"
        >
          B
        </button>
        <button
          type="button"
          className="rounded border border-zinc-200 px-2 py-0.5 text-xs italic hover:bg-zinc-50 disabled:opacity-50"
          disabled={disabled}
          onClick={() => apply((v, s, e) => wrapSelection(v, s, e, "_"))}
          title="Курсив"
        >
          I
        </button>
        {as === "textarea" && (
          <button
            type="button"
            className="rounded border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
            disabled={disabled}
            onClick={() => apply(toggleBulletList)}
            title="Маркированный список"
          >
            • Список
          </button>
        )}
        <button
          type="button"
          className="rounded border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
          disabled={disabled}
          onClick={() => setEmojiOpen((v) => !v)}
          title="Эмодзи"
        >
          🙂
        </button>
      </div>

      {emojiOpen && (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          {EMOJI_GROUPS.map((g) => (
            <div key={g.label} className="mb-1 last:mb-0">
              <p className="mb-1 text-[10px] uppercase text-zinc-400">{g.label}</p>
              <div className="flex flex-wrap gap-1">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="rounded px-1 text-lg hover:bg-zinc-100"
                    onClick={() => insertEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {as === "textarea" ? (
        <textarea
          ref={ref}
          name={name}
          className={className}
          rows={rows ?? 4}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onFocus={() => setEmojiOpen(false)}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : (
        <input
          ref={ref}
          name={name}
          className={className}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onFocus={() => setEmojiOpen(false)}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
    </div>
  );
}
