import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LANGUAGES_MAX, SUGGESTED_LANGUAGES, normalizeLanguages } from "@/lib/profile-fields";

type LanguagePickerProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

export function LanguagePicker({ value, onChange, disabled }: LanguagePickerProps) {
  const [draft, setDraft] = useState("");

  function addLanguage(raw: string) {
    const next = normalizeLanguages([...value, raw]);
    onChange(next);
    setDraft("");
  }

  function removeLanguage(lang: string) {
    onChange(value.filter((l) => l !== lang));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((lang) => (
          <span
            key={lang}
            className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary"
          >
            {lang}
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeLanguage(lang)}
              className="rounded-full p-0.5 hover:bg-primary/10"
              aria-label={`Remove ${lang}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          disabled={disabled || value.length >= LANGUAGES_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a language"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) addLanguage(draft);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !draft.trim() || value.length >= LANGUAGES_MAX}
          onClick={() => addLanguage(draft)}
        >
          Add
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_LANGUAGES.filter(
          (lang) => !value.some((v) => v.toLowerCase() === lang.toLowerCase()),
        ).map((lang) => (
          <button
            key={lang}
            type="button"
            disabled={disabled || value.length >= LANGUAGES_MAX}
            onClick={() => addLanguage(lang)}
            className={cn(
              "rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors",
              "hover:border-primary/40 hover:text-foreground disabled:opacity-50",
            )}
          >
            + {lang}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {value.length}/{LANGUAGES_MAX} languages · at least 1 required
      </p>
    </div>
  );
}
