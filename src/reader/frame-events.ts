export function closestFrameElement<T extends Element>(
  target: EventTarget | null,
  selector: string,
): T | null {
  if (!target || !('closest' in target)) return null;
  const closest = (target as EventTarget & { closest?: unknown }).closest;
  if (typeof closest !== 'function') return null;
  return closest.call(target, selector) as T | null;
}
