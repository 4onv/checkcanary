export function checkout({ lines }) {
  return { status: 'confirmed',
    total: lines.reduce((sum, line) => sum + line.price * line.quantity, 0) };
}
