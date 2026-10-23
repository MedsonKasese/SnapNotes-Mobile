export type MenuRect = { x: number; y: number; width: number; height: number };

const DESIRED_WIDTH = 216;
const VIEWPORT_INSET = 12;
const TRIGGER_GAP = 8;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Positions a compact popup relative to window-measured anchor and viewport
 * rectangles. The returned left/top are viewport-local coordinates.
 */
export function getNoteActionsMenuLayout(
  anchor: MenuRect,
  viewport: MenuRect,
  menuHeight: number,
): { left: number; top: number; width: number; maxHeight: number } {
  const viewportX = finiteOrZero(viewport.x);
  const viewportY = finiteOrZero(viewport.y);
  const viewportWidth = nonNegative(viewport.width);
  const viewportHeight = nonNegative(viewport.height);
  const anchorX = finiteOrZero(anchor.x) - viewportX;
  const anchorY = finiteOrZero(anchor.y) - viewportY;
  const anchorWidth = nonNegative(anchor.width);
  const anchorHeight = nonNegative(anchor.height);

  const width = Math.min(DESIRED_WIDTH, Math.max(0, viewportWidth - 2 * VIEWPORT_INSET));
  const maxHeight = Math.max(0, viewportHeight - 2 * VIEWPORT_INSET);
  const height = Math.min(nonNegative(menuHeight), maxHeight);

  // When the viewport itself is smaller than the requested inset, reduce the
  // inset symmetrically so even a zero-sized popup remains inside its bounds.
  const horizontalInset = Math.min(VIEWPORT_INSET, viewportWidth / 2);
  const verticalInset = Math.min(VIEWPORT_INSET, viewportHeight / 2);
  const rightAlignedLeft = anchorX + anchorWidth - width;
  const left = clamp(
    rightAlignedLeft,
    horizontalInset,
    Math.max(horizontalInset, viewportWidth - horizontalInset - width),
  );

  const aboveSpace = anchorY - TRIGGER_GAP - verticalInset;
  const belowSpace = viewportHeight - verticalInset - (anchorY + anchorHeight) - TRIGGER_GAP;
  let preferredTop: number;
  if (aboveSpace >= height) {
    preferredTop = anchorY - TRIGGER_GAP - height;
  } else if (belowSpace >= height) {
    preferredTop = anchorY + anchorHeight + TRIGGER_GAP;
  } else if (aboveSpace >= belowSpace) {
    preferredTop = anchorY - TRIGGER_GAP - height;
  } else {
    preferredTop = anchorY + anchorHeight + TRIGGER_GAP;
  }
  const top = clamp(
    preferredTop,
    verticalInset,
    Math.max(verticalInset, viewportHeight - verticalInset - height),
  );

  return { left, top, width, maxHeight };
}
