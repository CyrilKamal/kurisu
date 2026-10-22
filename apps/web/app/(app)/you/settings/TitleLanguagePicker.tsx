"use client";

import { titleLanguageResponseSchema, type TitleLanguage } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RadioChips } from "@/components/RadioChips";
import { sendApi } from "@/lib/clientApi";

const OPTIONS: [TitleLanguage, string, string][] = [
  ["romaji", "Romaji", "Sousou no Frieren"],
  ["english", "English", "Frieren: Beyond Journey’s End"],
  ["japanese", "Japanese", "葬送のフリーレン"],
];

/**
 * Which of a show's titles the app shows: MyAnimeList's romaji, the English one, or the
 * Japanese. Chat and the morning brief keep MyAnimeList's, since kurisu reads them back.
 */
export function TitleLanguagePicker({ initial }: { initial: TitleLanguage }) {
  const router = useRouter();
  const [language, setLanguage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const example = OPTIONS.find(([value]) => value === language)?.[2] ?? "";

  async function choose(next: TitleLanguage) {
    if (next === language) return;
    setBusy(true);
    setMessage(null);
    const result = await sendApi("PUT", "/me/title-language", titleLanguageResponseSchema, {
      language: next,
    });
    setBusy(false);
    if (result.ok && result.data) {
      setLanguage(result.data.titleLanguage);
      router.refresh();
    } else {
      setMessage("Couldn't save that. Try again.");
    }
  }

  return (
    <section className="pt-6">
      <h2 className="k-title pb-2">Titles</h2>
      <div className="k-panel flex flex-col gap-4 p-4">
        <RadioChips
          label="Show titles in"
          options={OPTIONS.map(([value, label]) => [value, label] as const)}
          value={language}
          disabled={busy}
          onChange={(next) => void choose(next)}
        />
        <p className="k-field__hint">
          Like &ldquo;{example}&rdquo;.{" "}
          {language === "romaji"
            ? "MyAnimeList's own titles."
            : `A show without ${language === "english" ? "an English" : "a Japanese"} title on MyAnimeList keeps its romaji one.`}{" "}
          Chat and the morning brief always use MyAnimeList&apos;s titles.
        </p>
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}
