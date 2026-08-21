export type ToolDevRestartStop = Readonly<{
  app: string;
  status: string;
}>;

export async function startAfterConvergedStops<TStart>(
  stopped: Readonly<Partial<Record<string, ToolDevRestartStop>>>,
  start: () => Promise<TStart>,
): Promise<TStart> {
  const unproven = Object.values(stopped).filter((result) =>
    result != null && result.status !== "not-running" && result.status !== "stopped"
  );
  if (unproven.length > 0) {
    throw new AggregateError(
      unproven.map((result) => new Error(`could not prove ${result!.app} stopped`)),
      "refusing tools-dev restart after an unproven stop",
    );
  }
  return await start();
}
