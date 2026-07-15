import { createFileRoute } from "@tanstack/react-router";
import { seedDemoPatPals } from "@/lib/seed.functions";

export const Route = createFileRoute("/api/public/seed-demos")({
  server: {
    handlers: {
      POST: async () => {
        const result = await seedDemoPatPals();
        return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
