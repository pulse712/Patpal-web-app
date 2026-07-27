import logoSrc from "@/Asset/logo.png";
import faviconSrc from "@/Asset/favicon.png";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  /** Full wordmark (default) or square mark for tight spaces. */
  variant?: "full" | "mark";
};

export function BrandLogo({ className, variant = "full" }: BrandLogoProps) {
  if (variant === "mark") {
    return (
      <img
        src={faviconSrc}
        alt="Pat My Back"
        className={cn("h-9 w-9 rounded-lg object-contain", className)}
      />
    );
  }

  return (
    <img
      src={logoSrc}
      alt="Pat My Back"
      className={cn("h-9 w-auto max-w-[200px] object-contain object-left", className)}
    />
  );
}
