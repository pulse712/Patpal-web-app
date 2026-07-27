import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverAuth } from "@/lib/server-auth";
import { validateProfileFields } from "@/lib/profile-fields";

export type MyProfileData = {
  fullName: string;
  introduction: string;
  languages: string[];
  headline: string;
  pricePerMinute: string;
  isListable: boolean;
  email: string;
};

const saveMyProfileSchema = z.object({
  fullName: z.string(),
  introduction: z.string(),
  languages: z.array(z.string()),
  headline: z.string(),
  pricePerMinute: z.string(),
  isListable: z.boolean(),
});

async function loadProfileRow(
  supabaseAdmin: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"],
  userId: string,
) {
  const extended = await supabaseAdmin
    .from("profiles")
    .select("full_name, introduction, languages")
    .eq("id", userId)
    .maybeSingle();

  if (!extended.error) return extended.data;

  if (/introduction|languages|column/i.test(extended.error.message)) {
    const basic = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    if (basic.error) throw new Error(basic.error.message);
    return basic.data
      ? { ...basic.data, introduction: null, languages: [] as string[] }
      : null;
  }

  throw new Error(extended.error.message);
}

async function loadPalRow(
  supabaseAdmin: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"],
  userId: string,
) {
  return supabaseAdmin
    .from("pat_pals")
    .select("headline, price_cents_per_minute")
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data;
    });
}

async function buildMyProfileData(
  supabaseAdmin: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"],
  userId: string,
): Promise<MyProfileData> {
  const [{ data: authUser }, profile, palRes] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    loadProfileRow(supabaseAdmin, userId),
    loadPalRow(supabaseAdmin, userId),
  ]);

  const loadedLanguages = Array.isArray(profile?.languages) ? profile.languages : [];

  return {
    email: authUser?.user?.email ?? "",
    fullName: profile?.full_name ?? "",
    introduction: profile?.introduction ?? "",
    languages: loadedLanguages.length > 0 ? loadedLanguages : ["English"],
    headline: palRes?.headline ?? "",
    pricePerMinute: String((palRes?.price_cents_per_minute ?? 100) / 100),
    isListable: !!palRes,
  };
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }): Promise<MyProfileData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildMyProfileData(supabaseAdmin, context.userId);
  });

export const saveMyProfile = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => saveMyProfileSchema.parse(data))
  .handler(async ({ data, context }): Promise<MyProfileData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const price = parseFloat(data.pricePerMinute);
    const { languages: normalizedLanguages } = validateProfileFields({
      fullName: data.fullName,
      introduction: data.introduction,
      languages: data.languages,
      headline: data.headline,
      pricePerMinute: data.isListable ? (Number.isFinite(price) ? price : undefined) : undefined,
      isListable: data.isListable,
    });

    const profilePayload = {
      full_name: data.fullName.trim(),
      introduction: data.introduction.trim() || null,
      languages: normalizedLanguages,
    };

    let profileRes = await supabaseAdmin
      .from("profiles")
      .update(profilePayload)
      .eq("id", userId)
      .select("id")
      .maybeSingle();

    if (profileRes.error && /introduction|languages|column/i.test(profileRes.error.message)) {
      profileRes = await supabaseAdmin
        .from("profiles")
        .update({ full_name: profilePayload.full_name })
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      if (profileRes.error) throw new Error(profileRes.error.message);
    } else if (profileRes.error) {
      throw new Error(profileRes.error.message);
    }

    if (!profileRes.data) {
      const insertRes = await supabaseAdmin.from("profiles").insert({
        id: userId,
        ...profilePayload,
      });
      if (insertRes.error) throw new Error(insertRes.error.message);
    }

    if (data.isListable) {
      const rate = Number.isFinite(price) ? price : 1;
      const cents = Math.max(0, Math.round(rate * 100));
      const palRes = await supabaseAdmin
        .from("pat_pals")
        .update({
          headline: data.headline.trim() || null,
          price_cents_per_minute: cents,
        })
        .eq("user_id", userId)
        .select("user_id")
        .maybeSingle();

      if (palRes.error) throw new Error(palRes.error.message);
      if (!palRes.data) throw new Error("Pat Pal listing not found.");
    }

    return buildMyProfileData(supabaseAdmin, userId);
  });
