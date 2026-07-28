import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORIES_MAX, type CategoryOption } from "@/lib/categories";

type CategoryPickerProps = {
  categories: CategoryOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
};

export function CategoryPicker({
  categories,
  value,
  onChange,
  disabled,
  loading,
}: CategoryPickerProps) {
  function toggle(slug: string) {
    if (disabled) return;
    if (value.includes(slug)) {
      onChange(value.filter((s) => s !== slug));
      return;
    }
    if (value.length >= CATEGORIES_MAX) return;
    onChange([...value, slug]);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading categories…</p>;
  }

  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories available.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {categories.map((category) => {
          const selected = value.includes(category.slug);
          return (
            <button
              key={category.id}
              type="button"
              disabled={disabled || (!selected && value.length >= CATEGORIES_MAX)}
              onClick={() => toggle(category.slug)}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                selected
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border hover:border-primary/40",
                disabled && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
                aria-hidden
              >
                {selected ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="min-w-0 flex-1 font-medium">
                {category.emoji ? `${category.emoji} ` : ""}
                {category.name}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value.length}/{CATEGORIES_MAX} selected · choose at least 1
      </p>
    </div>
  );
}
