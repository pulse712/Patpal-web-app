// Client-callable server functions for Stripe operations.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

const checkoutSchema = z.union([
  z.object({
    packageId: z.string(),
    customCents: z.undefined().optional(),
    returnOrigin: z.string().optional(),
  }),
  z.object({
    customCents: z.number().min(500),
    packageId: z.undefined().optional(),
    returnOrigin: z.string().optional(),
  }),
]);

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => checkoutSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { resolveCreditPackages, createWalletCheckoutSession } =
      await import("@/lib/stripe.server");
    const { userId } = context;
    const request = getRequest();

    let seconds: number;
    let amountCents: number;
    let label: string;

    if (data.packageId) {
      const packages = await resolveCreditPackages();
      const pkg = packages.find((p) => p.id === data.packageId);
      if (!pkg) throw new Error("Invalid package ID");
      seconds = pkg.seconds;
      amountCents = pkg.amount;
      label = pkg.label;
    } else {
      amountCents = Math.round(data.customCents!);
      const ratePerMinCents = 1000 / 15;
      seconds = Math.round((amountCents / ratePerMinCents) * 60);
      label = `Custom top-up (${Math.round(seconds / 60)} min)`;
    }

    const url = await createWalletCheckoutSession({
      userId,
      seconds,
      amountCents,
      label,
      returnOrigin: data.returnOrigin,
      request,
    });

    return { url };
  });
