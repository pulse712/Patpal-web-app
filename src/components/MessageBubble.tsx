import { cn } from "@/lib/utils";
import { formatMessageTimestamp } from "@/lib/format-message-time";

type MessageBubbleProps = {
  body: string;
  createdAt: string;
  mine: boolean;
  /** Default chat screen styling; `call` uses the in-call dark overlay palette. */
  variant?: "chat" | "call";
};

export function MessageBubble({ body, createdAt, mine, variant = "chat" }: MessageBubbleProps) {
  const timestamp = formatMessageTimestamp(createdAt);
  const isCall = variant === "call";

  return (
    <div className={cn("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
          isCall
            ? mine
              ? "bg-primary text-white rounded-br-sm"
              : "bg-white/10 text-white rounded-bl-sm"
            : mine
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {body}
      </div>
      {timestamp ? (
        <time
          dateTime={createdAt}
          className={cn(
            "px-1 text-[10px] leading-tight",
            isCall ? "text-gray-400" : "text-muted-foreground",
          )}
        >
          {timestamp}
        </time>
      ) : null}
    </div>
  );
}
