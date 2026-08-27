/**
 * "did you mean".
 *
 * A CLI that answers a typo with nothing but "invalid command" makes somebody
 * open the help and read forty lines to find the word they nearly typed. The
 * distance is capped relative to the length so that short words do not suggest
 * each other: `rm` and `ls` are not a near miss.
 */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_value, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row, ...Array.from({ length: columns - 1 }, () => 0)];
    for (let column = 1; column < columns; column += 1) {
      const substitution = previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[columns - 1]!;
}

export function suggest(typed: string, candidates: readonly string[], limit = 2): string[] {
  // One edit for a short word, two for a medium one, never more than three.
  // Generous thresholds turn "did you mean" into a list of everything, which is
  // exactly the help text somebody was trying not to read.
  const threshold = Math.max(1, Math.min(3, Math.floor(typed.length / 4)));
  return candidates
    .map((candidate) => ({ candidate, score: distance(typed, candidate) }))
    .filter((entry) => entry.score <= threshold)
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export function didYouMean(typed: string, candidates: readonly string[]): string {
  const matches = suggest(typed, candidates);
  return matches.length === 0 ? "" : ` Did you mean ${matches.map((one) => `"${one}"`).join(" or ")}?`;
}
