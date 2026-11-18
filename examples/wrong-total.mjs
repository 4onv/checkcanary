export function checkout({ approved }) {
  return { status: approved ? 'confirmed' : 'requires-approval', total: 0 };
}
