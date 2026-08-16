/** True only for a payment response that Clover explicitly classified as no money moved. */
export function isDefinitelyDeclined(error: unknown): boolean {
  return error instanceof Error && (error as Error & { retrySafe?: unknown }).retrySafe === true;
}
