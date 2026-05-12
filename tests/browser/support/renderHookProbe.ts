import { useEffect } from "react";
import { renderHook } from "vitest-browser-react";
import type { RenderHookOptions, RenderHookResult } from "vitest-browser-react";

export type HookProbe<Result, Props, Snapshot> = RenderHookResult<Result, Props> & {
  snapshots(): Snapshot[];
};

export async function renderHookProbe<Props, Result, Snapshot>(
  useValue: (props?: Props) => Result,
  selectSnapshot: (value: Result) => Snapshot,
  options?: RenderHookOptions<Props>,
): Promise<HookProbe<Result, Props, Snapshot>> {
  const snapshots: Snapshot[] = [];
  const hook = await renderHook((props?: Props) => {
    const value = useValue(props);

    useEffect(() => {
      snapshots.push(selectSnapshot(value));
    });

    return value;
  }, options);

  return {
    ...hook,
    snapshots: () => [...snapshots],
  };
}
