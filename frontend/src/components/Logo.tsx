/** The shield + box mark from ui/index.html (logo option 3C). */
export function Logo({ size = "header" }: { size?: "header" | "hero" }) {
  const isHero = size === "hero";
  const stroke = isHero ? { shield: 5, box: 4 } : { shield: 7, box: 6 };

  return (
    <svg
      width={isHero ? 84 : 24}
      height={isHero ? 92 : 26}
      viewBox="0 0 110 120"
      fill="none"
      style={isHero ? { filter: "drop-shadow(0 10px 16px rgba(43,127,174,0.28))" } : undefined}
    >
      <path
        d="M55 6 L98 22 V60 C98 88 80 106 55 116 C30 106 12 88 12 60 V22 Z"
        stroke="#2b7fae"
        strokeWidth={stroke.shield}
        strokeLinejoin="round"
        fill="#eaf6fc"
      />
      <rect x="35" y="48" width="40" height="34" rx="3" stroke="#12384c" strokeWidth={stroke.box} fill="none" />
      <line x1="35" y1="61" x2="75" y2="61" stroke="#12384c" strokeWidth={stroke.box} />
      <line x1="55" y1="61" x2="55" y2="82" stroke="#12384c" strokeWidth={stroke.box} />
    </svg>
  );
}
