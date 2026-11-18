export function checkout({ approved, lines }) {
  return { status: approved ? 'confirmed' : 'requires-approval',
    total: lines.reduce((sum, line) => sum + line.price * line.quantity, 0) };
}
