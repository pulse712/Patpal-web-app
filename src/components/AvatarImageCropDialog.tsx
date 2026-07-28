import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { AVATAR_OUTPUT_SIZE, getCroppedAvatarBlob } from "@/lib/image-crop";

type AvatarImageCropDialogProps = {
  open: boolean;
  imageSrc: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => Promise<void>;
};

export function AvatarImageCropDialog({
  open,
  imageSrc,
  onOpenChange,
  onConfirm,
}: AvatarImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedArea(pixels);
  }, []);

  async function handleConfirm() {
    if (!imageSrc || !croppedArea) return;
    setBusy(true);
    try {
      const blob = await getCroppedAvatarBlob(imageSrc, croppedArea);
      await onConfirm(blob);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedArea(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 px-5 pt-5">
          <DialogTitle>Crop profile photo</DialogTitle>
          <DialogDescription>
            Drag to reposition and use the slider to zoom. Photos are saved at{" "}
            {AVATAR_OUTPUT_SIZE}×{AVATAR_OUTPUT_SIZE} px.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-4 aspect-square w-full bg-muted">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : null}
        </div>

        <div className="space-y-2 px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">Zoom</p>
          <Slider
            value={[zoom]}
            min={1}
            max={3}
            step={0.05}
            onValueChange={(value) => setZoom(value[0] ?? 1)}
          />
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy || !croppedArea} onClick={() => void handleConfirm()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
