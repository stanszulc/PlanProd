import { T, s } from '../../constants/theme.js';

export function Dot({ color, size = 8 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

// Poprawiony Bar, aby poprawnie obsługiwał gradient na czystym CSS bez ostrzeżeń