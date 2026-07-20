import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IncomingCall } from "@/hooks/use-incoming-calls";

type Props = {
  call: IncomingCall;
  onAccept: () => void;
  onDecline: () => void;
};

export function IncomingCallOverlay({ call, onAccept, onDecline }: Props) {
  const isVideo = call.kind === "video";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-gray-950/95 px-6 text-white">
      <div className="relative mb-8">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
        <div className="relative grid h-24 w-24 place-items-center rounded-full bg-primary/20 text-3xl font-bold text-primary ring-4 ring-primary/40">
          {call.callerName.slice(0, 1).toUpperCase()}
        </div>
      </div>

      <p className="text-sm uppercase tracking-widest text-white/60">Incoming call</p>
      <h2 className="mt-2 text-2xl font-bold">{call.callerName}</h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
        {isVideo ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
        {isVideo ? "Video call" : "Audio call"}
      </p>

      <div className="mt-12 flex w-full max-w-xs items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <Button
            size="icon"
            variant="destructive"
            className="h-16 w-16 rounded-full"
            onClick={onDecline}
            aria-label="Decline call"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
          <span className="text-xs text-white/60">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Button
            size="icon"
            className="h-16 w-16 rounded-full bg-green-600 hover:bg-green-500"
            onClick={onAccept}
            aria-label="Accept call"
          >
            {isVideo ? <Video className="h-7 w-7" /> : <Phone className="h-7 w-7" />}
          </Button>
          <span className="text-xs text-white/60">Accept</span>
        </div>
      </div>
    </div>
  );
}
