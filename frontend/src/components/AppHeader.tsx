import { Logo } from "./Logo";

export function AppHeader() {
  return (
    <header
      className="sticky top-0 z-10"
      style={{ background: "#ffffffd9", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-2">
        <Logo />
        <span className="font-extrabold text-[15px]" style={{ color: "var(--navy)" }}>
          Package Protector
        </span>
      </div>
    </header>
  );
}
