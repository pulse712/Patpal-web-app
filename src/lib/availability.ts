/** Pal is taking calls. Independent of whether the app is in the foreground. */
export function isAcceptingCalls(availability: string | null | undefined): boolean {
  return availability === "available" || availability === "busy";
}
