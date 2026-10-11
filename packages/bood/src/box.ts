/** The drawing's box, in its own units. Every creature is drawn in it. */
export const BOOD_W = 8500;
export const BOOD_H = 5000;
export const VIEW_BOX = `0 0 ${BOOD_W} ${BOOD_H}`;

/** The middle of the box, which most moves turn about. */
export const MIDDLE: [number, number] = [BOOD_W / 2, BOOD_H / 2];
/** Near the feet, which a squash or a jump turns about. */
export const FEET: [number, number] = [BOOD_W / 2, BOOD_H * 0.88];
