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
import { BANNER_ASPECT, getCroppedBannerBlob } from "@/lib/image-crop";

type BannerImageCropDialogProps = {
  open: boolean;
  imageSrc: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => Promise<void>;
};

export function BannerImageCropDialog({
  open,
  imageSrc,
  onOpenChange,
  onConfirm,
}: BannerImageCropDialogProps) {
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
      const blob = await getCroppedBannerBlob(imageSrc, croppedArea);
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
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 px-5 pt-5">
          <DialogTitle>Crop banner image</DialogTitle>
          <DialogDescription>
            Drag to reposition and use the slider to zoom. Banners are saved at 1200×500 px.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-4 h-56 w-full bg-muted sm:h-64">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={BANNER_ASPECT}
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
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply crop & upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
