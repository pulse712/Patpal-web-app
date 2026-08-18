/** Pat Pal is accepting calls (toggle on dashboard). Not the same as in-app presence. */
export function isAcceptingCalls(availability: string | null | undefined): boolean {
  return availability === "available" || availability === "busy";
}

export function availabilityLabel(availability: string | null | undefined): string {
  return isAcceptingCalls(availability) ? "Available" : "Away";
}
