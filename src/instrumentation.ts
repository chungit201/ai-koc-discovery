/** On server start, resume campaigns whose pipeline was interrupted (crash, restart, deploy). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeUnfinished } = await import("./lib/pipeline/run");
  // Don't hold up server start; resume in the background
  setTimeout(() => void resumeUnfinished().catch((err) => console.error("[pipeline] resume failed", err)), 3_000);
}
